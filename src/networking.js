/**
 * @module networking
 * @description DCF wrapper for P2P networking in Cheating Daddy. Handles gRPC server/client, mDNS discovery, and BLE plugin for smart glasses interfacing.
 * @requires @grpc/grpc-js
 * @requires @grpc/proto-loader
 * @requires noble
 * @requires mdns
 * @requires winston
 */

const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const fs = require('fs');
const path = require('path');
const noble = require('@abandonware/noble');  // Enhanced: Switched to Noble for cross-platform BLE
const mdns = require('mdns');
const winston = require('winston');

const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'dcf-config.json'), 'utf8'));

const packageDefinition = protoLoader.loadSync(path.join(__dirname, '../messages.proto'));
const proto = grpc.loadPackageDefinition(packageDefinition).dcf;

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.simple(),
  transports: [new winston.transports.File({ filename: 'network.log' })],
});

let server = null;
let channelPool = [];  // Enhanced: gRPC channel pooling for performance
let clients = new Map();
const MAX_POOL_SIZE = 5;  // Pool size based on grpc.io recommendations

/**
 * Initializes a pool of gRPC channels for load distribution.
 * @function initChannelPool
 * @param {string} address - Peer address for channel creation.
 */
function initChannelPool(address) {
  for (let i = 0; i < MAX_POOL_SIZE; i++) {
    const channel = new grpc.Channel(address, grpc.credentials.createInsecure());
    channelPool.push(channel);
  }
  logger.info(`Initialized gRPC channel pool of size ${MAX_POOL_SIZE} for ${address}`);
}

/**
 * Gets a channel from the pool for RPC calls.
 * @function getPooledChannel
 * @returns {grpc.Channel} - Available channel from pool.
 */
function getPooledChannel() {
  const channel = channelPool.shift();
  channelPool.push(channel);  // Rotate for even distribution
  return channel;
}

function startDCFServices() {
  server = new grpc.Server();
  server.addService(proto.DCFService.service, {
    SendMessage: (call, callback) => {
      const msg = call.request;
      logger.info(`Received from peer ${call.request.recipient}: ${msg.data}`);
      const data = JSON.parse(msg.data);
      switch (data.type) {
        case 'ai_response':
          ipcRenderer.send('display-on-glasses', data.content);
          break;
        case 'sync_history':
          saveConversationSession(msg.sessionId, data.history);
          break;
        case 'remote_control':
          if (data.command === 'screenshot') captureManualScreenshot();
          break;
      }
      callback(null, { data: 'Acknowledged' });
    },
  });
  server.bindAsync(`${config.host}:${config.port}`, grpc.ServerCredentials.createInsecure(), () => {
    server.start();
    logger.info(`DCF server on ${config.port}`);
  });
}

/**
 * Connects to a peer and initializes channel pool.
 * @async
 * @function connectToPeer
 * @param {string} peerAddress - Address of the peer (e.g., 'localhost:50051').
 * @returns {Promise<void>}
 */
async function connectToPeer(peerAddress) {
  if (!clients.has(peerAddress)) {
    initChannelPool(peerAddress);
    const client = new proto.DCFService(getPooledChannel(), grpc.credentials.createInsecure());
    clients.set(peerAddress, client);
    logger.info(`Connected to ${peerAddress} with pooled channels`);
  }
  return clients.get(peerAddress);
}

/**
 * Sends data to peers using pooled channels.
 * @async
 * @function sendToPeers
 * @param {Object} payload - Data payload to send.
 * @param {string|null} [recipient=null] - Specific recipient address.
 * @param {string} [type='general'] - Message type.
 * @returns {Promise<void>}
 */
async function sendToPeers(payload, recipient = null, type = 'general') {
  const data = JSON.stringify({ type, ...payload });
  for (const [address, client] of clients.entries()) {
    if (!recipient || address === recipient) {
      try {
        const response = await new Promise((resolve, reject) => {
          client.SendMessage({ data, recipient: address }, (err, res) => {
            if (err) reject(err);
            else resolve(res);
          });
        });
        logger.info(`Response from ${address}: ${response.data}`);
      } catch (err) {
        logger.error(`Send error to ${address}: ${err}`);
      }
    }
  }
}

/**
 * Discovers peers with throttled scanning to reduce network overhead.
 * @function discoverPeers
 * @param {number} [interval=30000] - Scan interval in ms (default 30s).
 */
function discoverPeers(interval = 30000) {
  const browser = mdns.createBrowser(mdns.tcp('dcf-service'));
  browser.on('serviceUp', service => {
    const address = `${service.addresses[0]}:${service.port}`;
    connectToPeer(address);
    logger.info(`Discovered peer: ${address}`);
  });
  // Enhanced: Throttled start/stop to minimize continuous traffic
  setInterval(() => {
    browser.start();
    setTimeout(() => browser.stop(), 5000);  // Scan for 5s every interval
  }, interval);

  const ad = mdns.createAdvertisement(mdns.tcp('dcf-service'), config.port);
  ad.start();
}

class CustomBLETransport {
  /**
   * Sets up Noble BLE for smart glasses interfacing.
   * @function setup
   */
  setup() {
    noble.on('stateChange', state => {
      if (state === 'poweredOn') {
        noble.startScanning(['fffe'], true);  // Allow duplicates for continuous discovery
        logger.info('Noble BLE scanning started');
      } else {
        logger.warn(`BLE state changed to ${state}; retrying in 5s`);
        setTimeout(() => noble.startScanning(), 5000);  // Enhanced: Retry logic
      }
    });
    noble.on('discover', peripheral => {
      // Connect and exchange data with glasses
      logger.info(`Discovered BLE peripheral: ${peripheral.uuid}`);
      // Low-power: Stop scanning after connection if needed
    });
  }
  /**
   * Sends data over BLE.
   * @function send
   * @param {string} data - Data to send.
   */
  send(data) {
    // Placeholder: Write to characteristic
    logger.info(`BLE send: ${data}`);
  }
  receive() {
    // Placeholder: Handle incoming
  }
}

if (config.plugins.transport === 'custom_ble_transport') {
  const ble = new CustomBLETransport();
  ble.setup();
}

function validateConfig() {
  if (!config.port) throw new Error('Invalid config: Missing port');
  logger.info('Config validated');
}

function simulatePeer(address, mockData) {
  connectToPeer(address);
  setInterval(() => sendToPeers(mockData, address, 'test'), 5000);
}

function monitorPerformance() {
  setInterval(async () => {
    const start = Date.now();
    await sendToPeers({ test: 'ping' });
    const latency = Date.now() - start;
    logger.info(`Latency: ${latency}ms`);
  }, 30000);
}

module.exports = {
  startDCFServices,
  sendToPeers,
  discoverPeers,
  validateConfig,
  simulatePeer,
  monitorPerformance,
};
