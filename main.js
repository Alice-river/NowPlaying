const { app, BrowserWindow, Tray, Menu, screen, nativeImage, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const { Wnp, HANDSHAKE } = require('./wnp');
const { trayIconPng } = require('./png');
const { setAcrylic, clearAcrylic } = require('./acrylic');
const { DiscordPresence } = require('./discord');

const PORT = Number(process.env.NP_PORT) || 37250;
const DEBUG = process.env.NP_DEBUG === '1';
const HIDE_DELAY_MS = 10_000;
const SIZE = { width: 360, height: 96 };
const MARGIN = 16;

const log = (...args) => { if (DEBUG) console.log('[np]', ...args); };

// 動作確認用: 設定の保存先を分けると、普段使いの Agent と並べて動かせる
if (process.env.NP_USERDATA) app.setPath('userData', process.env.NP_USERDATA);

if (!app.requestSingleInstanceLock()) app.quit();

const wnp = new Wnp();
const sockets = new Set();
let win = null;
let tray = null;
let hideTimer = null;
let forcedHidden = false;
let settingsWin = null;
let previewOn = false;
let saveTimer = null;
let settings = { x: null, y: null, clickThrough: false, transparency: 25, blur: true,
  discord: true, discordAppId: '' };

const clampPercent = (v) => Math.min(100, Math.max(0, Math.round(Number(v)) || 0));
// 透過率が高いほど、暗い色の重ねを薄くする
const tintAlpha = () => Number((1 - settings.transparency / 100).toFixed(2));
const DISCORD_LABEL = {
  off: '無効', noid: 'Application ID が未設定', connecting: '接続しています',
  waiting: 'Discord が見つかりません (再試行中)', connected: '接続中', badid: 'Application ID が正しくありません',
};
const discord = new DiscordPresence({
  log,
  onStatus: (status) => {
    updateTray();
    if (settingsWin && !settingsWin.isDestroyed()) settingsWin.webContents.send('discord-status', DISCORD_LABEL[status] || status);
  },
});

const sampleView = () => ({
  playing: true, state: 0, title: 'プレビュー', artist: '透過率の確認', album: '', source: 'NowPlaying',
  cover: '', position: 60, duration: 200, at: Date.now(),
});

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');

function loadSettings() {
  try { settings = { ...settings, ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) }; } catch { /* 初回 */ }
  settings.transparency = clampPercent(settings.transparency);
}

function saveSettings() {
  try {
    fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
    fs.writeFileSync(settingsFile(), JSON.stringify(settings));
  } catch (e) { log('settings save failed', e.message); }
}

function defaultPosition() {
  const wa = screen.getPrimaryDisplay().workArea;
  return { x: wa.x + wa.width - SIZE.width - MARGIN, y: wa.y + MARGIN };
}

// 保存した位置が、今のどの画面にも入っていなければ右上に戻す
function startPosition() {
  if (settings.x === null || settings.y === null) return defaultPosition();
  const inside = screen.getAllDisplays().some((d) => {
    const b = d.workArea;
    return settings.x >= b.x - 20 && settings.y >= b.y - 20 && settings.x < b.x + b.width - 40 && settings.y < b.y + b.height - 40;
  });
  return inside ? { x: settings.x, y: settings.y } : defaultPosition();
}

