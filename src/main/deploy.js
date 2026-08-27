// ============================================================
// deploy.js —— 一键部署 DeepSeek Harness（全自动 + 分步进度上报）
// 全自动：Node 缺失自动装；npm 失败自动切 npx；最后自动准备目录。
// 进度：每个步骤完成都调 onProgress(step)，UI 实时显示"百分比+是否成功"。
// 大肥鱼：点一下就全自动搞定，每步都告诉你进度，不让你手动瞎折腾。
// ============================================================
const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

// ---- 跑命令（Promise，带超时，返回结构化结果）----
function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: opts.timeout || 120000, windowsHide: true }, (err, stdout, stderr) => {
      resolve({ ok: !err, code: err ? err.code : 0, stdout: (stdout || '').toString(), stderr: (stderr || '').toString(), timedOut: !!(err && err.killed) });
    });
  });
}

// ---- PATH 里是否有某命令 ----
function commandExists(cmd) {
  const sep = process.platform === 'win32' ? ';' : ':';
  const dirs = (process.env.PATH || '').split(sep);
  const name = process.platform === 'win32' ? (cmd.endsWith('.exe') ? cmd : cmd + '.exe') : cmd;
  for (const d of dirs) {
    try { if (!d) continue; if (fs.existsSync(path.join(d, name)) || fs.existsSync(path.join(d, cmd)) || fs.existsSync(path.join(d, cmd + '.cmd'))) return true; } catch { /* ignore */ }
  }
  return false;
}

// ---- 平台包管理器 ----
function systemInstaller() {
  switch (process.platform) {
    case 'win32': return { node: 'winget', nodeArgs: ['install', 'OpenJS.NodeJS.LTS', '--silent'], alt: ['choco', ['install', 'nodejs', '-y']], fallbackUrl: 'https://nodejs.org/' };
    case 'darwin': return { node: 'brew', nodeArgs: ['install', 'node'], alt: null, fallbackUrl: 'https://nodejs.org/' };
    default: return { node: 'apt-get', nodeArgs: [(process.getuid && process.getuid() === 0) ? 'install' : 'install', '-y', 'nodejs', 'npm'], alt: ['dnf', ['install', '-y', 'nodejs', 'npm']], fallbackUrl: 'https://nodejs.org/' };
  }
}

// 估算步骤：固定规划，用于计算百分比。部署进行时会按 realSteps 推进。
const PLAN = ['检查运行环境', '安装 Node 环境', '安装 DeepSeek Harness', '初始化配置目录', '启动官方 Web'];

