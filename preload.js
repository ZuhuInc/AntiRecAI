const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('antiRecAPI', {
  navigate: (url) => ipcRenderer.send('app-navigate', url),
  reload: () => ipcRenderer.send('app-reload'),
  setAlwaysOnTop: (isTop) => ipcRenderer.send('app-set-always-on-top', isTop),
  minimize: () => ipcRenderer.send('app-minimize'),
  hide: () => ipcRenderer.send('app-hide'),
  setPrompt: (prompt) => ipcRenderer.send('app-set-prompt', prompt),
  clearSession: () => ipcRenderer.send('app-clear-session'),
  setOpacity: (val) => ipcRenderer.send('app-set-opacity', val),
  setAntiObs: (val) => ipcRenderer.send('app-set-antiobs', val),
  saveSettings: (settings) => ipcRenderer.send('app-save-settings', settings),
  getSettings: () => ipcRenderer.invoke('app-get-settings'),
  getVersion: () => ipcRenderer.invoke('app-get-version'),
  onSettingsOpened: (isOpen) => ipcRenderer.send('app-settings-opened', isOpen),
  onSiteChanged: (callback) => ipcRenderer.on('site-changed', (_event, site) => callback(site)),
  onInitialSettings: (callback) => ipcRenderer.on('initial-settings', (_event, settings) => callback(settings))
});
