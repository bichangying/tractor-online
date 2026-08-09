#!/usr/bin/env bash
# 拖拉机 Online · 一键开玩（本机服务 + 免费公网隧道）
# 适用：Git Bash / WSL / macOS / Linux 终端
# 用法：  bash play.sh
#
# 做了什么：
#   1) 检查 3000 端口的游戏服务，没跑就自动 npm start（后台）
#   2) 用系统自带 ssh 打通 localhost.run 免费公网隧道（前台常驻）
# 玩的时候保持这个终端窗口开着；关掉窗口 = 朋友就进不来了。

set -e
cd "$(dirname "$0")"

# 1) 确保游戏服务在跑
if ! curl -s -o /dev/null --max-time 3 http://localhost:3000/api/health; then
  echo "[play] 启动游戏服务 (npm start) ..."
  npm start > /tmp/tractor-server.log 2>&1 &
  for i in $(seq 1 15); do
    if curl -s -o /dev/null --max-time 2 http://localhost:3000/api/health; then
      echo "[play] 服务已就绪"
      break
    fi
    sleep 1
  done
else
  echo "[play] 游戏服务已在运行"
fi

# 2) 打通公网隧道（前台运行，保持窗口打开即在线）
echo "[play] 建立公网隧道（localhost.run，免费、免账号、手机可直接开）..."
echo "[play] 连上后，把终端里出现的 https://xxxx.lhr.life 发给朋友即可。"
ssh -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=/dev/null -R 80:localhost:3000 nokey@localhost.run
