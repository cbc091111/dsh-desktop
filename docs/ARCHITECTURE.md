# DSH Desktop — 桌面端 DeepSeek Harness 架构与方案

> 项目代号：**dsh-desktop**（发布后仓库名建议 `dsh-desktop`）
> 技术栈：**Electron + Node 后端**（你已确认）
> 交付阶段：**架构方案定稿**（本轮）

---

## 0. 一句话概括

一个跨平台的 **Electron 桌面壳**，外壳即"管理器"，核心界面 **直接内嵌官方 DeepSeek Harness Web**（`http://127.0.0.1:3080`），从而 **UI 与官方 Web 100% 一致、100% 兼容全部 DSH 插件与 Cordis 生态**。桌面壳负责：探测/一键部署 DSH → 拉起官方 Web → 托管启动与重启 → 强制停止推理 → 插件扫描 → 主题壁纸 → 记忆编辑/迁移 → 出问题的容错启动引导。代码用 **可读自然命名 + 关键处中文注释** 编写，保持"大肥鱼"那种松弛、直接、不装腔的风格。

---

## 1. 为什么是"Electron 壳 + 内嵌官方 Web"，而不是"重写一个 Harness"

| 你的需求 | 重写 GUI | ✅ 内嵌官方 Web |
|---|---|---|
| UI 与官方 web 版保持一致 | 几乎不可能复刻 | **天生 100% 一致** |
| 兼容所有 DSH 插件 | 每个插件 UI 都要重做 | **插件在官方 Web 里原生就跑** |
| 一次发布长期可维护 | 官方一升级就崩 | 跟官方走，几乎免维护 |
| 复杂度 | 极高 | 低、稳 |

**大肥鱼结论**：别重复造轮子。官方 Web 就是最好的 UI。桌面壳只为它当"监护人"。

---

## 2. 目录结构（最终交付蓝本）

```
dsh-desktop/
├── package.json                  # Electron 主项目清单（含 electron-builder 打包配置）
├── electron-builder.yml          # 跨平台打包配置（Win/macOS/Linux）
├── README.md                     # 发布说明、安装指南、一键安装流程
├── docs/
│   ├── ARCHITECTURE.md           # 本文档
│   ├── INSTALL.md                # 各平台安装 + 一键脚本方法
│   └── PUBLISH.md                # GitHub 发布流程（见 §9）
├── src/
│   ├── main/                     # Electron 主进程（Node 后端）
│   │   ├── index.js              # 入口：创建窗口，挂接全部模块
│   │   ├── detect.js             # ① DSH 存在性检索（找 dsh / DSH_HOME / 端口）
│   │   ├── deploy.js             # ② 一键部署（首次找不到 DSH 时）
│   │   ├── launcher.js           # ③ 拉起/托管官方 dsh web（spawn 子进程）
│   │   ├── procmon.js            # ④ 进程侦探：默认端口占用/僵尸进程/失败检测
│   │   ├── force.js              # ⑤ 强制启动（抛弃一切阻碍因素）& 强制停止推理
│   │   ├── plugins.js            # ⑥ 每次启动扫描插件变动（Cordis bundles/目录指纹）
│   │   ├── theme.js              # ⑦ 自定义主题 & 壁纸（注入 CSS/背景图）
│   │   ├── memory.js             # ⑧ 记忆编辑 & 跨 agent 工具记忆迁移
│   │   ├── ipc.js                # 主→渲染 IPC 通道统一注册
│   │   └── logs.js               # 日志管线（写 logs/，出错上报到 UI）
│   ├── preload/
│   │   └── preload.js            # 安全桥：暴露 window.dshDesktop.* API（contextBridge）
│   └── renderer/                 # 桌面壳自身 UI（GitHub 开发者布局）
│       ├── index.html
│       ├── styles/
│       │   ├── base.css          # 深色开发者风（等距字体/顶栏/左导航）→ 与官方观感融合
│       │   └── themes.css        # 用户自定义主题变量 + 壁纸
│       ├── app.js                # 引导序列状态机（detect→confirm→deploy→wait port→open）
│       └── views/
│           ├── wizard.js         # 首启向导（有没有 DSH？一键部署？）
│           ├── home.js           # 主页：GitHub 布局 + 内嵌 WebView(官方 web)
│           ├── plugins.js        # 插件列表 & 变动扫描结果
│           ├── settings.js       # 设置：主题/壁纸/记忆编辑/记忆迁移
│           ├── memedit.js        # 记忆编辑器
│           ├── memmigrate.js     # 记忆迁移向导
│           └── failbox.js        # 启动失败提示框（强制启动？常见解决办法？）
├── assets/
│   ├── icon.icns / icon.ico / icon.png   # 三平台图标
│   └── wallpaper-default.png
└── installers/                  # 一键安装脚本（sh / ps1 / bat）→ 产物目录
    ├── install.sh               # Linux / macOS
    ├── install.ps1              # Windows PowerShell 一键
    └── install.bat              # Windows 双击版（调 ps1）
```

