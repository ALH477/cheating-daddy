const { app, BrowserWindow, Worker } = require('electron');  // Enhanced: Added Worker for threading
const path = require('path');
const { initializeRandomProcessNames } = require('./processRandomizer');
const { createWindow } = require('./window');
const { startDCFServices, discoverPeers, validateConfig, monitorPerformance } = require('./networking');

// Enhanced: Offload networking to a worker thread for non-blocking ops
const networkingWorker = new Worker(path.join(__dirname, 'networking.js'));

app.whenReady().then(() => {
  initializeRandomProcessNames();
  const mainWindow = createWindow();
  validateConfig();
  networkingWorker.postMessage({ action: 'startServices' });
  networkingWorker.postMessage({ action: 'discoverPeers', interval: 30000 });  // Throttled
  networkingWorker.postMessage({ action: 'monitorPerformance' });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

networkingWorker.on('message', (msg) => {
  if (msg.type === 'log') console.log(msg.data);
});
