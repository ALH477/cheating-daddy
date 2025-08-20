const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const fs = require('fs');
const path = require('path');
const noble = require('@abandonware/noble');
const mdns = require('mdns');
const winston = require('winston');
const { ipcMain } = require('electron');  // For relaying to renderer

const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'dcf-config.json'), 'utf8'));

const packageDefinition = protoLoader.loadSync(path.join(__dirname, '../messages.proto'));
const proto = grpc.loadPackageDefinition(packageDefinition).dcf;

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.simple(),
  transports: [new winston.transports.File({ filename: 'network.log' })],
});

let server = null;
let clients = new Map();

function startDCFServices() {
  server = new grpc.Server();
  server.addService(proto.DCFService.service, {
    SendMessage: (call, callback) => {
      const msg = call.request;
      logger.info(`Received: ${msg.data}`);
      // Handle types (ai_response, etc.)
      callback(null, { data: 'Acknowledged' });
    },
  });
  server.bindAsync(`${config.host}:${config.port}`, grpc.ServerCredentials.createInsecure(), () => {
    server.start();
  });
}

async function connectToPeer(peerAddress) {
  if (!clients.has(peerAddress)) {
    const client = new proto.DCFService(peerAddress, grpc.credentials.createInsecure());
    clients.set(peerAddress, client);
  }
  return clients.get(peerAddress);
}

async function sendToPeers(payload, recipient = null, type = 'general') {
  const data = JSON.stringify({ type, ...payload });
  clients.forEach((client, address) => {
    if (!recipient || address === recipient) {
      client.SendMessage({ data }, (err, response) => {
        if (err) logger.error(err);
      });
    }
  });
}

function discoverPeers() {
  const browser = mdns.createBrowser(mdns.tcp('dcf-service'));
  browser.on('serviceUp', service => {
    const address = `${service.addresses[0]}:${service.port}`;
    connectToPeer(address);
    ipcMain.emit('peer-discovered', address);  // Relay to renderer for GUI update
  });
  browser.start();
  const ad = mdns.createAdvertisement(mdns.tcp('dcf-service'), config.port);
  ad.start();
}

class CustomBLETransport {
  setup() {
    noble.on('stateChange', state => {
      if (state === 'poweredOn') noble.startScanning();
    });
    noble.on('discover', peripheral => {
      ipcMain.emit('peer-discovered', peripheral.uuid);  // Relay to GUI
    });
  }
  send(data) {
    // BLE write logic
  }
}

if (config.plugins.transport === 'custom_ble_transport') new CustomBLETransport().setup();

module.exports = { startDCFServices, sendToPeers, discoverPeers };