---

## 3. 核心流程（App.js 引导状态机）

```
[启动]
  ↓
① 探测 DSH
   ├─ 找 `dsh` 可执行（PATH / npx 缓存 / 用户指定）
   ├─ 找 `DSH_HOME`（默认 ~/.dsh）
   ├─ 探测默认端口(3080)是否已被官方 Web 占用
   → 若"没装 / 装了但没起 / 起了但异常"三态分明
     ↓ 首次且确认没装
② 询问是否一键部署（向导，符合"大肥鱼"口吻，无人工感）
   同意 → 用系统自带工具（PowerShell/npm）自动配置首次启动参数并拉取官方 dsh
   拒绝 → 停在主页，给出手动安装指引（§6）
   ↓
③ 拉起官方 Web（launcher.spawn dsh web），等待端口就绪
   ↓
④ 就绪 → 主页 WebView 加载 http://127.0.0.1:3080（100% 官方 UI + 全部插件）
   ↓
⑤ 每次启动执行：插件变动扫描（§7）＋ 主题壁纸生效（§8）
   ↓
[运行中] 顶栏提供：一键重启 / 强制停止推理 / 打开设置
```

---

## 4. 关键能力与对应文件

### 4.1 自动检索 DSH 是否存在 — `src/main/detect.js`
依次探测，输出结构化状态供 UI 决定下一步：

```js
// detect.js —— 探测 DSH 是否存在（只读，不改任何东西）
export async function detectDsh(ctx) {
  // 1) 内存态：默认端口是不是已经被官方 web 占了（最快最准）
  const portInUse = await isPortOpen(3080);

  // 2) 命令行态：PATH 里能不能敲 dsh；npx 全局缓存里有没有 @deepseek-ai/dsh
  const onPath = await which('dsh');
  const npxDsh = await findNpxDsh();            // ~/AppData/Local/npm-cache/_npx/.../dsh

  // 3) 文件态：DSH_HOME 存在吗？profiles/web/cordis.yml 在吗？
  const home = readDshHome();                   // 默认 ~/.dsh，可被用户覆盖

  return {
    found: Boolean(portInUse || onPath || npxDsh || home),
    running: Boolean(portInUse),                // Web 是否已在线
    portInUse, onPath, npxDsh, home,
    webUrl: portInUse ? 'http://127.0.0.1:3080' : null,
  };
}
```

### 4.2 一键部署（首次没装）— `src/main/deploy.js`
不在安装包里捆绑 DSH 的 node_modules（那样又大又容易坏），而是**用系统自带工具现拉**：

```js
// deploy.js —— 首次发现没装 DSH，走一键部署
// 思路：伪装成“官方标准安装”，只补两条尾巴：内存盘/K盘记忆、皮肤。
export async function oneClickDeploy(ctx, { home }) {
  // Windows: 让 PowerShell 帮你装 —— 兼容性强、跟系统内置工具走
  const verb = pickSystemTool();               // 'powershell' | 'sh' | 'bash'
  const script = buildInstallScript(verb);     // 见 installers/install.ps1 同款逻辑
  await runScript(script, { cwd: home });

  const result = await restartWeb(ctx);        // 拉起官方 Web
  await ensureMemoryDisk(ctx);                 // 交付出色记忆盘（K 盘 deepseek memory）落位
  return { ok: true, url: result.url };
}
```
> 记忆偏好：你要求"读写记忆走 K 盘 deepseek memory"。此处把 `DSH_HOME/memory` 软链/指向 `K:\deepseek memory`，兼容找不到 K 盘时自动回落 `~/.dsh/memory`，绝不报错。

