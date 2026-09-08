const {
  app,
  BrowserWindow,
  BrowserView,
  Tray,
  Menu,
  globalShortcut,
  clipboard,
  nativeImage,
  ipcMain,
  session,
  screen
} = require('electron');
const path = require('path');
const fs = require('fs');
const screenshot = require('screenshot-desktop');

// Desktop User-Agents
const CHROME_DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const SAFARI_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';

// --- Disable Automation Flags & Force Genuine User-Agent Globally ---
app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled');
app.commandLine.appendSwitch('user-agent', CHROME_DESKTOP_UA);
app.userAgentFallback = CHROME_DESKTOP_UA;

// --- Native Win32 Display Affinity & Global Mouse Polling via Koffi ---
let SetWindowDisplayAffinity = null;
let EnumChildWindows = null;
let GetAsyncKeyState = null;
const WDA_NONE = 0x00000000;
const WDA_MONITOR = 0x00000001;
const WDA_EXCLUDEFROMCAPTURE = 0x00000011; // 17 (Windows 10 2004+ / Windows 11)

try {
  const koffi = require('koffi');
  const user32 = koffi.load('user32.dll');
  SetWindowDisplayAffinity = user32.func('bool __stdcall SetWindowDisplayAffinity(uintptr_t hWnd, uint32_t dwAffinity)');
  const WNDENUMPROC = koffi.proto('bool __stdcall WNDENUMPROC(uintptr_t hWnd, intptr_t lParam)');
  EnumChildWindows = user32.func('bool __stdcall EnumChildWindows(uintptr_t hWndParent, WNDENUMPROC* lpEnumFunc, intptr_t lParam)');
  GetAsyncKeyState = user32.func('int16_t __stdcall GetAsyncKeyState(int vKey)');
  console.log('[AntiRecAI] Loaded Win32 SetWindowDisplayAffinity, EnumChildWindows & GetAsyncKeyState.');
} catch (e) {
  console.warn('[AntiRecAI] Could not load Win32 native display affinity / mouse APIs:', e.message);
}

// --- Persistent Settings Engine ---
const DEFAULT_SETTINGS = {
  activeSite: 'gemini',
  currentUrl: 'https://gemini.google.com/app',
  customServiceUrl: '',
  customPrompt: 'Provide only a short, direct answer: ',
  opacity: 1.0,
  alwaysOnTop: true,
  antiObs: true,
  bounds: null,
  hotkeys: {
    toggle: 'CommandOrControl+Shift+H',
    snip: 'CommandOrControl+Shift+S',
    exit: 'CommandOrControl+Shift+End'
  }
};

let userSettings = { ...DEFAULT_SETTINGS };

function getSettingsFilePath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function loadSettingsFromDisk() {
  try {
    const filePath = getSettingsFilePath();
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf8');
      userSettings = Object.assign({}, DEFAULT_SETTINGS, JSON.parse(raw));
      console.log('[AntiRecAI] Loaded persistent settings from disk.');
    }
  } catch (err) {
    console.warn('[AntiRecAI] Failed to read settings, using defaults:', err.message);
  }
}

let saveTimeout = null;
function saveSettingsToDisk() {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    try {
      const filePath = getSettingsFilePath();
      fs.writeFileSync(filePath, JSON.stringify(userSettings, null, 2), 'utf8');
    } catch (err) {
      console.error('[AntiRecAI] Failed to write settings to disk:', err.message);
    }
  }, 300);
}

// --- Global Variables ---
let mainWindow = null;
let aiView = null;
let tray = null;
let isQuitting = false;

// Ensure single instance
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
}

/**
 * Apply WDA_EXCLUDEFROMCAPTURE to root and all child HWNDs
 */
