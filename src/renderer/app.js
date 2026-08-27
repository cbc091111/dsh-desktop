// ============================================================
// app.js —— 壳的渲染层逻辑
// 引导序列：拉状态 → 监听变化 → 把官方 Web 地址喂给 <webview> → 顶栏指示灯
// 遇到运行时错误及时 toast（不打断人，符合"大肥鱼"的松弛感）
// ============================================================

// ---------- 小工具：toast（出错/关键变化及时汇报）----------
function toast(msg, kind = 'info') {
  const host = document.getElementById('toast-wrap');
  const el = document.createElement('div');
  el.className = 'toast' + (kind === 'err' ? ' err' : kind === 'ok' ? ' ok' : '');
  el.textContent = msg;
  host.appendChild(el);
  setTimeout(() => el.remove(), 5200); // 5 秒后自动消失，不打扰
}

// ---------- 获取 DOM 引用 ----------
const $ = (id) => document.getElementById(id);
const dot = $('dot'), statusText = $('statusText');
const webview = $('official');

// ---------- 状态渲染：顶栏在线灯 + 主入口加载 ----------
function applyState(snap) {
  const running = Boolean(snap && snap.running);
  const inferring = Boolean(snap && snap.inferring);

  // 顶栏在线灯三态：在线/掉线/未决
  if (running) {
    dot.className = 'dot online';
    statusText.textContent = '官方 DSH 在线';
  } else if (snap && snap.error) {
    dot.className = 'dot down';
    statusText.textContent = '未在线 · ' + snap.error;
  } else {
    dot.className = 'dot pending';
    statusText.textContent = '检测中…';
  }

  // 强制停止推理按钮：随时可点（是否推理交给用户自主判断）
  const stopBtn = $('btnStop');
  stopBtn.disabled = false; // 始终可用，不依赖推理检测
  stopBtn.classList.remove('inferring');
  stopBtn.title = '强制停止推理（自主判断，随时可用）';
}

// ---------- webview：官方界面加载状态监控 ----------
function wireWebview() {
  const wv = $('official');
  if (!wv) return;

  // 成功加载整个页面 → 顶栏亮绿
  wv.addEventListener('did-finish-load', () => {
    console.log('[webview] did-finish-load', wv.src);
    dot.className = 'dot online';
    statusText.textContent = '官方 DSH 在线';
  });

  // 任意子资源/导航失败 → 及时汇报（不打断人）
  wv.addEventListener('did-fail-load', (e) => {
    // 把错误码都打日志，便于诊断；-3 是内部可预期中断，不弹提示
    console.warn('[webview][fail]', e.errorCode, e.errorDescription, 'url=', e.validatedURL || wv.src);
    if (e.errorCode === -3) return;
    dot.className = 'dot down';
    statusText.textContent = '官方页面加载失败';
    toast(`官方页面加载失败(${e.errorCode})：${e.errorDescription || '未知原因'}。试试"一键重启"。`, 'err');
  });

  // 追踪加载生命周期（诊断用：确认 webview 进入加载流程）
  wv.addEventListener('did-start-loading', () => {
    console.log('[webview] did-start-loading', wv.src);
  });
  wv.addEventListener('did-stop-loading', () => {
    console.log('[webview] did-stop-loading', wv.src);
  });

  // 官方页面里跳转到新域名时，保留在官方会话内即可（href 已由主进程交给系统浏览器）
  wv.addEventListener('dom-ready', () => {
    console.log('[webview] dom-ready', wv.src);
  });
}

// ---------- 侧栏自动隐藏：点左上角"把手"展开，鼠标移开自动收回 ----------
// 用手把/点击触发，不用 hover 热区（避免误触）
function wireSidebarAutoHide() {
  const tab = $('sidebar-tab');
  const sidebar = $('sidebar');

  const openSidebar = () => document.body.classList.add('sidebar-open');
  const closeSidebar = () => document.body.classList.remove('sidebar-open');

  // 点把手展开（把手在侧栏收起时可见）
  if (tab) tab.addEventListener('click', openSidebar);
  // 鼠标进入侧栏保持展开
  sidebar.addEventListener('mouseenter', openSidebar);
  // 鼠标移出侧栏 → 稍缓一下再收起（避免抖；给用户一点反应时间）
  sidebar.addEventListener('mouseleave', () => { setTimeout(closeSidebar, 200); });
}

// ---------- 侧栏导航 + 二级菜单 Flyout（手机 app 进出效果）----------
const flyout = $('flyout');
const flyoutClose = $('flyoutClose');
const flyoutTitle = $('flyoutTitle');
const flyoutBody = $('flyoutBody');
let flyoutTimer = null; // 动画收尾定时器（隐藏掉 display:none）

// 打开某二级面板：view = 'plugins' | 'settings' | 'market'
function openFlyout(view) {
  // 高亮对应导航项
  document.querySelectorAll('.nav-item').forEach((n) =>
    n.classList.toggle('active', n.dataset.view === view));

  // 设置标题与内容
  if (view === 'plugins') {
    flyoutTitle.textContent = '🔌 插件';
    renderPluginsPanel();
  } else if (view === 'settings') {
    flyoutTitle.textContent = '⚙ 附加设置';
    renderSettingsPanel();
  } else if (view === 'market') {
    flyoutTitle.textContent = '🛒 插件市场';
    renderMarketPanel();
  }

  // 播放进入动画（浮层从左侧滑入；webview 本体不隐藏，返回即见）
  clearTimeout(flyoutTimer);
  flyout.classList.remove('hidden', 'closing');
  void flyout.offsetWidth;
  flyout.classList.add('open');
}

// 关闭：播放反向动画后真正隐藏
// 关键改进：关闭后【落在展开的侧边栏】，方便继续点其它导航，而不是直接缩回主界面。
function closeFlyout() {
  if (!flyout.classList.contains('open')) return;
  flyout.classList.remove('open');
  flyout.classList.add('closing');
  // 关闭浮层的同时展开侧栏（让用户回到导航面板，能继续操作）
  document.body.classList.add('sidebar-open');
  // 等反向动画跑完再把元素 display:none（手机退出 app 的收尾）
  flyoutTimer = setTimeout(() => {
    flyout.classList.add('hidden');
    flyout.classList.remove('closing');
  }, 300);
}

// 点导航：主界面→关浮层回官方界面；市场/插件/附加设置→开浮层
// 官方 Web 由 webview 直接常驻显示（打开软件即官方界面，不弹系统浏览器靠 --no-open 保证）
document.querySelectorAll('.nav-item').forEach((item) => {
  item.addEventListener('click', () => {
    // 禁用态导航项（当前：插件市场维护中）不可打开，给个友好提示
    if (item.classList.contains('disabled')) {
      toast('🛒 插件市场暂时关闭（安装功能维护中），等下次更新后恢复，不好意思～', 'err');
      return;
    }
    const view = item.dataset.view;
    if (view === 'home') {
      closeFlyout(); // 关浮层，回官方界面
    } else {
      openFlyout(view);
    }
  });
});

// 右上角关闭按钮 → 反向动画回原位
flyoutClose.addEventListener('click', closeFlyout);

// 点击右侧遮罩空白关闭（不隐藏 webview，只是收起浮层）
flyout.addEventListener('click', (e) => {
  if (e.target.classList && e.target.classList.contains('flyout-backdrop')) closeFlyout();
});

// 顶栏"附加设置"快捷按钮 → 打开附加设置浮层
$('btnSettings').addEventListener('click', () => {
  openFlyout('settings');
});

// ---- 插件面板：真实扫描展示（M4）----
// 从主进程拿插件列表 + 相对上次的 新增/移除/更新，分门别类展示
async function renderPluginsPanel() {
  flyoutBody.innerHTML =
    '<p class="muted" style="margin-bottom:10px">每次打开会自动扫描插件变动。</p>' +
    '<div id="flyoutPluginList" class="plugin-panel"></div>';
  const box = document.getElementById('flyoutPluginList');
  box.innerHTML = '<div class="muted">扫描中…</div>';

  try {
    const res = await window.dshDesktop.scanPlugins();

    // 变动区：新增/移除/更新（用色块分类，一眼看清）
    let html = '';
    const c = res.changed || {};
    if (c.firstTime) {
      html += '<div class="plug-sect muted">首次扫描：已建立插件基线，安装新插件后再对比。</div>';
    }
    if (c.added && c.added.length) html += badge('新增', c.added, 'add');
    if (c.removed && c.removed.length) html += badge('移除', c.removed, 'del');
    if (c.updated && c.updated.length) html += badge('更新', c.updated, 'upd');

    // 全部插件清单（每一项可点击 → 弹详情）
    const entries = res.entries || {};
    const listHtml = Object.keys(entries).map((n) => {
      const e = entries[n];
      const flag = e.missing ? '<span class="plug-flag">缺失</span>' : '';
      return `<div class="plug-item clickable" data-plugin="${escapeHtml(n)}" title="点击查看详情">` +
        `<span class="plug-name">${escapeHtml(n)}</span>` +
        `<span class="plug-ver">${e.missing ? '' : (e.version || '?')}</span>${flag}` +
        `<span class="plug-more">›</span>` +
        `</div>`;
    }).join('');

    html += `\n<div class="plug-border"></div>\n` +
      `<div class="plug-sect muted" style="margin-top:6px">已装配 ${res.total || 0} 个插件（点某个查看详情 / 诊断 / 删除）：</div>` +
      listHtml || '<div class="muted">（空）</div>';

    box.innerHTML = html;

    // 绑定点击 → 打开插件详情
    box.querySelectorAll('[data-plugin]').forEach((el) => {
      el.addEventListener('click', () => {
        const name = el.getAttribute('data-plugin');
        renderPluginDetail(name);
      });
    });
  } catch (e) {
    box.innerHTML = '<div class="plug-sect err">扫描失败：' + escapeHtml(String(e && e.message || e)) + '</div>';
  }
}

