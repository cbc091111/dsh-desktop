// ============================================================
// detect.js —— 探测 DSH 是否存在 / 是否在跑（只读，绝不改任何东西）
// 大肥鱼：先看明白再动手。这里只"看"，不"碰"。
// ============================================================
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { execFile } = require('child_process');

const DEFAULT_PORT = 3080;

// 探测默认端口是否已被某个 web 服务占用（最直接判断"官方 Web 在不在"）
function isPortOpen(port, host = '127.0.0.1', timeout = 1200) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let done = false;
    const finish = (v) => { if (!done) { done = true; socket.destroy(); resolve(v); } };
    socket.setTimeout(timeout);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(port, host);
  });
}

// 得到 DSH_HOME（默认 ~/.dsh，尊重用户设置的环境变量）
function readDshHome() {
  return process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
}

// 某个目录/profile 下是否有 cordis 装配文件（说明装了 DSH host）
function hasProfile(home) {
  try {
    const webDir = path.join(home, 'profiles', 'web');
    return fs.existsSync(path.join(webDir, 'cordis.yml')) ||
           fs.existsSync(path.join(home, 'cordis.yml'));
  } catch { return false; }
}

// 判断某命令在不在可执行路径里（只查 PATH，不执行任何东西）
function which(command) {
  try {
    // PATH 分隔符：Windows 用 ; 其它用 :
    const sep = process.platform === 'win32' ? ';' : ':';
    const exts = process.platform === 'win32'
      ? (process.env.PATHEXT || '.EXE;.CMD;.BAT;.PS1').split(';')
      : [''];
    const dirs = (process.env.PATH || '').split(sep);
    for (const dir of dirs) {
      if (!dir) continue;
      for (const ext of exts) {
        const p = path.join(dir, command + ext);
        if (fs.existsSync(p) || fs.existsSync(p.toLowerCase())) return p;
      }
    }
    return null;
  } catch { return null; }
}

// 在 npx 缓存目录里找官方 dsh 的可执行/入口（Windows npm 缓存路径）
function findNpxDsh() {
  const candidates = [];
  const roots = [];
  if (process.env.APPDATA) roots.push(path.join(process.env.APPDATA, 'npm'));
  roots.push(path.join(os.homedir(), 'AppData', 'Local', 'npm-cache', '_npx'));
  roots.push(path.join(os.homedir(), '.npm', '_npx'));
  for (const root of roots) {
    try { candidates.push(...npxWalk(root, 3, new Set())); } catch { /* ignore */ }
  }
  return candidates.find((p) =>
    p.includes('@deepseek-ai') && (p.includes('dsh') || p.includes('harness'))
  ) || candidates.find((p) => /[\\/]dsh([\\/]|$)/.test(p)) || null;
}

// 深搜一层 npx 缓存，找 package 的 package.json（限制深度防止扫整个盘）
function npxWalk(dir, depth, seen) {
  if (depth <= 0) return [];
  let out = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (seen.has(p)) continue;
      seen.add(p);
      if (e.isDirectory()) {
        if (fs.existsSync(path.join(p, 'package.json'))) out.push(p);
        out.push(...npxWalk(p, depth - 1, seen));
      }
    }
  } catch { /* ignore */ }
  return out;
}

// 主探测：汇总五项证据，给出结构化结论
async function scan(opts = {}) {
  const port = opts.port || DEFAULT_PORT;
  const home = opts.home || readDshHome();
  const portInUse = await isPortOpen(port);
  const onPath = which('dsh');
  const npxDsh = findNpxDsh();
  const hasProfile = _hasProfilePh(home);

  // found = 任一证据成立即认为"装了 DSH"
  const found = Boolean(portInUse || onPath || npxDsh || hasProfile);

  return {
    found,
    running: Boolean(portInUse),          // Web 在线 = 正在跑
    portInUse,
    onPath: onPath ? true : false,
    npxDsh: npxDsh || null,
    home,
    hasProfile,
    webUrl: portInUse ? `http://127.0.0.1:${port}` : null,
  };
}

// 局部 helper（避免与上面函数重名）
function _hasProfilePh(home) { return hasProfile(home); }

module.exports = {
  scan,
  isPortOpen,
  readDshHome,
  DEFAULT_PORT,
};
