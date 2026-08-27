// ============================================================
// procmon.js —— 进程哨兵
// 周期性探测官方 Web 是否在线/掉线/端口被占，第一时间把变化推给 UI
// 另：检测官方进程是否在"推理中"（综合"进程树 CPU"+"session 文件增长"双信号）
// 大肥鱼：发现问题要"及时汇报"，别等用户自己撞上。
// ============================================================
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { execFile } = require('child_process');
const { isPortOpen } = require('./detect');

const HEARTBEAT_MS = 4000;    // 每 4 秒探一次端口
const MAX_GRACE_MS = 12000;   // 端口明明被占但 Web 无响应时，标记"可能需要强制干预"
const INFER_POLL_MS = 1500;   // 推理检测轮询间隔

function createProcMon({ state, url, launcher }) {
  let timer = null;
  let inferTimer = null;
  let lastOkAt = Date.now(); // 上次探测到"确实连通"的时间

  // ------ 推理检测：综合"进程树 CPU" + "session 文件增长"双信号 ------
  // 更准的方案：
  //   A) 采样官方进程树（主进程 + 其 node 子进程）的整体 CPU —— 实时，能抓子进程里的实测计算
  //   B) 监控 ~/.dsh/sessions 下 session.jsonl.zstd 是否在增长 —— 确定性，官方推理会持续写盘
  // 任一信号激活都累计"推理证据"，需连续多次才确认/取消，避免抖动误判。
  let cpuSample = null;          // 上次进程树 CPU 采样 { time, pids→cpu map }
  let fileSample = null;         // 上次 session 文件大小采样 { time, sizes }
  let inferenceEvidence = 0;     // 连续正/负证据计数
  const EVIDENCE_REQUIRED = 2;   // 连续 2 次一致才翻转
  const SESSION_GLOB = process.env.DSH_HOME
    ? pathPosix(process.env.DSH_HOME) + '/sessions/**/session.jsonl.zstd'
    : null;

  // 找到官方主进程 PID
  async function findDshPid() {
    const child = launcher && launcher.getChild ? launcher.getChild() : null;
    if (child && child.pid && !child.killed) return child.pid;
    try { return await findPidOnPort(portOf(url || 'http://127.0.0.1:3080')); } catch { return null; }
  }

  // 收集进程树:主进程 + 其 node 子进程（推理常在子进程，单看主进程会漏）
  async function collectTreeCpu(pid) {
    const cpu = {};
    const mains = await readProcessCpu(pid);
    if (mains != null) cpu[pid] = mains;   // 主进程 CPU 时间
    // 找主进程的直接 node 子进程并累加
    const kids = await listChildren(pid);
    for (const k of Array.isArray(kids) ? kids : []) {
      const c = await readProcessCpu(k);
      if (c != null) cpu[k] = c;
    }
    return cpu; // { pid: ms }
  }

  // 收集所有 session 文件大小（推理会持续写这些 .zstd）
  async function collectSessionSizes() {
    return readSessionFileSizes(SESSION_GLOB);
  }

  async function detectInference() {
    const pid = await findDshPid();
    if (!pid) {
      cpuSample = null; fileSample = null; inferenceEvidence = 0;
      setInferring(false);
      return;
    }
    const now = Date.now();

    // --- 信号 A：进程树 CPU ---
    let cpuBusy = false;
    const treeCpu = await collectTreeCpu(pid);
    if (cpuSample) {
      const dt = (now - cpuSample.time) || 1;
      let deltaSum = 0;
      for (const k of Object.keys(treeCpu)) {
        const prev = cpuSample.cpu[k];
        if (prev != null) deltaSum += (treeCpu[k] - prev);
      }
      // CPU 占用率 = delta/dt；超过 12% 视为有明显计算活动
      cpuBusy = deltaSum > 0 && (deltaSum / dt) > 0.12;
    }
    cpuSample = { time: now, cpu: treeCpu };

    // --- 信号 B：session 文件增长 ---
    let fileBusy = false;
    const sizes = await collectSessionSizes();
    if (fileSample && sizes) {
      for (const f of Object.keys(sizes)) {
        const prev = fileSample.sizes[f];
        if (prev != null && sizes[f] > prev) { fileBusy = true; break; }
      }
    }
    fileSample = { time: now, sizes };

    // --- 综合判定：任一信号激活记为正证据 ---
    const evidence = (cpuBusy || fileBusy);
    if (evidence) inferenceEvidence = Math.min(inferenceEvidence + 1, 3);
    else inferenceEvidence = Math.max(inferenceEvidence - 1, -3);

    if (inferenceEvidence >= EVIDENCE_REQUIRED) setInferring(true);
    else if (inferenceEvidence <= -EVIDENCE_REQUIRED) setInferring(false);
  }

  // 更新 state.inferring，并与上次不同才推送（避免刷屏）
  let lastInfer = false;
  function setInferring(v) {
    if (v !== lastInfer) {
      lastInfer = v;
      state.setInferring(v);
    }
  }

  // 每 INFER_POLL_MS 判定一次是否在推理
  function startInferencePoll() {
    if (inferTimer) return;
    inferTimer = setInterval(detectInference, INFER_POLL_MS);
  }
  function stopInferencePoll() {
    if (inferTimer) clearInterval(inferTimer);
    inferTimer = null;
  }

  function start() {
    if (timer) return;
    timer = setInterval(tick, HEARTBEAT_MS);
    // 推理检测需要更快节奏，另开一个轮询
    detectInference();
    startInferencePoll();
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
    stopInferencePoll();
  }

  // 每次心跳：探测端口 + 记录状态，必要时发事件给 UI
  async function tick() {
    let ok = false;
    try {
      ok = await isPortOpen(state.webUrl ? portOf(state.webUrl) : 3080, '127.0.0.1');
    } catch { ok = false; }

    if (ok) {
      lastOkAt = Date.now();
      const wasOffline = !state.running;
      state.markOnline(state.webUrl);
      if (wasOffline) emit('online', { url: state.webUrl }); // 刚恢复 → 汇报
    } else {
      // 官方 Web 不在线 → 不可能在推理，归零
      setInferring(false);
      const beenDownMs = Date.now() - lastOkAt;
      const reason = beenDownMs > MAX_GRACE_MS ? 'web-unresponsive' : 'starting-or-down';
      state.markOffline(reason === 'web-unresponsive' ? '官方 Web 长时间无响应，可尝试强制重启。' : '官方 Web 尚未就绪。');
      if (reason === 'web-unresponsive') emit('down', { reason });
    }
  }

  // 端口从 url 里拆出来（默认 3080）
  function portOf(u) {
    try { return Number(new URL(u).port) || 3080; } catch { return 3080; }
  }

  // 极简事件总线：订阅者可注册兜底（M3 里由失败引导使用）
  const bus = {};
  function emit(evt, payload) {
    for (const fn of (bus[evt] || [])) { try { fn(payload); } catch { /* ignore */ } }
  }
  function on(evt, fn) { (bus[evt] = bus[evt] || []).push(fn); }

  return { start, stop, tick, on };
}