### 4.3 拉起与托管官方 Web — `src/main/launcher.js`
```js
// launcher.js —— 真实启动 dsh web（继承官方命令行，不重造）
export function spawnOfficialWeb(ctx) {
  const node = findNode();                    // 复用系统 Node，不用自带 fat app
  const dshEntry = resolveDshEntry();         // .../@deepseek-ai/dsh/lib/bin.js
  const child = spawn(node, [dshEntry, 'web'], {
    env: { ...process.env, DSH_HOME: ctx.home },
    stdio: ['ignore', 'pipe', 'pipe'],        // 不开管道。管子只用 stdout 捕获 → 见“边界”
  });
  // 监听 stdout 里的“listening”，并等 3080 就绪后向 UI 报告
  child.stdout?.on('data', d => log(child, d.toString()));
  child.on('exit', (code, sig) => notifyExited(ctx, code, sig));
  return child;
}
```

### 4.4 进程侦探 & 失败检测 — `src/main/procmon.js`
> 你要求"遇到运行时错误及时汇报"。procmon 就是那个哨兵。
- 周期性探测：3080 是否响应 / `dsh web` 子进程是否还活着 / 端口即使空但文件在（僵尸迹象）
- 三态上报给 UI：`online（正常）| offline（没起）| hooked（端口被别的进程占了）`
- **端口被占**时：识别占用者 PID/进程名，若是僵尸 `dsh web` → 建议杀掉重启；若是无关进程 → 提示换端口。

### 4.5 强制启动 & 强制停止推理 — `src/main/force.js` + UI 的 failbox.js
**强制启动**（用户同意后，"抛弃一切可能影响启动的因素"）：
```js
// force.js —— forceStart：清理一切阻碍因素后冷启动
// 按危险度由浅到深执行，每步记录，失败不卡死：
//  ① 清空残留环境变量（DSH_* 指向失效路径）
//  ② 清理卡死的锁文件 / stale .lock / profile 驻留在内存的孤儿
//  ③ 若 3080 被僵尸占用 → 强制结束该 PID
//  ④ 绕过 CNPM 代理/离线缓存 → 直接用默认 registry 现拉
//  ⑤ 以全新干净的 env + 默认配置启动官方 Web
export async function forceStart(ctx) {
  const steps = runCleanupSequence(ctx);       // 数组：每项 {name, ok}
  const child = spawnOfficialWeb(ctx, { cleanEnv: true });
  return { steps, child };
}
```
**强制停止推理**：
```js
// 给官方 Web 发一个“刹车”指令，或直接结束 dsh web 进程来冷却。
export async function forceStopReasoning(ctx) {
  try { await ctx.harnessStop(); }           // 优先走优雅停止（通知官方）
  catch { killProcessByPort(3080); }          // 优雅失败 → 硬停（大肥鱼：收拾不下去就重启）
  return ctx;
}
```

### 4.6 启动失败引导 — `src/renderer/views/failbox.js`
```js
// failbox.js —— 没起来？弹出的不是冰冷的错误码，是人话 + 两条路
if (!online) {
  showDialog({
    title: '🐋 没起来，肥鱼帮你看看',
    body: summarize(reasons),                       // 把 procmon 结论翻译成人话
    actions: [
      { label: '强制启动', primary: true, onClick: forceStart },   // 同意 → 抛弃一切阻碍
      { label: '我自己弄', onClick: openManualHelp },              // 拒绝 → 常见解法面板
    ],
  });
}
// 常见解法面板（拒绝后给的手把手步骤）：
//   Windows: 重装缺失运行时 / 检查 3080 被占用 / 设置镜像
//   macOS : 授权/重签 / 内存核分区放行
//   Linux : 关 SELinux 对 node 的限制 / 换 registry
```