// ---- 插件详情弹窗（在 flyout 里切换视图）----
// 含：地址 / 简介 / 一键删除 / 一键诊断(异常给修复建议) / 返回列表
async function renderPluginDetail(name) {
  flyoutTitle.textContent = '🔌 插件详情';
  flyoutBody.innerHTML = '<div class="muted">加载插件信息…</div>';
  try {
    const d = await window.dshDesktop.plugin.detail(name);
    const entry = d || {};
    const repoUrl = formatRepo(entry.repository);

    flyoutBody.innerHTML =
      `<div class="plug-detail-head">
         <button class="th-btn sm" id="plugBack">← 返回列表</button>
         <div class="plug-detail-status">${entry.missing ? '<span style="color:var(--danger)">缺失</span>' : `v${entry.version || '?'}`}</div>
       </div>` +
      `<h3 class="plug-detail-name">${escapeHtml(entry.name || name)}</h3>` +
      (!entry.missing ?
        `<div class="plug-detail-desc">${escapeHtml(entry.description || '（暂无简介）')}</div>` :
        `<div class="plug-sect err">该插件在装配列表里，但包里找不到实体，可能已损坏或被移除。</div>`) +
      `<div class="plug-detail-meta">
         <div class="pd-label">仓库地址</div>
         <div class="pd-value mono">${repoUrl ? `<a href="#" data-open="${escapeHtml(repoUrl)}">${escapeHtml(repoUrl)}</a>` : '（未提供 repository）'}</div>
         <div class="pd-label">本机路径</div>
         <div class="pd-value mono">${escapeHtml(entry.resolved || (entry.missing ? '（未找到）' : ''))}</div>
       </div>` +
      `<div class="plug-detail-actions">
         <button class="th-btn sm" id="plugDiagnose" style="border-color:var(--accent);color:var(--accent)">🩺 一键诊断</button>
         <button class="th-btn sm danger" id="plugDelete">🗑 一键删除</button>
       </div>` +
      `<div id="plugDiagnoseResult" style="margin-top:12px"></div>` +
      `<div id="plugDeleteConfirm" class="hidden" style="margin-top:12px;border:1px solid var(--danger);border-radius:10px;padding:12px">
          <p style="font-size:13px;line-height:1.6;color:var(--text)">⚠️ 这个操作会把 <b>${escapeHtml(entry.name || name)}</b> 从装配列表里<b>摘除（停用）</b>。不会物理删除文件。官方 Web 重启后才生效。</p>
          <div style="display:flex;gap:8px;margin-top:10px">
            <button class="th-btn sm" id="plugDeleteYes" style="border-color:var(--danger);color:var(--danger)">确认停用</button>
            <button class="th-btn sm" id="plugDeleteNo">取消</button>
          </div>
       </div>`;

    // 返回列表
    flyoutBody.querySelector('#plugBack').addEventListener('click', () => {
      flyoutTitle.textContent = '🔌 插件';
      renderPluginsPanel();
    });

    // 仓库地址链接 → 用系统浏览器打开
    const a = flyoutBody.querySelector('[data-open]');
    if (a) {
      a.addEventListener('click', (e) => {
        e.preventDefault();
        const openExternal = (url) => {
          // 通过主进程在系统浏览器打开（preload 暴露）
          window.dshDesktop.deploy && window.dshDesktop.openExternal(url);
        };
        openExternal(a.getAttribute('data-open'));
      });
    }

    // 一键诊断
    flyoutBody.querySelector('#plugDiagnose').addEventListener('click', async () => {
      const box = flyoutBody.querySelector('#plugDiagnoseResult');
      box.innerHTML = '<div class="muted">诊断中…</div>';
      const res = await window.dshDesktop.plugin.diagnose(name);
      if (res && res.ok) {
        if (res.healthy) {
          // 正常：显示正常，附带非错误信息（如"本地 dev 链接"）
          box.innerHTML = `<div style="color:var(--ok);font-size:13px">✅ 插件运行正常（v${res.version || '?'}）</div>`;
          if (res.notes && res.notes.length) {
            box.innerHTML += '<div class="muted" style="margin-top:6px">💡 ' + res.notes.map(escapeHtml).join('；') + '</div>';
          }
        } else {
          let html = '<div style="font-size:13px;color:var(--danger);margin-bottom:8px">⚠ 诊断发现 ' + res.problems.length + ' 个问题：</div>';
          html += '<ul class="plug-diagnose-list">' + res.problems.map((p) => `<li>${escapeHtml(p)}</li>`).join('') + '</ul>';
          html += '<div style="font-size:13px;color:var(--text);margin:8px 0 6px">🔧 修复建议（选一个执行）：</div>';
          html += '<div class="plug-suggests">' + (res.suggests && res.suggests.length ? res.suggests.map((s, i) =>
            `<button class="th-btn sm" data-sug="${i}" title="${escapeHtml(s.action)}">${escapeHtml(s.label)}</button>`).join('')
            : '<div class="muted">（无自动修复建议）</div>') + '</div>';
          box.innerHTML = html;
          box.querySelectorAll('[data-sug]').forEach((b) => {
            b.addEventListener('click', () => {
              const sug = res.suggests[Number(b.getAttribute('data-sug'))];
              // 修复建议执行为提示（删除类走删除流程）
              box.innerHTML += `<div class="muted" style="margin-top:8px">建议：${escapeHtml(sug && sug.action)}。如需停用请用下方"一键删除"。</div>`;
              toast('已记录修复建议：' + (sug && sug.label), 'info');
            });
          });
        }
      } else {
        box.innerHTML = '<div class="plug-sect err">诊断失败：' + escapeHtml(String(res && res.error || '未知')) + '</div>';
      }
    });

    // 一键删除
    flyoutBody.querySelector('#plugDelete').addEventListener('click', () => {
      flyoutBody.querySelector('#plugDeleteConfirm').classList.remove('hidden');
    });
    flyoutBody.querySelector('#plugDeleteNo').addEventListener('click', () => {
      flyoutBody.querySelector('#plugDeleteConfirm').classList.add('hidden');
    });
    flyoutBody.querySelector('#plugDeleteYes').addEventListener('click', async () => {
      flyoutBody.querySelector('#plugDeleteYes').disabled = true;
      const res = await window.dshDesktop.plugin.uninstall(name);
      if (res && res.ok) {
        toast(`已停用插件 ${name}。重启官方 Web 后生效。`, 'ok');
        flyoutTitle.textContent = '🔌 插件';
        renderPluginsPanel(); // 刷新列表
      } else {
        toast('停用失败：' + (res && res.error || '未知'), 'err');
        flyoutBody.querySelector('#plugDeleteYes').disabled = false;
      }
    });
  } catch (e) {
    flyoutBody.innerHTML = '<div class="plug-sect err">加载插件详情失败：' + escapeHtml(String(e && e.message || e)) + '</div>';
  }
}

