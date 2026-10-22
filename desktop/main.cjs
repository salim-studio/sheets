const { app, BrowserWindow, Menu, shell, session, protocol, net } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

app.setName('Sheets');

const ROOT = path.join(__dirname, '..', 'dist');

protocol.registerSchemesAsPrivileged([{
  scheme: 'app',
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
}]);

function serve(request) {
  const url = new URL(request.url);
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(ROOT + path.sep)) return new Response('Not found', { status: 404 });
  return net.fetch(pathToFileURL(file).toString());
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 640,
    minHeight: 420,
    backgroundColor: '#f5f7f6',
    icon: path.join(__dirname, '..', 'icon.png'),
    autoHideMenuBar: true,
    show: !process.env.SHEETS_SMOKE,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  });

  win.loadURL('app://sheets/index.html');

  if (process.env.SHEETS_SMOKE) {
    const fs = require('node:fs');
    win.webContents.once('did-fail-load', (_event, code, description) => {
      fs.writeFileSync(process.env.SHEETS_SMOKE, `load failed: ${code} ${description}`);
      app.quit();
    });
    win.webContents.once('did-finish-load', async () => {
      let result = 'ok';
      try {
        result = await win.webContents.executeJavaScript(`(async () => {
          localStorage.setItem('smoke', '1');
          if (localStorage.getItem('smoke') !== '1') return 'localStorage failed';
          try { await new Promise((resolve, reject) => { const r = indexedDB.open('smoke'); r.onsuccess = resolve; r.onerror = () => reject(r.error); }); }
          catch (e) { return 'indexedDB failed: ' + e; }
          return 'ok';
        })()`);
      } catch (e) { result = String(e); }
      fs.writeFileSync(process.env.SHEETS_SMOKE, result);
      app.quit();
    });
  }

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win.webContents.getURL()) event.preventDefault();
  });
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);

  protocol.handle('app', serve);

  session.defaultSession.on('will-download', (_event, item) => {
    item.setSaveDialogOptions({ title: 'Save sheet', defaultPath: item.getFilename() });
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
