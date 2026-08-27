// ============================================================
// updater.js —— 软件更新（检查 + 下载 + 一键安装）
// 说明：这是"dsh-desktop 自己"的更新（不是 deepseek web）。
// 机制：
//   · 定期（默认每24小时，北京时间）去 GitHub releases 查最新版本
//   · 与本地版本比较，有新版本 → 记入状态（前端在侧边栏⚙上加红点）
//   · 用户点"检查更新 / 一键更新" → 下载最新安装包（zip/exe）到临时目录
//   · 一键安装：打开下载目录，提示用户用新安装包装一次（覆盖旧版），实现升级
// 大肥鱼：用 GitHub 免费托管，不炸服务器；24小时一更，不烦人。
// ============================================================
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const { shell } = require('electron');
const { CONFIG, URLS } = require('./config');

// 版本号比较：返回 1(a>b) / 0 / -1(a<b)（支持 "0.1.0-rc.1" 之类）
function compareVersions(a, b) {
  const pa = String(a || '').replace(/^v/, '').split(/[.\-]/).map(Number);
  const pb = String(b || '').replace(/^v/, '').split(/[.\-]/).map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

// GitHub API 请求（带 UA，避免被拒）
function ghGet(url) {
  return new Promise((resolve) => {
    https.get(url, { headers: { 'User-Agent': 'dsh-desktop', Accept: 'application/vnd.github.v3+json' } }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve({ ok: true, json: JSON.parse(data) }); }
          catch { resolve({ ok: false, error: '解析失败' }); }
        } else resolve({ ok: false, error: 'HTTP ' + res.statusCode });
      });
    }).on('error', (e) => resolve({ ok: false, error: e.message }));
  });
}

// ---------- 检查最新版本 ----------
// 返回 { latest, hasUpdate, current, downloadUrl, assetName, publishedAt, notes }
async function checkForUpdate() {
  const current = CONFIG.version;
  const r = await ghGet(URLS.latestRelease);
  if (!r.ok) return { ok: false, error: r.error, current };
  const latest = r.json.tag_name; // 如 "v0.1.1"
  // 找对应平台/架构的 asset（zip 优先；Windows 用 setup exe）
  const assets = r.json.assets || [];
  let asset = selectAsset(assets);
  return {
    ok: true,
    current,
    latest,
    hasUpdate: compareVersions(latest, current) > 0,
    downloadUrl: asset ? asset.browser_download_url : null,
    assetName: asset ? asset.name : null,
    publishedAt: r.json.published_at || '',
    notes: (r.json.body || '').slice(0, 500),
  };
}

// 按当前平台挑安装包 asset
function selectAsset(assets) {
  const plat = process.platform;
  // win: .exe 或 .zip；darwin: .dmg/.zip；linux: .AppImage/.deb
  const want = plat === 'win32'
    ? ['.exe', '.zip']
    : plat === 'darwin' ? ['.dmg', '.zip'] : ['.AppImage', '.deb', '.zip'];
  for (const w of want) {
    const hit = assets.find((a) => a.name.toLowerCase().endsWith(w.toLowerCase()));
    if (hit) return hit;
  }
  return assets.find((a) => /\.(exe|zip|dmg|AppImage|deb)$/i.test(a.name)) || null;
}

// ---------- 下载最新安装包到临时目录 ----------
function downloadUpdate(url, destDir) {
  return new Promise((resolve) => {
    if (!url) return resolve({ ok: false, error: '没有可用下载地址' });
    ensureDir(destDir);
    const name = decodeURIComponent(url.split('/').pop());
    const dest = path.join(destDir, name);
    const file = fs.createWriteStream(dest);
    https.get(url, { headers: { 'User-Agent': 'dsh-desktop' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.destroy();
        return downloadUpdate(res.headers.location, destDir).then(resolve); // 跟随重定向
      }
      if (res.statusCode !== 200) {
        file.destroy();
        return resolve({ ok: false, error: '下载失败 HTTP ' + res.statusCode });
      }
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve({ ok: true, file: dest, name })));
      file.on('error', (e) => resolve({ ok: false, error: e.message }));
    }).on('error', (e) => resolve({ ok: false, error: e.message }));
  });
}

function ensureDir(dir) {
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* ignore */ }
}

// 下载目录
function downloadDir() {
  return path.join(os.tmpdir(), 'dsh-desktop-update');
}

// ---------- 一键更新：下载完打开下载目录/直接打开安装包 ----------
async function performUpdate(url) {
  const dir = downloadDir();
  const dl = await downloadUpdate(url, dir);
  if (!dl.ok) return dl;
  // 打开下载目录（让用户双击新安装包完成覆盖升级）
  shell.openPath(dir);
  return { ok: true, file: dl.file, name: dl.name, note: '已下载到临时目录，请双击新安装包装入完成升级。' };
}

// ============================================================
// 北京时间每 24 小时自动检查一次的调度器
// 目标：固定在北京时间每天 02:00 检查（凌晨，少打扰）。
// 计算到下次北京 02:00 的毫秒数，setTimeout 到点执行，然后再排下一次。
// 不叠加运行时长——就是按真实北京时间日历走。
// ============================================================
const BEIJING_OFFSET_MS = 8 * 3600 * 1000; // UTC+8 时差

function msUntilNextBeijing(hour = 2) {
  const now = Date.now();
  // 当前 UTC 时间 → 北京时间的"日+时"
  const beijingMs = now + BEIJING_OFFSET_MS;
  const beijingDate = new Date(beijingMs);
  const targetToday = new Date(beijingDate);
  targetToday.setUTCHours(hour, 0, 0, 0);
  let delta = targetToday.getTime() - beijingMs;
  if (delta <= 0) delta += 24 * 3600 * 1000; // 已经过了今天的时刻 → 明天
  return delta;
}

// 调度器：onCheck 每次到点执行；立即跑一次 + 之后每北京日循环
function scheduleDailyCheck(onCheck) {
  let timer = null;
  const run = async () => {
    clearTimeout(timer);
    try { await onCheck(); } catch { /* 本轮失败不影响下一轮 */ }
    // 排下一次北京时间 02:00
    const wait = msUntilNextBeijing(2);
    console.log(`[updater] 下次自动检查更新时间：${(wait / 3600000).toFixed(1)} 小时后（北京时间 02:00）`);
    timer = setTimeout(run, wait);
  };
  // 先立即跑一次（启动时），再进日历循环
  timer = setTimeout(run, 5000);
  return () => clearTimeout(timer); // 返回停止函数
}

module.exports = { checkForUpdate, downloadUpdate, performUpdate, compareVersions, downloadDir, scheduleDailyCheck, msUntilNextBeijing };
