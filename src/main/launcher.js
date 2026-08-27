// ============================================================
// launcher.js —— 拉起并托管官方 DeepSeek Harness Web 子进程
// 大肥鱼原则：壳不重造 DSH，只确保官方 dsh web 在跑，然后把界面嵌进来。
// 关键：官方 DSH 的插件跑在"系统 node"上（用系统的 node_modules），
//       所以这里 spawn 的不是 Electron，而是系统里的 node 命令。
// ============================================================
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { isPortOpen, readDshHome, DEFAULT_PORT } = require('./detect');

// ---------- 找到系统 node 可执行文件 ----------
function findNodeExec() {
  // 1) 优先走 PATH 里的 node（Windows: node.exe）
  const name = process.platform === 'win32' ? 'node.exe' : 'node';
  const sep = process.platform === 'win32' ? ';' : ':';
  const dirs = (process.env.PATH || '').split(sep);
  for (const dir of dirs) {
    try {
      const p = path.join(dir, name);
      if (fs.existsSync(p)) return p;
    } catch { /* ignore */ }
  }
  // 2) Windows 备选：npm 同目录下的 node
  if (process.platform === 'win32' && process.env.APPDATA) {
    const p = path.join(process.env.APPDATA, 'npm', 'node.exe');
    if (fs.existsSync(p)) return p;
  }
  // 3) 兜底：交给系统 PATH 自己解析（用裸名字）
  return name;
}

// ---------- 找到官方 dsh 的入口（.../@deepseek-ai/dsh/lib/bin.js）----------
function findDshEntry() {
  const roots = [];
  if (process.env.APPDATA) roots.push(path.join(process.env.APPDATA, 'npm'));
  roots.push(path.join(os.homedir(), 'AppData', 'Local', 'npm-cache', '_npx'));
  roots.push(path.join(os.homedir(), '.npm', '_npx'));
  if (process.env.PATH) {
    // 额外兜底：把 PATH 里可能含 node_modules 的目录也加进搜索根
    const sep = process.platform === 'win32' ? ';' : ':';
    for (const d of process.env.PATH.split(sep)) {
      const mm = /node_modules[\/\\](?:\.bin)?$/.test(d) ? path.dirname(d) : null;
      if (mm) roots.push(mm);
    }
  }
  const seen = new Set();
  const hits = [];
  for (const root of roots) walkForDsh(root, 8, seen, hits); // 深度放大到 8 层，覆盖 npx 缓存
  return hits[0] || null;
}

// 深搜 node_modules 缓存目录，命中 @deepseek-ai/dsh 包就记录其 lib/bin.js
function walkForDsh(dir, depth, seen, hits) {
  if (depth <= 0 || hits.length > 0) return;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (seen.has(p)) continue;
    seen.add(p);
    if (e.isDirectory()) {
      // node_modules 是个大灌木：万一命中标准包名，直接快速判是目标就返回
      if (endsWithSeg(p, ['node_modules', '@deepseek-ai', 'dsh']) ||
          endsWithSeg(p, ['node_modules', 'dsh'])) {
        const bin = path.join(p, 'lib', 'bin.js');
        if (fs.existsSync(bin)) { hits.push(p); return; }
      }
      // 普通目录继续下钻
      walkForDsh(p, depth - 1, seen, hits);
    }
  }
}

// 判断路径结尾是否依次匹配指定段（跨平台、防大小写）
function endsWithSeg(p, segs) {
  const parts = p.split(/[\\/]/).filter(Boolean).map((s) => s.toLowerCase());
  const tail = segs.map((s) => s.toLowerCase());
  if (parts.length < tail.length) return false;
  return tail.every((s, i) => parts[parts.length - tail.length + i] === s);
}

// Windows shim 指向一个真实相对入口；这里顺便把 .bin\dsh 反向解析到包目录
function resolveFromBinShim() {
  // 已由 app 侧调用 which('dsh')；此处留占位，避免过度复杂
  return null;
}

// ---------- 创建启动器 ----------
function createLauncher({ state, port, url, home }) {
  const finalUrl = url || `http://127.0.0.1:${port || DEFAULT_PORT}`;
  const finalHome = home || readDshHome();
  let child = null;

  // 确保官方 Web 在跑：端口通就直接用；不通就尝试拉起 dsh web
  async function ensureRunning() {
    const up = await isPortOpen(port, '127.0.0.1');
    if (up) {
      state.markOnline(finalUrl);
      return { ok: true, source: 'already-running', url: finalUrl };
    }
    // 端口没通 → 需要自己把它拉起来
    const started = await start();
    return started;
  }

  // 真正去 spawn 系统 node 跑 dsh web
  // envOverrides: 可选的自定义环境对象（forceStart 用它传"干净环境"）
  function start(envOverrides) {
    return new Promise((resolve) => {
      const node = findNodeExec();
      const entryDir = findDshEntry();
      const entry = entryDir ? path.join(entryDir, 'lib', 'bin.js') : null;

      // 找不到官方 dsh 入口 → 告诉 UI 走"一键部署"（M2 以后介入）
      if (!entry) {
        state.markOffline('未找到官方 @deepseek-ai/dsh，需要一键部署');
        return resolve({ ok: false, reason: 'dsh-not-installed', url: null });
      }

      const env = envOverrides || { ...process.env, DSH_HOME: finalHome };
      // 注意：Electron 主进程里 process.execPath 是 electron.exe，
      //       传给子进程的 node 必须是系统 node。这里直接用查到的 node。
      // --no-open：禁止官方 dsh 启动时自动在默认浏览器打开界面（壳内要用 webview，不需要弹系统浏览器）
      child = spawn(node, [entry, 'web', '--no-open'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
      state.setChild(child);

      // 捕获启动日志，供"遇到运行时错误及时汇报"
      const chunks = [];
      const collect = (d) => { chunks.push(d.toString()); };
      child.stdout?.on('data', collect);
      child.stderr?.on('data', collect);

      // 等端口就绪（轮询，最多 ~15 秒）
      const t0 = Date.now();
      const timer = setInterval(async () => {
        if (await isPortOpen(port)) {
          clearInterval(timer);
          state.markOnline(finalUrl);
          resolve({ ok: true, source: 'launched', url: finalUrl, node, entry });
        } else if (Date.now() - t0 > 15000) {
          // 超时没起来 → 尝试读日志尾部，给出可汇报的错误
          clearInterval(timer);
          const tail = chunks.slice(-3).join('\n').trim();
          state.markOffline(`官方 Web 启动超时。日志尾部：\n${tail || '(空)'}`);
          resolve({ ok: false, reason: 'timeout', url: null, log: tail || null });
        }
      }, 400);

      child.on('exit', (code, sig) => {
        clearInterval(timer);
        state.setChild(null);
        if (!state.running) {
          state.markOffline(`dsh web 已退出（code=${code} sig=${sig}）`);
        }
      });
    });
  }

  // 一键重启：先停旧进程再拉起（start 内部会自己 markOnline/Offline）
  async function restart() {
    await stop();
    return start();
  }

  // 停止当前托管的官方进程
  function stop() {
    return new Promise((resolve) => {
      if (child && !child.killed) {
        const c = child;
        child = null;
        try { c.kill('SIGTERM'); } catch { /* ignore */ }
        // 给一点时间，然后不强求
        setTimeout(() => { state.setChild(null); resolve(true); }, 300);
      } else { resolve(true); }
    });
  }

  return { ensureRunning, start, restart, stop, getChild: () => child };
}

module.exports = { createLauncher, findNodeExec, findDshEntry };