function applyScreenProtection(win, enable = null) {
  if (!win || win.isDestroyed()) return;

  const isEnabled = enable !== null ? enable : (userSettings.antiObs !== false);

  try {
    win.setContentProtection(isEnabled);
  } catch (e) {
    console.warn('[AntiRecAI] Electron setContentProtection warning:', e.message);
  }

  if (SetWindowDisplayAffinity && process.platform === 'win32') {
    try {
      const handleBuffer = win.getNativeWindowHandle();
      const hwnd = process.arch === 'x64' || process.arch === 'arm64'
        ? handleBuffer.readBigUInt64LE(0)
        : handleBuffer.readUInt32LE(0);

      const affinity = isEnabled ? WDA_EXCLUDEFROMCAPTURE : WDA_NONE;
      const res = SetWindowDisplayAffinity(hwnd, affinity);
      if (!res && isEnabled) {
        SetWindowDisplayAffinity(hwnd, WDA_MONITOR);
      }

      if (EnumChildWindows) {
        const enumCallback = (childHwnd) => {
          SetWindowDisplayAffinity(childHwnd, affinity);
          return true;
        };
        EnumChildWindows(hwnd, enumCallback, 0);
      }
      console.log(`[AntiRecAI] Anti-OBS mode: ${isEnabled ? 'ENABLED (Hidden)' : 'DISABLED (Visible)'}`);
    } catch (err) {
      console.error('[AntiRecAI] Failed applying native display affinity:', err);
    }
  }
}

/**
 * Configure Session with Clean Headers & Stealth Preload for Google OAuth
 */
function setupSessionSecurity() {
  const stealthPreloadPath = path.join(__dirname, 'stealth-preload.js');

  // Configure Default Session
  session.defaultSession.setUserAgent(CHROME_DESKTOP_UA);
  session.defaultSession.setPreloads([stealthPreloadPath]);

  // Configure Partition Session
  const ses = session.fromPartition('persist:gemini_session');
  ses.setUserAgent(CHROME_DESKTOP_UA);
  ses.setPreloads([stealthPreloadPath]);

  // Strip Electron traces and dynamically route Google OAuth
  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    const isGoogleAuth =
      details.url.includes('accounts.google.com') ||
      details.url.includes('accounts.youtube.com') ||
      details.url.includes('myaccount.google.com') ||
      details.url.includes('google.com/signin');

    if (isGoogleAuth) {
      // Safari desktop user agent bypasses Google CEF/Electron bot detection checks
      details.requestHeaders['User-Agent'] = SAFARI_UA;
      delete details.requestHeaders['sec-ch-ua'];
      delete details.requestHeaders['sec-ch-ua-mobile'];
      delete details.requestHeaders['sec-ch-ua-platform'];
      delete details.requestHeaders['X-Requested-With'];
    } else {
      details.requestHeaders['User-Agent'] = CHROME_DESKTOP_UA;
      details.requestHeaders['sec-ch-ua'] = '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"';
      details.requestHeaders['sec-ch-ua-mobile'] = '?0';
      details.requestHeaders['sec-ch-ua-platform'] = '"Windows"';
      delete details.requestHeaders['X-Requested-With'];
    }

    callback({ cancel: false, requestHeaders: details.requestHeaders });
  });
}

/**
 * Generate fallback tray icon
 */
function createFallbackTrayIcon() {
  const base64Icon =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAABmJLR0QA/wD/' +
    'AP+gvaeTAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAB3RJTUUH6AMDCQEvsV/21wAAAYZJREFUWMO1171L' +
    'w0AUwPHvXWqtiIuIoqsg+Bs4OHVz9A8Q/AMqDs5uDg5CRycHOzqJODi4uQiKqKCDg1K11ba55+C0X5q0' +
    'j7YQ8vLw3r3L5ZJ7B27xW84U7vEId2B78gB3n0W417F6r1o9b62/rQkR0QW6gA+UAA+oAA1gAkyBCXBj' +
    'rR1rIuK3B8Z4g29gDTxZB42/N8A60AQmgSfg3lo79qf3W1Z03wLqQAWoAiVg0XquC9wAN8ARcAbcWmvv' +
    'vN6v5n0+B3KAA2ytPfgBjgVfgU/AQf+9gQeGz3uG73d8P/R6Q0NExg2bNzy1B4wbtmC4sIzhwPqGC/s0' +
    'HNg/hvvhwb2fIuJrv10r1gD9y0bX/sH+20790F3Z3302BnwEfsyv/QnQf3b970T8gXW7A+1VnAPrQA4o' +
    'AWmglcR17zqwA+wA58AFcAxsW2t7/e7n1vNlX897X+8rI/qD7g+6f5zE53l9/7/m9X1vA35a14737U1a' +
    '3z683v8C4UeX3RzI6mAAAAAElFTkSuQmCC';

  return nativeImage.createFromDataURL(base64Icon);
}