### 4.7 每次启动扫描插件变动 — `src/main/plugins.js`
```js
// plugins.js —— 每次打开都做插件指纹快照对比
// 指纹 = 每个插件的 { name, version, mtime, bundleName } 拼成的 sha256
export async function scanPlugins(ctx, previousFingerprint) {
  const entries = collectCordisBundles(ctx);     // 遍历 profiles/web/node_modules + bundles 表
  const current = fingerprint(entries);
  const changed = diff(previousFingerprint, current); // { added, removed, updated }
  persistFingerprint(current);                    // 存 ~/.dsh/.../ 供下次对比
  return { total: entries.length, changed, entries };
}
// UI (plugins.js) 展示：新增/移除/更新的差异列表，一键“应用新插件”（重启官方 Web）。
```

### 4.8 自定义主题 & 壁纸 — `src/main/theme.js` + renderer
- UI 主题：在 WebView 层**注入 CSS 变量覆盖**（不改官方源码），支持预设配方 + 用户自定义色板。
- 壁纸：WebView 注入背景图 `url(file://...)` 覆盖到官方界面边缘/侧栏，`assets/wallpaper-*.png`。
- 持久化到 `~/.dsh/dsh-desktop/themes.json`，启动时自动应用。

### 4.9 记忆编辑 & 记忆迁移 — `src/main/memory.js`
- **记忆编辑**：读写 `~/.dsh/memory`（dsh-mneme 的 JSONL 结构，兼容格式）。UI 提供搜索、编辑、删除、打标签、导出。
- **记忆迁移**（跨 agent 工具导入）：向导可导入其他工具的对话/记忆文件——
  - 兼容格式识别器：JSONL / JSON / MD / CSV
  - 映射器：把别家的字段名映射回 dsh-mneme 结构 `{type,title,content,tags,importance}`
  - 导入前**预览映射**，确认后写入，自带去重（md5 of content blend）。
- 遵循你的偏好：读写默认走 K 盘 `deepseek memory`，找不到回落本地，绝不断链。

---

## 5. 交互与"人情味"设计（大肥鱼人设落地）

- 所有弹窗/提示用**松弛自然的中文**，不是"操作失败，错误码 0x80004005"。
  - 例：找不到 DSH → "没瞅见 DeepSeek Harness，要肥鱼给你一键装个不？"
  - 卡在端口 → "3080 被别人占了，肥鱼看看是谁在碍事。"
- **没人机感**：不做"机器人式确认弹窗轰炸"。引导一次问清，之后记住选择（`~/.dsh/dsh-desktop/state.json`），下次静默照做。
- 出错**及时上报**：日志管线 + procmon 哨兵在 UI 顶部给一条不打断的 toast。

---

## 6. 安装流程（清晰简单，三平台）

> 全程优先**用系统自带内置工具**（PowerShell / sh / npm），不要求你先装别的。

### 6.1 简洁安装（推荐：给开发者）
```bash
# 用你电脑自带的包管理器装 Electron 壳即可
npm install -g dsh-desktop
dsh-desktop                      # 打开，首次自动引导探测/部署
```

### 6.2 一键脚本安装（installers/）
**Windows（PowerShell）— 右键"用 PowerShell 运行"或：**
```powershell
# install.ps1 —— 一键：装 Electron 壳 → 自动探测 DSH → 拉起官方 Web
Set-ExecutionPolicy -Scope CurrentUser Bypass -Force   # 允许本脚本
iex (Invoke-RestMethod https://raw.githubusercontent.com/<you>/dsh-desktop/main/installers/install.ps1)
```
脚本内部动作（全部只读检查先行，绝不改用户已有 DSH）：
```powershell
# install.ps1 关键步骤（含注释，方便你按需改）
param([int]$Port = 3080)
$ErrorActionPreference = 'Stop'
# ① 检查 Node —— Windows 系统自带？没带就用一键装（winget，系统内置）
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  winget install OpenJS.NodeJS.LTS      # winget 是 Win10/11 系统内置包管理器
}
# ② 安装 dsh-desktop 壳（若用户已装官方 dsh，这里只装壳不动官方）
npm install -g dsh-desktop
# ③ 交给壳自身完成 探测 → 一键部署(可选) → 拉起官方 web
dsh-desktop
```
**macOS / Linux** 用 `install.sh`，用系统自带 `sh` + `curl` + 你的包管理器：
```bash
curl -fsSL https://raw.githubusercontent.com/<you>/dsh-desktop/main/installers/install.sh | sh
```

