// ============================================================
// update-state.js —— 更新状态持久化（小红点 / 忽略标记）
// 存到 ~/.dsh/dsh-desktop/update-state.json
// 字段：
//   latestChecked   上次自动检查时间
//   latestVersion   当前最新版本
//   hasUpdate       是否存在待更新（红点什么条件下亮）
//   pendingVersion  待更新版本
//   ignoredVersion  用户点"忽略"的那个版本（对同一版本不再亮红点）
// ============================================================
const fs = require('fs');
const path = require('path');
const os = require('os');

function statePath(home) {
  const dir = path.join(home || process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'dsh-desktop');
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* ignore */ }
  return path.join(dir, 'update-state.json');
}

function loadUpdateState(home) {
  try { return JSON.parse(fs.readFileSync(statePath(home), 'utf8')); }
  catch { return { latestChecked: 0, latestVersion: null, hasUpdate: false, pendingVersion: null, ignoredVersion: null }; }
}

function saveUpdateState(state, home) {
  try { fs.writeFileSync(statePath(home), JSON.stringify(state, null, 2)); return { ok: true }; }
  catch (e) { return { ok: false, error: e.message }; }
}

module.exports = { loadUpdateState, saveUpdateState, statePath };
