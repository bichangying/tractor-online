#!/usr/bin/env bash
# 拖拉机 Online · 一键开玩（本机服务 + 免费公网隧道 · 自动重连 + 保活）
# 适用：Git Bash / WSL / macOS / Linux 终端
# 用法：  bash play.sh
#
# 做了什么：
#   1) 检查 3000 端口的游戏服务，没跑就自动启动（后台）
#   2) 打通 localhost.run 免费公网隧道，并把地址写入 CURRENT_URL.txt
#   3) 每 45 秒自动心跳一次，防止 localhost.run 因「空闲」踢掉隧道
#   4) 隧道一旦断开，5 秒后自动重连（会换一个新地址，以终端提示为准）
#
# 玩的时候保持这个终端窗口开着；关掉窗口 = 朋友就进不来了。
# 停止：按 Ctrl+C

set -u
cd "$(dirname "$0")"

PORT=3000
URL_FILE="./CURRENT_URL.txt"
LOG_FILE="./tunnel.log"
KEEPALIVE_SEC=45

# ---------- 健康检查（不用 -o /dev/null，某些环境会返回假错误码）----------
health_ok() {
  curl -s --max-time 3 "http://127.0.0.1:$PORT/api/health" 2>/dev/null | grep -q '"ok"'
}

# ---------- 1) 确保游戏服务在跑 ----------
if health_ok; then
  echo "[play] 游戏服务已在运行 (端口 $PORT)"
else
  echo "[play] 启动游戏服务 ..."
  node server/index.js > ./server.log 2>&1 &
  SERVER_PID=$!
  for i in $(seq 1 20); do
    if health_ok; then
      echo "[play] 服务已就绪 (pid $SERVER_PID)"
      break
    fi
    sleep 1
  done
  if ! health_ok; then
    echo "[play] ✗ 服务启动失败，请查看 server.log"
    echo "[play]   如果报 EADDRINUSE，说明 3000 端口已被占用（可能服务本就在跑）"
    exit 1
  fi
fi

# ---------- 2) 保活心跳（防止空闲被踢）----------
keepalive_loop() {
  while true; do
    sleep "$KEEPALIVE_SEC"
    u=$(cat "$URL_FILE" 2>/dev/null || true)
    if [ -n "$u" ]; then
      curl -s --max-time 10 "$u/api/health" >/dev/null 2>&1 || true
    fi
  done
}
keepalive_loop &
KA_PID=$!

cleanup() {
  echo ""
  echo "[play] 正在停止 ..."
  kill "$KA_PID" 2>/dev/null || true
  exit 0
}
trap cleanup INT TERM

# ---------- 3) 隧道主循环（断线自动重连）----------
echo "[play] 建立公网隧道（localhost.run，免费、免账号、手机可直接开）..."
echo ""

while true; do
  : > "$URL_FILE"
  ssh -o StrictHostKeyChecking=accept-new \
      -o UserKnownHostsFile=/dev/null \
      -o ServerAliveInterval=30 \
      -o ServerAliveCountMax=3 \
      -o ExitOnForwardFailure=yes \
      -R "80:localhost:$PORT" nokey@localhost.run 2>&1 |
  while IFS= read -r line; do
    echo "$line" >> "$LOG_FILE"
    url=$(printf '%s' "$line" | grep -oE 'https://[a-z0-9-]+\.lhr\.life' | head -1)
    if [ -n "${url:-}" ]; then
      printf '%s' "$url" > "$URL_FILE"
      echo ""
      echo "=================================================="
      echo "  ✅ 游戏已上线，把下面这个地址发给朋友："
      echo ""
      echo "     $url"
      echo ""
      echo "  （手机浏览器直接打开 → 建房 → 把房间号发给朋友）"
      echo "  地址也已写入：CURRENT_URL.txt"
      echo "=================================================="
      echo ""
    fi
  done

  echo "[play] ⚠ 隧道已断开（$(date '+%H:%M:%S')），5 秒后自动重连（地址会变）..."
  sleep 5
done
