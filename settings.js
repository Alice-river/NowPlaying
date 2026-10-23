const slider = document.getElementById('t');
const out = document.getElementById('v');
const blur = document.getElementById('blur');
const DEFAULT = 25;

function show(value) {
  slider.value = String(value);
  out.textContent = `${value}%`;
}

slider.addEventListener('input', () => {
  const value = Number(slider.value);
  out.textContent = `${value}%`;
  window.np.setTransparency(value);
});

const auto = document.getElementById('auto');
auto.addEventListener('change', () => window.np.setAutostart(auto.checked));

blur.addEventListener('change', () => window.np.setBlur(blur.checked));

document.getElementById('reset').addEventListener('click', () => {
  show(DEFAULT);
  blur.checked = true;
  window.np.setTransparency(DEFAULT);
  window.np.setBlur(true);
});

const dcOn = document.getElementById('dc-on');
const dcId = document.getElementById('dc-id');
const dcStatus = document.getElementById('dc-status');
let dcTimer = null;

function sendDiscord() {
  clearTimeout(dcTimer);
  dcTimer = setTimeout(() => window.np.setDiscord(dcOn.checked, dcId.value.trim()), 400);
}
dcOn.addEventListener('change', sendDiscord);
dcId.addEventListener('input', sendDiscord);
window.np.onDiscordStatus((label) => { dcStatus.textContent = `状態: ${label}`; });

window.np.getSettings().then((s) => {
  show(s.transparency);
  blur.checked = s.blur;
  auto.checked = s.autostart;
  auto.disabled = !s.canAutostart; // 開発中 (exe でないとき) は変えられない
  dcOn.checked = s.discord;
  dcId.value = s.discordAppId;
  dcStatus.textContent = `状態: ${s.discordStatus}`;
});