function createWindow() {
  const pos = startPosition();
  win = new BrowserWindow({
    ...SIZE, x: pos.x, y: pos.y, show: false,
    frame: false, resizable: false, maximizable: false, minimizable: false, fullscreenable: false,
    skipTaskbar: true, alwaysOnTop: true, hasShadow: true,
    transparent: true, roundedCorners: true, backgroundColor: '#00000000',
    title: 'NowPlaying',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setIgnoreMouseEvents(settings.clickThrough, { forward: true });
  win.loadFile(path.join(__dirname, 'widget.html'));

  let moveTimer = null;
  win.on('moved', () => {
    clearTimeout(moveTimer);
    moveTimer = setTimeout(() => {
      const [x, y] = win.getPosition();
      settings.x = x; settings.y = y;
      saveSettings();
    }, 300);
  });
  win.webContents.on('did-finish-load', () => { pushConfig(); pushState(); });
}

function pushConfig() {
  if (!win || win.isDestroyed()) return;
  // ぼかしはウィンドウの後ろに、色の濃さ (不透明度) は画面側の半透明の色でかける
  if (settings.blur) setAcrylic(win); else clearAcrylic(win);
  win.webContents.send('config', { tint: tintAlpha() });
}

function pushState() {
  if (!win || win.isDestroyed()) return;
  const real = wnp.view();
  const view = real || (previewOn ? sampleView() : null);
  if (view) win.webContents.send('state', view);
  applyVisibility(view);
  discord.update(discordState(real));
}

// Discord へ渡す内容。確認用の表示は含めない。カバーは公開された https の URL だけ
function discordState(view) {
  if (!view) return { state: 2 };
  const elapsed = view.playing ? (Date.now() - view.at) / 1000 : 0;
  const position = view.duration > 0 ? Math.min(view.duration, view.position + elapsed) : view.position;
  return {
    state: view.state, title: view.title, artist: view.artist, album: view.album, source: view.source,
    cover: /^https:\/\//i.test(view.cover) ? view.cover : '', position: Math.round(position), duration: view.duration,
  };
}

function openSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) { settingsWin.show(); settingsWin.focus(); return; }
  settingsWin = new BrowserWindow({
    width: 380, height: 690, useContentSize: true, resizable: false, minimizable: false, maximizable: false, fullscreenable: false,
    title: 'NowPlaying 設定', backgroundColor: '#15161d', autoHideMenuBar: true, show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true },
  });
  settingsWin.setMenu(null);
  settingsWin.webContents.on('render-process-gone', (_e, d) => console.error('[np] settings renderer gone:', d.reason, d.exitCode));
  settingsWin.webContents.on('did-fail-load', (_e, code, desc) => console.error('[np] settings load failed:', code, desc));
  settingsWin.webContents.on('console-message', (e) => log('settings console:', e.message));
  // 起動時の表示指定 (非表示で起動した場合など) で最初の show が無視されることがあるので、念のため 2 回目も行う
  const reveal = () => { if (settingsWin && !settingsWin.isDestroyed()) { settingsWin.show(); settingsWin.focus(); } };
  settingsWin.once('ready-to-show', reveal);
  setTimeout(() => { if (settingsWin && !settingsWin.isDestroyed() && !settingsWin.isVisible()) reveal(); }, 600);
  settingsWin.loadFile(path.join(__dirname, 'settings.html'));
  previewOn = true;
  pushState();
  settingsWin.on('closed', () => { settingsWin = null; previewOn = false; pushState(); });
}

// 配布版 (ポータブル exe) は、起動した exe 自身を登録する
const loginItem = () => (app.isPackaged ? { path: process.env.PORTABLE_EXECUTABLE_FILE || process.execPath } : null);

ipcMain.handle('settings:get', () => ({
  transparency: settings.transparency, blur: settings.blur,
  autostart: app.isPackaged && app.getLoginItemSettings(loginItem() || {}).openAtLogin,
  canAutostart: app.isPackaged,
  discord: settings.discord, discordAppId: settings.discordAppId,
  discordStatus: DISCORD_LABEL[discord.status] || discord.status,
}));
ipcMain.on('settings:set-discord', (_event, { enabled, appId }) => {
  settings.discord = !!enabled;
  settings.discordAppId = String(appId || '').trim().slice(0, 30);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveSettings, 300);
  discord.configure({ enabled: settings.discord, appId: settings.discordAppId });
});
ipcMain.on('settings:set-autostart', (_event, on) => {
  if (app.isPackaged) app.setLoginItemSettings({ ...loginItem(), openAtLogin: !!on });
});
ipcMain.on('settings:set-blur', (_event, on) => {
  settings.blur = !!on;
  pushConfig();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveSettings, 300);
});
ipcMain.on('settings:set-transparency', (_event, value) => {
  settings.transparency = clampPercent(value);
  pushConfig();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveSettings, 300);
});

