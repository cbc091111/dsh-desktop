// ============================================================
// plugins.js —— 插件变动扫描
// 权威数据源：profiles/web/package.json 的 dsh.profile.bundles 数组
// 用 require.resolve 定位每个包真实位置（兼容 pnpm symlink/npx 缓存/本地 dev 链接），
// 读版本 + mtime 生成指纹。启动时与上次指纹对比，标出 新增/移除/更新。
// 大肥鱼：每次打开都扫一眼，谁动了我的插件，一目了然。
// ============================================================
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { createRequire } = require('module');

// DSH_HOME 下的 web profile
function webProfileDir(home) {
  return path.join(home || process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'profiles', 'web');
}

// 指纹存储位置（壳自己的目录，不碰官方数据）
function fingerprintPath(home) {
  const dir = path.join(home || process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'dsh-desktop');
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* ignore */ }
  return path.join(dir, 'plugin-fingerprint.json');
}

// 读取 bundle 列表（package.json → dsh.profile.bundles 数组）
function readBundles(webDir) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(webDir, 'package.json'), 'utf8'));
    const list = pkg && pkg.dsh && pkg.dsh.profile && arr(pkg.dsh.profile.bundles);
    return Array.isArray(list) ? list : [];
  } catch { return []; }
}

function arr(v) { return Array.isArray(v) ? v : (v ? [v] : undefined); }

