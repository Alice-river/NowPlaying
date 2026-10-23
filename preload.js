const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('np', {
  onState: (cb) => ipcRenderer.on('state', (_event, state) => cb(state)),
  onConfig: (cb) => ipcRenderer.on('config', (_event, config) => cb(config)),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setDiscord: (enabled, appId) => ipcRenderer.send('settings:set-discord', { enabled: !!enabled, appId }),
  onDiscordStatus: (cb) => ipcRenderer.on('discord-status', (_event, label) => cb(label)),
  setAutostart: (on) => ipcRenderer.send('settings:set-autostart', !!on),
  setBlur: (on) => ipcRenderer.send('settings:set-blur', !!on),
  setTransparency: (value) => ipcRenderer.send('settings:set-transparency', value),
});