/**
 * Update the AI BrowserView bounds to fit below custom header (40px)
 */
function updateViewBounds() {
  if (!mainWindow || !aiView) return;
  const [width, height] = mainWindow.getSize();
  aiView.setBounds({
    x: 0,
    y: 40,
    width: width,
    height: Math.max(0, height - 40)
  });
}

/**
 * Create the Frameless Window with Custom Header & AI View
 */
function createWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;

  let x, y, width, height;

  if (userSettings.bounds && typeof userSettings.bounds.x === 'number') {
    x = userSettings.bounds.x;
    y = userSettings.bounds.y;
    width = userSettings.bounds.width;
    height = userSettings.bounds.height;
  } else {
    width = 520;
    height = Math.min(840, screenHeight - 60);
    x = screenWidth - width - 28;
    y = Math.max(20, Math.floor((screenHeight - height) / 2));
  }

  const iconPath = path.join(__dirname, 'assets', 'IconMain.png');

  mainWindow = new BrowserWindow({
    x,
    y,
    width,
    height,
    minWidth: 400,
    minHeight: 520,
    show: false,
    frame: false, // Custom sleek titlebar
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    autoHideMenuBar: true,
    alwaysOnTop: userSettings.alwaysOnTop,
    skipTaskbar: true, // Hidden from Taskbar & Alt-Tab
    backgroundColor: '#121316',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  // Apply saved opacity
  if (typeof userSettings.opacity === 'number') {
    mainWindow.setOpacity(userSettings.opacity);
  }

  // Load custom Header UI
  mainWindow.loadFile(path.join(__dirname, 'header.html'));

  // Create embedded AI BrowserView
  aiView = new BrowserView({
    webPreferences: {
      partition: 'persist:gemini_session', // Persistent multi-AI cookies
      nodeIntegration: false,
      contextIsolation: true,
      spellcheck: true
    }
  });

  mainWindow.setBrowserView(aiView);
  updateViewBounds();

  // Load initial AI service with Chrome User-Agent
  aiView.webContents.setUserAgent(CHROME_DESKTOP_UA);
  aiView.webContents.loadURL(userSettings.currentUrl, {
    userAgent: CHROME_DESKTOP_UA
  });

  // Handle OAuth popups properly in the same partition
  aiView.webContents.setWindowOpenHandler(({ url }) => {
    if (
      url.includes('accounts.google.com') ||
      url.includes('google.com/signin') ||
      url.includes('auth0.openai.com') ||
      url.includes('auth.openai.com') ||
      url.includes('claude.ai/login') ||
      url.includes('auth.anthropic.com') ||
      url.includes('gemini.google.com') ||
      url.includes('chatgpt.com')
    ) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 500,
          height: 680,
          autoHideMenuBar: true,
          webPreferences: {
            partition: 'persist:gemini_session',
            nodeIntegration: false,
            contextIsolation: true
          }
        }
      };
    }
    require('electron').shell.openExternal(url);
    return { action: 'deny' };
  });

  // Reapply screen protection on all window events
  applyScreenProtection(mainWindow);

  mainWindow.once('ready-to-show', () => {
    applyScreenProtection(mainWindow);
    // Send initial persistent settings to header UI
    if (mainWindow.webContents) {
      mainWindow.webContents.send('initial-settings', userSettings);
    }
  });

  mainWindow.on('show', () => {
    applyScreenProtection(mainWindow);
  });

  mainWindow.on('focus', () => {
    applyScreenProtection(mainWindow);
  });

  const recordBounds = () => {
    if (mainWindow && !mainWindow.isMinimized()) {
      const b = mainWindow.getBounds();
      userSettings.bounds = b;
      saveSettingsToDisk();
    }
  };

  mainWindow.on('resize', () => {
    updateViewBounds();
    recordBounds();
  });

  mainWindow.on('move', () => {
    recordBounds();
  });

  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
    return false;
  });
}

