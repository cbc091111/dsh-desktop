// ============================================================
// config.js —— 应用配置中心
// 把所有"会因发布/换仓库而变"的东西集中在这里，便于无损更新：
//   发布到 GitHub 后，只需改 GITHUB_OWNER / GITHUB_REPO，
//   软件启动时自动从 GitHub 仓库读取最新版本、下载量、在线统计等。
// 后续加功能也不动这里，改别的文件即可。
// ============================================================
const os = require('os');
const path = require('path');

// ---------- 你的 GitHub 信息（发布前改这里，或改用户目录下的 config.local.json）----------
// 占位：未发布时指向占位仓库；发布后改成你真实的账号/仓库名。
const DEFAULT_CONFIG = {
  // GitHub 归属（想换仓库只改这两行）
  owner: 'cbc091111',   // ← 你的 GitHub 账号
  repo: 'dsh-desktop',             // ← 仓库名
  // 当前软件版本（发布打标签时同步更新；也可读 package.json）
  version: readOwnVersion(),
  // 统计心跳用的路径（在线人数：客户端发心跳到 GitHub 一个公共文件记录时间戳+计数）
  analytics: {
    // 心跳写入的目标：一个 GitHub 仓库里的公共文件（用于"在线"伪实时计数）
    heartbeatsRepo: 'dsh-desktop-analytics',
    heartbeatFile: 'heartbeats.json',
    // 客户端浏览器访问我们 Release 页/官网时也会被计数（累计）
  },
};

// 读到本项目自己的版本
function readOwnVersion() {
  try {
    const pkg = require('../../package.json');
    return pkg.version || '0.0.0';
  } catch { return '0.0.0'; }
}

// ---------- 允许用户放一个"用户级覆盖"配置文件：让换仓库/换版本更无损 ----------
//   $HOME/.dsh/dsh-desktop/config.json  可存在，字段覆盖上面默认值
function loadUserOverrides() {
  try {
    const p = path.join(os.homedir(), '.dsh', 'dsh-desktop', 'config.json');
    if (require('fs').existsSync(p)) return JSON.parse(require('fs').readFileSync(p, 'utf8'));
  } catch { /* 忽略 */ }
  return {};
}

const user = loadUserOverrides();

// 合并默认 + 用户覆盖
const CONFIG = {
  owner: user.owner || DEFAULT_CONFIG.owner,
  repo: user.repo || DEFAULT_CONFIG.repo,
  version: user.version || DEFAULT_CONFIG.version,
  analytics: {
    heartbeatsRepo: (user.analytics && user.analytics.heartbeatsRepo) || DEFAULT_CONFIG.analytics.heartbeatsRepo,
    heartbeatFile: (user.analytics && user.analytics.heartbeatFile) || DEFAULT_CONFIG.analytics.heartbeatFile,
  },
};

// 常用 URL 组装
const URLS = {
  // GitHub Release API：拿最新版本信息
  latestRelease: `https://api.github.com/repos/${CONFIG.owner}/${CONFIG.repo}/releases/latest`,
  // 拿所有 releases（统计累计下载量）
  allReleases: `https://api.github.com/repos/${CONFIG.owner}/${CONFIG.repo}/releases`,
  // 统计仓库（在线心跳 + 累计使用时记录）
  heartbeatJson: `https://api.github.com/repos/${CONFIG.owner}/${CONFIG.analytics.heartbeatsRepo}/contents/${CONFIG.analytics.heartbeatFile}`,
  heartbeatRaw: `https://raw.githubusercontent.com/${CONFIG.owner}/${CONFIG.analytics.heartbeatsRepo}/main/${CONFIG.analytics.heartbeatFile}`,
};

module.exports = { CONFIG, URLS, DEFAULT_CONFIG, loadUserOverrides };