// ============================================================
// 跨平台读取某进程的 CPU 总时间（毫秒）
// Windows 用 wmic（Kernel/UserModeTime），Linux/macOS 用 ps -o time=
// ============================================================
const { platform } = require('os');

function readProcessCpu(pid) {
  return new Promise((resolve) => {
    let cmd, args;
    if (platform() === 'win32') {
      cmd = 'wmic';
      args = ['process', 'where', `ProcessId=${pid}`, 'get', 'KernelModeTime,UserModeTime', '/value'];
    } else {
      cmd = 'ps';
      args = ['-o', 'time=', '-p', String(pid)];
    }
    execFile(cmd, args, { timeout: 1500 }, (err, stdout, stderr) => {
      if (err) return resolve(0);
      let totalMs = 0;
      if (platform() === 'win32') {
        // 解析 KernelModeTime=... UserModeTime=...（单位 100ns）
        const km = /KernelModeTime=(\d+)/i.exec(stdout);
        const um = /UserModeTime=(\d+)/i.exec(stdout);
        const k = km ? parseInt(km[1], 10) : 0;
        const u = um ? parseInt(um[1], 10) : 0;
        totalMs = (k + u) / 10000; // 100ns → ms
      } else {
        // ps -o time= 输出 "HH:MM:SS" 或 "MM:SS"
        const t = stdout.trim();
        const parts = t.split(':').map(Number);
        totalMs = (parts[0] * 3600 + (parts[1] || 0) * 60 + (parts[2] || 0)) * 1000;
      }
      resolve(totalMs);
    });
  });
}

