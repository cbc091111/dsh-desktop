// ============================================================
// dsh-desktop —— 主进程入口
// 扮演"监护人"：创建窗口、挂载各能力模块（探测/部署/拉起/监控/主题/记忆）
// 大肥鱼原则：壳不重造官方 UI，只守护官方 DSH Web（默认 127.0.0.1:3080）
// ============================================================
const { app, BrowserWindow, shell } = require('electron');
const path = require('path');

// 软件渲染：在无 GPU/远程会话里也能把画面合出来（截图/无头验证必需）
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-gpu-compositing');

// ---- 各能力模块（M1 只启用到"拉起与监控"；其余按里程碑逐步点亮）----
const { scan } = require('./detect');             // 探测 DSH 是否存在/运行态
const { createLauncher } = require('./launcher'); // 拉起/托管官方 dsh web 子进程
const { createProcMon } = require('./procmon');   // 哨兵：探测在线/掉线/端口被占
const { registerIpc } = require('./ipc');         // 统一注册主进程->渲染层 IPC
const { State } = require('./store');             // 轻量运行时状态（跨模块共享）

const state = new State({ webUrl: null, running: false }); // 当前运行态
let mainWindow = null; // 主窗口引用（Electron 标准做法：防 GC 回收）
let stopUpdateScheduler = null; // 每日自动检查更新的停止函数（退出时清理）

// 默认端口，与官方 DSH Web 一致
const DEFAULT_PORT = 3080;
const DEFAULT_URL = `http://127.0.0.1:${DEFAULT_PORT}`;

// 单实例锁：避免用户开两个壳，各自去抢同一个官方 Web（会打架）
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit(); // 已有实例，直接退出本实例
} else {
  app.on('second-instance', () => {
    // 用户又点了一次图标：把已开的窗口拉回前台
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  bootstrap();
}

// ---------- 启动主流程 ----------
async function bootstrap() {
  // 等 Electron 应用就绪后再创建窗口
  await app.whenReady();

  // 1) 探测当前 DSH 状态（只读，不改任何东西）
  const probe = await scan();
  state.setProbe(probe);

  // 2) 创建主窗口
  mainWindow = createMainWindow();

  // 3) 挂接各模块；若官方 Web 未起，则按探测结果决定（M1 先走"打开页面提示"）
  const launcher = createLauncher({ state, port: DEFAULT_PORT, url: DEFAULT_URL });
  const procMon = createProcMon({ state, url: DEFAULT_URL, launcher });

  // 4) 统一注册 IPC（渲染层调这里取状态/触发动作）
  registerIpc({
    mainWindow: () => mainWindow,
    state,
    launcher,
    procMon,
    port: DEFAULT_PORT,
    url: DEFAULT_URL,
  });

  // 5) 拉起官方 Web 并开哨兵
  procMon.start();
  await launcher.ensureRunning(); // 若端口在跑则直接用，否则尝试拉起

  // 5.1) 启动"每日自动查找更新"（北京时间 02:00 循环，后台不打扰，只亮红点）
  const { scheduleDailyCheck } = require('./updater');
  const { checkForUpdate } = require('./updater');
  const { loadUpdateState, saveUpdateState } = require('./update-state');
  stopUpdateScheduler = scheduleDailyCheck(async () => {
    try {
      const r = await checkForUpdate();
      if (!r.ok) return;
      const st = loadUpdateState(process.env.DSH_HOME);
      st.latestChecked = Date.now();
      st.latestVersion = r.latest;
      if (r.hasUpdate && st.ignoredVersion !== r.latest) {
        st.hasUpdate = true;
        st.pendingVersion = r.latest;
      } else if (!r.hasUpdate) {
        st.hasUpdate = false;
        st.pendingVersion = null;
      }
      saveUpdateState(st, process.env.DSH_HOME);
    } catch { /* 检查失败不打扰 */ }
  });

  // 6) 加载壳界面到窗口
  await mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  // 7) 兜底：窗口关闭即退出（除非 mac 惯例）
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
  // 退出前停掉后台调度器
  app.on('will-quit', () => {
    if (stopUpdateScheduler) { stopUpdateScheduler(); stopUpdateScheduler = null; }
  });
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createMainWindow();
  });

  // 8) 可选：诊断截图模式。传 --capture=<path> 会在界面加载后截图并退出，
  //    用于在无交互会话里验证官方界面是否真渲染（M1 验收用）。
  const capIdx = process.argv.indexOf('--capture');
  if (capIdx !== -1 && mainWindow) {
    const cwd = process.cwd();
    const target = path.resolve(cwd, process.argv[capIdx + 1] || 'capture.png');
    let attempts = 0;
    (async function tryCapture() {
      try {
        mainWindow.show();
        mainWindow.focus();
        const img = await mainWindow.webContents.capturePage();
        const buf = img.toPNG();
        // 空图(极小)不算成功，重试几轮
        if (buf.length > 20000 || attempts > 8) {
          require('fs').writeFileSync(target, buf);
          console.log('[capture] written bytes=', buf.length);
          app.quit();
        } else {
          attempts++;
          setTimeout(tryCapture, 1500);
        }
      } catch (e) {
        console.error('[capture] failed', e && e.message);
        app.quit();
      }
    })();
  }
}

// ---------- 创建主窗口（GitHub 开发者式布局，深色观感与官方融合）----------
function createMainWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'DSH Desktop — DeepSeek Harness',
    backgroundColor: '#0d1117', // 深色底，贴合 GitHub 深色主题
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,   // 安全：渲染层无法直达 Node
      nodeIntegration: false,   // 安全：禁用 Node 注入
      webviewTag: true,         // 允许用 <webview> 内嵌官方 Web 页
    },
  });

  // 外部链接用系统浏览器打开，不塞进壳里（更符合开发者习惯）
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });

  return win;
}
