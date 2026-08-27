// ============================================================
// theme.js —— 壳自身界的主题 & 壁纸管理
// 作用：用户选主题色 + 设壁纸背景 → 应用到"壳"的界面（顶栏/侧栏/浮层）。
//       不碰官方 Web 内部（保持官方 UI 原汁原味，除非以后做"注入官方"开关）。
// 持久化到 ~/.dsh/dsh-desktop/themes.json，启动自动应用。
// 大肥鱼：自己住的壳，配色自己说了算。
// ============================================================
const fs = require('fs');
const os = require('os');
const path = require('path');

// 主题配置文件位置
function configPath(home) {
  const dir = path.join(home || process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'dsh-desktop');
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* ignore */ }
  return path.join(dir, 'themes.json');
}

// 预设主题配方（语义命名，用户可改）
const PRESETS = {
  default: { name: 'GitHub 深色', bg: '#0d1117', panel: '#161b22', border: '#30363d', text: '#e6edf3', accent: '#4493f8' },
  ocean:   { name: '深海蓝',    bg: '#0a1628', panel: '#10233f', border: '#1f3a5f', text: '#e8f1fb', accent: '#3b82f6' },
  forest:  { name: '森林绿',    bg: '#0c1410', panel: '#15251b', border: '#2c4a38', text: '#e7f2ea', accent: '#22c55e' },
  sunset:  { name: '落日橙',    bg: '#1a1010', panel: '#2a1816', border: '#4a3226', text: '#f7ece4', accent: '#f97316' },
  violet:  { name: '紫罗兰',    bg: '#120f20', panel: '#1e1730', border: '#3a2f5a', text: '#efeaf5', accent: '#a78bfa' },
};

// 读取当前主题配置
function loadTheme(home) {
  try { return JSON.parse(fs.readFileSync(configPath(home), 'utf8')); }
  catch { return { preset: 'default', custom: null, wallpaper: null }; }
}

// 保存主题配置
function saveTheme(theme, home) {
  try { fs.writeFileSync(configPath(home), JSON.stringify(theme, null, 2)); return { ok: true }; }
  catch (e) { return { ok: false, error: e.message }; }
}

// 获取当前应用到 UI 的完整主题（预设展开 + 自定义覆盖 + 壁纸）
function getAppliedTheme(home) {
  const cfg = loadTheme(home);
  const preset = PRESETS[cfg.preset] || PRESETS.default;
  const custom = cfg.custom && cfg.custom.enabled ? cfg.custom : null;
  const applied = custom || preset; // 自定义开启则用自定义色板，否则用预设
  return {
    preset: cfg.preset,
    presetName: (PRESETS[cfg.preset] || PRESETS.default).name,
    palette: { bg: applied.bg, panel: applied.panel, border: applied.border, text: applied.text, accent: applied.accent },
    usingCustom: !!custom,
    wallpaper: cfg.wallpaper || null, // 壁纸文件绝对路径
  };
}

// 设置预设主题
function setPreset(preset, home) {
  if (!PRESETS[preset]) return { ok: false, error: '未知主题: ' + preset };
  const cfg = loadTheme(home);
  cfg.preset = preset;
  return saveTheme(cfg, home);
}

// 设置自定义色板（可部分覆盖某几项）
function setCustom(palette, home) {
  const cfg = loadTheme(home);
  cfg.custom = { enabled: true, ...(palette || {}) };
  return saveTheme(cfg, home);
}

// 关闭自定义，回到预设
function clearCustom(home) {
  const cfg = loadTheme(home);
  if (cfg.custom) cfg.custom.enabled = false;
  return saveTheme(cfg, home);
}

// 设置壁纸（传绝对文件路径）
function setWallpaper(absPath, home) {
  if (absPath && typeof absPath === 'string' && !path.isAbsolute(absPath)) {
    return { ok: false, error: '需要绝对路径' };
  }
  const cfg = loadTheme(home);
  cfg.wallpaper = absPath || null;
  return saveTheme(cfg, home);
}

module.exports = {
  PRESETS,
  loadTheme, saveTheme, getAppliedTheme,
  setPreset, setCustom, clearCustom, setWallpaper,
  configPath,
};
