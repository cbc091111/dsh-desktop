#!/usr/bin/env sh
# ============================================================
# install.sh —— DSH Desktop 一键安装脚本（macOS / Linux）
#
# 用法（终端复制粘贴）：
#   curl -fsSL <你的GitHub raw URL>/install.sh | sh
#
# 原理：用系统自带的包管理器和 curl + npm，不要求额外先装东西。
#   macOS → Homebrew；Debian/Ubuntu → apt；Fedora → dnf；Arch → pacman
# 安全：只读检查先行，绝不覆盖已有 Node / DSH 配置。
# ============================================================

set -e
echo "🐋 DSH Desktop 一键安装开始…"

# ---------- 1) 找系统的包管理器 ----------
detect_pkg() {
  if command -v brew >/dev/null 2>&1; then echo "brew"
  elif command -v apt-get >/dev/null 2>&1; then echo "apt"
  elif command -v dnf >/dev/null 2>&1; then echo "dnf"
  elif command -v pacman >/dev/null 2>&1; then echo "pacman"
  elif command -v apk >/dev/null 2>&1; then echo "apk"
  else echo "none"; fi
}

# ---------- 2) 确保有 Node ----------
ensure_node() {
  if command -v node >/dev/null 2>&1 && [ -n "$(node -v)" ]; then
    echo "  ✓ Node 已装：$(node -v)"
    return
  fi
  echo "  ⚠ 未检测到 Node，用系统包管理器补上…"
  pkg="$(detect_pkg)"
  case "$pkg" in
    brew) brew install node ;;
    apt)  [ "$(id -u)" = "0" ] && apt-get update && apt-get install -y nodejs npm || { echo "需要 sudo：请用 sudo 运行，或手动装 Node"; exit 1; } ;;
    dnf)  [ "$(id -u)" = "0" ] && dnf install -y nodejs npm || { echo "需要 sudo：请用 sudo 运行，或手动装 Node"; exit 1; } ;;
    pacman) [ "$(id -u)" = "0" ] && pacman -Sy --noconfirm nodejs npm || { echo "需要 sudo：请用 sudo 运行，或手动装 Node"; exit 1; } ;;
    apk)  apk add nodejs npm ;;
    none) echo "未能自动装 Node。请手动安装：https://nodejs.org/"; exit 1 ;;
  esac
  echo "  ✓ Node 已装好"
}

# ---------- 3) 安装 dsh-desktop ----------
install_shell() {
  echo "  正在从 npm 安装 dsh-desktop …"
  if ! npm install -g dsh-desktop 2>/dev/null; then
    echo "  ⚠ npm 上还没有 dsh-desktop（未发布）。若本地有 tgz，请手动：npm install -g <路径>"
    exit 1
  fi
  echo "  ✓ dsh-desktop 已安装"
}

# ---------- 4) 启动 ----------
launch_shell() {
  echo "  正在启动 DSH Desktop…（自动探测/部署 DeepSeek Harness）"
  if command -v dsh-desktop >/dev/null 2>&1; then
    nohup dsh-desktop >/tmp/dsh-desktop.log 2>&1 &
  else
    echo "  未找到 dsh-desktop 命令，请检查安装。"
    exit 1
  fi
}

ensure_node
install_shell
launch_shell
echo ""
echo "✅ 安装完成！窗口打开后会自动探测 DeepSeek Harness。"
