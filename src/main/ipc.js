// ============================================================
// ipc.js —— 主进程 ↔ 渲染层 IPC 统一注册
// 保持"最小暴露面"：只把壳需要的能力桥出去，官方 Web 会话完全隔离。
// 渲染层只能通过 preload 暴露的白名单 API 调这些，安全。
// ============================================================
const { ipcMain } = require('electron');
const path = require('path');
const { isPortOpen } = require('./detect');

// 通道名清单（preload 与 index.js 共用，避免两个地方写错字符串）
const CH = {
  getState: 'dshDesktop:getState',
  status: 'dshDesktop:status',      // 主→渲染 状态推送
  ensureRunning: 'dshDesktop:ensureRunning',
  restart: 'dshDesktop:restart',
  rescan: 'dshDesktop:rescan',
};

// 读本地壁纸图片 → data URL（供渲染层做 body 背景，绕过 file:// 与 CSP）
function wallpaperToDataUrl(absPath) {
  const fs = require('fs');
  try {
    if (!absPath || !fs.existsSync(absPath)) return null;
    const ext = path.extname(absPath).toLowerCase();
    const mime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' }[ext] || 'image/png';
    const buf = fs.readFileSync(absPath);
    return `data:${mime};base64,${buf.toString('base64')}`;
  } catch { return null; }
}

// 启动失败时给用户的"常见解法"清单（人话，按平台给出，用户自己动手）
function commonFixesSuggest(platform) {
  const fixes = [ '一键重启官方 Web' ];
  if (platform === 'win32') {
    fixes.push('检查 3080 端口是否被其它程序占用（命令：netstat -ano | findstr :3080）');
    fixes.push('若被占用，结束对应 PID（taskkill /PID <pid> /F），再点一键重启');
    fixes.push('确认系统 Node 已装且版本 ≥ 16（node -v 查看）');
    fixes.push('网络畅时，可删掉 ~/.dsh 下的卡死锁文件再重启');
  } else if (platform === 'darwin') {
    fixes.push('确认 Node ≥ 16：node -v');
    fixes.push('若首次启动被 macOS 拦截，到"系统设置→隐私与安全性"允许');
    fixes.push('端口被占时：lsof -ti tcp:3080 | xargs kill -9');
  } else {
    fixes.push('确认 Node ≥ 16：node -v');
    fixes.push('SELinux 若拦截 node，临时放行：setsebool -P httpd_can_network_connect 1');
    fixes.push('端口被占时：sudo lsof -ti tcp:3080 | xargs kill -9');
  }
  fixes.push('以上都不行，点"强制启动"让肥鱼扔掉一切阻碍因素硬拽起来');
  return fixes;
}

