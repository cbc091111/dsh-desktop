# DSH Desktop — GitHub 发布流程

> 大肥鱼版大白话：把软件"摆上架"，让全世界能一键装。

## 前置

- 已注册 GitHub 账号（免费），仓库名建议 `dsh-desktop`
- 本机已装 `git` 与 `gh`（GitHub 官方命令行）——`gh` 可以让发布半自动
- **全部功能测试通过再发**（当前还在 M6/M7）

## 三步发布

### 第 1 步：初始化仓库并推上 GitHub

```bash
cd dsh-desktop
git init
git add -A
git commit -m "feat: DSH Desktop v0.1.0 桌面端 DeepSeek Harness"
# 把 <你的账号> 换成你的 GitHub 用户名
git remote add origin https://github.com/<你的账号>/dsh-desktop.git
git branch -M main
git push -u origin main
```

### 第 2 步：本地/CI 出三平台安装包，打标签

```bash
# 本地出 Windows 包（也可用 GitHub Actions 三平台矩阵）
npm install
npm run build:win     # 产出 dist/dsh-desktop-0.1.0-win.x64-setup.exe + zip
# 打版本标签并推送 → 触发未来 CI 自动构建（见 .github/workflows）
git tag v0.1.0
git push origin v0.1.0
```

> macOS / Linux 包建议交给 GitHub Actions（三平台矩阵），否则需要对应系统才能构建。
> 配套的 `.github/workflows/release.yml` 见仓库根目录（未创建则按下方第 4 步补上）。

### 第 3 步：发布 Release（把安装包挂上网）

```bash
# 方式 A：gh 命令行（推荐，半自动）
gh release create v0.1.0 \
  "dist/dsh-desktop-0.1.0-win.x64-setup.exe" \
  "dist/dsh-desktop-0.1.0-win.x64.zip" \
  --title "DSH Desktop v0.1.0" \
  --notes "见 docs/ARCHITECTURE.md 与 README.md"

# 方式 B：网页操作 —— GitHub 仓库页 → Releases → Draft a new release
#         选标签 v0.1.0 → 上传 exe/zip → 发布
```

### 第 4 步（可选但推荐）：GitHub Actions 三平台自动构建

在仓库新建 `.github/workflows/release.yml`：

```yaml
name: Build Release
on:
  push:
    tags: ['v*']
jobs:
  build:
    strategy:
      matrix:
        include:
          - os: windows-latest
          - os: macos-latest
          - os: ubuntu-latest
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
      - run: npm run build        # electron-builder 自动按当前系统出包
      - uses: softprops/action-gh-release@v2
        with:
          files: dist/**/*
```

推送 `v0.1.0` 标签后，GitHub 会在三台虚拟机上自动装好三平台安装包并挂到 Release 页。

## 一键安装链接（README 里给读者用）

发布后，把 README 里这段 raw 链接换成你的真实地址：

```powershell
# Windows PowerShell
iex (Invoke-RestMethod https://raw.githubusercontent.com/<你的账号>/dsh-desktop/main/installers/install.ps1)
```

```bash
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/<你的账号>/dsh-desktop/main/installers/install.sh | sh
```

## 常见坑 & 提示

- **仓库公开即可免费**，Release 下载量无限制。
- **不要把 node_modules 推上去**（用 `.gitignore`）：`node_modules/`、`dist/`、`*.log`。
- 想改图标/品牌，替换 `assets/icon.png`（256×256）后重新构建；win 会自动转 .ico。
- 发布前把 README 里的功能表、安装方法写清楚，别人才能一眼看懂怎么用。

---

Made by 大肥鱼 🐋
