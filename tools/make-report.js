#!/usr/bin/env node
// ============================================================
// make-report.js —— 生成"软件完整记录 + 代码详情"报包，放到桌面
// 用途：把项目源码各文件摘要、版本信息、发布配置、说明打包成一个
//       zip 放桌面，方便你人工检查、改配置、审阅。
// 用法：node tools/make-report.js   （在项目根目录运行）
// 产物：$HOME/Desktop/dsh-desktop-记录-<日期>.zip
// ============================================================
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const REPORT_DIR = path.join(ROOT, '.report-work');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const dateStr = new Date().toISOString().slice(0, 10);
const OUT = path.join(os.homedir(), 'Desktop', `dsh-desktop-记录-${dateStr}.zip`);

// ---------- 收集要打包的文件（源码 + 文档 + 配置）----------
function collectFiles() {
  const out = [];
  const walk = (dir, base) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.') && e.name !== '.gitignore') continue;
      if (['node_modules', 'dist', '.report-work'].includes(e.name)) continue;
      const p = path.join(dir, e.name);
      const rel = path.join(base, e.name);
      if (e.isDirectory()) walk(p, rel);
      else out.push({ rel, abs: p });
    }
  };
  walk(ROOT, '');
  // 额外塞入关键说明文件（即使被跳过也确保有）
  return out;
}

// ---------- 生成 README-检查说明 ----------
function makeManual() {
  const files = collectFiles();
  return [
    '# DSH Desktop — 完整记录 & 代码详情',
    '',
    '> 由 make-report.js 自动生成。改完可直接 commit/push 到 GitHub。',
    '',
    `## 版本`,
    `- 版本号: ${pkg.version}`,
    `- 生成日期: ${dateStr}`,
    `- 项目名: ${pkg.name}`,
    `- 描述: ${pkg.description || ''}`,
    '',
    `## 你要改的地方（发布前）`,
    `打开 \`src/main/config.js\`，找到这几行并替换成你的 GitHub：`,
    '```',
    "owner: 'YOUR_GITHUB_USERNAME'  ← 改成你的 GitHub 账号",
    "repo: 'dsh-desktop'            ← 仓库名",
    '```',
    '也可以用用户级覆盖文件 $HOME/.dsh/dsh-desktop/config.json 覆盖，不打乱源码。',
    '',
    `## 源码文件清单`,
    '',
    ...files.map((f) => `- \`${f.rel}\``),
    '',
    `## 发布三步（详见 docs/PUBLISH.md）`,
    `1. git add -A && git commit -m "..." && git push`,
    `2. git tag v${pkg.version} && git push origin v${pkg.version}`,
    `3. gh release create v${pkg.version} dist/* --title "v${pkg.version}" --notes "见 README"`,
    '',
  ].join('\n');
}

// ---------- 极简 zip 打包：用系统自带 tar（Windows 10+ / macOS / Linux 都有）----------
// 先把文件铺到临时目录，再 tar -a -cf out.zip -C tmpdir .
function zipWithTar(workDir, outZip) {
  return execSync(`tar -a -cf "${outZip}" -C "${workDir}" .`, { stdio: 'pipe' });
}

(async function main() {
  console.log('正在生成报包…');
  const files = collectFiles();
  // 铺文件到临时目录
  fs.rmSync(REPORT_DIR, { recursive: true, force: true });
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  fs.writeFileSync(path.join(REPORT_DIR, 'README-检查说明.md'), makeManual(), 'utf8');
  let copied = 1;
  for (const f of files) {
    const dest = path.join(REPORT_DIR, f.rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    try { fs.copyFileSync(f.abs, dest); copied++; }
    catch (e) { fs.writeFileSync(dest, '<无法读取: ' + e.message + '>'); }
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.rmSync(OUT, { force: true });
  zipWithTar(REPORT_DIR, OUT);
  fs.rmSync(REPORT_DIR, { recursive: true, force: true });
  console.log(`✅ 报包已生成：${OUT}`);
  console.log(`   包含 ${copied} 个文件，${(fs.statSync(OUT).size / 1024).toFixed(1)} KB`);
})().catch((e) => { console.error('生成失败', e); process.exit(1); });
