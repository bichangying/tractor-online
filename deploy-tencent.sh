#!/usr/bin/env bash
# 拖拉机 Online —— 腾讯云轻量应用服务器 一键部署脚本
# 适用：全新 Ubuntu / Debian 轻量实例（root 或带 sudo 的普通用户）
#
# 用法（二选一）：
#   A. 直接在线拉取执行（仓库需为 public）：
#      curl -fsSL https://raw.githubusercontent.com/bichangying/tractor-online/main/deploy-tencent.sh | bash
#   B. 已 clone 仓库后本地执行：
#      git clone https://github.com/bichangying/tractor-online.git
#      cd tractor-online && bash deploy-tencent.sh
#
# 注意：脚本只负责装环境+起服务。腾讯云控制台的「防火墙」还需手动放行下方 PORT 端口！

set -euo pipefail

REPO_URL="https://github.com/bichangying/tractor-online.git"
APP_DIR="$HOME/tractor-online"
PORT=3000

# root 下不用 sudo
if [ "$(id -u)" -eq 0 ]; then SUDO=""; else SUDO="sudo"; fi

echo "==> [1/6] 更新系统 & 安装基础工具"
$SUDO apt-get update -y
$SUDO apt-get install -y curl git ufw

echo "==> [2/6] 安装 Node.js 20（含 npm）"
if ! command -v node >/dev/null || [ "$(node -v | tr -d 'v' | cut -d. -f1)" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | $SUDO -E bash -
  $SUDO apt-get install -y nodejs
fi
node -v && npm -v

echo "==> [3/6] 克隆 / 更新代码"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" pull --ff-only
else
  git clone "$REPO_URL" "$APP_DIR"
fi
cd "$APP_DIR"

echo "==> [4/6] 安装依赖（生产，走国内镜像加速）"
npm config set registry https://registry.npmmirror.com
npm ci --omit=dev || npm install --omit=dev

echo "==> [5/6] pm2 常驻进程（开机自启）"
$SUDO npm install -g pm2
pm2 delete tractor-online 2>/dev/null || true
PORT=$PORT pm2 start server/index.js --name tractor-online
pm2 save
$SUDO env PATH="$PATH:/usr/bin" pm2 startup systemd -u "$USER" --hp "$HOME" || echo "pm2 自启配置失败，请手动执行上方提示的 pm2 startup 命令"

echo "==> [6/6] 开放系统防火墙端口 $PORT"
$SUDO ufw allow 22/tcp
$SUDO ufw allow "$PORT"/tcp
$SUDO ufw --force enable || true

PUB_IP=$(curl -s --max-time 10 https://api.ipify.org || hostname -I | awk '{print $1}')
echo ""
echo "============================================================"
echo " 部署完成 ✅"
echo " 重要：还需到【腾讯云控制台 → 轻量应用服务器 → 防火墙】"
echo "       手动「添加规则」放行入站 TCP $PORT 端口，朋友才能访问。"
echo ""
echo " 朋友用手机浏览器打开：  http://$PUB_IP:$PORT"
echo " （控制台防火墙 和 本机 ufw 都放行后才会通）"
echo "============================================================"
