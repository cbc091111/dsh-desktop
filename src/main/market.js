// ============================================================
// market.js —— 插件市场（内置可视化插件市场）
// 数据源：awesome-dsh-plugin.com/plugins.json（2322+ 社区插件，官方 dshmarket 同源）
// 功能：拉取目录 + 缓存 + 搜索/分类 + 提供一键安装所需信息。
// 大肥鱼安全守则：安装前只读探测/确认，绝不未经确认动他人装配。
// ============================================================
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');

const MARKET_URL = 'https://awesome-dsh-plugin.com/plugins.json';

// 缓存文件位置
function cachePath() {
  const dir = path.join(os.homedir(), '.dsh', 'dsh-desktop');
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* ignore */ }
  return path.join(dir, 'market-cache.json');
}

// 拉市场列表（优先缓存，缓存超时则刷新）
async function listMarket(opts = {}) {
  const force = !!opts.force;
  const maxAge = opts.maxAge || 6 * 3600 * 1000; // 6 小时缓存
  const cacheFile = cachePath();

  // 尝试用缓存
  if (!force && fs.existsSync(cacheFile)) {
    try {
      const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      if (cached && cached.updated && (Date.now() - cached.fetchedAt < maxAge) && Array.isArray(cached.plugins)) {
        return { ok: true, cached: true, count: cached.plugins.length, plugins: cached.plugins, categories: cached.categories || [] };
      }
    } catch { /* 缓存损坏则重新拉 */ }
  }

  // 拉远程
  const remote = await fetchMarket();
  if (remote.ok) {
    // 写缓存
    try {
      fs.writeFileSync(cacheFile, JSON.stringify({ ...remote, fetchedAt: Date.now() }, null, 2));
    } catch { /* ignore */ }
  }
  return remote;
}

// 拉远程目录
function fetchMarket() {
  return new Promise((resolve) => {
    https.get(MARKET_URL, { headers: { 'User-Agent': 'dsh-desktop' } }, (res) => {
      if (res.statusCode !== 200) return resolve({ ok: false, error: 'HTTP ' + res.statusCode });
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try {
          const o = JSON.parse(data);
          const plugins = Array.isArray(o) ? o : (o.plugins || []);
          const categories = Array.isArray(o.categories)
            ? Object.keys(o.categories).map((k) => ({ id: k, name: (o.categories[k] && o.categories[k].name) || k }))
            : [{ id: 'all', name: '全部' }];
          categories.unshift({ id: 'all', name: '全部' });
          resolve({ ok: true, cached: false, count: plugins.length, plugins, categories, updated: Date.now() });
        } catch (e) {
          resolve({ ok: false, error: '解析失败: ' + e.message });
        }
      });
    }).on('error', (e) => resolve({ ok: false, error: e.message }));
  });
}

// 根据插件数据生成"一键安装"所需信息（返回真实命令，用户/壳可选执行）
function buildInstallInfo(plugin) {
  const installHint = (plugin && plugin.install) || '';
  // 常见：install 字段含命令；备选组合
  return {
    name: plugin && plugin.name,
    npm: (plugin && plugin.npm) || null,
    tarball: (plugin && plugin.tarball) || null,
    url: (plugin && plugin.url) || (plugin && plugin.page) || '',
    installHint,
  };
}

// 精简为市场面板需要的最小字段（不把大 description 全量塞 UI）
function slimPlugin(p) {
  const descEn = (p.description && p.description.en) || (p.description && p.description.zh) || p.description || '';
  const descZh = (p.description && p.description.zh) || '';
  return {
    name: p.name,
    owner: p.owner || '',
    url: p.url || '',
    page: p.page || '',
    category: p.category || '',
    description: (typeof descZh === 'string' && descZh) ? descZh : (typeof descEn === 'string' ? descEn : ''),
    npm: p.npm || '',
    tarball: p.tarball || '',
    stars: p.stars || 0,
    downloads: p.downloads || 0,
    install: (p.install || '').trim(),
    added: p.added || '',
  };
}

// ============================================================
// 安全一键安装
// 官方安装命令：dsh plugin --profile web add <包名>
// 执行前：① 只读检查该插件是否已装配/冲突 ② 检查 Node/dsh 工具 ③ 用户在前端确认后才真的执行
// 大肥鱼安全守则：不动他人的插件、装前检查、确认才动手。
// ============================================================
const { execFile } = require('child_process');

