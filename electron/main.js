const { app, BrowserWindow } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

let mainWindow;
let backendProcess;
let frontendProcess;

// We use hardcoded ports for simplicity, but in a production app you might
// want to detect open ports to avoid conflicts on the user's machines.
const FRONTEND_PORT = 3000;
const BACKEND_PORT = 4000;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    },
    autoHideMenuBar: true
  });

  // Load the Next.js frontend
  mainWindow.loadURL(`http://localhost:${FRONTEND_PORT}`);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function startBackend() {
  const isDev = !app.isPackaged;
  const backendPath = isDev 
    ? path.join(__dirname, '..', 'rawtorrent_backend', 'dist', 'index.js')
    : path.join(process.resourcesPath, 'app.asar.unpacked', 'rawtorrent_backend', 'dist', 'index.js');

  backendProcess = spawn('node', [backendPath], {
    env: { ...process.env, PORT: BACKEND_PORT, NODE_ENV: 'production' }
  });

  backendProcess.stdout.on('data', (data) => console.log(`Backend: ${data}`));
  backendProcess.stderr.on('data', (data) => console.error(`Backend Err: ${data}`));
}

function startFrontend() {
  const isDev = !app.isPackaged;
  // If in dev, we should ideally start it via npm run dev, but for the packaged app
  // we run the standalone server.
  const frontendPath = isDev
    ? path.join(__dirname, '..', '.next', 'standalone', 'server.js')
    : path.join(process.resourcesPath, 'app.asar.unpacked', '.next', 'standalone', 'server.js');

  frontendProcess = spawn('node', [frontendPath], {
    env: { 
      ...process.env, 
      PORT: FRONTEND_PORT, 
      NODE_ENV: 'production',
      NEXT_PUBLIC_BACKEND_HTTP_URL: `http://localhost:${BACKEND_PORT}`,
      NEXT_PUBLIC_BACKEND_WS_URL: `ws://localhost:${BACKEND_PORT}`
    }
  });

  frontendProcess.stdout.on('data', (data) => console.log(`Frontend: ${data}`));
  frontendProcess.stderr.on('data', (data) => console.error(`Frontend Err: ${data}`));
}

app.on('ready', () => {
  // Check if we are running the built package or dev mode
  // and spawn the backend and frontend accordingly.
  try {
    startBackend();
    startFrontend();

    // Small delay to let the HTTP servers start before loading the window
    setTimeout(createWindow, 2000);
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
  if (mainWindow === null) {
    createWindow();
  }
});

// Ensure we kill child processes when electron exits
app.on('before-quit', () => {
  if (backendProcess) backendProcess.kill();
  if (frontendProcess) frontendProcess.kill();
});
