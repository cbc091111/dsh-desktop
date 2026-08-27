# ============================================================
# install.ps1 —— DSH Desktop 一键安装脚本（Windows / PowerShell）
#
# 用法（右键"用 PowerShell 运行"，或命令行）：
#   iex (Invoke-RestMethod <你的GitHub raw URL>/install.ps1)
#
# 原理：全用系统自带工具——
#   ① 检查/安装 Node（winget 是 Win10/11 系统内置包管理器）
#   ② 安装 dsh-desktop 壳（默认从 npm；未发布时可指向本地 tgz）
#   ③ 启动壳，后续由壳自己探测/部署官方 DeepSeek Harness
#
# 安全：先只读检查，绝不覆盖用户已有 DSH / Node / 其它配置。
# ============================================================

param(
  [int]$Port = 3080,          # 官方 DSH Web 端口
  [string]$Package = ''       # 可选：本地 tgz 路径（发布前自测用）；留空走 npm
)

$ErrorActionPreference = 'Stop'
Write-Host "🐋 DSH Desktop 一键安装开始…" -ForegroundColor Cyan

# ---------- 1) 检查 / 安装 Node（软件的地基，系统自带 winget） ----------
function Ensure-Node {
  $ver = (node -v) 2>$null
  if ($LASTEXITCODE -eq 0 -and $ver) {
    Write-Host "  ✓ Node 已安装：$ver" -ForegroundColor Green
    return
  }
  Write-Host "  ⚠ 未检测到 Node，正在用系统自带 winget 安装 …" -ForegroundColor Yellow
  $ok = winget install --id OpenJS.NodeJS.LTS --source winget --silent --accept-package-agreements --accept-source-agreements
  if ($LASTEXITCODE -ne 0) { throw 'Node 安装失败。请手动安装后再运行：https://nodejs.org/' }
  # 刷新 PATH（当前会话补上 winget 装的 node）
  $env:Path = [System.Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path', 'Process')
  Write-Host "  ✓ Node 已通过 winget 装好" -ForegroundColor Green
}

# ---------- 2) 安装 dsh-desktop 壳 ----------
function Install-Shell {
  if ($Package) {
    Write-Host "  本地安装包：$Package"
    & npm install -g $Package
    if ($LASTEXITCODE -ne 0) { throw '本地安装包安装失败' }
  } else {
    Write-Host "  正在从 npm 安装 dsh-desktop …"
    & npm install -g dsh-desktop
    if ($LASTEXITCODE -ne 0) {
      Write-Host "  ⚠ npm 上还没有 dsh-desktop（未发布）。" -ForegroundColor Yellow
      Write-Host "  若你已本地构建出 tgz，请加参数：install.ps1 -Package D:\\path\\to\\dsh-desktop-x.x.x.tgz"
      throw 'dsh-desktop 未发布到 npm'
    }
  }
  Write-Host "  ✓ dsh-desktop 已安装" -ForegroundColor Green
}

# ---------- 3) 启动壳 ----------
function Launch-Shell {
  Write-Host "  正在启动 DSH Desktop…（它会自动探测/部署 DeepSeek Harness）" -ForegroundColor Cyan
  Start-Process dsh-desktop
}

# ---------- 主流程 ----------
Ensure-Node
Install-Shell
Launch-Shell
Write-Host ""
Write-Host "✅ 安装完成！窗口打开后，若检测到没装 DeepSeek Harness，会引导你一键部署。" -ForegroundColor Green
