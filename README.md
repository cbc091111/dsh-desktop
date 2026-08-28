# DSH Desktop 🐋

桌面端 **DeepSeek Harness** —— 把官方 DeepSeek Harness 从"网页 + 敲命令"变成**像装微信一样装好的桌面软件**。

- 界面与官方 Web 版 **100% 一致**，所有官方插件**照常全兼容**
- 一键部署 / 一键重启 / 强制停止推理 / 插件市场 / 主题壁纸 / 记忆迁移 / 自动更新，全给你包办

## 📦 下载安装

Windows 用户请到右侧 **Releases** 页下载最新版：

- **安装版**：`dsh-desktop Setup <版本>.exe`（双击一路下一步即可）
- **便携版**：`...-win.zip`（解压出来，双击里面的 exe 就能用）

> 支持 Windows / macOS / Linux（安装包按平台发行）。

### 一键安装命令（PowerShell）
```powershell
iex (Invoke-RestMethod https://raw.githubusercontent.com/cbc091111/dsh-desktop/main/installers/install.ps1)
```

## ✨ 它做了什么

| 场景 | 行为 |
|---|---|
| 首次打开 | 自动检测是否装了 DeepSeek Harness，没有就问你要不要一键部署 |
| 想用了 | 双击图标，打开就是官方界面 |
| 卡住了 | 一键重启（带"正在重启中"提示），或强制停止推理 |
| 装插件 | 内置插件市场，2000+ 社区插件可浏览搜索 |
| 换风格 | 自定义主题色 + 壁纸 |
| 换 AI 工具 | 从 ChatGPT/Claude/Kimi/豆包 等一键迁移记忆 |
| 有新版 | 侧边栏亮红点，一键更新 |

## ❓ 常见问题

**打开没有官方界面？**
先确认是否装了 DeepSeek Harness，没装就点"一键部署"，装好回到软件点"重新检查"。

**安装插件报错？**
插件一键安装在完善中，部分暂不可用；遇到问题可去仓库提 Issue。

## 🧑‍💻 想参与 / 想改？

欢迎反馈问题、提建议。更多技术细节见 `docs/`。

---

Made by © 超高校级的幼刀
