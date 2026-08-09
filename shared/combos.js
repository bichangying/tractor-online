import { faceOf } from './cards.js';
import { COMBO, TRUMP, ERR } from './constants.js';

/**
 * ─────────────── 牌型分解 ───────────────
 * 把一手出牌拆成"组件(component)"：
 *   { unit: 每组张数(1单/2对/3三张), len: 连续几组, value: 最高阶梯值, cards: [...] }
 * 单个组件 → SINGLE / PAIR / TRIPLE / TRACTOR；多个组件 → THROW（甩牌）
 *
 * 全部牌必须同属一组（同花色或全主），否则返回 null。
 */
export function decompose(cards, order) {
  if (!cards || cards.length === 0) return null;
  const group = order.groupOf(cards[0]);
  for (const c of cards) if (order.groupOf(c) !== group) return null;

  const byFace = new Map();
  for (const c of cards) {
    const f = faceOf(c);
    if (!byFace.has(f)) byFace.set(f, []);
    byFace.get(f).push(c);
  }

  const bySize = new Map();
  for (const cs of byFace.values()) {
    const u = { unit: cs.length, value: order.valueOf(cs[0]), cards: cs };
    if (!bySize.has(u.unit)) bySize.set(u.unit, []);
    bySize.get(u.unit).push(u);
  }

  const comps = [];
  for (const [unit, list] of bySize) {
    list.sort((a, b) => a.value - b.value);
    if (unit === 1) {
      for (const u of list) comps.push({ unit: 1, len: 1, value: u.value, low: u.value, cards: u.cards });
      continue;
    }
    let run = [list[0]];
    const flush = () => comps.push({
      unit, len: run.length,
      value: run[run.length - 1].value,
      low: run[0].value,
      cards: run.flatMap((u) => u.cards),
    });
    for (let i = 1; i < list.length; i++) {
      if (list[i].value === run[run.length - 1].value + 1) run.push(list[i]);
      else { flush(); run = [list[i]]; }
    }
    flush();
  }
  comps.sort((a, b) => b.unit - a.unit || b.len - a.len || b.value - a.value);
  return { group, comps, size: cards.length, cards: cards.slice() };
}

export function signatureOf(comps) {
  return comps.map((c) => `${c.unit}x${c.len}`).sort().join('+');
}

export function comboOf(cards, order) {
  const d = decompose(cards, order);
  if (!d) return null;
  let type;
  if (d.comps.length === 1) {
    const c = d.comps[0];
    if (c.unit === 1) type = COMBO.SINGLE;
    else if (c.len === 1) type = c.unit === 2 ? COMBO.PAIR : COMBO.TRIPLE;
    else type = COMBO.TRACTOR;
  } else type = COMBO.THROW;
  return { ...d, type, signature: signatureOf(d.comps), top: d.comps[0].value };
}

/** 挑战者能否压过当前最大牌型（形状必须完全一致） */
export function beatsCombo(chal, lead) {
  if (!chal || !lead) return false;
  if (chal.signature !== lead.signature) return false;
  const ct = chal.group === TRUMP, lt = lead.group === TRUMP;
  if (!ct && chal.group !== lead.group) return false; // 副牌垫牌，不参与比较
  if (ct && !lt) return true;                          // 主牌毙副牌
  for (let i = 0; i < chal.comps.length; i++) {
    if (!(chal.comps[i].value > lead.comps[i].value)) return false;
  }
  return true;
}

// ─────────────── 跟牌校验 ───────────────
export function countPairsInComps(comps) {
  let n = 0;
  for (const c of comps) n += Math.floor(c.unit / 2) * c.len;
  return n;
}

export function maxPairsOf(cards) {
  const m = new Map();
  for (const c of cards) m.set(faceOf(c), (m.get(faceOf(c)) || 0) + 1);
  let n = 0;
  for (const v of m.values()) n += Math.floor(v / 2);
  return n;
}

export function maxTractorLenOfComps(comps) {
  let n = 0;
  for (const c of comps) if (c.unit >= 2 && c.len > n) n = c.len;
  return n;
}

export function maxTractorLenOf(cards, order) {
  if (!cards.length) return 0;
  const d = decompose(cards, order);
  return d ? maxTractorLenOfComps(d.comps) : 0;
}

/**
 * 跟牌规则：
 *  1. 张数必须与首攻一致
 *  2. 门长必须先跟完（手上该组有多少就必须出多少，最多到首攻张数）
 *  3. strict 模式下：首攻含 N 个对子时，若手上该组有对子，必须尽量拆出对子
 *  4. strict 模式下：首攻是 L 连对时，若手上该组有 ≥R 连对，必须打出 ≥R 连对
 */
export function validateFollow({ hand, played, lead, order, strict = true }) {
  if (played.length !== lead.size) {
    return { ok: false, code: ERR.BAD_COUNT, msg: `需要出 ${lead.size} 张牌` };
  }
  const lg = lead.group;
  const handIn = hand.filter((c) => order.groupOf(c) === lg);
  const playIn = played.filter((c) => order.groupOf(c) === lg);
  const must = Math.min(lead.size, handIn.length);
  if (playIn.length !== must) {
    return { ok: false, code: ERR.MUST_FOLLOW, msg: `必须打出 ${must} 张${order.groupLabel(lg)}` };
  }
  if (!strict || must === 0) return { ok: true };

  const needPairs = countPairsInComps(lead.comps);
  if (needPairs > 0) {
    const req = Math.min(needPairs, maxPairsOf(handIn));
    if (req > 0 && maxPairsOf(playIn) < req) {
      return { ok: false, code: ERR.NEED_PAIR, msg: `必须打出至少 ${req} 个对子` };
    }
  }
  const needT = maxTractorLenOfComps(lead.comps);
  if (needT >= 2) {
    const req = Math.min(needT, maxTractorLenOf(handIn, order));
    if (req >= 2 && maxTractorLenOf(playIn, order) < req) {
      return { ok: false, code: ERR.NEED_TRACTOR, msg: `必须打出至少 ${req} 连对` };
    }
  }
  return { ok: true };
}

/**
 * 甩牌校验：任何一个组件能被别家同组牌压住 → 甩牌失败，
 * 强制只出其中最小的那个组件（并公开亮相作为惩罚）。
 */
export function throwCheck(leadCards, otherHands, order) {
  const combo = comboOf(leadCards, order);
  if (!combo) return { ok: false, code: ERR.MIXED_SUIT, msg: '甩牌必须同花色' };
  if (combo.type !== COMBO.THROW) return { ok: true, combo };

  for (const comp of combo.comps) {
    for (const h of otherHands) {
      const inG = h.filter((c) => order.groupOf(c) === combo.group);
      if (!inG.length) continue;
      const d = decompose(inG, order);
      if (!d) continue;
      const can = d.comps.some((x) => x.unit >= comp.unit && x.len >= comp.len && x.value > comp.value);
      if (can) {
        const weakest = combo.comps
          .slice()
          .sort((a, b) => a.value - b.value || a.unit - b.unit || a.len - b.len)[0];
        return { ok: false, forced: weakest.cards, beatenComp: comp };
      }
    }
  }
  return { ok: true, combo };
}

/** 该组内所有可用的合法牌型（供 AI 枚举，简化版） */
export function enumerateLeads(cards, order) {
  const out = [];
  const groups = new Map();
  for (const c of cards) {
    const g = order.groupOf(c);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(c);
  }
  for (const [, cs] of groups) {
    const d = decompose(cs, order);
    if (!d) continue;
    for (const comp of d.comps) out.push({ cards: comp.cards, comp });
  }
  return out;
}
