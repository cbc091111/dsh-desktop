// ============================================================
// preload.js —— 安全桥
// 渲染层(Node 关闭)只能通过这些白名单 API 与主进程互动。
// 官方 Web 页面跑在 <webview> 里又被隔离，接触不到这里。
// ============================================================
const { contextBridge, ipcRenderer } = require('electron');

// 暴露给壳 UI 的最小可用 API（名字语义化，UI 一看就懂）
contextBridge.exposeInMainWorld('dshDesktop', {
  // 拉取当前运行态快照（顶栏在线灯、探测结果等）
  getState: () => ipcRenderer.invoke('dshDesktop:getState'),

  // 订阅主进程状态推送
  onStatus: (cb) => {
    const handler = (_e, snap) => cb(snap);
    ipcRenderer.on('dshDesktop:status', handler);
    return () => ipcRenderer.removeListener('dshDesktop:status', handler);
  },

  // 确保官方 Web 在跑
  ensureRunning: () => ipcRenderer.invoke('dshDesktop:ensureRunning'),

  // 一键重启
  restart: () => ipcRenderer.invoke('dshDesktop:restart'),

  // 手动重新探测
  rescan: () => ipcRenderer.invoke('dshDesktop:rescan'),

  // 优雅停止推理（M3 强化）
  stopInference: () => ipcRenderer.invoke('dshDesktop:stopInference'),

  // 一键部署（首次没装 DSH 时）
  deploy: (opts) => ipcRenderer.invoke('dshDesktop:deploy', opts || {}),

  // 订阅部署实时进度（每个步骤的百分比 + 成功/失败）
  onDeployProgress: (cb) => {
    const handler = (_e, step) => cb(step);
    ipcRenderer.on('dshDesktop:deployProgress', handler);
    return () => ipcRenderer.removeListener('dshDesktop:deployProgress', handler);
  },

  // 强制启动：抛弃一切阻碍因素冷启动（M3）
  forceStart: () => ipcRenderer.invoke('dshDesktop:forceStart'),

  // 强制停止推理（优雅→硬停，M3）
  forceStop: () => ipcRenderer.invoke('dshDesktop:forceStop'),

  // 启动失败时的常见解法清单（M3 失败引导框用）
  commonFixes: () => ipcRenderer.invoke('dshDesktop:commonFixes'),

  // 插件变动扫描（M4）：返回插件总览 + 新增/移除/更新
  scanPlugins: () => ipcRenderer.invoke('dshDesktop:scanPlugins'),

  // 更新（检查/忽略/状态/一键更新）
  update: {
    check: () => ipcRenderer.invoke('dshDesktop:update:check'),
    state: () => ipcRenderer.invoke('dshDesktop:update:state'),
    ignore: () => ipcRenderer.invoke('dshDesktop:update:ignore'),
    perform: (url) => ipcRenderer.invoke('dshDesktop:update:perform', url),
  },

  // 使用统计（累计下载 + 在线估算）
  stats: () => ipcRenderer.invoke('dshDesktop:stats'),

  // 插件市场（内置可视化市场）
  market: {
    list: (opts) => ipcRenderer.invoke('dshDesktop:market:list', opts || {}),
    check: (pkg) => ipcRenderer.invoke('dshDesktop:market:check', pkg),
    install: (pkg, opts) => ipcRenderer.invoke('dshDesktop:market:install', pkg, opts || {}),
  },

  // 用系统默认浏览器打开外部链接（插件仓库地址等）
  openExternal: (url) => ipcRenderer.invoke('dshDesktop:openExternal', url),

  // 插件详情 / 一键删除 / 一键诊断（M4 增强）
  plugin: {
    detail: (name) => ipcRenderer.invoke('dshDesktop:plugin:detail', name),
    uninstall: (name) => ipcRenderer.invoke('dshDesktop:plugin:uninstall', name),
    diagnose: (name) => ipcRenderer.invoke('dshDesktop:plugin:diagnose', name),
  },

  // 主题 & 壁纸（M4）
  theme: {
    get: () => ipcRenderer.invoke('dshDesktop:theme:get'),
    presets: () => ipcRenderer.invoke('dshDesktop:theme:presets'),
    setPreset: (p) => ipcRenderer.invoke('dshDesktop:theme:setPreset', p),
    setCustom: (palette) => ipcRenderer.invoke('dshDesktop:theme:setCustom', palette || {}),
    clearCustom: () => ipcRenderer.invoke('dshDesktop:theme:clearCustom'),
    setWallpaper: (absPath) => ipcRenderer.invoke('dshDesktop:theme:setWallpaper', absPath || null),
    wallpaperDataUrl: (absPath) => ipcRenderer.invoke('dshDesktop:theme:wallpaperDataUrl', absPath || null),
  },

  // 打开系统文件选择器（壁纸/导入用），返回绝对路径
  pickWallpaper: () => ipcRenderer.invoke('dshDesktop:pickWallpaper'),

  // 记忆：查看/新增/导出/迁移导入（M5）
  memory: {
    list: (opts) => ipcRenderer.invoke('dshDesktop:memory:list', opts || {}),
    stats: () => ipcRenderer.invoke('dshDesktop:memory:stats'),
    add: (data) => ipcRenderer.invoke('dshDesktop:memory:add', data || {}),
    export: () => ipcRenderer.invoke('dshDesktop:memory:export'),
    import: (items) => ipcRenderer.invoke('dshDesktop:memory:import', items || []),
    verify: (titles) => ipcRenderer.invoke('dshDesktop:memory:verify', titles || []),
    pickAndParse: (ext) => ipcRenderer.invoke('dshDesktop:memory:pickAndParse', ext || ''),
  },
});