/**
 * Setup Windows System Tray
 */
function setupTray() {
  if (!tray) {
    const iconPath = path.join(__dirname, 'assets', 'IconMain.png');
    let icon = null;
    if (fs.existsSync(iconPath)) {
      icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
    } else {
      icon = createFallbackTrayIcon();
    }
    tray = new Tray(icon);
    tray.setToolTip('AntiRecAI (Stealth Overlay)');
    tray.on('click', () => toggleWindowVisibility());
    tray.on('double-click', () => toggleWindowVisibility());
  }

  const hotkeys = userSettings.hotkeys || DEFAULT_SETTINGS.hotkeys;
  const toggleLabel = (hotkeys.toggle || 'Ctrl+Shift+H').replace('CommandOrControl', 'Ctrl');
  const snipLabel = (hotkeys.snip || 'Ctrl+Shift+S').replace('CommandOrControl', 'Ctrl');
  const exitLabel = (hotkeys.exit || 'Ctrl+Shift+End').replace('CommandOrControl', 'Ctrl');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: `Toggle Overlay (${toggleLabel})`,
      click: () => toggleWindowVisibility()
    },
    {
      label: `Capture & Query (${snipLabel})`,
      click: () => triggerScreenshotWorkflow()
    },
    { type: 'separator' },
    {
      label: 'Anti-OBS Stealth Mode',
      type: 'checkbox',
      checked: userSettings.antiObs !== false,
      click: (item) => {
        userSettings.antiObs = item.checked;
        saveSettingsToDisk();
        applyScreenProtection(mainWindow, item.checked);
        if (mainWindow && mainWindow.webContents) {
          mainWindow.webContents.send('initial-settings', userSettings);
        }
      }
    },
    {
      label: 'Always On Top',
      type: 'checkbox',
      checked: userSettings.alwaysOnTop !== false,
      click: (item) => {
        userSettings.alwaysOnTop = item.checked;
        saveSettingsToDisk();
        if (mainWindow) mainWindow.setAlwaysOnTop(item.checked, 'screen-saver');
        if (mainWindow && mainWindow.webContents) {
          mainWindow.webContents.send('initial-settings', userSettings);
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Switch to Gemini',
      click: () => switchService('https://gemini.google.com/app', 'gemini')
    },
    {
      label: 'Switch to ChatGPT',
      click: () => switchService('https://chatgpt.com/', 'chatgpt')
    },
    {
      label: 'Switch to Claude',
      click: () => switchService('https://claude.ai/new', 'claude')
    },
    { type: 'separator' },
    {
      label: 'Reload Active Page',
      click: () => {
        if (aiView) aiView.webContents.reload();
      }
    },
    {
      label: 'Clear Cache & Sign Out',
      click: async () => {
        const ses = session.fromPartition('persist:gemini_session');
        await ses.clearStorageData();
        if (aiView) aiView.webContents.reload();
      }
    },
    { type: 'separator' },
    {
      label: `Quit AntiRecAI (${exitLabel})`,
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(contextMenu);
}

function toggleWindowVisibility() {
  if (!mainWindow) return;

  if (mainWindow.isVisible()) {
    mainWindow.hide();
  } else {
    mainWindow.show();
    mainWindow.focus();
    applyScreenProtection(mainWindow);
  }
}

function switchService(url, siteKey) {
  userSettings.currentUrl = url;
  if (siteKey) userSettings.activeSite = siteKey;
  saveSettingsToDisk();

  if (aiView) {
    aiView.webContents.loadURL(url, { userAgent: CHROME_DESKTOP_UA });
  }
  if (mainWindow && mainWindow.webContents && siteKey) {
    mainWindow.webContents.send('site-changed', siteKey);
  }
}

/**
 * Universal Multi-AI Prompt & Screenshot Injector
 */
async function triggerScreenshotWorkflow() {
  try {
    console.log('[AntiRecAI] Capturing screen in memory...');
    const imgBuffer = await screenshot({ format: 'png' });

    const image = nativeImage.createFromBuffer(imgBuffer);
    clipboard.writeImage(image);
    console.log('[AntiRecAI] Screenshot copied to clipboard.');

    if (!mainWindow.isVisible()) {
      mainWindow.show();
    }
    mainWindow.focus();
    mainWindow.moveTop();
    applyScreenProtection(mainWindow);

    if (!aiView || !aiView.webContents) return;

    // Focus editor and trigger native paste
    const universalFocusScript = `
      (async function() {
        const url = window.location.href;
        let target = null;

        if (url.includes('gemini.google.com')) {
          target = document.querySelector('rich-textarea div[contenteditable="true"]') ||
                   document.querySelector('div[contenteditable="true"]') ||
                   document.querySelector('div[role="textbox"]');
        } else if (url.includes('chatgpt.com')) {
          target = document.querySelector('#prompt-textarea') ||
                   document.querySelector('div[contenteditable="true"]') ||
                   document.querySelector('textarea');
        } else if (url.includes('claude.ai')) {
          target = document.querySelector('div[contenteditable="true"].ProseMirror') ||
                   document.querySelector('div[contenteditable="true"]');
        } else {
          target = document.querySelector('div[contenteditable="true"]') || document.querySelector('textarea');
        }

        if (target) {
          target.focus();
          return true;
        }
        return false;
      })();
    `;

    await aiView.webContents.executeJavaScript(universalFocusScript);
    aiView.webContents.paste(); // Native paste into active AI editor

    // Wait for attachment upload to initialize, then inject prompt and send
    setTimeout(async () => {
      const promptToUse = userSettings.customPrompt || 'Provide only a short, direct answer: ';
      const submitScript = `
        (async function() {
          const url = window.location.href;
          const prompt = ${JSON.stringify(promptToUse)};
          let target = null;
          let sendBtn = null;

          if (url.includes('gemini.google.com')) {
            target = document.querySelector('rich-textarea div[contenteditable="true"]') ||
                     document.querySelector('div[contenteditable="true"]');
            sendBtn = document.querySelector('button[aria-label*="Send prompt"]') ||
                      document.querySelector('button[aria-label*="Send message"]') ||
                      document.querySelector('button.send-button');
          } else if (url.includes('chatgpt.com')) {
            target = document.querySelector('#prompt-textarea') ||
                     document.querySelector('div[contenteditable="true"]');
            sendBtn = document.querySelector('button[data-testid="send-button"]') ||
                      document.querySelector('button[aria-label*="Send prompt"]');
          } else if (url.includes('claude.ai')) {
            target = document.querySelector('div[contenteditable="true"].ProseMirror') ||
                     document.querySelector('div[contenteditable="true"]');
            sendBtn = document.querySelector('button[aria-label*="Send Message"]') ||
                      document.querySelector('button:has(svg)');
          } else {
            target = document.querySelector('div[contenteditable="true"]') || document.querySelector('textarea');
          }

          if (target) {
            target.focus();
            document.execCommand('insertText', false, prompt);
            target.dispatchEvent(new Event('input', { bubbles: true }));
            target.dispatchEvent(new Event('change', { bubbles: true }));

            setTimeout(() => {
              if (sendBtn && !sendBtn.disabled) {
                sendBtn.click();
              } else {
                target.dispatchEvent(new KeyboardEvent('keydown', {
                  key: 'Enter',
                  code: 'Enter',
                  keyCode: 13,
                  which: 13,
                  bubbles: true
                }));
              }
            }, 350);
          }
        })();
      `;

      await aiView.webContents.executeJavaScript(submitScript);
    }, 650);
  } catch (err) {
    console.error('[AntiRecAI] Screenshot workflow error:', err);
  }
}

// --- Global Mouse Shortcut Poller via Win32 GetAsyncKeyState ---
let mouseBindings = [];
let mousePollInterval = null;
let prevButtonStates = {};

function isMouseShortcut(acceleratorStr) {
  if (!acceleratorStr || typeof acceleratorStr !== 'string') return false;
  return /mouse|mbutton|xbutton|middle|rightclick|leftclick/i.test(acceleratorStr);
}

function parseMouseShortcut(id, acceleratorStr, action) {
  if (!acceleratorStr) return null;
  const str = acceleratorStr.toLowerCase();

  let vk = null;
  if (str.includes('mouse4') || str.includes('xbutton1') || str.includes('side1')) {
    vk = 0x05; // VK_XBUTTON1
  } else if (str.includes('mouse5') || str.includes('xbutton2') || str.includes('side2')) {
    vk = 0x06; // VK_XBUTTON2
  } else if (str.includes('mouse3') || str.includes('middleclick') || str.includes('mbutton') || str.includes('middle')) {
    vk = 0x04; // VK_MBUTTON
  } else if (str.includes('rightclick') || str.includes('rbutton')) {
    vk = 0x02; // VK_RBUTTON
  } else if (str.includes('leftclick') || str.includes('lbutton')) {
    vk = 0x01; // VK_LBUTTON
  }

  if (vk === null) return null;

  return {
    id,
    vk,
    ctrl: /ctrl|control|commandorcontrol/i.test(str),
    shift: /shift/i.test(str),
    alt: /alt/i.test(str),
    meta: /meta|super|win/i.test(str),
    action
  };
}

function startMouseShortcutPoller() {
  if (mousePollInterval) return;
  if (!GetAsyncKeyState || process.platform !== 'win32') return;

  mousePollInterval = setInterval(() => {
    if (mouseBindings.length === 0) return;

    const ctrlDown = (GetAsyncKeyState(0x11) & 0x8000) !== 0;
    const shiftDown = (GetAsyncKeyState(0x10) & 0x8000) !== 0;
    const altDown = (GetAsyncKeyState(0x12) & 0x8000) !== 0;
    const winDown = ((GetAsyncKeyState(0x5B) | GetAsyncKeyState(0x5C)) & 0x8000) !== 0;

    for (const binding of mouseBindings) {
      const isBtnDown = (GetAsyncKeyState(binding.vk) & 0x8000) !== 0;
      const wasBtnDown = !!prevButtonStates[binding.id];
      prevButtonStates[binding.id] = isBtnDown;

      // Trigger once on press (edge transition: released -> pressed)
      if (isBtnDown && !wasBtnDown) {
        const matchCtrl = binding.ctrl === ctrlDown;
        const matchShift = binding.shift === shiftDown;
        const matchAlt = binding.alt === altDown;
        const matchWin = binding.meta === winDown;

        if (matchCtrl && matchShift && matchAlt && matchWin) {
          console.log(`[AntiRecAI] Triggered mouse shortcut for: ${binding.id}`);
          binding.action();
        }
      }
    }
  }, 16); // ~60 checks/sec, ~0% CPU
}

function stopMouseShortcutPoller() {
  if (mousePollInterval) {
    clearInterval(mousePollInterval);
    mousePollInterval = null;
  }
}

/**
 * Register Configurable Global Shortcuts (Keyboard & Mouse Buttons)
 */
function registerShortcuts() {
  globalShortcut.unregisterAll();
  mouseBindings = [];
  prevButtonStates = {};

  const hotkeys = userSettings.hotkeys || DEFAULT_SETTINGS.hotkeys;
  const toggleKey = hotkeys.toggle || 'CommandOrControl+Shift+H';
  const snipKey = hotkeys.snip || 'CommandOrControl+Shift+S';
  const exitKey = hotkeys.exit || 'CommandOrControl+Shift+End';

  const shortcutDefs = [
    { id: 'toggle', key: toggleKey, action: () => toggleWindowVisibility() },
    { id: 'snip', key: snipKey, action: () => triggerScreenshotWorkflow() },
    {
      id: 'exit',
      key: exitKey,
      action: () => {
        console.log('[AntiRecAI] Stop process triggered by shortcut');
        isQuitting = true;
        app.quit();
      }
    }
  ];

  let hasMouseBinding = false;

  for (const def of shortcutDefs) {
    if (isMouseShortcut(def.key)) {
      const parsed = parseMouseShortcut(def.id, def.key, def.action);
      if (parsed) {
        mouseBindings.push(parsed);
        hasMouseBinding = true;
        console.log(`[AntiRecAI] Registered mouse shortcut: ${def.id} -> ${def.key}`);
      }
    } else {
      try {
        const res = globalShortcut.register(def.key, def.action);
        if (!res) console.warn(`[AntiRecAI] Failed to register keyboard shortcut: ${def.key}`);
        else console.log(`[AntiRecAI] Registered keyboard shortcut: ${def.id} -> ${def.key}`);
      } catch (e) {
        console.warn(`[AntiRecAI] Invalid shortcut syntax: ${def.key}`, e.message);
      }
    }
  }

  if (hasMouseBinding) {
    startMouseShortcutPoller();
  } else {
    stopMouseShortcutPoller();
  }

  setupTray();
}

/**
 * IPC Communication with Header UI
 */
function setupIpcHandlers() {
  ipcMain.handle('app-get-settings', () => {
    return userSettings;
  });

  ipcMain.handle('app-get-version', () => {
    return app.getVersion();
  });

  ipcMain.on('app-save-settings', (_event, newSettings) => {
    const hotkeysChanged =
      newSettings.hotkeys &&
      JSON.stringify(newSettings.hotkeys) !== JSON.stringify(userSettings.hotkeys);

    Object.assign(userSettings, newSettings);
    if (newSettings.hotkeys) {
      userSettings.hotkeys = Object.assign({}, DEFAULT_SETTINGS.hotkeys, newSettings.hotkeys);
    }
    saveSettingsToDisk();

    if (hotkeysChanged) {
      registerShortcuts();
    }
  });

  ipcMain.on('app-navigate', (_event, url) => {
    userSettings.currentUrl = url;
    saveSettingsToDisk();
    if (aiView) aiView.webContents.loadURL(url, { userAgent: CHROME_DESKTOP_UA });
  });

  ipcMain.on('app-reload', () => {
    if (aiView) aiView.webContents.reload();
  });

  ipcMain.on('app-set-always-on-top', (_event, isTop) => {
    userSettings.alwaysOnTop = isTop;
    saveSettingsToDisk();
    if (mainWindow) mainWindow.setAlwaysOnTop(isTop, 'screen-saver');
    setupTray();
  });

  ipcMain.on('app-set-antiobs', (_event, isEnabled) => {
    userSettings.antiObs = isEnabled;
    saveSettingsToDisk();
    applyScreenProtection(mainWindow, isEnabled);
    setupTray();
  });

  ipcMain.on('app-minimize', () => {
    if (mainWindow) mainWindow.minimize();
  });

  ipcMain.on('app-hide', () => {
    if (mainWindow) mainWindow.hide();
  });

  ipcMain.on('app-set-prompt', (_event, prompt) => {
    userSettings.customPrompt = prompt;
    saveSettingsToDisk();
    console.log('[AntiRecAI] Persistent prompt updated:', prompt);
  });

  ipcMain.on('app-set-opacity', (_event, opacity) => {
    const val = Math.max(0.1, Math.min(1.0, parseFloat(opacity)));
    userSettings.opacity = val;
    saveSettingsToDisk();
    if (mainWindow) {
      mainWindow.setOpacity(val);
    }
  });

  ipcMain.on('app-clear-session', async () => {
    const ses = session.fromPartition('persist:gemini_session');
    await ses.clearStorageData();
    if (aiView) aiView.webContents.reload();
  });

  ipcMain.on('app-settings-opened', (_event, isOpen) => {
    if (!mainWindow || !aiView) return;
    const [width, height] = mainWindow.getSize();
    if (isOpen) {
      // Push the view down so settings modal is fully visible and interactive
      aiView.setBounds({ x: 0, y: height, width: width, height: 0 });
    } else {
      updateViewBounds();
    }
  });
}

// App lifecycle
app.whenReady().then(() => {
  loadSettingsFromDisk();
  setupSessionSecurity();
  setupIpcHandlers();
  createWindow();
  setupTray();
  registerShortcuts();

  app.on('web-contents-created', (_event, contents) => {
    contents.setUserAgent(CHROME_DESKTOP_UA);
    contents.on('did-create-window', (popupWin) => {
      applyScreenProtection(popupWin);
    });
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    applyScreenProtection(mainWindow);
  }
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  stopMouseShortcutPoller();
});
