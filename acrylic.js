// すりガラス (ぼかし) を、ウィンドウの後ろに直接かける。
// Windows 11 のアクリルは、フォーカスの無いウィンドウでは単色に戻ってしまう。
// 常に表示するウィジェットでは困るので、フォーカスに関係なく効く「ぼかし」(BLURBEHIND) を使い、
// 色の濃さ (不透明度) は画面側の半透明の色で調整する。
let native = null;

function load() {
  if (native !== null) return native;
  try {
    const koffi = require('koffi');
    const user32 = koffi.load('user32.dll');
    const dwm = koffi.load('dwmapi.dll');
    const ACCENT = koffi.struct('ACCENT_POLICY', {
      AccentState: 'int', AccentFlags: 'int', GradientColor: 'uint32', AnimationId: 'int',
    });
    const WCAD = koffi.struct('WINCOMPATTRDATA', { Attribute: 'int', Data: 'void *', SizeOfData: 'size_t' });
    native = {
      koffi, ACCENT, WCAD,
      setWca: user32.func('int __stdcall SetWindowCompositionAttribute(uintptr_t hwnd, WINCOMPATTRDATA *data)'),
      setDwm: dwm.func('int __stdcall DwmSetWindowAttribute(uintptr_t hwnd, uint32_t attr, int *value, uint32_t size)'),
    };
  } catch (e) {
    console.error('[np] acrylic unavailable:', e.message);
    native = false;
  }
  return native;
}

const ACCENT_DISABLED = 0;
const ACCENT_BLURBEHIND = 3;
const WCA_ACCENT_POLICY = 19;
const DWMWA_WINDOW_CORNER_PREFERENCE = 33;
const DWMWCP_ROUND = 2;

function hwndOf(win) {
  const buf = win.getNativeWindowHandle();
  return buf.length >= 8 ? buf.readBigUInt64LE(0) : BigInt(buf.readUInt32LE(0));
}

function setAcrylic(win, { r = 18, g = 18, b = 26, alpha = 1 } = {}) {
  const n = load();
  if (!n) return false;
  try {
    const hwnd = hwndOf(win);
    const a = Math.max(1, Math.min(255, Math.round(alpha)));
    const policy = n.koffi.alloc(n.ACCENT, 1);
    n.koffi.encode(policy, n.ACCENT, {
      AccentState: ACCENT_BLURBEHIND, AccentFlags: 0,
      // 0xAABBGGRR
      GradientColor: ((a << 24) | (b << 16) | (g << 8) | r) >>> 0, AnimationId: 0,
    });
    const ok = n.setWca(hwnd, { Attribute: WCA_ACCENT_POLICY, Data: policy, SizeOfData: n.koffi.sizeof(n.ACCENT) });
    n.setDwm(hwnd, DWMWA_WINDOW_CORNER_PREFERENCE, [DWMWCP_ROUND], 4);
    return ok !== 0;
  } catch (e) {
    console.error('[np] acrylic failed:', e.message);
    return false;
  }
}

function clearAcrylic(win) {
  const n = load();
  if (!n) return;
  try {
    const policy = n.koffi.alloc(n.ACCENT, 1);
    n.koffi.encode(policy, n.ACCENT, { AccentState: ACCENT_DISABLED, AccentFlags: 0, GradientColor: 0, AnimationId: 0 });
    n.setWca(hwndOf(win), { Attribute: WCA_ACCENT_POLICY, Data: policy, SizeOfData: n.koffi.sizeof(n.ACCENT) });
  } catch { /* 何もしない */ }
}

module.exports = { setAcrylic, clearAcrylic };