### 6.3 打包安装器（installers 产物）
`electron-builder` 产出：
| 平台 | 产物 |
|---|---|
| Windows | `.exe`（NSIS 安装向导）或便携 `.zip` |
| macOS   | `.dmg + .zip`（arm64 & x64） |
| Linux   | `.AppImage / .deb / .rpm` |

---

## 7. "兼容主流操作系统"与"兼容全部插件"

- **操作系统**：Windows 10/11、macOS 12+（arm64/x64）、主流 Linux。用 `electron-builder` + CI（GitHub Actions 三平台矩阵构建）。
- **插件兼容**：100% 由官方 Web 承担——壳只需保证"端口 up -> 内嵌 WebView 打开官方界面"，Cordis/插件/皮肤（包括你之前的 dsh-liang-skin）全部原生可用。壳本身不解析插件 UI。

---

## 8. 安全边界（Electron 最佳实践）

- `contextIsolation: true`、`nodeIntegration: false`，只经 `preload.js` 的 `contextBridge` 暴露白名单 API。插件/网页内容无法访问主进程。
- WebView 设 `partition` 隔离官方会话缓存与壳自身。
- 危险动作（杀进程、改 registry）一律**先探测→给出人话说明→用户点确认才执行**，且记入日志。

---

## 9. GitHub 发布流程（你要的"具体发布流程"）

完整步骤在 **`docs/PUBLISH.md`**，这里给浓缩版：

```markdown
## 三步把 dsh-desktop 发到 GitHub

### 第 1 步：仓库初始化与代码提交
1. GitHub 建公开仓库 `dsh-desktop`（或含 scope）。
2. 本地:
   cd dsh-desktop
   git init && git add .
   git commit -m "feat: 桌面端 DeepSeek Harness 壳 v0.1.0"
   git remote add origin https://github.com/<you>/dsh-desktop.git
   git branch -M main
   git push -u origin main

### 第 2 步：打标签 + 触发 CI 出安装包
   npm run build            # 本地或交给 Actions
   git tag v0.1.0
   git push origin v0.1.0
   # GitHub Actions（.github/workflows/release.yml）三平台矩阵构建：
   #   windows-latest / macos-latest / ubuntu-latest
   #   用 electron-builder 产出 exe/dmg/AppImage 并上传。

### 第 3 步：把产物挂到 Release
   # 方式 A：Actions 自动创建 GitHub Release 并附 tgz/exe/dmg（推荐）
   # 方式 B：手动
   gh release create v0.1.0 \
     dist/dsh-desktop-0.1.0-win-x64-setup.exe \
     dist/dsh-desktop-0.1.0-mac-arm64.dmg \
     dist/dsh-desktop-0.1.0.AppImage \
     --title "dsh-desktop v0.1.0" --notes "见 docs/ARCHITECTURE.md"

README 里把一键脚本指向你发布的 tags：
  iex (Invoke-RestMethod .../raw/<you>/dsh-desktop/v0.1.0/installers/install.ps1)
```

---

## 10. 里程碑（建议的落地顺序）

| 阶段 | 内容 | 验收 |
|---|---|---|
| M1 | 建 Electron 骨架 + 内嵌官方 Web(3080) 打开 | 能打开官方界面 |
| M2 | detect + deploy + launcher + procmon（探测/部署/拉起/哨兵） | 三态探测正确 |
| M3 | forceStart + forceStop + failbox（强制启动/停推/失败引导） | 卡死也能救活 |
| M4 | plugins 扫描 + theme 壁纸 | 变动高亮、换主题生效 |
| M5 | memory 编辑 + 迁移向导 | 能迁移别家记忆 |
| M6 | 三平台打包 + GitHub Actions + installers | 一键装成功 |
| M7 | README/PUBLISH 完善，发 v0.1.0 Release | 发布可复现 |

---

## 11. 待你拍板的 3 个小事

1. **发布账号**：仓库挂你 GitHub 账号 `@<you>`？一键脚本里那条 raw URL 等你给用户名/仓库名再定。
2. **是否需要我把官方 DSH 一并内置**？我倾向**不内置**（壳用系统 Node 现拉官方），安装包更小、更稳；如果你想"离线全内置"，告诉我，我改 deploy 策略。
3. **K 盘记忆**：找不到 K 盘时自动回落到 `~/.dsh/memory`，可接受吗？（当前按"可接受"设计）
```