// 用 require.resolve 定位单个 bundler 的真实 package.json，返回详细元信息
function resolveBundle(webDir, name) {
  try {
    const req = createRequire(path.join(webDir, 'noop.js'));
    const pkgJsonPath = req.resolve(name + '/package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
    const st = fs.statSync(pkgJsonPath);
    return {
      name,
      version: pkg.version || 'unknown',
      resolved: pkgJsonPath,
      mtime: Math.floor(st.mtimeMs), // 毫秒级，能捕捉源码更新
      description: pkg.description || '',
      repository: (pkg.repository && (pkg.repository.url || pkg.repository)) || '',
    };
  } catch (e) {
    // 解析失败 → 标 missing（可能 bundle 卸载了但 package.json 没清）
    return { name, version: null, resolved: null, mtime: 0, missing: true, description: '', repository: '' };
  }
}

// 生成当前指纹对象 + 指纹哈希
async function scanCurrenth(home) {
  const webDir = webProfileDir(home);
  if (!fs.existsSync(path.join(webDir, 'package.json'))) {
    return { bundles: [], fingerprint: crypto.createHash('sha256').update('empty').digest('hex') };
  }
  const bundles = readBundles(webDir);
  // 并行解析所有 bundle（都很快，但统一收集）
  const entries = {};
  for (const name of bundles) entries[name] = resolveBundle(webDir, name);

  // 指纹 = 所有 bundle 的名称+版本+mtime 序列化的哈希
  const payload = bundles.map((n) => {
    const e = entries[n];
    return `${n}@${e && e.version}@${e && e.mtime}`;
  }).sort().join('|');
  const fingerprint = crypto.createHash('sha256').update(payload).digest('hex');
  return { bundles, entries, fingerprint };
}

// 扫描并对比上次指纹，返回差异
async function scanPlugins(opts = {}) {
  const home = opts.home || process.env.DSH_HOME;
  const now = await scanCurrenth(home);
  const fpPath = fingerprintPath(home);

  let prev = null;
  try { prev = JSON.parse(fs.readFileSync(fpPath, 'utf8')); } catch { prev = null; }

  const changed = compareFingerprints(prev, now);
  // 存盘当前指纹供下次对比（存完整 entries，含 mtime/resolved，才能检测源码修改）
  try { fs.writeFileSync(fpPath, JSON.stringify({ fingerprint: now.fingerprint, entries: now.entries }, null, 2)); } catch { /* ignore */ }

  return {
    total: now.bundles.length,
    fingerprint: now.fingerprint,
    changed,               // { added:[], removed:[], updated:[] }
    entries: summarize(now.entries),
    wasScanned: !!prev,    // 首次启动没有上次指纹，只有 now，diff 全部当 added 会误导 → 用 flag 让 UI 显示"首次扫描，已建立基线"
  };
}

// 对比新旧指纹
function compareFingerprints(prev, now) {
  const added = [];
  const removed = [];
  const updated = [];
  if (!prev || !prev.fingerprint) {
    // 无基线：首次扫描，不全标 added（避免吓人），只记录基线建立
    return { added: [], removed: [], updated: [], firstTime: true };
  }
  const prevNames = new Set(Object.keys(prev.entries || {}));
  const nowNames = now.bundles;
  // 新增：现在有、之前没有的 bundle
  for (const n of nowNames) if (!prevNames.has(n)) added.push(n);
  // 移除：之前有、现在没有
  for (const pn of prevNames) if (!nowNames.includes(pn)) removed.push(pn);
  // 更新：都存在但版本/mtime 变了
  for (const n of nowNames) {
    if (!prevNames.has(n)) continue;
    const p = prev.entries[n];
    const c = now.entries[n];
    if (p && c && (p.version !== c.version || p.mtime !== c.mtime)) updated.push(n);
  }
  return { added, removed, updated, firstTime: false };
}

// 精简 entries 只保留 UI 需要的叶子字段（含描述/仓库，供详情弹窗）
function summarize(entries) {
  const out = {};
  for (const k of Object.keys(entries)) {
    const e = entries[k];
    out[k] = {
      version: e.version,
      missing: !!e.missing,
      description: e.description || '',
      repository: e.repository || '',
      resolved: e.resolved || '',
    };
  }
  return out;
}

// ---- 插件详情：取单个插件的完整元信息（读 package.json 无关闭 JSON 缓存问题）----
function getPluginDetail(name, opts = {}) {
  const webDir = webProfileDir(opts.home);
  const e = resolveBundle(webDir, name);
  return { ok: true, name, ...e, packagesWebPath: webDir };
}

// ---- 一键删除（安全版）：只从 package.json 的 bundles 列表摘除该插件入口 ——
// 不物理删 node_modules（可能被共享/有依赖），仅"停用"，符合用户"安装/删除前先确认、不动他人"的谨慎偏好。
// 操作前会先诊断一次，给出当前状态。
function uninstallPlugin(name, opts = {}) {
  const webDir = webProfileDir(opts.home);
  const pkgPath = path.join(webDir, 'package.json');
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const bundles = pkg.dsh && pkg.dsh.profile && pkg.dsh.profile.bundles;
    if (!Array.isArray(bundles)) return { ok: false, error: 'bundles 列表缺失，无法安全移除' };
    if (!bundles.includes(name)) return { ok: false, error: `插件 ${name} 不在 bundles 列表（可能已移除）` };
    // 备份原文件再改写（防呆：出问题可还原）
    const backup = pkgPath + '.bak-' + Date.now();
    fs.copyFileSync(pkgPath, backup);
    pkg.dsh.profile.bundles = bundles.filter((b) => b !== name);
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
    return { ok: true, removed: name, backup, note: '已从装配列表摘除（停用）。未物理删除 node_modules。重启官方 Web 后生效。' };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ---- 一键诊断：检查插件是否能正常运行，返回状态 + 问题 + 修复建议 ----
function diagnosePlugin(name, opts = {}) {
  const webDir = webProfileDir(opts.home);
  const e = resolveBundle(webDir, name);
  const problems = [];
  const suggests = [];

  // 1）字节级：包能否被解析（resolved != null）
  if (!e.resolved) {
    problems.push('bundles 里登记了但 node_modules 里找不到该包（入口缺失）');
    suggests.push({ label: '重新安装插件', action: 'npm 重新安装该包（若在 npm 上有）' });
    suggests.push({ label: '从装配列表停用', action: '一键删除（停用），避免启动报错' });
  }

  // 2）版本是否可读
  if (!e.version || e.version === 'unknown') {
    problems.push('无法读取插件版本号（package.json 损坏或缺失）');
    if (!e.resolved) suggests.push({ label: '检查 package.json 是否完整', action: '看 node_modules 下该包的 package.json 是否存在且内容合法' });
  }

  // 3）描述/仓库空：不强报，仅提示
  // 4）包路径在外部（本地 dev 链接）：不算坏，仅给"开发模式"提示（避免误报异常）
  const devStrong = /[\\/]plugins[\\/]|[\\/]dsh-.+-[mM]ain$/.test(e.resolved || '') || /[\\/]src[\\/]/.test(e.resolved || '');
  const notes = [];
  if (devStrong && e.resolved) {
    notes.push('该插件来自本地开发目录（dev 链接），非 npm 正式安装');
  }

  // 结论级别
  const healthy = problems.length === 0;
  return {
    ok: true,
    name,
    healthy,
    status: healthy ? '正常' : '异常',
    version: e.version,
    resolved: e.resolved,
    problems,
    notes,       // 非错误的信息提示（如本地 dev 链接）
    suggests,
  };
}

module.exports = { scanPlugins, getPluginDetail, uninstallPlugin, diagnosePlugin };
