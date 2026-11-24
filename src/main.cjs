'use strict';

const { app, BrowserWindow, Menu, dialog, shell, session, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const {
  WHATSAPP_ORIGIN,
  isWhatsAppOrigin,
  isSafeExternalLink,
  cleanDownloadFilename,
  chromiumUserAgent,
} = require('./security.cjs');
const learningDb = require('./learning-db.cjs');

const WINDOW_TITLE = 'WhatsApp Web — Gráfica do Sorriso';
const SESSION_PARTITION = 'persist:whatsapp-grafica';
let mainWindow = null;
let learningWindow = null;
let isQuitting = false;
let currentMode = learningDb.getMode();

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

// IPC para o visualizador de aprendizado
ipcMain.handle('learning:getData', () => ({
  mode: learningDb.getMode(),
  stats: learningDb.getStats(),
  examples: learningDb.getExamples(200),
}));

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

function injectObserver(window) {
  const injectPath = path.join(__dirname, 'observer-inject.js');
  try {
    const code = fs.readFileSync(injectPath, 'utf8');
    window.webContents.executeJavaScript(code).catch(err => {
      console.warn('Falha ao injetar observador:', err.message);
    });
  } catch (err) {
    console.warn('Não foi possível ler script de observação:', err.message);
  }
}

function openLearningViewer() {
  if (learningWindow && !learningWindow.isDestroyed()) {
    learningWindow.focus();
    return;
  }

  learningWindow = new BrowserWindow({
    width: 720,
    height: 640,
    title: 'Aprendizado da IA',
    backgroundColor: '#111b21',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'learning-preload.cjs'),
    },
  });

  learningWindow.loadFile(path.join(__dirname, 'learning-viewer.html'));
  learningWindow.on('closed', () => { learningWindow = null; });
}

function setMode(mode) {
  currentMode = learningDb.setMode(mode);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setTitle(`${WINDOW_TITLE} [${modeLabel(currentMode)}]`);
  }
}

function modeLabel(mode) {
  return { observer: 'Observador', auto: 'IA Automática', approval: 'IA com Aprovação' }[mode] || mode;
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
      label: 'Modo IA',
      submenu: [
        {
          label: 'Observador (aprender)',
          type: 'radio',
          checked: currentMode === 'observer',
          click: () => setMode('observer'),
        },
        {
          label: 'IA responde sozinha',
          type: 'radio',
          checked: currentMode === 'auto',
          click: () => setMode('auto'),
        },
        {
          label: 'IA responde com aprovação',
          type: 'radio',
          checked: currentMode === 'approval',
          click: () => setMode('approval'),
        },
        { type: 'separator' },
        { label: 'Ver aprendizado da IA', click: openLearningViewer },
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
            detail: 'Aplicativo independente. Modo Observador ativo por padrão.\nA IA observa suas respostas para aprender o seu estilo.\nNão afiliado à WhatsApp LLC ou Meta.',
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

  // Recebe exemplos de aprendizado do script injetado
  window.webContents.on('console-message', () => {});
  window.webContents.executeJavaScript(`
    window.addEventListener('message', (event) => {
      if (event.data && event.data.type === 'IA_LEARNING_EXAMPLE') {
        // será capturado pelo preload ou via ipc
      }
    });
  `).catch(() => {});
}

// Listener global para mensagens do script injetado (via executeJavaScript + postMessage não atravessa facilmente,
// então usamos um canal simples via console ou melhoramos depois)
function setupLearningBridge(window) {
  window.webContents.on('did-finish-load', () => {
    injectObserver(window);
    // Ponte simples: o script usa postMessage, capturamos via executeJavaScript periódico ou melhoramos
    // Por enquanto, expomos uma função global que o script pode chamar se necessário
    window.webContents.executeJavaScript(`
      window.__sendLearningExample = (data) => {
        console.log('LEARNING_EXAMPLE:' + JSON.stringify(data));
      };
    `).catch(() => {});
  });

  window.webContents.on('console-message', (_event, _level, message) => {
    if (typeof message === 'string' && message.startsWith('LEARNING_EXAMPLE:')) {
      try {
        const data = JSON.parse(message.slice('LEARNING_EXAMPLE:'.length));
        if (data.incomingText && data.userReply) {
          learningDb.addExample(data.incomingText, data.userReply, data.chatName);
          console.log('[Aprendizado] Exemplo salvo:', data.incomingText.slice(0, 30));
        }
      } catch (e) {
        console.warn('Falha ao processar exemplo:', e.message);
      }
    }
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
    title: `${WINDOW_TITLE} [${modeLabel(currentMode)}]`,
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
  setupLearningBridge(mainWindow);

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