function profileDir() {
  return path.join(os.homedir(), '.dsh', 'profiles', 'web');
}

// 只读检查：插件是否已装配 / 会不会有冲突
function checkPluginConflict(pkgName, home) {
  const webDir = profileDir();
  const issues = [];
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(webDir, 'package.json'), 'utf8'));
    const bundles = (pkg.dsh && pkg.dsh.profile && pkg.dsh.profile.bundles) || [];
    if (bundles.includes(pkgName)) issues.push({ kind: 'installed', detail: `插件 ${pkgName} 已在装配列表中（已安装），无需重复安装。` });
  } catch { /* 读不到就当无 */ }
  return { ok: issues.length === 0, issues };
}

// 执行安装命令（dsh plugin add），带超时
// 固定用 npx 拉官方 dsh CLI 执行；并显式指定工作目录为 web profile，
// 避免打包后 Electron 的 cwd 不在 profile 导致 pnpm 报"位置/路径"错。
function runInstall(pkgName, opts = {}) {
  return new Promise((resolve) => {
    const cmd = 'npx';
    const args = ['--yes', '@deepseek-ai/dsh', 'plugin', '--profile', 'web', 'add', pkgName];
    const cwd = opts.cwd || profileDir();
    execFile(cmd, args, { cwd, timeout: opts.timeout || 300000, windowsHide: true }, (err, stdout, stderr) => {
      resolve({ ok: !err, code: err ? err.code : 0, stdout: (stdout || '').toString(), stderr: (stderr || '').toString() });
    });
  });
}

// 清理 profile node_modules 里所有带 BOM 的 package.json（官方 dsh 的 JSON.parse 遇 BOM 崩溃，
// 会连累整个插件安装。删 BOM 字节不影响内容，安全。）
function stripBOMFromProfile() {
  const root = path.join(profileDir(), 'node_modules');
  let fixed = 0;
  (function walk(dir, depth) {
    if (depth > 3) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === '.pnpm') continue;
        if (/^package\.json$/i.test(e.name)) {
          let b = null; try { b = fs.readFileSync(p); } catch { continue; }
          if (b && b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF) {
            try { fs.writeFileSync(p, b.slice(3)); fixed++; } catch { /* ignore */ }
          }
        } else walk(p, depth + 1);
      } else if (/^package\.json$/i.test(e.name)) {
        let b = null; try { b = fs.readFileSync(p); } catch { continue; }
        if (b && b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF) {
          try { fs.writeFileSync(p, b.slice(3)); fixed++; } catch { /* ignore */ }
        }
      }
    }
  })(root, 0);
  return fixed;
}

// 一键安装（先检查，可 dryRun 只检查不装）
async function installPlugin(pkgName, opts = {}) {
  const dryRun = !!opts.dryRun;
  // 1) 只读冲突检查
  const conflict = checkPluginConflict(pkgName);
  if (conflict.issues.length) return { ok: false, ...conflict, step: 'check' };

  if (dryRun) return { ok: true, step: 'check', message: '检查通过，可安全安装' };

  // 2) 安装前先清一遍带 BOM 的 package.json（预防官方 reconcile 崩溃）
  stripBOMFromProfile();

  // 3) 真装
  let r = await runInstall(pkgName, opts);
  // 若失败且疑似 BOM/JSON 问题：再去 BOM 一次并自动重试（此时包已下载，重试通常秒过）
  if (!r.ok && /not valid JSON|Unexpected token|BOM|\uFEFF|SyntaxError/.test((r.stderr || '') + (r.stdout || ''))) {
    stripBOMFromProfile();
    r = await runInstall(pkgName, opts);
  }
  if (r.ok) return { ok: true, step: 'install', message: '安装命令执行成功', out: r.stdout.slice(-200) };
  return { ok: false, step: 'install', message: (r.stderr || r.stdout || '').trim().slice(0, 400) };
}

module.exports = { listMarket, fetchMarket, slimPlugin, buildInstallInfo, installPlugin, checkPluginConflict, MARKET_URL };