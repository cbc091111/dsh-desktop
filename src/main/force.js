// ============================================================
// force.js —— 强制能力
// ① forceStart：官方 Web 起不来时，"抛弃一切可能影响启动的因素"冷启动
// ② forceStop：强制停止推理（优雅失败则硬停）
// 大肥鱼：平时不动武，真卡住了再上"物理手段"，每步都留痕、可回放。
// ============================================================
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { isPortOpen, readDshHome, DEFAULT_PORT } = require('./detect');
const { createLauncher, findNodeExec, findDshEntry } = require('./launcher');

// ---- 按危险度由轻到重做清理；每步记录 ok/说明，失败不阻断后续 ----

// ① 清理"僵死的官方 dsh 事件残留"：杀掉监听 3080 的进程（仅当它确实占用端口）
function killPortHolder(port, log) {
  return new Promise((resolve) => {
    const pid = findPidOnPort(port);
    if (!pid) { log.push({ step: '端口占用清理', ok: true, detail: `端口 ${port} 空闲，无需清理` }); return resolve(true); }
    killPid(pid, (ok, detail) => {
      log.push({ step: '端口占用清理', ok, detail });
      resolve(ok);
    });
  });
}

// 找到占用某端口的 PID（Windows: netstat；Linux/macOS: lsof）
function findPidOnPort(port) {
  try {
    if (process.platform === 'win32') {
      const out = execFileSyncSafe('netstat', ['-ano', '-p', 'tcp']);
      const lines = (out || '').split('\n');
      for (const line of lines) {
        const m = line.match(/\s*TCP\s+([\d.:]+):(\d+)\s+[\d.:]+:\d+\s+LISTENING\s+(\d+)/i);
        if (m && Number(m[2]) === port) return m[3];
      }
    } else {
      const out = execFileSyncSafe('lsof', ['-ti', `tcp:${port}`]);
      if (out) return out.trim().split('\n')[0];
    }
  } catch { /* ignore */ }
  return null;
}

// 执行并捕获输出（同步，节省 IO 轮询）
function execFileSyncSafe(cmd, args) {
  try { return require('child_process').execFileSync(cmd, args, { encoding: 'utf8' }); } catch { return ''; }
}

// 杀进程：taskkill (win) / kill (unix)
function killPid(pid, cb) {
  const taskkill = process.platform === 'win32';
  execFile(taskkill ? 'taskkill' : 'kill', taskkill ? ['/PID', pid, '/F'] : ['-9', pid], (err) => {
    cb(!err, err ? `结束 PID ${pid} 失败：${err.message}` : `已结束占用进程 PID ${pid}`);
  });
}

// ② 清环境残留：剔除会让官方 web 迷路的 DSH_* 指针（保留必要的）
function cleanEnv(base) {
  const env = { ...(base || process.env) };
  delete env.DSH_PROFILE;      // 避免壳误设了别的 profile
  delete env.DSH_BIN;          // 指向失效路径的 dsh 二进制
  delete env.npm_config_registry_strict_ssl_reset; // 无意义的残留
  // 保留 DSH_HOME（它决定了官方 web 用哪套配置），但仅当它确实是目录
  if (env.DSH_HOME && !fs.existsSync(env.DSH_HOME)) {
    delete env.DSH_HOME;
    try { env.DSH_HOME = readDshHome(); } catch { delete env.DSH_HOME; }
  }
  return env;
}

// ③ 清理 stale 锁文件（常见"起不来"元凶：卡死的 .lock）
function cleanStaleLocks(home, log) {
  const lockPaths = [
    path.join(home, 'profiles', 'web', '.dsh.lock'),
    path.join(home, 'profiles', 'web', 'dsh.lock'),
    path.join(home, '.dsh.lock'),
    path.join(home, 'cache', '.package-lock-stale'),
  ];
  let cleaned = 0;
  for (const p of lockPaths) {
    try {
      // 只删超过 5 分钟且确实存在的锁（避免误删正在用的）
      const st = fs.statSync(p);
      if (Date.now() - st.mtimeMs > 5 * 60 * 1000) { fs.unlinkSync(p); cleaned++; }
    } catch { /* ignore（不存在或读不到都跳过） */ }
  }
  log.push({ step: '清理 stale 锁文件', ok: true, detail: cleaned ? `清掉 ${cleaned} 个卡死锁文件` : '无卡死锁文件' });
  return cleaned;
}

// ---- 强制启动：跑完整清理序列，再用"干净环境 + 默认配置"冷启动官方 web ----
// state & launcher 由调用方（index）注入，保证与主流程共享同一状态
async function forceStart(ctx = {}) {
  const log = [];
  const port = ctx.port || DEFAULT_PORT;
  const home = ctx.home || readDshHome();

  // 1) 从最乱的因素清理起（按危险度递增，逐步"抛弃阻碍"）
  await killPortHolder(port, log);        // 端口被占 → 清掉
  cleanStaleLocks(home, log);             // 卡死锁 → 清掉
  const cleanEnvObj = cleanEnv({ ...process.env, DSH_HOME: home });

  // 2) 用干净环境冷启动官方 web
  const launcher = ctx.launcher || createLauncher({ port, url: `http://127.0.0.1:${port}`, home, state: ctx.state });
  log.push({ step: '冷启动官方 Web', ok: true, detail: `node=${findNodeExec()}` });

  const result = await launcher.start(cleanEnvObj);
  log.push({ step: '拉起结果', ok: result.ok, detail: result.ok ? `已就绪 ${result.url}` : (result.reason || result.log || '未知') });

  return { ok: result.ok, url: result.url, log, launcher };
}

// ---- 强制停止推理：先优雅，失败则硬停 ----
async function forceStop(ctx = {}) {
  const port = ctx.port || DEFAULT_PORT;
  const attempts = [];

  // ① 尝试优雅停止：给官方 web 发"停机"信号（通过结束其子进程）
  //    注：这里用"关闭官方 web"来打断推理（官方模型推理是同步计算，唯一可靠刹车就是让进程停）
  try {
    if (ctx.state && ctx.state.child && !ctx.state.child.killed) {
      try { ctx.state.child.kill('SIGTERM'); } catch { /* ignore */ }
      attempts.push({ step: '优雅停止(SIGTERM)', ok: true, detail: '已发送 SIGTERM 给官方 web' });
    } else {
      attempts.push({ step: '优雅停止', ok: true, detail: '无托管进程，交由端口处理' });
    }
  } catch (e) {
    attempts.push({ step: '优雅停止', ok: false, detail: e.message });
  }

  // ② 给一点时间；若仍在，硬停占用端口的进程（终极刹车）
  await new Promise((r) => setTimeout(r, 600));
  if (await isPortOpen(port)) {
    await killPortHolder(port, attempts);
  } else {
    attempts.push({ step: '确认', ok: true, detail: '端口已释放，推理已停' });
  }

  return { ok: true, attempts };
}

module.exports = { forceStart, forceStop };
