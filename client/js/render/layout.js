/**
 * 4 / 5 / 6 人自动布局
 *
 * 规则：把「我」旋转到正下方，其余按顺时针均匀分布在一个椭圆上。
 *   rel   = (seat - mySeat + N) % N
 *   angle = 90° + rel × (360° / N)     （屏幕坐标，y 向下，90° 即正下方）
 *   x = cx + RX·cos(angle)，y = cy + RY·sin(angle)
 *
 *   N=4 → 下 / 左 / 上 / 右
 *   N=5 → 下 / 左下 / 左上 / 右上 / 右下
 *   N=6 → 下 / 左下 / 左上 / 上 / 右上 / 右下
 *
 * 出牌区落在「座位 → 中心」方向的 rP 比例处，天然不会互相遮挡。
 */
const GEO = {
  4: { rx: 40, ry: 33, cx: 50, cy: 46, seatR: 1.0, playR: 0.50 },
  5: { rx: 41, ry: 34, cx: 50, cy: 45, seatR: 1.0, playR: 0.52 },
  6: { rx: 43, ry: 35, cx: 50, cy: 45, seatR: 1.0, playR: 0.54 },
};

export function seatLayout(n, mySeat) {
  const g = GEO[n] || GEO[4];
  const base = mySeat == null ? 0 : mySeat;
  const out = [];
  for (let seat = 0; seat < n; seat++) {
    const rel = (seat - base + n) % n;
    const deg = 90 + rel * (360 / n);
    const rad = (deg * Math.PI) / 180;
    const dx = Math.cos(rad);
    const dy = Math.sin(rad);
    const isMe = rel === 0 && mySeat != null;
    const seatPos = isMe
      ? { x: 11, y: 84 }                                   // 自己固定在左下角，把下方留给手牌
      : { x: g.cx + g.rx * dx, y: g.cy + g.ry * dy };
    const playPos = isMe
      ? { x: g.cx, y: g.cy + g.ry * g.playR + 4 }
      : { x: g.cx + g.rx * g.playR * dx, y: g.cy + g.ry * g.playR * dy };
    out.push({
      seat, rel, deg, isMe,
      side: sideOf(deg),
      seatPos, playPos,
    });
  }
  return out;
}

function sideOf(deg) {
  const d = ((deg % 360) + 360) % 360;
  if (d > 60 && d < 120) return 'bottom';
  if (d >= 120 && d < 240) return 'left';
  if (d >= 240 && d < 300) return 'top';
  return 'right';
}

/** 出牌区内牌的排布方向（左右两侧竖排更省空间） */
export function playDirection(side) {
  return side === 'left' || side === 'right' ? 'row' : 'row';
}
