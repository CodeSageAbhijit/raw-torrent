const { app, BrowserWindow } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const net = require('net');
const { autoUpdater } = require('electron-updater');

let mainWindow;
let backendProcess;
let frontendProcess;
let frontendPortAssigned;
let backendPortAssigned;

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => {
        resolve(port);
      });
    });
  });
}

function createWindow(port, backendPort) {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    },
    autoHideMenuBar: true
  });

  mainWindow.loadURL(`http://127.0.0.1:${port}?wsPort=${backendPort}`);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function startBackend(port) {
  const isDev = !app.isPackaged;
  const backendPath = isDev 
    ? path.join(__dirname, '..', 'rawtorrent_backend', 'dist', 'index.js')
    : path.join(process.resourcesPath, 'app.asar.unpacked', 'rawtorrent_backend', 'dist', 'index.js');

  backendProcess = spawn(process.execPath, [backendPath], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', PORT: port, NODE_ENV: 'production' }
  });

  backendProcess.stdout.on('data', (data) => console.log(`Backend: ${data}`));
  backendProcess.stderr.on('data', (data) => console.error(`Backend Err: ${data}`));
}

function startFrontend(port, backendPort) {
  const isDev = !app.isPackaged;
  const frontendPath = isDev
    ? path.join(__dirname, '..', '.next', 'standalone', 'server.js')
    : path.join(process.resourcesPath, 'app.asar.unpacked', '.next', 'standalone', 'server.js');

  frontendProcess = spawn(process.execPath, [frontendPath], {
    env: { 
      ...process.env, 
      ELECTRON_RUN_AS_NODE: '1',
      PORT: port, 
      HOSTNAME: '127.0.0.1',
      NODE_ENV: 'production',
      BACKEND_URL: `http://127.0.0.1:${backendPort}`,
      NEXT_PUBLIC_BACKEND_HTTP_URL: `http://127.0.0.1:${backendPort}`,
      NEXT_PUBLIC_BACKEND_WS_URL: `ws://127.0.0.1:${backendPort}`
    }
  });

  frontendProcess.stdout.on('data', (data) => console.log(`Frontend: ${data}`));
  frontendProcess.stderr.on('data', (data) => console.error(`Frontend Err: ${data}`));
}

app.on('ready', async () => {
  try {
    // Configure auto updater for background updates
    if (app.isPackaged) {
      autoUpdater.checkForUpdatesAndNotify().catch(err => {
        console.error('Failed to check for updates:', err);
      });

      // Optional: Log when updates happen
      autoUpdater.on('update-downloaded', () => {
        console.log('Update downloaded, ready to install on next restart');
      });
    }

    frontendPortAssigned = await getFreePort();
    backendPortAssigned = await getFreePort();

    startBackend(backendPortAssigned);
    startFrontend(frontendPortAssigned, backendPortAssigned);

    setTimeout(() => {
      if (frontendPortAssigned) createWindow(frontendPortAssigned, backendPortAssigned);
    }, 2000);
  } catch (error) {
    console.error("Failed to start sub-processes:", error);
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null && frontendPortAssigned && backendPortAssigned) {
    createWindow(frontendPortAssigned, backendPortAssigned);
  }
});

const killOrphans = () => {
  if (backendProcess) backendProcess.kill();
  if (frontendProcess) frontendProcess.kill();
};

app.on('before-quit', killOrphans);
app.on('quit', killOrphans);

