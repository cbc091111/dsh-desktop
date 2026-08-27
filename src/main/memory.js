// ============================================================
// memory.js —— 记忆 查看 / 新增 / 迁移 / 导出
// 采用「官方 Markdown 镜像」方案（避开 node:sqlite，兼容 Electron 主进程）
//   · ~/.dsh/memory/ 下官方的 preferences.md / projects.md / decisions.md /
//     history.md / summary.md 是 dsh-mneme 导出的人类可读快照；
//     官方注释明确"手工编辑此文件会被合并回记忆库（人工优先）"。
//   · 所以：读取 = 解析这些 md；新增/迁移 = 按官方格式追加到对应 md。
//     完全不需要 sqlite，安全、跨平台、与官方机制协同。
// 大肥鱼：走官方认可的路，既读得清也写得进，还不碰数据库地雷。
// ============================================================
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

// 记忆库目录（兼容 K 盘 deepseek memory 偏好 + 本地兜底）
function memoryDir(home) {
  const k = 'K:/deepseek memory';
  if (fs.existsSync(k)) return k;
  return path.join(home || process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'memory');
}

// 官方 md 镜像文件 → 类型
const TYPE_FILES = {
  preference: 'preferences.md',
  project: 'projects.md',
  decision: 'decisions.md',
  history: 'history.md',
  summary: 'summary.md',
};

function openTypeFile(type, home) {
  return path.join(memoryDir(home), TYPE_FILES[type] || 'history.md');
}