// ---- 全自动一键部署（带进度回调） ----
// onProgress(step): { stepIndex, totalSteps, name, percent, ok, detail, state }  state ∈ running|ok|fail
async function oneClickDeploy(ctx = {}) {
  const home = ctx.home || process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
  const dryRun = !!ctx.dryRun;
  const onProgress = (typeof ctx.onProgress === 'function') ? ctx.onProgress : () => {};
  const inst = systemInstaller();
  const total = PLAN.length;
  let step = 0;

  const report = (name, ok, detail, state) => {
    step += 1;
    const percent = Math.round((step / total) * 100);
    onProgress({ stepIndex: step, totalSteps: total, name, percent, ok: !!ok, detail: detail || '', state: state || (ok ? 'ok' : 'fail') });
    return { name, ok: !!ok, detail: detail || '' };
  };

  const stepsDone = [];

  // ---- 步骤1：检查运行环境（Node / npm）----
  const hasNode = commandExists('node');
  const hasNpm = commandExists('npm') || commandExists('npx');
  stepsDone.push(report('检查运行环境（Node / npm）', true, `node:${hasNode ? '有' : '无'}  npm/npx:${hasNpm ? '有' : '无'}`, 'ok'));

  // ---- 步骤2：确保 Node 可用（全自动补装）----
  let nodeReady = hasNode;
  if (!hasNode && !dryRun) {
    // 自动尝试多个包管理器
    onProgress({ stepIndex: step + 1, totalSteps: total, name: '安装 Node 环境', percent: progressFor(step + 1, total), ok: true, detail: '检测到没有 Node，开始自动安装（推荐去 nodejs.org，这里先试系统管理器）', state: 'running' });
    let installed = false;
    const managers = [inst.node, ...(inst.alt ? [inst.alt[0]] : [])];
    for (const m of managers) {
      const args = m === inst.node ? inst.nodeArgs : (inst.alt && inst.alt[1]) || [];
      if (!commandExists(m)) continue;
      const r = await run(m, args, { timeout: 240000 });
      if (r.ok) { installed = true; break; }
      // 失败继续试下一个
    }
    nodeReady = commandExists('node');
    stepsDone.push(report('安装 Node 环境', nodeReady, nodeReady ? 'Node 已就绪' : (`自动安装失败。请到 ${inst.fallbackUrl} 手动装一次 Node。`, 'fail')));
  } else {
    stepsDone.push(report('安装 Node 环境', hasNode || dryRun, (hasNode || dryRun) ? (dryRun ? '(预演)将自动安装或检测 Node' : '已存在 Node，无需安装') : '未检测到 Node，将自动安装', 'ok'));
  }

  // 若没 Node 且没装成 → 中止，明确失败（但窗口仍常驻可看进度）
  if (!nodeReady && !dryRun) {
    return finalResult({ ok: false, home, dryRun, steps: stepsDone, next: '部署失败，最常见原因是：未安装 Node 或 Node 版本过低。请到 nodejs.org 装一次最新 LTS 版 Node，装好后再点"一键部署"重试。' });
  }

  // ---- 步骤3：安装 DeepSeek Harness（npm → npx 自动切换）----
  let dshOk = false;
  if (dryRun) {
    dshOk = true;
    stepsDone.push(report('安装 DeepSeek Harness', true, '(预演)将安装 @deepseek-ai/dsh', 'ok'));
  } else {
    onProgress({ stepIndex: step + 1, totalSteps: total, name: '安装 DeepSeek Harness', percent: progressFor(step + 1, total), ok: true, detail: '正在通过 npm 安装 @deepseek-ai/dsh（若失败将自动改用 npx）', state: 'running' });
    if (commandExists('npm')) {
      const r1 = await run('npm', ['install', '-g', '@deepseek-ai/dsh'], { timeout: 300000 });
      if (r1.ok) { dshOk = true; stepsDone.push(report('安装 DeepSeek Harness', true, 'npm 安装成功', 'ok')); }
      else {
        // npm 失败 → 试 npx（npx 会自动临时拉包）
        const r2 = await run('npx', ['--yes', '@deepseek-ai/dsh', '--version'], { timeout: 300000 });
        dshOk = r2.ok;
        stepsDone.push(report('安装 DeepSeek Harness', dshOk, dshOk ? 'npm 失败，改用 npx 临时拉取成功' : `npm 与 npx 均失败：${trimE(r1.stderr)}`, dshOk ? 'ok' : 'fail'));
      }
    } else if (commandExists('npx')) {
      const r2 = await run('npx', ['--yes', '@deepseek-ai/dsh', '--version'], { timeout: 300000 });
      dshOk = r2.ok;
      stepsDone.push(report('安装 DeepSeek Harness', dshOk, dshOk ? 'npx 拉取成功' : `npx 失败：${trimE(r2.stderr)}`, dshOk ? 'ok' : 'fail'));
    } else {
      dshOk = false;
      stepsDone.push(report('安装 DeepSeek Harness', false, '未找到 npm 或 npx，无法自动安装', 'fail'));
    }
  }

  // ---- 步骤4：初始化配置目录（幂等）----
  if (!dryRun) {
    for (const sub of ['profiles', 'profiles/web', 'memory', 'plugins']) {
      try { fs.mkdirSync(path.join(home, sub), { recursive: true }); } catch { /* ignore */ }
    }
  }
  stepsDone.push(report('初始化配置目录', true, dryRun ? '(预演)' : `已准备 ${path.join(home, 'profiles')} 等目录`, 'ok'));

  // ---- 步骤5：启动官方 Web（交给 launcher / UI 后续做，这里标识完成）----
  stepsDone.push(report('启动官方 Web', dshOk, dshOk ? '已就绪，可进入主界面' : '因上一步失败，无法启动官方 Web', dshOk ? 'ok' : 'fail'));

  return finalResult({
    ok: dshOk,
    home,
    dryRun,
    steps: stepsDone,
    nodeInstalled: nodeReady,
    dshInstalled: dshOk,
    next: dshOk ? null : '部署失败，最常见原因是未安装 Node 或 Node 版本过低。请先到 nodejs.org 装最新 LTS 版 Node；也可能是网络/镜像问题（可切换 npm 国内镜像后重试）。',
  });
}

function finalResult(o) {
  // 进度推一个终态
  return o;
}

function progressFor(step, total) { return Math.min(100, Math.round((step / total) * 100)); }

function trimE(s) { return String(s || '').trim().slice(0, 300); }

module.exports = { oneClickDeploy, systemInstaller, commandExists, PLAN };