function registerIpc({ mainWindow, state, launcher, procMon, port, url }) {
  const emit = () => {
    const w = mainWindow();
    if (w && !w.isDestroyed()) w.webContents.send(CH.status, state.snapshot());
  };

  // 状态一变化，立刻推给渲染层（顶栏在线灯实时刷新）
  state.onChange(emit);

  // 渲染层主动拉一次当前状态
  ipcMain.handle(CH.getState, () => state.snapshot());

  // 用系统默认浏览器打开外部链接（插件仓库地址）
  ipcMain.handle('dshDesktop:openExternal', async (ev, url) => {
    if (typeof url !== 'string' || !/^https?:\/\//.test(url)) return { ok: false, error: '仅允许 http/https 链接' };
    const { shell } = require('electron');
    shell.openExternal(url);
    return { ok: true };
  });

  // 渲染层请求"确保官方 Web 在跑"（首次打开/手动拉起按钮）
  ipcMain.handle(CH.ensureRunning, async () => {
    const r = await launcher.ensureRunning();
    emit();
    return r;
  });

  // 一键重启
  ipcMain.handle(CH.restart, async () => {
    const r = await launcher.restart();
    emit();
    return r;
  });

  // 手动重新探测（给 UI 的"重新检查"按钮用）
  ipcMain.handle(CH.rescan, async () => {
    const { scan } = require('./detect');
    const probe = await scan({ port, home: process.env.DSH_HOME });
    state.setProbe(probe);
    emit();
    return probe;
  });

  // 停止推理（M3 强化，这里先给一个优雅停止接口占位）
  ipcMain.handle('dshDesktop:stopInference', async () => {
    await launcher.stop();
    emit();
    return { ok: true };
  });

  // 一键部署：渲染层"确认部署"后触发（首次没装 DSH 时）
  // 通过 onProgress 回调把每个步骤的进度实时推给渲染层
  ipcMain.handle('dshDesktop:deploy', async (ev, opts = {}) => {
    const { oneClickDeploy } = require('./deploy');
    const win = ev.sender; // 当前发起请求的窗口
    const report = await oneClickDeploy({
      home: opts.home,
      dryRun: !!opts.dryRun,
      onProgress: (step) => {
        // 把实时进度推给发起窗口
        try { if (win && !win.isDestroyed()) win.send('dshDesktop:deployProgress', step); } catch { /* ignore */ }
      },
    });
    // 推一个终态（100%）
    try { if (win && !win.isDestroyed()) win.send('dshDesktop:deployProgress', { state: 'done', ok: report.ok, percent: 100, name: '部署结束', detail: report.ok ? '成功' : '失败', stepIndex: 5, totalSteps: 5 }); } catch { /* ignore */ }
    emit();
    return report;
  });

  // 强制启动：放弃一切阻碍因素冷启动（M3，用户明确同意后才调用）
  ipcMain.handle('dshDesktop:forceStart', async () => {
    const { forceStart } = require('./force');
    const report = await forceStart({ state, launcher, port, home: process.env.DSH_HOME });
    emit();
    return report;
  });

  // 强制停止推理：优雅→硬停（M3）
  ipcMain.handle('dshDesktop:forceStop', async () => {
    const { forceStop } = require('./force');
    const report = await forceStop({ state, launcher, port });
    emit();
    return report;
  });

  // 获取"启动失败"时建议的常见解法清单（渲染层按平台给出）
  ipcMain.handle('dshDesktop:commonFixes', async () => {
    return commonFixesSuggest(process.platform);
  });

  // 插件变动扫描：返回 当前插件总览 + 相对上次的 新增/移除/更新
  ipcMain.handle('dshDesktop:scanPlugins', async () => {
    const { scanPlugins } = require('./plugins');
    const res = await scanPlugins({ home: process.env.DSH_HOME });
    emit();
    return res;
  });

  // 插件详情：单个插件的地址/简介/路径
  ipcMain.handle('dshDesktop:plugin:detail', async (ev, name) => {
    const { getPluginDetail } = require('./plugins');
    return getPluginDetail(String(name || ''), { home: process.env.DSH_HOME });
  });

  // 插件一键删除（停用）：从 bundles 列表摘除 + 备份
  ipcMain.handle('dshDesktop:plugin:uninstall', async (ev, name) => {
    const { uninstallPlugin } = require('./plugins');
    return uninstallPlugin(String(name || ''), { home: process.env.DSH_HOME });
  });

  // 插件一键诊断：运行是否正常 + 问题时给修复建议
  ipcMain.handle('dshDesktop:plugin:diagnose', async (ev, name) => {
    const { diagnosePlugin } = require('./plugins');
    return diagnosePlugin(String(name || ''), { home: process.env.DSH_HOME });
  });

  // ---- 更新（检查 / 忽略 / 一键更新 / 状态）----
  const { loadUpdateState, saveUpdateState } = require('./update-state');
  ipcMain.handle('dshDesktop:update:check', async () => {
    const { checkForUpdate } = require('./updater');
    const r = await checkForUpdate();
    // 记入状态（供小红点）
    const st = loadUpdateState(process.env.DSH_HOME);
    st.latestChecked = Date.now();
    st.latestVersion = r.latest || st.latestVersion;
    // 有新版本 → 小红点（除非用户对"这个版本"点过忽略）
    if (r.ok && r.hasUpdate && st.ignoredVersion !== r.latest) {
      st.hasUpdate = true;
      st.pendingVersion = r.latest;
    } else if (!(r.ok && r.hasUpdate)) {
      st.hasUpdate = false;
      st.pendingVersion = null;
    }
    saveUpdateState(st, process.env.DSH_HOME);
    return { ...r, redDot: !!st.hasUpdate };
  });
  ipcMain.handle('dshDesktop:update:state', async () => {
    const st = loadUpdateState(process.env.DSH_HOME);
    return st;
  });
  ipcMain.handle('dshDesktop:update:ignore', async () => {
    const st = loadUpdateState(process.env.DSH_HOME);
    if (st.pendingVersion) st.ignoredVersion = st.pendingVersion;
    st.hasUpdate = false;
    st.pendingVersion = null;
    saveUpdateState(st, process.env.DSH_HOME);
    return st;
  });
  ipcMain.handle('dshDesktop:update:perform', async (ev, url) => {
    const { performUpdate } = require('./updater');
    return performUpdate(url);
  });

  // ---- 使用统计（累计 + 在线）----
  ipcMain.handle('dshDesktop:stats', async () => {
    const { cumulativeStats, onlineStats } = require('./stats');
    const [cum, on] = await Promise.all([cumulativeStats(), onlineStats('')]);
    return { ok: true, cumulative: cum, online: on };
  });

  // ---- 插件市场（内置可视化市场）----
  ipcMain.handle('dshDesktop:market:list', async (ev, opts = {}) => {
    const { listMarket } = require('./market');
    const r = await listMarket(opts);
    // 精简给 UI
    if (r.ok) r.plugins = (r.plugins || []).map((p) => require('./market').slimPlugin(p));
    return r;
  });
  ipcMain.handle('dshDesktop:market:check', async (ev, pkg) => {
    const { checkPluginConflict } = require('./market');
    return checkPluginConflict(String(pkg || ''));
  });
  ipcMain.handle('dshDesktop:market:install', async (ev, pkg, opts = {}) => {
    const { installPlugin } = require('./market');
    return installPlugin(String(pkg || ''), opts || {});
  });


  // ---- 主题 & 壁纸 ----
  ipcMain.handle('dshDesktop:theme:get', async () => {
    const { getAppliedTheme } = require('./theme');
    return getAppliedTheme(process.env.DSH_HOME);
  });
  ipcMain.handle('dshDesktop:theme:presets', async () => {
    const { PRESETS } = require('./theme');
    return Object.keys(PRESETS).map((k) => ({ id: k, name: PRESETS[k].name }));
  });
  ipcMain.handle('dshDesktop:theme:setPreset', async (ev, preset) => {
    const { setPreset } = require('./theme');
    return setPreset(preset, process.env.DSH_HOME);
  });
  ipcMain.handle('dshDesktop:theme:setCustom', async (ev, palette) => {
    const { setCustom } = require('./theme');
    return setCustom(palette, process.env.DSH_HOME);
  });
  ipcMain.handle('dshDesktop:theme:clearCustom', async () => {
    const { clearCustom } = require('./theme');
    return clearCustom(process.env.DSH_HOME);
  });
  ipcMain.handle('dshDesktop:theme:setWallpaper', async (ev, absPath) => {
    const { setWallpaper } = require('./theme');
    return setWallpaper(absPath, process.env.DSH_HOME);
  });
  // 读壁纸图片 → data URL（渲染层用 <style> 设置 body 背景，绕过 file:// 限制）
  ipcMain.handle('dshDesktop:theme:wallpaperDataUrl', async (ev, absPath) => {
    return wallpaperToDataUrl(absPath);
  });
  // 打开系统文件选择框，挑一张壁纸图，返回绝对路径
  ipcMain.handle('dshDesktop:pickWallpaper', async (ev) => {
    const { dialog } = require('electron');
    const win = mainWindow();
    const r = win ? await dialog.showOpenDialog(win, {
      title: '选择壁纸图片',
      properties: ['openFile'],
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }],
    }) : { canceled: true };
    if (r.canceled || !r.filePaths || !r.filePaths.length) return { canceled: true };
    return { canceled: false, path: r.filePaths[0] };
  });

  // ---- 记忆：查看 / 新增 / 导出 / 迁移导入 ----
  ipcMain.handle('dshDesktop:memory:list', async (ev, opts = {}) => {
    const { listMemories } = require('./memory');
    return listMemories({ home: process.env.DSH_HOME, ...opts });
  });
  ipcMain.handle('dshDesktop:memory:stats', async () => {
    const { memoryStats } = require('./memory');
    return memoryStats(process.env.DSH_HOME);
  });
  ipcMain.handle('dshDesktop:memory:add', async (ev, data = {}) => {
    const { addMemory } = require('./memory');
    return addMemory(data, { home: process.env.DSH_HOME });
  });
  ipcMain.handle('dshDesktop:memory:export', async () => {
    const { exportMarkdown } = require('./memory');
    return exportMarkdown(process.env.DSH_HOME);
  });
  ipcMain.handle('dshDesktop:memory:import', async (ev, items = []) => {
    const { importMany } = require('./memory');
    return importMany(items, { home: process.env.DSH_HOME });
  });
  // 迁移后完整性检查：harness 自己读回核对（第三方 agent 工具不支持外部联动）
  ipcMain.handle('dshDesktop:memory:verify', async (ev, titles = []) => {
    const { verifyImported } = require('./memory');
    return verifyImported({ home: process.env.DSH_HOME, titles });
  });
  // 迁移：弹文件选择 → 解析其他工具的记忆文件 → 返回可预览的记忆项（未写入）
  ipcMain.handle('dshDesktop:memory:pickAndParse', async (ev, filterExt) => {
    const { dialog } = require('electron');
    const win = mainWindow();
    const r = win ? await dialog.showOpenDialog(win, {
      title: '选择要导入的记忆文件',
      properties: ['openFile'],
      filters: filterExt === 'all'
        ? [{ name: '记忆/对话', extensions: ['json', 'md', 'csv', 'txt'] }]
        : [{ name: '记忆文件', extensions: ['json', 'md', 'csv', 'txt'] }],
    }) : { canceled: true };
    if (r.canceled || !r.filePaths || !r.filePaths.length) return { canceled: true };
    const { parseMemoryFile } = require('./memory-importer');
    const parsed = parseMemoryFile(r.filePaths[0]);
    return { canceled: false, file: r.filePaths[0], ...parsed };
  });

  return { channels: CH };
}

module.exports = { registerIpc, CH };