// ---- 解析单个官方 md 镜像文件 → 记忆项数组 ----
function parseMirror(file) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch { return []; }
  const items = [];
  let cur = null;
  let curBody = [];
  let skipComment = false;
  const flush = () => {
    if (cur && curBody.join('\n').trim()) {
      cur.content = curBody.join('\n').trim();
      items.push(cur);
    }
    cur = null; curBody = [];
  };
  for (const line of raw.split('\n')) {
    // 新条目：## 标题（## 开头的正文段落不要，只有条目标题用它区分）
    const title = line.match(/^##\s+(.+)$/);
    if (title) {
      flush();
      cur = { type: null, title: title[1].trim(), importance: 3, tags: [], id: null, content: '' };
      continue;
    }
    if (!cur) continue;
    // 字段
    const id = line.match(/^\*\*ID\*\*\s*[:：]\s*`?([^`]+)`?\s*$/);
    const typ = line.match(/^\*\*类型\*\*\s*[:：]\s*(\w+)/);
    const imp = line.match(/^\*\*重要性\*\*\s*[:：]\s*(\d+)/);
    const tag = line.match(/^\*\*标签\*\*\s*[:：]\s*(.*)$/);
    if (id) { cur.id = id[1].trim(); continue; }
    if (typ) { cur.type = typ[1].toLowerCase(); continue; }
    if (imp) { cur.importance = Math.max(1, Math.min(5, Number(imp[1]))); continue; }
    if (tag) {
      const t = tag[1].trim();
      cur.tags = t && t !== '-' ? t.split(/[,，]/).map((s) => s.trim()).filter(Boolean) : [];
      continue;
    }
    // HTML 注释块（整块跳过，直到 -->）
    if (line.indexOf('-->') !== -1 && skipComment) { skipComment = false; continue; }
    if (line.trim().startsWith('<!--')) {
      if (line.indexOf('-->') === -1) skipComment = true;
      continue;
    }
    if (skipComment) continue;
    // 分隔线忽略
    if (line.trim() === '---') continue;
    if (line.trim()) curBody.push(line);
  }
  flush();
  return items;
}

// 列出记忆：读全部类型 md，可选筛选/搜索
function listMemories(opts = {}) {
  const items = [];
  for (const type of Object.keys(TYPE_FILES)) {
    const f = openTypeFile(type, opts.home);
    const parsed = parseMirror(f);
    parsed.forEach((p) => {
      const item = { id: p.id || null, type: type, title: p.title, content: p.content, tags: p.tags || [], importance: p.importance || 3, forgotten: false, archived: false, updated_at: p.updated_at || '' };
      items.push(item);
    });
  }
  // 筛选
  let filtered = items;
  if (opts.type) filtered = filtered.filter((i) => i.type === opts.type);
  if (opts.query) {
    const q = opts.query.toLowerCase();
    filtered = filtered.filter((i) => (i.title || '').toLowerCase().includes(q) || (i.content || '').toLowerCase().includes(q));
  }
  filtered = filtered.sort((a, b) => b.importance - a.importance);
  const lim = opts.limit || 200;
  return { ok: true, count: filtered.length, items: filtered.slice(0, lim) };
}

// 统计
function memoryStats(home) {
  const items = listMemories({ home, limit: 10000 }).items;
  const byType = {};
  items.forEach((i) => (byType[i.type] = (byType[i.type] || 0) + 1));
  return { ok: true, total: items.length, byType };
}

// 新增一条记忆：追加到对应类型的官方 md 镜像（官方会合并回记忆库）
function addMemory(data, opts = {}) {
  const type = ['preference', 'project', 'decision', 'history', 'summary'].includes(data.type) ? data.type : 'preference';
  const f = openTypeFile(type, opts.home);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const title = String(data.title || '未命名');
  const content = String(data.content || '');
  const importance = Math.max(1, Math.min(5, Math.round(Number(data.importance) || 3)));
  const tags = Array.isArray(data.tags) ? data.tags.slice(0, 20).map(String).join(',') : '';

  // 构造官方镜像格式的条目块
  const block =
    `\n## ${title}\n` +
    `- **ID**: \`${id}\`\n` +
    `- **类型**: ${type}\n` +
    `- **重要性**: ${importance}\n` +
    `- **标签**: ${tags}\n` +
    `- **更新时间**: ${now}\n` +
    `\n${content}\n---\n`;

  try {
    fs.appendFileSync(f, block, 'utf8');
    return { ok: true, id, type, title };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// 批量追加（迁移导入）—— 直接追加，不做事务（md 是流式）
function importMany(items, opts = {}) {
  let done = 0, failed = 0;
  const errors = [];
  const importedTitles = [];
  for (const it of (items || [])) {
    const r = addMemory(it, opts);
    if (r.ok) { done++; importedTitles.push(String(it.title || '未命名')); }
    else { failed++; if (errors.length < 5) errors.push(String(it && it.title) + ': ' + r.error); }
  }
  return { ok: failed === 0, done, failed, errors, importedTitles };
}

// —— 迁移后完整性检查（harness 自己检查；第三方工具不支持外部联动）——
// 传入刚导入的标题列表，读回记忆库核对：每条是否都能搜到、字段是否完整合法
function verifyImported(opts = {}) {
  const titles = (opts.titles || []).slice(0, 200);
  if (!titles.length) {
    return { ok: false, passed: 0, total: 0, issues: [{ kind: 'empty', detail: '没有需要校验的导入条目' }] };
  }
  const all = listMemories({ home: opts.home, limit: 10000 }).items;
  const issues = [];
  let passed = 0;
  for (const t of titles) {
    // 用 title 精确匹配（md 镜像里 title 是唯一可查的稳定字段）
    const found = all.filter((i) => i.title === t);
    if (found.length === 0) {
      issues.push({ kind: 'missing', title: t, detail: `导入后找不到记忆"${t}"` });
      continue;
    }
    const f = found[found.length - 1]; // 最后一次追加
    // 格式合法性
    const contentOk = f.content && f.content.trim().length > 0;
    const typeOk = ['preference', 'project', 'decision', 'history', 'summary'].includes(f.type);
    const impOk = typeof f.importance === 'number' && f.importance >= 1 && f.importance <= 5;
    if (contentOk && typeOk && impOk) passed++;
    else {
      const bad = [];
      if (!contentOk) bad.push('内容为空');
      if (!typeOk) bad.push(`类型不合法(${f.type})`);
      if (!impOk) bad.push(`重要性非法(${f.importance})`);
      issues.push({ kind: 'malformed', title: t, detail: `记忆"${t}"字段不完整：${bad.join('、')}` });
    }
  }
  return {
    ok: issues.length === 0,
    passed,
    total: titles.length,
    issues,
  };
}

// 导出：合并所有类型 → Markdown
function exportMarkdown(home) {
  const items = listMemories({ home, limit: 10000 }).items;
  let md = '# 记忆导出\n\n> 由 DSH Desktop 导出，可编辑或用"迁移导入"读回。\n\n';
  const typeOrder = ['preference', 'project', 'decision', 'history', 'summary'];
  for (const t of typeOrder) {
    const group = items.filter((i) => i.type === t);
    if (!group.length) continue;
    md += `\n## ${t}\n`;
    for (const m of group) {
      md += `\n### ${m.title}\n`;
      md += `**importance**: ${m.importance}  ` + (m.tags.length ? `**tags**: ${m.tags.join(', ')}  ` : '') + '\n';
      md += m.content + '\n';
    }
  }
  return { ok: true, count: items.length, md };
}

module.exports = { parseMirror, listMemories, memoryStats, addMemory, importMany, verifyImported, exportMarkdown, memoryDir };
