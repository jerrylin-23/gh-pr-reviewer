/**
 * Electron main process.
 *
 * Responsibilities: own the Python backend lifecycle, own the window, apply the
 * security policy, and register the typed IPC channels. Nothing else.
 */

import { app, BrowserWindow, ipcMain, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { BACKEND_STATE_EVENT, type BackendState } from '../shared/contract';
import { PythonBackend, resolvePythonLocation } from './backend';
import { registerIpcHandlers } from './ipc';
import { attachWindowGuards } from './security';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const DEV_SERVER_URL = process.env.PR_REVIEWER_DEV_SERVER ?? '';

let mainWindow: BrowserWindow | null = null;
let backend: PythonBackend | null = null;
let shuttingDown = false;

const logger = {
  info: (message: string) => console.log(message),
  error: (message: string) => console.error(message),
};

function broadcastBackendState(state: BackendState): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(BACKEND_STATE_EVENT, state);
  }
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 720,
    show: false,
    backgroundColor: '#08080a',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      sandbox: true,
      webviewTag: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
    },
  });

  attachWindowGuards(window.webContents, { devServerOrigin: DEV_SERVER_URL }, shell);

  window.once('ready-to-show', () => window.show());

  // If the backend became ready before the renderer subscribed, push again.
  window.webContents.on('did-finish-load', () => {
    if (backend) {
      broadcastBackendState(backend.getState());
    }
  });

  if (DEV_SERVER_URL) {
    void window.loadURL(DEV_SERVER_URL);
  } else {
    void window.loadFile(path.join(dirname, '..', 'dist', 'index.html'));
  }

  window.on('closed', () => {
    mainWindow = null;
  });

  return window;
}

async function bootstrap(): Promise<void> {
  const location = resolvePythonLocation({
    appPath: app.getAppPath(),
    resourcesPath: process.resourcesPath,
    isPackaged: app.isPackaged,
    env: process.env,
  });

  backend = new PythonBackend(location, logger, broadcastBackendState);

  registerIpcHandlers(ipcMain, backend, shell);

  // Start the engine before the window so the first paint is less likely to
  // race the ready event. The did-finish-load and preload refresh cover the rest.
  const state = await backend.start();

  mainWindow = createWindow();
  broadcastBackendState(state);
}

async function shutdown(): Promise<void> {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  if (backend) {
    await backend.stop();
    backend = null;
  }
}

// One backend and one window per machine. A second launch focuses the first.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.on('web-contents-created', (_event, contents) => {
    attachWindowGuards(contents, { devServerOrigin: DEV_SERVER_URL }, shell);
  });

  app.whenReady().then(bootstrap).catch((error: Error) => {
    logger.error(`main: bootstrap failed: ${error.message}`);
    // The renderer must never sit on "starting" forever.
    broadcastBackendState({
      status: 'failed',
      code: 'BACKEND_START_FAILED',
      message: `The desktop app could not start the Python review engine: ${error.message}`,
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
    }
  });

  // `before-quit` gives the child a bounded chance to exit cleanly. The
  // `will-quit` and `quit` hooks catch the paths that skip it.
  app.on('before-quit', (event) => {
    if (!shuttingDown && backend) {
      event.preventDefault();
      void shutdown().then(() => app.quit());
    }
  });

  process.on('exit', () => {
    void shutdown();
  });
}
