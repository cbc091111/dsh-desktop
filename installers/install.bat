@echo off
REM ============================================================
REM install.bat —— DSH Desktop 一键安装（Windows 双击版）
REM 双击本文件：允许 PowerShell 执行 → 运行 install.ps1
REM 会检查安装 Node → 装 dsh-desktop → 启动
REM ============================================================
setlocal
title DSH Desktop 一键安装

echo [DSH Desktop] 正在准备 PowerShell 一键安装…

REM 找到本脚本同目录下的 install.ps1
set "DIR=%~dp0"
set "PS1=%DIR%install.ps1"

REM 以当前用户维度放行本会话的 PowerShell 执行策略（不全局改，安全）
powershell -NoProfile -ExecutionPolicy Bypass -Command "Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force"

if exist "%PS1%" (
    echo [DSH Desktop] 找到安装脚本，开始执行…
    powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%"
) else (
    echo [DSH Desktop] 未找到 install.ps1（应与本文件在同一目录）。
    echo 请直接运行 PowerShell 并执行：
    echo   iex (Invoke-RestMethod ^<你的GitHub raw URL^>/install.ps1)
    pause
)

endlocal