function applyVisibility(view) {
  if (!win || win.isDestroyed()) return;
  if ((forcedHidden && !previewOn) || !view) {
    clearTimeout(hideTimer); hideTimer = null;
    if (win.isVisible()) win.hide();
    return;
  }
  if (view.playing) {
    clearTimeout(hideTimer); hideTimer = null;
    if (!win.isVisible()) { win.showInactive(); win.moveTop(); }
  } else if (win.isVisible() && !hideTimer) {
    // 一時停止や停止のあと、少し待ってから隠す
    hideTimer = setTimeout(() => { hideTimer = null; if (win && !win.isDestroyed()) win.hide(); }, HIDE_DELAY_MS);
  }
}

function startServer() {
  const wss = new WebSocketServer({
    host: '127.0.0.1', port: PORT, maxPayload: 8 * 1024 * 1024,
    // ブラウザの拡張だけを受け付ける。普通のWebページからの接続は断る
    verifyClient: ({ origin }) => !origin || /^(chrome|moz|edge)-extension:\/\//.test(origin),
  });
  wss.on('listening', () => log(`listening on 127.0.0.1:${PORT}`));
  wss.on('error', (e) => { console.error('[np] server error:', e.message); updateTray(); });
  wss.on('connection', (ws) => {
    sockets.add(ws);
    ws.send(HANDSHAKE);
    updateTray();
    log('extension connected');
    ws.on('message', (data, isBinary) => {
      if (isBinary) wnp.handleBinary(Buffer.from(data));
      else wnp.handleText(data.toString('utf8'));
    });
    ws.on('close', () => {
      sockets.delete(ws);
      if (sockets.size === 0) wnp.clear();
      updateTray();
      log('extension disconnected');
    });
    ws.on('error', () => ws.terminate());
  });
}

function updateTray() {
  if (!tray) return;
  const connected = sockets.size > 0;
  tray.setToolTip(`NowPlaying (${connected ? '拡張と接続中' : '拡張の接続待ち'})`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: `127.0.0.1:${PORT} で待ち受け (${connected ? `接続 ${sockets.size}` : '未接続'})`, enabled: false },
    { label: `Discord: ${DISCORD_LABEL[discord.status] || discord.status}`, enabled: false },
    { type: 'separator' },
    { label: '設定… (透過率)', click: openSettings },
    {
      label: 'ウィジェットを隠す', type: 'checkbox', checked: forcedHidden,
      click: (item) => { forcedHidden = item.checked; pushState(); },
    },
    {
      label: 'クリックを通す (操作できなくなる)', type: 'checkbox', checked: settings.clickThrough,
      click: (item) => { settings.clickThrough = item.checked; saveSettings(); win.setIgnoreMouseEvents(item.checked, { forward: true }); },
    },
    {
      label: '位置を右上に戻す',
      click: () => { const p = defaultPosition(); win.setPosition(p.x, p.y); settings.x = p.x; settings.y = p.y; saveSettings(); },
    },
    { type: 'separator' },
    { label: '終了', click: () => app.quit() },
  ]));
}

app.on('second-instance', (_event, argv) => {
  if (argv.includes('--settings')) { openSettings(); return; }
  forcedHidden = false; pushState(); updateTray();
});

app.whenReady().then(() => {
  loadSettings();
  createWindow();
  tray = new Tray(nativeImage.createFromBuffer(trayIconPng(32)));
  tray.on('double-click', openSettings);
  updateTray();
  if (process.argv.includes('--settings')) openSettings();
  wnp.on('change', pushState);
  // あとから出た最前面ウィンドウに隠されないよう、ときどき一番上へ戻す
  setInterval(() => { if (win && !win.isDestroyed() && win.isVisible()) win.moveTop(); }, 3000);
  // 再生位置は動き続けるので、変化がなくても 5 秒ごとに渡す
  setInterval(() => discord.update(discordState(wnp.view())), 5000);
  discord.configure({ enabled: settings.discord, appId: settings.discordAppId });
  startServer();
});

app.on('window-all-closed', (e) => e.preventDefault());
app.on('before-quit', () => discord.close());
