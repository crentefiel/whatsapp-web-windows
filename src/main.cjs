'use strict';

const { app, BrowserWindow, Menu, dialog, shell, session } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const {
  WHATSAPP_ORIGIN,
  isWhatsAppOrigin,
  isSafeExternalLink,
  cleanDownloadFilename,
  chromiumUserAgent,
} = require('./security.cjs');

const WINDOW_TITLE = 'WhatsApp Web — Gráfica do Sorriso';
const SESSION_PARTITION = 'persist:whatsapp-grafica';
let mainWindow = null;
let isQuitting = false;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady().then(launch).catch((error) => {
    console.error('Falha ao abrir WhatsApp Web:', error);
    dialog.showErrorBox('Erro ao iniciar', String(error.message || error));
    app.quit();
  });
}

app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => { isQuitting = true; });

function getBoundsPath() {
  return path.join(app.getPath('userData'), 'window.json');
}

function loadWindowBounds() {
  try {
    const saved = JSON.parse(fs.readFileSync(getBoundsPath(), 'utf8'));
    const { width, height } = saved;
    if (Number.isInteger(width) && Number.isInteger(height) &&
        width >= 900 && height >= 650 && width <= 4000 && height <= 2600) {
      return { width, height };
    }
  } catch {
    // Primeira inicialização.
  }
  return { width: 1280, height: 820 };
}

function saveWindowBounds(window) {
  if (!window || window.isDestroyed() || window.isMinimized() || window.isMaximized()) return;
  try {
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    const { width, height } = window.getBounds();
    fs.writeFileSync(getBoundsPath(), JSON.stringify({ width, height }));
  } catch (error) {
    console.warn('Não foi possível salvar tamanho da janela:', error.message);
  }
}

function configureSession(waSession) {
  // Usa a identificação de Chromium. Não intercepta nem lê mensagens.
  waSession.setUserAgent(chromiumUserAgent(waSession.getUserAgent()));

  waSession.setPermissionCheckHandler((_contents, permission, requestingOrigin) =>
    isWhatsAppOrigin(requestingOrigin) &&
      ['media', 'notifications', 'clipboard-sanitized-write'].includes(permission)
  );

  waSession.setPermissionRequestHandler(async (contents, permission, callback, details) => {
    const requestingUrl = (details && details.requestingUrl) || (contents && contents.getURL()) || '';
    if (!isWhatsAppOrigin(requestingUrl)) return callback(false);
    if (permission === 'notifications' || permission === 'clipboard-sanitized-write') {
      return callback(true);
    }
    if (permission !== 'media') return callback(false);

    try {
      const types = (details && details.mediaTypes) || [];
      const description = types.includes('video') ? 'câmera e microfone' : 'microfone';
      const result = await dialog.showMessageBox(mainWindow || undefined, {
        type: 'question',
        buttons: ['Permitir', 'Bloquear'],
        defaultId: 0,
        cancelId: 1,
        title: 'Permissão do WhatsApp Web',
        message: 'Permitir acesso ao ' + description + '?',
        detail: 'Necessário para gravação de áudio e recursos de chamada quando disponíveis.',
      });
      callback(result.response === 0);
    } catch {
      callback(false);
    }
  });

  waSession.on('will-download', (_event, item) => {
    const filename = cleanDownloadFilename(item.getFilename());
    const filePath = dialog.showSaveDialogSync(mainWindow || undefined, {
      title: 'Salvar anexo do WhatsApp',
      defaultPath: path.join(app.getPath('downloads'), filename),
      buttonLabel: 'Salvar',
    });
    if (!filePath) {
      item.cancel();
      return;
    }
    item.setSavePath(filePath);
  });
}

function installMenu(window) {
  const menu = Menu.buildFromTemplate([
    {
      label: 'WhatsApp',
      submenu: [
        { label: 'Recarregar', accelerator: 'CmdOrCtrl+R', click: () => window.webContents.reload() },
        { label: 'Recarregar sem cache', accelerator: 'CmdOrCtrl+Shift+R', click: () => window.webContents.reloadIgnoringCache() },
        { type: 'separator' },
        { label: 'Abrir pasta Downloads', click: () => shell.openPath(app.getPath('downloads')) },
        { type: 'separator' },
        { role: 'quit', label: 'Sair' },
      ],
    },
    {
      label: 'Exibir',
      submenu: [
        { role: 'zoomIn', label: 'Aumentar zoom' },
        { role: 'zoomOut', label: 'Diminuir zoom' },
        { role: 'resetZoom', label: 'Restaurar zoom' },
        { role: 'togglefullscreen', label: 'Tela cheia' },
      ],
    },
    {
      label: 'Ajuda',
      submenu: [
        { label: 'Abrir WhatsApp no navegador', click: () => shell.openExternal(WHATSAPP_ORIGIN) },
        {
          label: 'Sobre',
          click: () => dialog.showMessageBox(window, {
            type: 'info',
            title: 'Sobre',
            message: 'WhatsApp Web — Gráfica do Sorriso',
            detail: 'Aplicativo independente que abre o WhatsApp Web oficial. Não afiliado à WhatsApp LLC ou Meta. Sem IA nesta fase.',
          }),
        },
      ],
    },
  ]);
  Menu.setApplicationMenu(menu);
}

function configureWindowSecurity(window) {
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalLink(url) && !isWhatsAppOrigin(url)) {
      shell.openExternal(url).catch((error) => console.warn('Falha ao abrir link:', error.message));
    }
    return { action: 'deny' };
  });

  window.webContents.on('will-navigate', (event, url) => {
    if (isWhatsAppOrigin(url)) return;
    event.preventDefault();
    if (isSafeExternalLink(url)) {
      shell.openExternal(url).catch((error) => console.warn('Falha ao abrir link:', error.message));
    }
  });

  window.webContents.on('did-fail-load', (_event, code, description, validatedURL, isMainFrame) => {
    if (!isMainFrame || code === -3 || !isWhatsAppOrigin(validatedURL)) return;
    console.error('WhatsApp Web indisponível (' + code + '): ' + description);
    dialog.showMessageBox(window, {
      type: 'warning',
      title: 'Falha de conexão',
      message: 'Não foi possível carregar o WhatsApp Web.',
      detail: 'Verifique a internet e selecione WhatsApp > Recarregar.',
    }).catch(() => {});
  });
}

async function launch() {
  app.setName('WhatsApp Web - Grafica do Sorriso');
  const waSession = session.fromPartition(SESSION_PARTITION, { cache: true });
  configureSession(waSession);

  mainWindow = new BrowserWindow({
    ...loadWindowBounds(),
    minWidth: 900,
    minHeight: 650,
    title: WINDOW_TITLE,
    backgroundColor: '#111b21',
    show: false,
    autoHideMenuBar: false,
    webPreferences: {
      partition: SESSION_PARTITION,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      spellcheck: true,
    },
  });

  configureWindowSecurity(mainWindow);
  installMenu(mainWindow);

  mainWindow.once('ready-to-show', () => {
    if (!isQuitting && mainWindow && !mainWindow.isDestroyed()) mainWindow.show();
  });
  mainWindow.on('close', () => saveWindowBounds(mainWindow));
  mainWindow.on('closed', () => { mainWindow = null; });

  try {
    await mainWindow.loadURL(WHATSAPP_ORIGIN);
  } catch (error) {
    console.warn('Não foi possível carregar agora:', error.message);
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show();
  }
}
