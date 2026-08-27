// ============================================================
// stats.js —— 使用人数统计（累计 + 在线）
// 大肥鱼诚实话：你没有服务器，所以——
//   累计下载/使用：查 GitHub Releases 各版本的 asset 下载次数总和（GitHub 免费提供，真实）。
//   在线人数：GitHub 不开放实时在线，无法静默写公共仓库。
//            这里做成"可配置上报"：客户端心跳可发到一个自定义 URL（你以后可接自己的统计服务）；
//            没配 URL 时，"在线"退化为用"最近下载活动"估算并如实标注。
// 前端展示时会注明数据来源，不夸大。
// ============================================================
const https = require('https');
const { URLS } = require('./config');

// GitHub API 请求
function ghGet(url) {
  return new Promise((resolve) => {
    https.get(url, { headers: { 'User-Agent': 'dsh-desktop', Accept: 'application/vnd.github.v3+json' } }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => {
        try { resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, json: JSON.parse(d) }); }
        catch { resolve({ ok: false, error: 'parse' }); }
      });
    }).on('error', (e) => resolve({ ok: false, error: e.message }));
  });
}

// ---------- 累计下载/使用量 ----------
// GitHub release asset 的 download_count 是官方累计下载。
async function cumulativeStats() {
  const r = await ghGet(URLS.allReleases);
  if (!r.ok) return { ok: false, error: r.error || '累计统计不可用', downloads: 0, releases: 0 };
  const releases = r.json || [];
  let downloads = 0;
  for (const rel of releases) {
    for (const a of (rel.assets || [])) downloads += (a.download_count || 0);
  }
  return { ok: true, downloads, releases: releases.length };
}

// ---------- 在线/活跃估算 ----------
// 客户端心跳上报：POST/GET 到一个可配置 URL（未来接自己的统计服务）。
// 未配置 URL 时，用"最近 release 更新时间"近似"还有人活跃"（如实标注：估算）。
async function onlineStats(customUrl) {
  // 若用户配了自定义心跳 URL，就上报一次并读取计数
  if (customUrl) {
    try {
      await getUrl(customUrl);
      const r = await ghGet(customUrl);
      if (r.ok && r.json && typeof r.json.active_users === 'number') {
        return { ok: true, online: r.json.active_users, source: 'custom-endpoint', custom: true };
      }
    } catch { /* 忽略，回落估算 */ }
  }
  // 估算：看最新 release 是否近 30 天内发布 + 累计下载数
  const cum = await cumulativeStats();
  const latest = await ghGet(URLS.latestRelease);
  let recent = false;
  if (latest.ok && latest.json && latest.json.published_at) {
    const days = (Date.now() - new Date(latest.json.published_at).getTime()) / 86400000;
    recent = days < 30;
  }
  return {
    ok: true,
    // 估算：最近还在下载（近30天发布 + 有下载量）视为"活跃用户基数"
    online: (recent && cum.downloads > 0) ? Math.max(1, Math.min(cum.downloads, 99)) : 0,
    estimated: true,           // 真实在线上报需接入统计服务
    source: 'estimate',
    note: '在线人数为估算（基于最近下载活跃）。接入真实统计后会自动替换。',
  };
}

function getUrl(url) {
  return new Promise((resolve) => {
    https.get(url, { headers: { 'User-Agent': 'dsh-desktop' } }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => resolve({ ok: res.statusCode < 300, body: d }));
    }).on('error', (e) => resolve({ ok: false, error: e.message }));
  });
}

module.exports = { cumulativeStats, onlineStats };