// 把 repository 字段规整成可打开的 URL
function formatRepo(repo) {
  if (!repo) return '';
  // git+https://... 或 git@github.com:user/repo.git
  const r = String(repo);
  if (/^https?:\/\//.test(r)) return r.replace(/^git\+/, '');
  const m = r.match(/git@([^:]+):(.+)\.git/);
  if (m) return `https://${m[1]}/${m[2]}`;
  const m2 = r.match(/^([^:]+):(.+)\.git/);
  if (m2) return `https://github.com/${m2[2]}`;
  return r;
}

// 变动徽章组
function badge(label, names, kind) {
  const color = { add: '#3fb950', del: '#f85149', upd: '#d29922' }[kind] || '#8b949e';
  return `<div class="plug-sect">
    <span class="plug-label" style="color:${color}">${label} ${names.length}</span>
    <div class="plug-names">${names.map(escapeHtml).join(' · ')}</div>
  </div>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// 启动时自动扫描一次插件，若有变动则轻提示（不打断）
async function autoScanPluginsOnLaunch() {
  try {
    const res = await window.dshDesktop.scanPlugins();
    const c = res.changed || {};
    if (!c.firstTime) {
      const nAdd = (c.added || []).length, nDel = (c.removed || []).length, nUpd = (c.updated || []).length;
      if (nAdd || nDel || nUpd) {
        const parts = [];
        if (nAdd) parts.push(`新增 ${nAdd}`);
        if (nDel) parts.push(`移除 ${nDel}`);
        if (nUpd) parts.push(`更新 ${nUpd}`);
        toast(`插件有变动：${parts.join('，')}。可到"插件"面板查看。`, 'ok');
      }
    }
  } catch (e) { /* 静默：扫描不是关键路径 */ }
}

// ---- 主题 & 壁纸（M4）----
// 把主题色板写到 <html> 上的 CSS 变量，覆盖 base.css 的默认配色；壁纸作为 body 背景
async function applyTheme() {
  try {
    const t = await window.dshDesktop.theme.get();
    if (!t || !t.palette) return;
    const p = t.palette;
    const root = document.documentElement.style;
    root.setProperty('--bg', p.bg);
    root.setProperty('--panel', p.panel);
    root.setProperty('--border', p.border);
    root.setProperty('--text', p.text);
    root.setProperty('--accent', p.accent);
    document.body.setAttribute('data-using-custom', t.usingCustom ? '1' : '0');

    // 壁纸：读成 data URL 铺 body 背景（不盖顶栏/侧栏的不透明度）
    if (t.wallpaper) {
      const url = await window.dshDesktop.theme.wallpaperDataUrl(t.wallpaper);
      if (url) {
        document.body.style.backgroundImage = `url("${url}")`;
        document.body.style.backgroundSize = 'cover';
        document.body.style.backgroundPosition = 'center';
      }
    } else {
      document.body.style.backgroundImage = 'none';
    }
  } catch (e) { console.warn('[theme] apply failed', e); }
}

// ---- 附加设置面板内容（M4 主题 + M5 记忆占位）----
async function renderSettingsPanel() {
  flyoutBody.innerHTML =
    '<div class="card" style="background:transparent;border:none;padding:0">' +
    '  <h3>🎨 主题</h3>' +
    '  <div id="themePresets" style="display:flex;flex-wrap:wrap;gap:8px;margin-top:10px"></div>' +
    '  <div style="margin-top:12px;display:flex;gap:14px;flex-wrap:wrap">' +
    '    <label class="th-field">背景色 <input type="color" id="thBg" value="#0d1117"></label>' +
    '    <label class="th-field">面板色 <input type="color" id="thPanel" value="#161b22"></label>' +
    '    <label class="th-field">文字色 <input type="color" id="thText" value="#e6edf3"></label>' +
    '    <label class="th-field">强调色 <input type="color" id="thAccent" value="#4493f8"></label>' +
    '  </div>' +
    '  <div style="margin-top:10px;display:flex;flex-wrap:wrap;gap:8px">' +
    '    <button class="th-btn" id="thApplyCustom">套用自定义色板</button>' +
    '    <button class="th-btn" id="thBackDefault">回到默认主题</button>' +
    '  </div>' +
    '</div>' +
    '<div class="card" style="background:transparent;border:none;padding:0;margin-top:16px">' +
    '  <h3>🖼 壁纸</h3>' +
    '  <p class="muted" style="margin:6px 0">选择一张图片作为壳的背景（不会盖掉官方界面）。</p>' +
    '  <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">' +
    '    <button class="th-btn" id="thPickWallpaper">选择壁纸图片…</button>' +
    '    <button class="th-btn" id="thClearWallpaper">移除壁纸</button>' +
    '  </div>' +
    '</div>' +
    '<div class="card" style="background:transparent;border:none;padding:0;margin-top:16px">' +
    '  <h3>🧠 记忆</h3>' +
    '  <div id="memSummary" class="muted" style="margin:6px 0">载入中…</div>' +
    '  <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">' +
    '    <button class="th-btn" id="memList">查看</button>' +
    '    <button class="th-btn" id="memExport">导出</button>' +
    '    <button class="th-btn" id="memImport">迁移导入…</button>' +
    '  </div>' +
    '  <div id="memResults" style="margin-top:12px;max-height:320px;overflow:auto"></div>' +
    '</div>' +
    '<div class="card" style="background:transparent;border:none;padding:0;margin-top:16px">' +
    '  <h3>🔄 软件更新</h3>' +
    '  <div class="muted" style="margin:6px 0" id="updateSummary">检查中…</div>' +
    '  <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">' +
    '    <button class="th-btn" id="updCheck">🔍 检查更新</button>' +
    '    <button class="th-btn" id="updInstall" disabled>⬇ 一键安装更新</button>' +
    '    <button class="th-btn" id="updIgnore">忽略本版</button>' +
    '  </div>' +
    '  <div class="muted" style="margin-top:8px;font-size:12px">每次启动 + 每24小时(北京时间)后台自动检查，有新版本会在侧边栏附加设置上加红点。</div>' +
    '</div>' +
    '<div class="card" style="background:transparent;border:none;padding:0;margin-top:16px">' +
    '  <h3>📊 使用统计</h3>' +
    '  <div id="statsBox" class="muted" style="margin:6px 0">加载中…</div>' +
    '  <div style="margin-top:8px"><button class="th-btn" id="statsRefresh">刷新</button></div>' +
    '</div>';

  // ---- 主题绑定：预设 / 自定义色板 / 壁纸 ----
  loadThemeControls();

  // 更新面板 & 统计面板
  initUpdatePanel();
  initStatsPanel();

  const memSummary = document.getElementById('memSummary');
  const memResults = document.getElementById('memResults');
  try {
    const st = await window.dshDesktop.memory.stats();
    if (st && st.ok) {
      const typText = Object.keys(st.byType || {}).map((k) => `${k} ${st.byType[k]}`).join(' · ');
      memSummary.textContent = `共 ${st.total} 条记忆。按类型：${typText}`;
    } else { memSummary.textContent = '（记忆库暂不可读）'; }
  } catch (e) { memSummary.textContent = '读取记忆失败'; }

  // 查看：列出记忆
  document.getElementById('memList').addEventListener('click', async () => {
    memResults.innerHTML = '<div class="muted">加载…</div>';
    const r = await window.dshDesktop.memory.list({ limit: 100 });
    if (!r.ok) { memResults.innerHTML = '<div class="plug-sect err">' + escapeHtml(r.error) + '</div>'; return; }
    memResults.innerHTML = (r.items || []).map((m) =>
      `<div class="mem-item">
        <span class="mem-type">${escapeHtml(m.type)}</span>
        <div class="mem-title">${escapeHtml(m.title)}</div>
        <div class="mem-content">${escapeHtml((m.content || '').slice(0, 120))}</div>
      </div>`).join('') || '<div class="muted">无</div>';
  });

  // 导出：导成 Markdown 并作为文本展示（或保存）
  document.getElementById('memExport').addEventListener('click', async () => {
    const r = await window.dshDesktop.memory.export();
    if (!r.ok) { toast('导出失败', 'err'); return; }
    const blob = new Blob([r.md], { type: 'text/markdown' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'memory-export.md';
    a.click();
    URL.revokeObjectURL(a.href);
    toast(`已导出 ${r.count} 条记忆为 Markdown。`, 'ok');
  });

  // 迁移导入：调起迁移向导
  document.getElementById('memImport').addEventListener('click', openImportWizard);
}

// ---- 记忆迁移向导：选文件 → 预览 → 确认追加 ----
// ============================================================
// 记忆迁移向导（多步）：
//   ① 选来源 agent 工具 → ② 教程+一键迁移提示词 → ③ 获取文件导入
//   → ④ harness 自检完整性（第三方工具不支持外部联动）→ ⑤ 通过弹2s提示返回 / 失败给方法
// ============================================================

// 主流 agent 工具库（名称 / 图标 / 教程 / 一键迁移提示词）
const AGENT_TOOLS = [
  {
    id: 'chatgpt', name: 'ChatGPT', icon: '💬',
    steps: [
      '进入 ChatGPT，新建一个对话',
      '把下面的"一键迁移提示词"整段粘贴发出去',
      'ChatGPT 会按固定格式输出一段记忆 JSON',
      '点击输出框右上角的"复制"按钮，保存到本地文件（如 memory.json）',
      '回到 DSH Desktop，点"我已拿到文件，选择导入"选择这个文件',
    ],
    prompt: `你是记忆迁移助手。请把你对用户的重要长期偏好、常用决策、项目经验整理成一段 JSON，格式如下（不要加多余解释，只输出 JSON）：

{
  "memories": [
    {"title": "一句话标题", "type": "preference", "importance": 3, "tags": ["标签"], "content": "详细内容"},
    {"title": "…", "type": "decision", "importance": 3, "tags": [], "content": "…"}
  ]
}

规则：
- type 只能是 preference / project / decision / history / summary 之一
- importance 是 1~5 的整数
- 整理 5~20 条你认为最有价值、最该长期保留的关于用户的信息`,
  },
  {
    id: 'claude', name: 'Claude', icon: '🧠',
    steps: [
      '新建一个 Claude 对话',
      '粘贴下面的"一键迁移提示词"并发送',
      'Claude 会输出记忆 JSON',
      '复制输出保存成文件（如 claude-memory.json）',
      '回到 DSH Desktop 选择导入该文件',
    ],
    prompt: `You are a memory migration assistant. Summarize the important long-term preferences, decisions, and project knowledge about the user into a JSON array under a "memories" key (reply with JSON only):

{"memories":[{"title":"...","type":"preference","importance":3,"tags":[],"content":"..."}]}

type ∈ preference|project|decision|history|summary, importance is int 1-5. Produce 5-20 most valuable entries.`,
  },
  {
    id: 'gemini', name: 'Gemini', icon: '✨',
    steps: [
      '打开 Gemini，新建对话',
      '粘贴"一键迁移提示词"发送',
      '将 Gemini 输出的 JSON 保存为文件',
      '回 DSH Desktop 导入',
    ],
    prompt: '你是记忆迁移助手。请把关于用户的重要长期偏好、决定、项目经验整理成如下 JSON（只输出 JSON）：\n{"memories":[{"title":"...","type":"preference|project|decision|history|summary","importance":1-5整数,"tags":[],"content":"详细内容"}]}\n提炼5~20条最值得保留的。',
  },
  {
    id: 'cursor', name: 'Cursor', icon: '⌨️',
    steps: [
      '在 Cursor 的 Chat / Agent 里新建对话',
      '粘贴"一键迁移提示词"发送',
      '把输出的 JSON 保存成你电脑上的文件',
      '回 DSH Desktop 导入',
    ],
    prompt: '你是记忆迁移助手。请把与用户相关的长期偏好、技术决策、项目结构经验整理为 JSON（只输出 JSON）：\n{"memories":[{"title":"...","type":"preference|project|decision|history|summary","importance":1-5,"tags":[],"content":"..."}]}\n5~20条。',
  },
  {
    id: 'kimi', name: 'Kimi', icon: '🌙',
    steps: [
      '打开 Kimi，新建会话',
      '粘贴"一键迁移提示词"发送',
      '把 Kimi 输出的 JSON 段落复制保存为文件',
      '回 DSH Desktop 导入',
    ],
    prompt: '你是记忆迁移助手，请把用户的重要长期偏好、决定、项目知识整理成 JSON（只输出 JSON）：\n{"memories":[{"title":"...","type":"preference|project|decision|history|summary","importance":1-5,"tags":[],"content":"..."}]}\n整理5~20条。',
  },
  {
    id: 'doubao', name: '豆包', icon: '🫘',
    steps: [
      '打开豆包，新建对话',
      '粘贴"一键迁移提示词"发送',
      '把豆包输出的 JSON 保存为文件',
      '回 DSH Desktop 导入',
    ],
    prompt: '你是记忆迁移助手。把用户的重要长期偏好、决定、项目经验整理成 JSON（只输出 JSON）：\n{"memories":[{"title":"...","type":"preference|project|decision|history|summary","importance":1-5,"tags":[],"content":"..."}]}\n5~20条。',
  },
  {
    id: 'spark', name: '讯飞星火', icon: '🔥',
    steps: [
      '打开讯飞星火，新建对话',
      '粘贴"一键迁移提示词"发送',
      '复制输出的 JSON 保存为文件',
      '回 DSH Desktop 导入',
    ],
    prompt: '你是记忆迁移助手。把用户的重要长期偏好、决定、项目经验整理成 JSON（只输出 JSON）：\n{"memories":[{"title":"...","type":"preference|project|decision|history|summary","importance":1-5,"tags":[],"content":"..."}]}\n5~20条。',
  },
  {
    id: 'other', name: '其它工具', icon: '🧩',
    steps: [
      '在任意 AI 工具里，让它把关于用户的重要记忆整理成 JSON（格式见下）',
      '任何工具只要能输出合法 JSON 都行',
      '把 JSON 保存成文件，回 DSH Desktop 导入',
    ],
    prompt: '通用的导出格式：\n{"memories":[{"title":"...","type":"preference|project|decision|history|summary","importance":1-5,"tags":[],"content":"..."}]}',
  },
];

// 第①步：列出工具供选择
function renderToolPicker() {
  const memResults = document.getElementById('memResults');
  memResults.innerHTML =
    `<div class="plug-sect" style="margin-bottom:10px">🧳 选择你的记忆来自哪个 AI 工具，帮你一键转移：</div>` +
    `<div class="mig-toolgrid">` +
    AGENT_TOOLS.map((t) =>
      `<div class="mig-tool" data-tool="${t.id}"><span class="mig-icon">${t.icon}</span><span>${t.name}</span></div>`).join('') +
    `</div>`;
  memResults.querySelectorAll('[data-tool]').forEach((el) => {
    const id = el.getAttribute('data-tool');
    el.addEventListener('click', () => renderToolGuide(id));
  });
}

// 第②步：某个工具 → 教程 + 一键迁移提示词 + 回退/去导入
function renderToolGuide(toolId) {
  const tool = AGENT_TOOLS.find((t) => t.id === toolId) || AGENT_TOOLS[AGENT_TOOLS.length - 1];
  const memResults = document.getElementById('memResults');
  memResults.innerHTML =
    `<div class="plug-detail-head">
       <button class="th-btn sm" id="migBack">← 选别的工具</button>
       <div class="mig-tooltitle">${tool.icon} ${tool.name}</div>
     </div>` +
    `<div class="mig-steps">
       <div class="pd-label">📋 导入教程</div>
       <ol>${tool.steps.map((s) => `<li>${escapeHtml(s)}</li>`).join('')}</ol>
     </div>` +
    `<div class="mig-prompt">
       <div class="pd-label" style="margin-bottom:6px">📝 一键迁移提示词（复制发给 ${tool.name}）</div>
       <div class="mig-promptbox" id="migPromptBox">${escapeHtml(tool.prompt)}</div>
       <button class="th-btn sm" id="migCopyPrompt">📋 复制提示词</button>
     </div>` +
    `<div class="plug-detail-actions" style="margin-top:16px">
        <button class="th-btn" id="migImportNow" style="border-color:var(--accent);color:var(--accent)">📂 我已拿到文件，选择导入</button>
     </div>` +
    `<div id="migStep4" style="margin-top:12px"></div>`;

  memResults.querySelector('#migBack').addEventListener('click', renderToolPicker);
  memResults.querySelector('#migCopyPrompt').addEventListener('click', () => {
    const text = tool.prompt;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => { toast('提示词已复制！去粘给你选的工具吧。', 'ok'); })
        .catch(() => fallbackCopy(text));
    } else fallbackCopy(text);
  });
  memResults.querySelector('#migImportNow').addEventListener('click', () => doImportWithVerify());
}

// 剪贴板兼容（无权限时退到临时输入框选中复制）
function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
  toast('已复制到剪贴板。', 'ok');
}

// 第③④步：选文件导入 + harness 自检完整性
async function doImportWithVerify() {
  const memResults = document.getElementById('memResults');
  const s4 = document.getElementById('migStep4');
  s4.innerHTML = '<div class="muted">选择工具导出的记忆文件…</div>';
  let r;
  try { r = await window.dshDesktop.memory.pickAndParse(); }
  catch (e) { s4.innerHTML = '<div class="plug-sect err">文件选择出错：' + escapeHtml(String(e && e.message || e)) + '</div>'; return; }
  if (r.canceled) { s4.innerHTML = '<div class="muted">已取消。</div>'; return; }
  if (!r.ok) { s4.innerHTML = '<div class="plug-sect err">解析失败：' + escapeHtml(r.error) + '</div>'; return; }
  const items = r.items || [];
  if (!items.length) { s4.innerHTML = '<div class="muted">没从这个文件里解析出可导入的记忆条目。</div>'; return; }

  // 预览 + 确认
  const preview = items.slice(0, 6).map((it) =>
    `<div class="mem-item"><span class="mem-type">${escapeHtml(it.type)}</span><div class="mem-title">${escapeHtml(it.title)}</div></div>`).join('');
  const extra = items.length > 6 ? `<div class="muted">…还有 ${items.length - 6} 条</div>` : '';
  s4.innerHTML =
    `<div class="plug-sect">从文件解析出 <b>${items.length}</b> 条记忆：</div>${preview}${extra}
     <div style="margin-top:10px;display:flex;gap:8px">
       <button class="th-btn" id="migStepOk" style="border-color:var(--accent);color:var(--accent)">✅ 导入并自检完整性</button>
       <button class="th-btn" id="migStepCancel">取消</button>
     </div>
     <div id="migVerifyResult" style="margin-top:10px"></div>`;

  s4.querySelector('#migStepCancel').addEventListener('click', () => { s4.innerHTML = '<div class="muted">已取消导入。</div>'; });
  s4.querySelector('#migStepOk').addEventListener('click', async () => {
    s4.querySelector('#migStepOk').disabled = true;
    const vr = document.getElementById('migVerifyResult');
    vr.innerHTML = '<div class="muted">正在导入并自检完整性…</div>';
    try {
      const imp = await window.dshDesktop.memory.import(items);
      const titles = items.map((i) => i.title || '未命名');
      const check = await window.dshDesktop.memory.verify(titles);

      // 刷新统计
      const st = await window.dshDesktop.memory.stats();
      const sm = document.getElementById('memSummary');
      if (st && st.ok && sm) sm.textContent = `共 ${st.total} 条记忆。按类型：${Object.keys(st.byType || {}).map((k) => `${k} ${st.byType[k]}`).join(' · ')}`;

      if (check && check.ok) {
        // ✅ 完整无误 → 弹 2s 提示 → 返回主界面
        vr.innerHTML = '';
        successBanner(`✅ 记忆迁移成功！已导入 ${check.passed} 条，自检完整无缺失。`);
        await new Promise((r2) => setTimeout(r2, 2000)); // 提示停留 2s
        // 关闭浮层，回到侧边栏/主界面
        document.body.classList.add('sidebar-open');
        closeFlyout();
        // 若之前从设置面板进来，回设置面板也行；这里直接show到主界面（webview始终可见）
        document.querySelector('.nav-item[data-view="home"]').click();
      } else {
        // ❌ 失败 → 给解决方法
        renderVerifyFail(check, imp, vr);
      }
    } catch (e) {
      vr.innerHTML = '<div class="plug-sect err">导入/自检出错：' + escapeHtml(String(e && e.message || e)) + '</div>';
    }
  });
}

// 成功后 2s 的提示条（用独立元素，自动消失）
function successBanner(text) {
  let el = document.getElementById('migSuccessBanner');
  if (!el) {
    el = document.createElement('div');
    el.id = 'migSuccessBanner';
    document.body.appendChild(el);
  }
  el.textContent = text;
  el.className = 'mig-success';
  setTimeout(() => el.remove(), 2000);
}

// 完整性失败 → 解决方法
function renderVerifyFail(check, imp, vr) {
  const issues = (check && check.issues) || [];
  let html = '<div style="color:var(--danger);font-size:13px;margin-bottom:8px">⚠️ 自检发现有 ' + issues.length + ' 条记忆不完整：</div>';
  html += '<ul class="plug-diagnose-list">' + issues.slice(0, 8).map((i) => `<li>${escapeHtml(i.detail || i.title || i.kind)}</li>`).join('') + '</ul>';
  html += '<div style="color:var(--text);font-size:13px;margin:6px 0">🔧 解决办法：</div>';
  html += '<div class="plug-suggests">';
  if (issues.some((i) => i.kind === 'missing')) {
    html += `<button class="th-btn sm" data-fix="retry">重新导入一次</button>`;
    html += `<button class="th-btn sm" data-fix="manual">手动补记</button>`;
  }
  if (issues.some((i) => i.kind === 'malformed')) {
    html += `<button class="th-btn sm" data-fix="checkfile">检查源文件格式</button>`;
  }
  html += `<button class="th-btn sm" data-fix="restart">重启官方 Web 后再试</button>`;
  html += '</div><div class="muted" style="margin-top:8px">已导入成功但校验不全的，多数是多字节/空内容问题，可重试或手动补记。</div>';
  vr.innerHTML = html;

  vr.querySelectorAll('[data-fix]').forEach((b) => {
    b.addEventListener('click', () => {
      const fix = b.getAttribute('data-fix');
      if (fix === 'retry') { doImportWithVerify(); }
      else if (fix === 'manual') {
        vr.innerHTML += '<div class="muted" style="margin-top:8px">手动补记：到附加设置→记忆→写一条新记忆，或直接让官方 agent 记住。</div>';
        toast('建议：直接在官方对话框里告诉它要记的内容。', 'info');
      }
      else if (fix === 'checkfile') { vr.innerHTML += '<div class="muted" style="margin-top:8px">请检查导出的 JSON 里每条都有非空 content、合法的 type、1~5 的 importance。</div>'; }
      else if (fix === 'restart') { vr.innerHTML += '<div class="muted" style="margin-top:8px">点顶栏"一键重启"官方 Web，再重新导入。</div>'; }
    });
  });
}

// 入口：迁移导入
async function openImportWizard() {
  const memResults = document.getElementById('memResults');
  renderToolPicker();
}

// ---- 主题控件加载：预设按钮 / 自定义色板 / 壁纸（renderSettingsPanel 调用）----
async function loadThemeControls() {
  // 填充预设主题按钮
  try {
    const presets = await window.dshDesktop.theme.presets();
    const box = document.getElementById('themePresets');
    box.innerHTML = presets.map((pr) =>
      `<button class="th-btn" data-preset="${pr.id}" data-name="${pr.name}">${pr.name}</button>`).join('');
    box.querySelectorAll('[data-preset]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        await window.dshDesktop.theme.setPreset(btn.dataset.preset);
        await applyTheme();
        toast('主题已切换。', 'ok');
      });
    });
  } catch (e) { /* 忽略 */ }

  // 套用自定义色板
  $('thApplyCustom').addEventListener('click', async () => {
    const palette = {
      bg: $('thBg').value, panel: $('thPanel').value,
      border: $('thPanel').value, text: $('thText').value, accent: $('thAccent').value,
    };
    await window.dshDesktop.theme.setCustom(palette);
    await applyTheme();
    toast('自定义色板已套用。', 'ok');
  });
  // 回默认
  $('thBackDefault').addEventListener('click', async () => {
    await window.dshDesktop.theme.setPreset('default');
    await window.dshDesktop.theme.clearCustom();
    await applyTheme();
    toast('已回到默认主题。', 'ok');
  });
  // 壁纸选择
  $('thPickWallpaper').addEventListener('click', async () => {
    const picked = await window.dshDesktop.pickWallpaper();
    if (picked && picked.canceled !== true) {
      await window.dshDesktop.theme.setWallpaper(picked.path);
      await applyTheme();
      toast('壁纸已换上。', 'ok');
    }
  });
  $('thClearWallpaper').addEventListener('click', async () => {
    await window.dshDesktop.theme.setWallpaper(null);
    await applyTheme();
    toast('壁纸已移除。', 'ok');
  });
}

// ============================================================
// 更新面板 + 小红点
// ============================================================

// 侧边栏"附加设置"红点刷新（读持久化状态；hasUpdate=true 且未忽略该版本才亮）
async function refreshUpdateDot() {
  try {
    const st = await window.dshDesktop.update.state();
    const dot = document.querySelector('.update-dot');
    if (!dot) return;
    if (st && st.hasUpdate) {
      dot.classList.remove('hidden');
      dot.title = `有新版本 ${st.pendingVersion || ''} 可更新`;
    } else {
      dot.classList.add('hidden');
    }
  } catch (e) { /* 忽略 */ }
}

// 附加设置里的"检查更新 / 一键安装 / 忽略"面板
async function initUpdatePanel() {
  const summary = document.getElementById('updateSummary');
  const installBtn = document.getElementById('updInstall');
  const refresh = async () => {
    summary.textContent = '检查中…';
    try {
      const r = await window.dshDesktop.update.check();
      const ver = r.latest || '?';
      if (r.ok === false) {
        summary.textContent = '无法检查更新：' + (r.error || '网络/仓库未就绪') + '（发布后自动生效）';
        installBtn.disabled = true;
      } else if (r.hasUpdate) {
        summary.textContent = `发现新版本 ${ver}（当前 ${r.current}）。可以一键安装，或忽略本版。`;
        installBtn.disabled = false;
        installBtn.dataset.url = r.downloadUrl || '';
      } else {
        summary.textContent = `已是最新版本（当前 ${r.current}）。`;
        installBtn.disabled = true;
      }
      await refreshUpdateDot(); // 红点随检查结果刷新
    } catch (e) { summary.textContent = '检查出错：' + (e && e.message); }
  };

  const checkBtn = document.getElementById('updCheck');
  checkBtn.addEventListener('click', refresh);

  installBtn.addEventListener('click', async () => {
    const url = installBtn.dataset.url;
    installBtn.disabled = true;
    summary.textContent = url ? '正在下载最新安装包…' : '没有可用的下载地址。';
    if (url) {
      const r = await window.dshDesktop.update.perform(url);
      summary.textContent = r && r.ok ? `已下载到临时目录（${r.name}）。已打开该目录，双击新安装包即可完成升级。` : ('下载失败：' + (r && r.error));
    }
  });

  const ignoreBtn = document.getElementById('updIgnore');
  ignoreBtn.addEventListener('click', async () => {
    await window.dshDesktop.update.ignore();
    summary.textContent = '已忽略本版本更新。';
    await refreshUpdateDot(); // 红点消失
  });

  // 进面板时先刷新一次
  refresh();
}

// 附加设置里的"使用统计"面板
async function initStatsPanel() {
  const box = document.getElementById('statsBox');
  const refresh = async () => {
    box.innerHTML = '统计中…';
    try {
      const r = await window.dshDesktop.stats();
      const cum = r && r.cumulative;
      const on = r && r.online;
      let html = '';
      html += `<div style="font-size:13px;line-height:1.8">`;
      html += `📦 累计下载/使用：<b>${cum && cum.ok ? cum.downloads : '—'}</b> 次<br>`;
      html += `🗂 已发布版本：<b>${cum && cum.ok ? cum.releases : '—'}</b> 个<br>`;
      html += `🟢 在线（估算）：<b>${on && on.ok ? on.online : '—'}</b> 人<br>`;
      html += `</div>`;
      if (on && on.estimated) html += `<div class="muted" style="font-size:12px;margin-top:6px">在线为估算（基于最近下载活跃）。接入真实统计后自动替换。</div>`;
      if (!cum || !cum.ok) html += `<div class="muted" style="font-size:12px;margin-top:4px">累计数据需发布到 GitHub 后可用（当前为占位仓库）。</div>`;
      box.innerHTML = html;
    } catch (e) { box.innerHTML = '统计失败：' + (e && e.message); }
  };
  document.getElementById('statsRefresh').addEventListener('click', refresh);
  refresh();
}

// ---------- 顶栏动作按钮 ----------
$('btnRescan').addEventListener('click', async () => {
  statusText.textContent = '重新检查中…';
  dot.className = 'dot pending';
  const probe = await window.dshDesktop.rescan();
  applyState({ running: probe.running, webUrl: probe.webUrl, error: probe.found ? null : '未找到 DSH' });
});

// ---- 重启过程弹窗 ----
let restartBox = null;
function showRestarting(msg) {
  if (!restartBox) {
    restartBox = document.createElement('div');
    restartBox.id = 'restartBox';
    restartBox.style.cssText = 'position:fixed;inset:0;z-index:9997;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;';
    restartBox.innerHTML = '<div style="background:var(--panel);border:1px solid var(--border);border-radius:14px;padding:28px 34px;text-align:center;box-shadow:0 24px 60px rgba(0,0,0,.5)">' +
      '<div id="restartSpinner" style="width:40px;height:40px;border:4px solid #1f2630;border-top-color:#4493f8;border-radius:50%;margin:0 auto 14px;animation:restartSpin 1s linear infinite"></div>' +
      '<div id="restartMsg" style="color:var(--text);font-size:14px;font-weight:600"></div></div>';
    document.body.appendChild(restartBox);
    const style = document.createElement('style');
    style.id = 'restartSpinStyle';
    style.textContent = '@keyframes restartSpin{to{transform:rotate(360deg)}}';
    document.head.appendChild(style);
  }
  restartBox.style.display = 'flex';
  document.getElementById('restartMsg').textContent = msg || '正在重启官方 Web…';
}
function hideRestarting() {
  if (restartBox) restartBox.style.display = 'none';
}

$('btnRestart').addEventListener('click', async () => {
  statusText.textContent = '正在一键重启…';
  dot.className = 'dot pending';
  showRestarting('正在重启官方 Web…');
  try {
    const r = await window.dshDesktop.restart();
    const snap = await window.dshDesktop.getState();
    hideRestarting();
    if (r && r.ok) {
      toast('官方 Web 已重启。', 'ok');
      applyState(snap);
    } else {
      applyState(snap);
      // 重启失败 → 交失败引导框（同意强制启动/拒绝看解法）
      showFailbox('一键重启没成功。可以让肥鱼强制启动，或照着常用解法自查。');
    }
  } catch (e) {
    hideRestarting();
    toast('重启出错：' + (e && e.message), 'err');
  }
});

// ---------- 强制停止推理 二级确认流程 ----------
const forceConfirm = $('forceConfirm');

function openForceConfirm() {
  forceConfirm.classList.remove('hidden');
  void forceConfirm.offsetWidth;
  forceConfirm.classList.add('open');
}
function closeForceConfirm() {
  forceConfirm.classList.remove('open');
  setTimeout(() => forceConfirm.classList.add('hidden'), 220);
}

// 点"强制停止推理"按钮 → 弹二级确认（按钮本身只在推理中可用）
$('btnStop').addEventListener('click', openForceConfirm);

// 不同意 → 关闭确认菜单，回主界面（webview 一直在，无需额外处理）
$('forceConfirmNo').addEventListener('click', closeForceConfirm);
$('forceConfirmClose').addEventListener('click', closeForceConfirm);

// 同意 → 执行强制停止推理
$('forceConfirmYes').addEventListener('click', async () => {
  closeForceConfirm(); // 先收起确认框
  statusText.textContent = '正在强制停止推理…';
  dot.className = 'dot pending';
  try {
    const r = await window.dshDesktop.forceStop();
    const snap = await window.dshDesktop.getState();
    applyState(snap);
    if (r && r.ok) toast('已强制停止推理。', 'ok');
    else toast('强制停止未完全成功，见控制台记录。', 'err');
  } catch (e) {
    toast('强制停止出错：' + (e && e.message), 'err');
  }
});

// ---------- 启动：拉一次状态 + 订阅主进程推送 ----------
(async function init() {
  wireWebview(); // 先挂 webview 监控，再拉状态（避免漏掉早期事件）
  wireSidebarAutoHide(); // 侧栏自动隐藏
  applyTheme(); // 应用保存的主题/壁纸（不阻塞首屏）
  // 启动时自动扫一次插件变动（不阻塞首屏）
  autoScanPluginsOnLaunch();
  // 启动时刷新侧边栏更新小红点（读持久化状态）
  refreshUpdateDot();
  try {
    const snap = await window.dshDesktop.getState();
    applyState(snap);

    if (snap && snap.probe) {
      const probe = snap.probe;

      // 【没装 DSH】→ 询问是否一键部署（首次引导，保持"大肥鱼"口吻，无机器人感）
      if (!probe.found) {
        askDeploy();
        return;
      }

      // 【装了但没在跑】→ 自动尝试拉起官方 Web
      if (probe.found && !probe.running) {
        statusText.textContent = '检测到 DSH 未在运行，正在拉起官方 Web…';
        dot.className = 'dot pending';
        const r = await window.dshDesktop.ensureRunning();
        applyState(await window.dshDesktop.getState());
        if (!(r && r.ok)) toast('官方 Web 未能拉起，已准备强制启动方案（见下一步提示）。', 'err');
      }
    }
  } catch (e) {
    toast('初始化失败：' + (e && e.message) + '（可能是 preload 未就绪）', 'err');
  }
  // 订阅主进程状态推送，实时刷新顶栏
  window.dshDesktop.onStatus(applyState);
})();

// ---- 没装 DSH 时的"一键部署"引导框（简洁、可确认/可跳过，记选择）----
function askDeploy() {
  dot.className = 'dot pending';
  statusText.textContent = '未找到 DeepSeek Harness';

  // 记住用户上次的选择（别每次都问，避免"人机感"）
  const prev = localStorage.getItem('dshDeployChoice');
  if (prev === 'yes') { runDeploy(); return; }
  if (prev === 'no') { statusText.textContent = '未找到 DSH · 可在"附加设置"里手动部署'; return; }

  const wrap = document.getElementById('toast-wrap');
  const el = document.createElement('div');
  el.className = 'toast';
  el.style.maxWidth = '460px';
  el.style.padding = '14px 16px';
  el.innerHTML =
    '<div style="font-weight:600;margin-bottom:6px">🐋 没瞅见 DeepSeek Harness</div>' +
    '<div style="font-size:13px;color:#8b949e;margin-bottom:10px;line-height:1.6">点"一键部署"全自动帮你装好（会逐布显示进度和是否成功）；也可以先进主界面看看。</div>' +
    '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
    '<button data-act="yes" id="deployQuickStart" style="background:#4493f8;color:#fff;border:none;border-radius:6px;padding:7px 14px;cursor:pointer">⚡ 一键部署</button>' +
    '<button data-act="progress" id="deployQuickProgress" style="background:transparent;color:#4493f8;border:1px solid #4493f8;border-radius:6px;padding:7px 14px;cursor:pointer">📊 进度检测</button>' +
    '<button data-act="no" style="background:transparent;color:#8b949e;border:1px solid #30363d;border-radius:6px;padding:7px 14px;cursor:pointer">先进主界面看看</button>' +
    '</div>';
  wrap.appendChild(el);

  el.querySelector('[data-act=yes]').addEventListener('click', () => {
    localStorage.setItem('dshDeployChoice', 'yes');
    el.remove();
    runDeploy();
  });
  // 进度检测：唤出常驻部署面板
  el.querySelector('[data-act=progress]').addEventListener('click', () => {
    showDeployPanel();
  });
  el.querySelector('[data-act=no]').addEventListener('click', () => {
    localStorage.setItem('dshDeployChoice', 'no');
    el.remove();
    statusText.textContent = '未找到 DSH · 可在"附加设置"里手动部署';
    askDeploySkipToHome();
  });
}

// 点"先进主界面看看" → 进主界面（部署面板仍可随时从"附加设置"或重新触发唤出，但不会自动消失）
function askDeploySkipToHome() {
  document.body.classList.add('sidebar-open');
  const navHome = document.querySelector('.nav-item[data-view="home"]');
  if (navHome) navHome.click();
}

// ============================================================
// 一键部署 —— 部署中显示实时进度；结束时显示结果框（重试/手动部署/去主界面）
// 手动部署：点开弹出完整教程，内含"一键检验是否成功"。
// 点击教程里的"我明白了/返回" → 回到上一级（失败的一键部署界面），不消失不迷路。
// ============================================================
let deploySteps = [];       // 已完成的步骤 {name,ok,percent,detail,state}
let deployRunning = false;  // 是否部署中
let deploySuccess = false;  // 是否已成功

// 创建部署结果/进度框（始终常驻在右侧一列，直到成功才可关闭）
function ensureDeployPanel() {
  let panel = document.getElementById('deployPanel');
  if (panel) return panel;
  panel = document.createElement('div');
  panel.id = 'deployPanel';
  panel.className = 'deploy-result';
  panel.innerHTML =
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">' +
    '  <div style="font-weight:700;font-size:14px">🐋 DeepSeek Harness 部署</div>' +
    '  <button id="deployPanelClose" class="th-btn sm" style="display:none;border:none;background:none;color:#8b949e;font-size:16px">✕</button>' +
    '</div>' +
    '<div id="deploySummary" style="font-size:12px;color:#8b949e;margin-bottom:8px"></div>' +
    // 进行中：进度条
    '<div id="deployProgWrap" style="display:none;">' +
    '  <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px"><span id="deployProgName"></span><span id="deployProgPct"></span></div>' +
    '  <div style="height:8px;background:#1f2630;border-radius:4px;overflow:hidden"><div id="deployProgBar" style="height:100%;width:0%;background:#4493f8;transition:width .3s"></div></div>' +
    '</div>' +
    '<div id="deploySteps" style="margin-top:10px;max-height:260px;overflow:auto"></div>' +
    '<div id="deployNext" class="deploy-next" style="display:none;margin-top:10px"></div>' +
    // 结果按钮区（部署结束时出现）
    '<div id="deployActions" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px"></div>';
  document.body.appendChild(panel);
  return panel;
}

// 清空面板（开始新一轮部署时）
function resetDeployPanel() {
  const p = ensureDeployPanel();
  document.getElementById('deploySteps').innerHTML = '';
  document.getElementById('deployProgWrap').style.display = 'none';
  document.getElementById('deployActions').innerHTML = '';
  document.getElementById('deployNext').style.display = 'none';
  document.getElementById('deploySummary').textContent = '';
  p.querySelector('#deployPanelClose').style.display = 'none';
}

// 部署中：实时进度
function updateDeployRunning(step) {
  ensureDeployPanel();
  document.getElementById('deployProgWrap').style.display = 'block';
  document.getElementById('deployProgName').textContent = step.name || '';
  document.getElementById('deployProgPct').textContent = step.percent + '%';
  document.getElementById('deployProgBar').style.width = step.percent + '%';
  document.getElementById('deploySummary').textContent = '正在部署…' + (step.name || '');
}

// 部署一步完成：记录到列表
function updateDeployStepDone(step) {
  const stepsEl = document.getElementById('deploySteps');
  const detail = step.detail || '';
  const row = document.createElement('div');
  row.className = 'deploy-step ' + (step.ok ? 'ok' : 'bad');
  row.innerHTML = `${step.ok ? '✓' : '✗'} ${escapeHtml(step.name)} <span style="opacity:.7">${step.percent}%</span> <span class="muted">${escapeHtml(detail)}</span>`;
  stepsEl.appendChild(row);
}

// 部署接收（成功/失败）：收尾并展示结果 + 按钮
function finishDeploy(success, msg, rep) {
  deploySuccess = success;
  deployRunning = false;
  const p = ensureDeployPanel();
  document.getElementById('deployProgWrap').style.display = 'none';
  document.getElementById('deployProgBar').style.width = success ? '100%' : '0%';
  const summary = document.getElementById('deploySummary');
  summary.style.color = success ? '#3fb950' : '#f85149';
  summary.textContent = msg || (success ? '部署成功！' : '部署没成功，下面有原因和解决办法。');

  // 失败建议（部署失败最常见原因：没装 Node 或版本过低）
  const next = document.getElementById('deployNext');
  if (!success) {
    next.style.display = 'block';
    next.textContent = rep && rep.next
      ? '建议：' + rep.next
      : '建议：部署失败，最常见原因是未安装 Node 或其版本过低。到 nodejs.org 装最新 LTS 版 Node 后，再点"重试一键部署"。';
  } else {
    next.style.display = 'none';
  }

  // 按钮区
  const actions = document.getElementById('deployActions');
  actions.innerHTML = '';
  // 失败才显示"重试"
  if (!success) {
    actions.innerHTML += '<button class="th-btn" id="deployRetry">🔄 重试一键部署</button>';
  }
  // 手动部署（教程，随时可点）
  actions.innerHTML += '<button class="th-btn" id="deployManual">📖 手动部署</button>';
  // 去主界面
  actions.style.display = 'flex'; actions.style.gap = '8px'; actions.style.flexWrap = 'wrap';
  actions.innerHTML += '<button class="th-btn" id="deployHome">🚀 去主界面看看</button>';

  // 绑定
  const retry = document.getElementById('deployRetry');
  if (retry) retry.addEventListener('click', runDeploy);
  const manual = document.getElementById('deployManual');
  if (manual) manual.addEventListener('click', openManualTutorial);
  const home = document.getElementById('deployHome');
  if (home) home.addEventListener('click', () => {
    document.body.classList.add('sidebar-open');
    const navHome = document.querySelector('.nav-item[data-view="home"]');
    if (navHome) navHome.click();
  });

  // 成功才允许关闭面板；失败常驻（但可"去主界面"，面板留着）
  p.querySelector('#deployPanelClose').style.display = success ? 'inline-block' : 'none';
  p.querySelector('#deployPanelClose').onclick = () => p.style.display = 'none';
}

// 订阅部署实时进度
function subscribeDeployProgress() {
  if (!window.dshDesktop || !window.dshDesktop.onDeployProgress) return;
  window.dshDesktop.onDeployProgress((step) => {
    if (step.state === 'running') updateDeployRunning(step);
    else if (step.state === 'done') {
      updateDeployStepDone(step);
      // 终态（由 deploy.js 的 done 推进度：ok=是否成功）
      finishDeploy(!!step.ok, step.ok ? '部署成功！DeepSeek Harness 已就绪。' : '一键部署未完全成功。');
    } else {
      updateDeployStepDone(step);
    }
  });
}

// 手动部署教程（含"一键检验是否成功"）。返回 → 回到上一级部署界面
function openManualTutorial() {
  const p = ensureDeployPanel();
  // 保存当前部署界面内容，供"返回"还原
  window.__deploySnapshot = {
    summary: document.getElementById('deploySummary').innerHTML,
    summaryStyle: document.getElementById('deploySummary').style.color,
    steps: document.getElementById('deploySteps').innerHTML,
    actions: document.getElementById('deployActions').innerHTML,
    next: document.getElementById('deployNext').innerHTML,
    nextDisp: document.getElementById('deployNext').style.display,
  };
  const plat = (navigator.platform || '').toLowerCase();
  const isWin = /win/.test(plat);
  p.innerHTML =
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">' +
    '  <button class="th-btn sm" id="tutBack">← 返回部署界面</button>' +
    '  <div style="font-weight:700;font-size:14px">📖 手动部署 DeepSeek Harness</div>' +
    '</div>' +
    '<div style="background:rgba(210,153,34,.1);border:1px solid rgba(210,153,34,.35);border-radius:8px;padding:8px 10px;margin-bottom:10px;font-size:12px;color:#e3b341">⚠️ 一键部署失败最常见原因：<b>还没装 Node，或 Node 版本过低</b>。先确保装好 Node（下面第 1 步），装完再回来点一键部署即可。</div>' +
    '<div style="font-size:13px;line-height:1.8;color:#e6edf3">' +
    (isWin
      ? '1. 装好 Node.js（如果没装）：<a style="color:#4493f8" href="#" data-open="https://nodejs.org/">nodejs.org</a><br>'
      : '1. 装好 Node.js：<a style="color:#4493f8" href="#" data-open="https://nodejs.org/">nodejs.org</a><br>') +
    (isWin
      ? '2. 打开 PowerShell，粘贴下面命令并回车：'
      : '2. 打开终端，粘贴下面命令并回车：') +
    '<div style="display:flex;align-items:stretch;gap:8px;margin:8px 0 10px">' +
    '  <code id="tutCmd" style="flex:1;background:#0a0e14;border:1px solid #30363d;border-radius:6px;padding:8px 10px;font-family:var(--mono);font-size:12px;display:flex;align-items:center;overflow-x:auto;white-space:nowrap;color:#e6edf3">npm install -g @deepseek-ai/dsh</code>' +
    '  <button class="th-btn sm" id="tutCopyCmd" style="flex:0 0 auto;border-color:#4493f8;color:#4493f8">📋 复制</button>' +
    '</div>' +
    '3. 装好后回到本软件，会自动检测并接管。<br>' +
    '4. 若没自动启动，点顶栏"重新检查"，再点"一键部署"里的重试。' +
    '</div>' +
    '<div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap">' +
    '  <button class="th-btn" id="tutVerify" style="border-color:#3fb950;color:#3fb950">🔍 一键检验是否成功</button>' +
    '  <button class="th-btn" id="tutOpenDir" style="display:none">📂 打开官方 Web</button>' +
    '</div>' +
    '<div id="tutVerifyResult" style="margin-top:10px"></div>' +
    '<div style="margin-top:14px"><button class="th-btn" id="tutGotIt">我明白了，返回</button></div>';
  p.querySelector('#tutBack').addEventListener('click', backToDeployPanel);
  p.querySelector('#tutGotIt').addEventListener('click', backToDeployPanel);
  // 复制 PowerShell 命令
  const cp = p.querySelector('#tutCopyCmd');
  if (cp) cp.addEventListener('click', () => {
    const cmd = (p.querySelector('#tutCmd') || {}).textContent || 'npm install -g @deepseek-ai/dsh';
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(cmd.trim()).then(() => {
        cp.textContent = '✓ 已复制';
        setTimeout(() => { cp.textContent = '📋 复制'; }, 1500);
      }).catch(() => fallbackCopy(cmd));
    } else fallbackCopy(cmd);
  });
  const a = p.querySelector('[data-open]');
  if (a) a.addEventListener('click', (e) => { e.preventDefault(); if (window.dshDesktop.openExternal) window.dshDesktop.openExternal('https://nodejs.org/'); });
  // 一键检验
  p.querySelector('#tutVerify').addEventListener('click', async () => {
    const vr = p.querySelector('#tutVerifyResult');
    vr.innerHTML = '<span class="muted">正在检测…</span>';
    try {
      const st = await window.dshDesktop.getState();
      if (st && st.running && st.webUrl) {
        vr.innerHTML = '<span style="color:#3fb950">✅ 检验成功：DeepSeek Harness 已在运行（' + escapeHtml(st.webUrl) + '）。不用再部署啦。</span>';
        p.querySelector('#tutOpenDir').style.display = 'inline-block';
        p.querySelector('#tutOpenDir').onclick = () => { location.href = st.webUrl; };
        // 检验成功 → 更新快照，让"返回"后显示成功状态
        if (window.__deploySnapshot) {
          window.__deploySnapshot.summary = '✅ 检验成功：DeepSeek Harness 已就绪。';
          window.__deploySnapshot.summaryStyle = '#3fb950';
          window.__deploySnapshot.actions = '<button class="th-btn" id="deployHome">🚀 去主界面看看</button>';
        }
        deploySuccess = true;
      } else {
        vr.innerHTML = '<span style="color:#f85149">✗ 未检测到运行中的 DeepSeek Harness。请确认命令是否执行成功（尤其步骤2装 dsh）。</span>';
      }
    } catch (e) {
      vr.innerHTML = '<span style="color:#f85149">检验出错：' + escapeHtml(String(e && e.message || e)) + '</span>';
    }
  });
}

// 回到上一级部署界面（还原快照）
function backToDeployPanel() {
  const p = ensureDeployPanel();
  const snap = window.__deploySnapshot;
  if (snap) {
    p.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">' +
      '  <div style="font-weight:700;font-size:14px">🐋 DeepSeek Harness 部署</div>' +
      '</div>' +
      '<div id="deploySummary" style="font-size:12px;color:#8b949e;margin-bottom:8px">' + snap.summary + '</div>' +
      '<div id="deployProgWrap" style="display:none"><div style="height:8px;background:#1f2630;border-radius:4px;overflow:hidden"><div id="deployProgBar" style="height:100%;width:0%;background:#4493f8;transition:width .3s"></div></div></div>' +
      '<div id="deploySteps" style="margin-top:10px;max-height:260px;overflow:auto">' + snap.steps + '</div>' +
      '<div id="deployNext" class="deploy-next" style="' + snap.nextDisp + ';margin-top:10px">' + snap.next + '</div>' +
      '<div id="deployActions" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">' + snap.actions + '</div>';
    const retry = document.getElementById('deployRetry');
    if (retry) retry.addEventListener('click', runDeploy);
    const manual = document.getElementById('deployManual');
    if (manual) manual.addEventListener('click', openManualTutorial);
    const home = document.getElementById('deployHome');
    if (home) home.addEventListener('click', () => {
      document.body.classList.add('sidebar-open');
      const nh = document.querySelector('.nav-item[data-view="home"]');
      if (nh) nh.click();
    });
  }
}

// 真·一键部署
async function runDeploy() {
  const p = ensureDeployPanel();
  p.style.display = 'block';
  resetDeployPanel();
  deploySteps = [];
  deployRunning = true;
  deploySuccess = false;
  document.getElementById('deploySummary').textContent = '正在一键部署…（全自动）';
  document.getElementById('deployProgWrap').style.display = 'block';
  document.getElementById('deployProgBar').style.width = '0%';
  statusText.textContent = '正在一键部署 DeepSeek Harness…';
  dot.className = 'dot pending';

  try {
    const rep = await window.dshDesktop.deploy({ dryRun: false });
    if (rep && rep.ok) {
      finishDeploy(true, '部署成功，正在启动官方 Web…');
      const r = await window.dshDesktop.ensureRunning();
      const snap = await window.dshDesktop.getState();
      applyState(snap);
      if (r && r.ok) {
        finishDeploy(true, '✅ 部署成功，DeepSeek Harness 已就绪！');
        statusText.textContent = '官方 DSH 在线';
        dot.className = 'dot online';
        setTimeout(() => { document.querySelector('.nav-item[data-view="home"]').click(); }, 700);
      } else {
        finishDeploy(false, '部署装好了，但官方 Web 启动失败。可在下方"手动部署"里检验，或重试。', rep);
      }
    } else {
      finishDeploy(false, '一键部署未完全成功。下面列出了每步结果，可重试或查看手动部署。', rep);
    }
  } catch (e) {
    finishDeploy(false, '部署出错：' + (e && e.message));
  }
}

// "进度检测"按钮：唤出部署面板（若没部署过，给引导）
function showDeployPanel() {
  const p = ensureDeployPanel();
  p.style.display = 'block';
  if (!deployRunning && !document.getElementById('deploySteps').childElementCount) {
    document.getElementById('deploySummary').textContent = '还没开始部署。点上方"一键部署"开始；想手动装就点"手动部署"。';
    writeDeployIdleActions();
  }
}

// 空闲时也放出手动部署入口
function writeDeployIdleActions() {
  const actions = document.getElementById('deployActions');
  actions.style.display = 'flex'; actions.style.gap = '8px'; actions.style.flexWrap = 'wrap';
  actions.innerHTML = '<button class="th-btn" id="deployManual2">📖 手动部署</button>';
  const b = document.getElementById('deployManual2');
  if (b) b.addEventListener('click', openManualTutorial);
}

// 订阅部署实时进度（启动时注册一次）
subscribeDeployProgress();

// ============================================================
// 插件市场面板（内置可视化市场）
// ============================================================
let marketData = { plugins: [], categories: [], loaded: false };
let marketCat = 'all';
let marketQuery = '';

async function renderMarketPanel() {
  flyoutBody.innerHTML =
    '<div style="display:flex;flex-direction:column;height:100%;min-height:0">' +
    '  <div style="display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap">' +
    '    <input id="mkSearch" type="text" placeholder="搜索插件名 / 关键词…" style="flex:1;background:#0a0e14;border:1px solid #30363d;border-radius:6px;padding:7px 10px;color:#e6edf3;font-size:13px" />' +
    '    <button class="th-btn sm" id="mkRefresh" title="刷新市场">🔄 刷新</button>' +
    '  </div>' +
    '  <div id="mkCats" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px"></div>' +
    '  <div id="mkCount" class="muted" style="font-size:12px;margin-bottom:6px"></div>' +
    '  <div id="mkList" style="flex:1;overflow:auto;min-height:0"></div>' +
    '</div>';

  // 搜索
  document.getElementById('mkSearch').addEventListener('input', (e) => {
    marketQuery = e.target.value.trim().toLowerCase();
    renderMarketList();
  });
  document.getElementById('mkRefresh').addEventListener('click', () => {
    marketData.loaded = false;
    loadMarket(true);
  });

  // 加载市场
  if (!marketData.loaded) loadMarket(false);
  else { renderMarketCats(); renderMarketList(); }
}

async function loadMarket(force) {
  const box = document.getElementById('mkList');
  const count = document.getElementById('mkCount');
  box.innerHTML = '<div class="muted">⏳ 正在加载插件市场……首次需联网拉取 2300+ 个插件，可能要 10~30 秒，请稍候。</div>';
  try {
    const r = await window.dshDesktop.market.list({ force });
    if (!r || !r.ok) { box.innerHTML = '<div class="plug-sect err">加载市场失败：' + escapeHtml((r && r.error) || '未知') + '<br>请检查网络后点"刷新"重试。</div>'; return; }
    marketData.plugins = r.plugins || [];
    marketData.categories = (r.categories || []).filter((c, i, a) => a.findIndex((x) => x.id === c.id) === i); // 去重
    marketData.loaded = true;
    renderMarketCats();
    renderMarketList();
  } catch (e) {
    box.innerHTML = '<div class="plug-sect err">加载市场出错：' + escapeHtml(String(e && e.message || e)) + '</div>';
  }
}

function renderMarketCats() {
  const cats = document.getElementById('mkCats');
  cats.innerHTML = marketData.categories.map((c) =>
    `<button class="th-btn sm ${marketCat === c.id ? 'mk-active' : ''}" data-cat="${escapeHtml(c.id)}">${escapeHtml(c.name || c.id)}</button>`).join('');
  cats.querySelectorAll('[data-cat]').forEach((b) => {
    b.addEventListener('click', () => { marketCat = b.getAttribute('data-cat') || 'all'; renderMarketCats(); renderMarketList(); });
  });
}

function renderMarketList() {
  const box = document.getElementById('mkList');
  const count = document.getElementById('mkCount');
  let list = marketData.plugins || [];
  if (marketCat && marketCat !== 'all') list = list.filter((p) => p.category === marketCat);
  if (marketQuery) {
    const q = marketQuery;
    list = list.filter((p) => (p.name || '').toLowerCase().includes(q) || (p.description || '').toLowerCase().includes(q) || (p.owner || '').toLowerCase().includes(q));
  }
  count.textContent = `共 ${marketData.plugins.length} 个插件，当前显示 ${list.length} 个`;
  if (!list.length) { box.innerHTML = '<div class="muted">没有匹配的插件。</div>'; return; }

  box.innerHTML = list.slice(0, 100).map((p) => mkCard(p)).join('') +
    (list.length > 100 ? '<div class="muted" style="margin:8px 0;text-align:center">已显示前 100 个，用搜索精确定位</div>' : '');
  // 绑定安装按钮（当前功能未开放：灰色，点击提示敬请期待）
  box.querySelectorAll('.mk-install').forEach((b) => {
    b.addEventListener('click', () => { toast('插件一键安装敬请期待，稍后版本开放。', 'info'); });
  });
  // 详情链接
  box.querySelectorAll('[data-open]').forEach((a) => {
    a.addEventListener('click', (e) => { e.preventDefault(); if (window.dshDesktop.openExternal) window.dshDesktop.openExternal(a.getAttribute('data-open')); });
  });
}

function mkCard(p) {
  const desc = (p.description || '').slice(0, 90) || '（暂无简介）';
  return '<div class="mk-card">' +
    '<div class="mk-head">' +
    '  <span class="mk-name">' + escapeHtml(p.name) + '</span>' +
    '  <span class="mk-dl">⬇ ' + fmtNum(p.downloads) + ' · ⭐ ' + fmtNum(p.stars) + '</span>' +
    '</div>' +
    '<div class="mk-desc">' + escapeHtml(desc) + '</div>' +
    '<div class="mk-foot">' +
    '  <span class="mk-owner" style="color:#8b949e">' + escapeHtml(p.owner || '') + '</span>' +
    '  ' + (p.url ? '<a href="#" data-open="' + escapeHtml(p.url) + '" style="color:#4493f8;font-size:12px">主页</a>' : '') +
    '</div>' +
    '<button class="th-btn sm mk-install disabled" data-name="' + escapeHtml(p.name || '') + '" style="margin-top:8px;width:100%;border-color:#555f6b;color:#555f6b;cursor:not-allowed">⏳ 敬请期待</button>' +
    '</div>';
}

function fmtNum(n) {
  n = Number(n) || 0;
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return String(n);
}

// 一键安装：先检查冲突 → 确认 → 执行
async function mkInstall(installHint, name) {
  // 提取插件 npm 包名（从 install 命令）
  const pkg = extractPkgName(installHint);
  if (!pkg) { toast('无法识别该插件的安装包名', 'err'); return; }

  // 1) 只读检查冲突
  const check = await window.dshDesktop.market.check(pkg);
  if (check && check.issues && check.issues.some((i) => i.kind === 'installed')) {
    toast('该插件已安装，无需重复。', 'err');
    return;
  }

  // 2) 确认框（带弹入动画）
  const wrap = document.getElementById('toast-wrap');
  const el = document.createElement('div');
  el.className = 'deploy-result mk-pop'; // mk-pop 提供淡入+上移动画
  el.innerHTML =
    '<div style="font-weight:700;margin-bottom:8px">安装插件：' + escapeHtml(name || pkg) + '</div>' +
    '<div class="muted" style="font-size:12px;line-height:1.7;margin-bottom:10px">将执行安装命令（装到官方 Harness 的 web profile）：<br><code>' + escapeHtml('dsh plugin --profile web add ' + pkg) + '</code><br>装完需要重启官方 Web 生效。不会动你其它插件。</div>' +
    '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
    '  <button class="th-btn" id="mkInstYes" style="border-color:#3fb950;color:#3fb950">确认安装</button>' +
    '  <button class="th-btn" id="mkInstNo">取消</button>' +
    '</div>' +
    '<div id="mkInstResult" style="margin-top:8px"></div>';
  wrap.appendChild(el);

  // 关窗（带淡出动画）
  let autoCloseTimer = null;
  const closePopup = () => {
    if (autoCloseTimer) clearTimeout(autoCloseTimer);
    el.style.transition = 'opacity .3s, transform .3s';
    el.style.opacity = '0';
    el.style.transform = 'translateY(-8px)';
    setTimeout(() => el.remove(), 300);
  };
  el.querySelector('#mkInstNo').addEventListener('click', closePopup);
  el.querySelector('#mkInstYes').addEventListener('click', async () => {
    const res = document.getElementById('mkInstResult');
    document.getElementById('mkInstYes').disabled = true;
    res.innerHTML = '<div class="muted">正在安装…（可能需要几分钟）</div>';
    const r = await window.dshDesktop.market.install(pkg, {});
    if (r && r.ok) {
      res.innerHTML = '<div style="color:#3fb950">✅ 安装命令执行成功！请重启官方 Web 使插件生效（可点顶栏"一键重启"）。</div>';
      toast('插件安装成功，请重启官方 Web 生效', 'ok');
      // 成功稍后自动关窗
      autoCloseTimer = setTimeout(closePopup, 2600);
    } else {
      res.innerHTML = '<div style="color:#f85149">安装失败：' + escapeHtml((r && r.message) || '未知') + '</div>';
      // 失败显示 3 秒后自动消失
      document.getElementById('mkInstYes').disabled = false;
      autoCloseTimer = setTimeout(closePopup, 3000);
    }
  });
}

// 从 install 命令里提取 npm 包名
function extractPkgName(installHint) {
  if (!installHint) return null;
  // 匹配 "add <pkg>"
  const m = String(installHint).match(/(?:add|install)\s+([^\s]+)/);
  return m ? m[1] : null;
}


