import { app, BrowserWindow, ipcMain } from 'electron';
import assert from 'node:assert/strict';

// Never load LocalCode's main process, real user profile, workspace, or network content.
app.setPath('userData', process.argv[2]);

/** Validate the built preload in Electron's real sandbox; exit nonzero on any bridge error. */
async function verifyBrowserBridge(): Promise<void> {
  await app.whenReady();
  ipcMain.handle('browser:get-feature-state', () => ({ enabled: false }));
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: process.argv[3],
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  await window.loadURL('about:blank');
  const feature = await window.webContents.executeJavaScript(`
    globalThis.browserEventResult = new Promise(resolve => {
      globalThis.offBrowserEvent = window.llmIde.onBrowserEvent(resolve);
    });
    window.llmIde.getBrowserFeatureState();
  `);
  assert.deepEqual(feature, { enabled: false });
  const state = { sessionActive: true, currentUrl: 'https://example.invalid/' };
  window.webContents.send('browser:event', state);
  assert.deepEqual(await window.webContents.executeJavaScript('globalThis.browserEventResult'), state);
  await window.webContents.executeJavaScript('globalThis.offBrowserEvent();');
  window.destroy();
  console.log('browser bridge integration passed');
  app.quit();
}

verifyBrowserBridge().catch(error => {
  console.error(error);
  app.exit(1);
});