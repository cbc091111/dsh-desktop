// ============================================================
// memory-importer.js —— 迁移导入：解析其他 agent 工具的记忆文件
// 支持常见来源：
//   · JSON 数组/对象（ChatGPT / Claude / Gemini / Cursor 等导出的记忆/对话）
//   · Markdown（含本壳 exportMarkdown 的格式，可"搬去再搬回"）
//   · CSV（简单的 title,content,type,importance,tags）
// 统一映射成 dsh-mneme 结构 {type,title,content,tags,importance}
// 大肥鱼：别人的记忆也能搬进自己脑子，但先给你看清单，不偷梁换柱。
// ============================================================
const fs = require('fs');
const path = require('path');

// 根据扩展名 / 内容嗅探解析
function parseMemoryFile(absPath) {
  try {
    const ext = path.extname(absPath || '').toLowerCase();
    const raw = fs.readFileSync(absPath, 'utf8');
    if (ext === '.json') return parseJson(raw);
    if (ext === '.csv') return parseCsv(raw);
    // 其余按 Markdown / 文本
    return parseMarkdown(raw);
  } catch (e) {
    return { ok: false, error: e.message, items: [] };
  }
}

// 判断字符串是否 JSON
function parseJson(raw) {
  try {
    const data = JSON.parse(raw);
    // 数组 → 每条都是记忆
    if (Array.isArray(data)) return { ok: true, items: data.map(normalize).filter(Boolean) };
    // 对象：可能含 memories/items/conversations 字段
    const arr = Array.isArray(data.memories) ? data.memories
      : Array.isArray(data.items) ? data.items
      : Array.isArray(data.conversations) ? data.conversations
      : null;
    if (arr) return { ok: true, items: arr.map(normalize).filter(Boolean) };
    // 单个对象本身是一条记忆
    const one = normalize(data);
    return one ? { ok: true, items: [one] } : { ok: false, error: '无法识别的 JSON 结构', items: [] };
  } catch (e) {
    return { ok: false, error: 'JSON 解析失败：' + e.message, items: [] };
  }
}

// 把一个来源对象规整成记忆结构
function normalize(o) {
  if (!o || typeof o !== 'object') return null;
  // 常见字段别名映射
  const pick = (...keys) => { for (const k of keys) { if (o[k] != null && typeof o[k] !== 'object') return o[k]; } return null; };
  const title = String(pick('title', 'name', 'topic', 'subject', 'summary') || '').slice(0, 200);
  const content = String(pick('content', 'text', 'body', 'message', 'description', 'detail') || '').slice(0, 4000);
  if (!content) return null; // 没内容不值得导
  // type
  let type = String(pick('type', 'kind', 'category') || '').toLowerCase();
  type = ['preference', 'project', 'decision', 'history', 'summary'].includes(type) ? type : 'history';
  // importance
  let imp = Number(pick('importance', 'priority', 'weight', 'score', 'star')) || 3;
  imp = Math.max(1, Math.min(5, Math.round(imp)));
  // tags
  let tags = [];
  const tv = pick('tags', 'labels', 'keywords');
  if (Array.isArray(tv)) tags = tv.map(String);
  else if (typeof tv === 'string' && tv.trim()) tags = tv.split(',').map((s) => s.trim()).filter(Boolean);
  return { type, title: title || '（未命名）', content, tags, importance: imp };
}

// Markdown 解析：识别 "## type" 分节 + "### title" + content
function parseMarkdown(raw) {
  const items = [];
  let curType = 'history';
  let curTitle = null;
  let curBuf = [];
  let curTags = [];
  let curImp = 3;

  const flush = () => {
    if (curTitle) {
      const content = curBuf.join('\n').trim().replace(/\n{3,}/g, '\n\n');
      if (content) items.push({ type: curType, title: curTitle, content, tags: curTags, importance: curImp });
    }
    curTitle = null; curBuf = []; curTags = []; curImp = 3;
  };

  const lines = raw.split('\n');
  for (const line of lines) {
    // 类型节 [H2]：## preference（去掉行尾 $，避免多行下失配）
    const s = line.match(/^##\s+(\w+)/);
    if (s) {
      if (['preference','project','decision','history','summary'].includes(s[1])) {
        // 切换类型节前，先收掉上一节未完结的条目
        if (curTitle) flush();
        curType = s[1];
      } else {
        // 非记忆类型的 H2（如标题分隔），也先 flush 当前条目
        if (curTitle) flush();
      }
      continue;
    }
    // 标题 [H3]：### title
    const m = line.match(/^###\s+(.+)/);
    if (m) { flush(); curTitle = m[1].trim(); continue; }
    // importance & tags 元数据（可能在同一行，如 "**importance**: 4  **tags**: a, b"）
    const imp = line.match(/\*\*importance\*\*\s*[:：]\s*(\d+)/);
    if (imp) { curImp = Math.max(1, Math.min(5, Number(imp[1]))); }
    const tg = line.match(/\*\*tags\*\*\s*[:：]\s*(.+)/);
    if (tg) { curTags = tg[1].split(',').map((x) => x.trim()).filter(Boolean); }
    if (imp || tg) continue;
    if (line.trim() && !line.startsWith('# ') && !line.startsWith('>')) curBuf.push(line);
  }
  flush();
  return { ok: true, items };
}

// CSV 解析：表头 title,content,type,importance,tags
function parseCsv(raw) {
  const lines = raw.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return { ok: false, error: '空 CSV', items: [] };
  const header = lines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, ''));
  const items = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    if (cells.length && cells.join('').trim()) {
      const row = {};
      header.forEach((h, idx) => (row[h] = cells[idx] != null ? cells[idx].replace(/^"|"$/g, '') : ''));
      const one = normalize(row);
      if (one) items.push(one);
    }
  }
  return { ok: true, items };
}

// 简单 CSV 行解析（处理引号包裹的逗号）
function splitCsvLine(line) {
  const out = []; let cur = ''; let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) { if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false; } else cur += ch; }
    else { if (ch === '"') inQ = true; else if (ch === ',') { out.push(cur); cur = ''; } else cur += ch; }
  }
  out.push(cur);
  return out;
}

module.exports = { parseMemoryFile };