// 找到监听端口进程 PID（Windows netstat / unix lsof）
function findPidOnPort(port) {
  return new Promise((resolve) => {
    let cmd, args;
    if (platform() === 'win32') {
      cmd = 'netstat'; args = ['-ano', '-p', 'tcp'];
      execFile(cmd, args, { timeout: 1500 }, (err, stdout) => {
        if (err) return resolve(null);
        for (const line of (stdout || '').split('\n')) {
          const m = line.match(/\s*TCP\s+[\d.:]+:(\d+)\s+[\d.:]+:\d+\s+LISTENING\s+(\d+)/i);
          if (m && Number(m[1]) === Number(port)) return resolve(m[2]);
        }
        resolve(null);
      });
    } else {
      cmd = 'lsof'; args = ['-ti', `tcp:${port}`];
      execFile(cmd, args, { timeout: 1500 }, (err, stdout) => {
        if (err) return resolve(null);
        const first = (stdout || '').trim().split('\n')[0];
        resolve(first || null);
      });
    }
  });
}

// 路径转 POSIX 风格（glob 统一用 /）
function pathPosix(p) {
  return String(p).replace(/\\/g, '/');
}

// 列出某进程的直接子进程 PID 列表（跨平台）
function listChildren(pid) {
  return new Promise((resolve) => {
    if (platform() === 'win32') {
      // wmic 拿父进程关系
      execFile('wmic', ['process', 'get', 'ProcessId,ParentProcessId,Name'], { timeout: 2000 }, (err, stdout) => {
        if (err) return resolve([]);
        const kids = [];
        for (const line of (stdout || '').split('\n')) {
          const m = line.match(/^\s*(\d+)\s+(\d+)\s+(\S+)/i);
          if (m && Number(m[2]) === Number(pid)) kids.push(m[1]);
        }
        resolve(kids);
      });
    } else {
      execFile('ps', ['-eo', 'pid=,ppid='], { timeout: 2000 }, (err, stdout) => {
        if (err) return resolve([]);
        const kids = [];
        for (const line of (stdout || '').split('\n')) {
          const m = line.trim().match(/^(\d+)\s+(\d+)$/);
          if (m && Number(m[2]) === Number(pid)) kids.push(m[1]);
        }
        resolve(kids);
      });
    }
  });
}

// 读取所有 session 文件（.zstd 等）的当前大小；用它判断"是否正在增长"（推理写盘信号）
// 纯 fs 递归扫描（不引入 glob 外部依赖），只找 session.jsonl.* 这类会话记录
function readSessionFileSizes(glob) {
  return new Promise((resolve) => {
    if (!glob) return resolve(null);
    // glob 形如 '<home>/sessions/**/session.jsonl.zstd' → 提取 sessions 根目录
    const home = process.env.DSH_HOME || (os.homedir && os.homedir());
    const sessRoot = pathPosix(home) ? path.join(home, 'sessions') : home;
    const sizes = {};
    try { walkSessionDir(sessRoot, sizes, 3); } catch { /* ignore */ }
    resolve(sizes);
  });
}

// 深搜 sessions 目录，收集所有 session.jsonl.* 文件大小（限制深度防扫全盘）
function walkSessionDir(dir, out, depth) {
  if (depth <= 0) return;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      walkSessionDir(p, out, depth - 1);
    } else if (/^session\.jsonl\./.test(e.name)) {
      try { out[p] = fs.statSync(p).size; } catch { /* ignore */ }
    }
  }
}

module.exports = { createProcMon, findPidOnPort };
