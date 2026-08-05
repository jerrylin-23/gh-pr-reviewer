/**
 * Electron entry used only by `scripts/smoke.mjs`.
 *
 * It boots the real main process from `dist-electron/main.js`, then checks the
 * renderer and the preload bridge from the outside and prints one result line.
 * No product code is changed for the test.
 */

import { app, BrowserWindow } from 'electron';

await import('../dist-electron/main.js');

const results = { rendererLoaded: false, preloadApi: false, backendReady: false, repos: null };

function fail(message) {
  console.log(`SMOKE_RESULT ${JSON.stringify({ ok: false, message, results })}`);
  app.exit(1);
}

const hardStop = setTimeout(() => fail('The smoke run timed out.'), 90_000);

async function waitFor(check, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}.`);
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
}

app.whenReady().then(async () => {
  try {
    const window = await waitFor(async () => BrowserWindow.getAllWindows()[0], 20_000, 'a window');
    if (window.webContents.isLoading()) {
      await new Promise((resolve) => window.webContents.once('did-finish-load', resolve));
    }
    results.rendererLoaded = await window.webContents.executeJavaScript(
      'Boolean(document.querySelector("#root") && (document.querySelector(".app--shell") || document.querySelector(".sidebar") || document.querySelector(".app--blocked")))',
    );

    results.preloadApi = await window.webContents.executeJavaScript(
      'typeof window.prReviewer?.repos?.list === "function" && ' +
        'typeof window.prReviewer?.review?.generate === "function" && ' +
        'typeof window.require === "undefined" && typeof window.ipcRenderer === "undefined"',
    );

    results.backendReady = await waitFor(
      () => window.webContents.executeJavaScript('window.prReviewer.system.backendState().status === "ready"'),
      45_000,
      'the Python backend',
    );

    results.repos = await window.webContents.executeJavaScript(
      'window.prReviewer.repos.list().then((r) => JSON.stringify(r))',
    );

    clearTimeout(hardStop);
    console.log(`SMOKE_RESULT ${JSON.stringify({ ok: true, results })}`);
    app.quit();
  } catch (error) {
    clearTimeout(hardStop);
    fail(error.message);
  }
});
