import { TRUMP, COMBO, NT, SUITS } from '../../shared/constants.js';
import { faceOf, pointsOf } from '../../shared/cards.js';
import { decompose, comboOf, beatsCombo, maxTractorLenOfComps, maxTractorLenOf, maxPairsOf } from '../../shared/combos.js';

// ─────────── 小工具 ───────────
function groupCards(hand, order) {
  const m = new Map();
  for (const c of hand) {
    const g = order.groupOf(c);
    if (!m.has(g)) m.set(g, []);
    m.get(g).push(c);
  }
  return m;
}

function facesOf(cards) {
  const m = new Map();
  for (const c of cards) {
    const f = faceOf(c);
    if (!m.has(f)) m.set(f, []);
    m.get(f).push(c);
  }
  return m;
}

const byValueAsc = (order) => (a, b) => order.valueOf(a) - order.valueOf(b);
const cmpFor = (pref, order) => {
  if (pref === 'high') return (a, b) => order.valueOf(b) - order.valueOf(a);
  if (pref === 'points') return (a, b) => (pointsOf(b) - pointsOf(a)) || (order.valueOf(a) - order.valueOf(b));
  return (a, b) => (pointsOf(a) - pointsOf(b)) || (order.valueOf(a) - order.valueOf(b)); // low：先垫无分小牌
};

/** 从同组牌里挑 `need` 张，优先满足「连对 → 对子 → 单张」结构，保证跟牌合法 */
export function selectFromGroup(inGroup, need, order, lead, pref = 'low') {
  const chosen = [];
  let pool = inGroup.slice();
  if (need <= 0) return chosen;

  const takeIds = (cards) => {
    chosen.push(...cards);
    const ids = new Set(cards.map((c) => c.id));
    pool = pool.filter((c) => !ids.has(c.id));
  };

  // 1. 连对需求
  const needT = lead ? maxTractorLenOfComps(lead.comps) : 0;
  if (needT >= 2 && need >= 4) {
    const availT = maxTractorLenOf(pool, order);
    const req = Math.min(needT, availT, Math.floor(need / 2));
    if (req >= 2) {
      const d = decompose(pool, order);
      const cands = d ? d.comps.filter((c) => c.unit >= 2 && c.len >= req) : [];
      if (cands.length) {
        cands.sort((a, b) => (pref === 'high' ? b.value - a.value : a.value - b.value));
        const c = cands[0];
        const pairs = [...facesOf(c.cards).values()]
          .filter((cs) => cs.length >= 2)
          .map((cs) => cs.slice(0, 2))
          .sort((a, b) => order.valueOf(a[0]) - order.valueOf(b[0]));
        const take = pref === 'high' ? pairs.slice(-req) : pairs.slice(0, req);
        takeIds(take.flat());
      }
    }
  }

  // 2. 对子需求
  const pairsAvail = [...facesOf(pool).values()]
    .filter((cs) => cs.length >= 2)
    .map((cs) => cs.slice(0, 2));
  pairsAvail.sort((a, b) => cmpFor(pref, order)(a[0], b[0]));
  const needPairs = lead ? lead.comps.reduce((n, c) => n + Math.floor(c.unit / 2) * c.len, 0) : 0;
  let usedPairs = Math.floor(chosen.length / 2);
  for (const p of pairsAvail) {
    if (chosen.length + 2 > need) break;
    if (needPairs > 0 && usedPairs >= needPairs) break;
    takeIds(p);
    usedPairs++;
  }

  // 3. 单张补齐
  pool.sort(cmpFor(pref, order));
  while (chosen.length < need && pool.length) takeIds([pool[0]]);
  return chosen.slice(0, need);
}

/** 从非首攻花色里挑「垫牌」 */
function selectFiller(hand, ledGroup, count, order, pref = 'low') {
  const rest = hand.filter((c) => order.groupOf(c) !== ledGroup);
  // 优先垫副牌，留主牌
  rest.sort((a, b) => {
    const ta = order.groupOf(a) === TRUMP ? 1 : 0;
    const tb = order.groupOf(b) === TRUMP ? 1 : 0;
    if (ta !== tb) return ta - tb;
    return cmpFor(pref, order)(a, b);
  });
  return rest.slice(0, count);
}

// ─────────── 首攻 ───────────
export function chooseLead(hand, order) {
  const groups = groupCards(hand, order);
  let best = null;
  for (const [g, cs] of groups) {
    const d = decompose(cs, order);
    if (!d) continue;
    const top = order.ladderSize(g) - 1;
    for (const comp of d.comps) {
      const isTop = comp.value >= top - 1;             // 差不多是这门最大
      const pts = comp.cards.reduce((n, c) => n + pointsOf(c), 0);
      const score =
        (isTop ? 900 : 0) +
        comp.unit * comp.len * 45 +
        comp.value * 2 +
        pts * 3 +
        (g === TRUMP ? -120 : 0);                       // 尽量别先打主
      if (!best || score > best.score) best = { score, cards: comp.cards, isTop };
    }
  }
  if (best && best.isTop) return best.cards;
  // 没有大牌 → 出一张最小的无分副牌探路
  const cands = hand.filter((c) => order.groupOf(c) !== TRUMP);
  const pool = (cands.length ? cands : hand).slice()
    .sort((a, b) => (pointsOf(a) - pointsOf(b)) || (order.valueOf(a) - order.valueOf(b)));
  return best && best.cards.length > 1 && Math.random() < 0.35 ? best.cards : [pool[0]];
}

// ─────────── 跟牌 ───────────
export function chooseFollow({ hand, lead, plays, order, isPartnerWinning, isLast }) {
  const ledGroup = lead.group;
  const inGroup = hand.filter((c) => order.groupOf(c) === ledGroup);
  const must = Math.min(lead.size, inGroup.length);
  const tablePoints = plays.reduce((n, p) => n + p.cards.reduce((m, c) => m + pointsOf(c), 0), 0);
  let best = plays[0];
  for (const p of plays) if (p.combo && beatsCombo(p.combo, best.combo)) best = p;

  // A. 有该门牌且够数 —— 可能压
  if (must === lead.size) {
    const high = selectFromGroup(inGroup, must, order, lead, 'high');
    const hc = comboOf(high, order);
    const canWin = hc && beatsCombo(hc, best.combo);
    if (canWin && (tablePoints > 0 || isLast || Math.random() < 0.4)) return high;
    if (isPartnerWinning) return selectFromGroup(inGroup, must, order, lead, 'points');
    return selectFromGroup(inGroup, must, order, lead, 'low');
  }

  // B. 完全没有该门 —— 可以毙（用主牌）
  if (must === 0) {
    const trumps = hand.filter((c) => order.groupOf(c) === TRUMP);
    if (trumps.length >= lead.size && ledGroup !== TRUMP && (tablePoints >= 5 || isLast)) {
      const ruff = selectFromGroup(trumps, lead.size, order, lead, 'low');
      const rc = comboOf(ruff, order);
      if (rc && beatsCombo(rc, best.combo)) return ruff;
    }
    if (isPartnerWinning) return selectFiller(hand, ledGroup, lead.size, order, 'points');
    return selectFiller(hand, ledGroup, lead.size, order, 'low');
  }

  // C. 有一部分 —— 必须全出，剩下垫牌
  const forced = selectFromGroup(inGroup, must, order, lead, 'low');
  const filler = selectFiller(hand, ledGroup, lead.size - must, order, isPartnerWinning ? 'points' : 'low');
  return forced.concat(filler);
}

// ─────────── 亮主 ───────────
export function chooseDeclare(hand, level, current, seatDealtRatio) {
  const levelCards = hand.filter((c) => c.r === level && c.s !== 'T');
  const jokers = hand.filter((c) => c.s === 'T');
  const bySuit = new Map();
  for (const c of levelCards) {
    if (!bySuit.has(c.s)) bySuit.set(c.s, []);
    bySuit.get(c.s).push(c);
  }
  // 王对 → 无主
  const bj = jokers.filter((c) => c.r === 'bj');
  const sj = jokers.filter((c) => c.r === 'sj');
  const strengthNow = current ? current.strength : 0;
  if (bj.length >= 2 && strengthNow < 4 && Math.random() < 0.6) return bj.slice(0, 2).map((c) => c.id);
  if (sj.length >= 2 && strengthNow < 3 && Math.random() < 0.45) return sj.slice(0, 2).map((c) => c.id);

  let bestSuit = null, bestScore = -1;
  for (const [s, cs] of bySuit) {
    const suitCount = hand.filter((c) => c.s === s).length;
    const score = suitCount + (cs.length >= 2 ? 8 : 0);
    if (score > bestScore) { bestScore = score; bestSuit = s; }
  }
  if (!bestSuit) return null;
  const cs = bySuit.get(bestSuit);
  if (cs.length >= 2 && strengthNow < 2) return cs.slice(0, 2).map((c) => c.id);
  if (cs.length >= 1 && strengthNow < 1) {
    const suitCount = hand.filter((c) => c.s === bestSuit).length;
    if (suitCount >= 5 || seatDealtRatio > 0.75) return [cs[0].id];
  }
  return null;
}

// ─────────── 扣底 ───────────
export function chooseBury(hand, order, count) {
  const nonTrump = hand.filter((c) => order.groupOf(c) !== TRUMP);
  const bySuitCount = new Map();
  for (const c of nonTrump) bySuitCount.set(c.s, (bySuitCount.get(c.s) || 0) + 1);
  const scored = nonTrump.map((c) => ({
    c,
    // 分低 + 花色短 + 牌小 → 优先扣
    score: pointsOf(c) * 100 + (bySuitCount.get(c.s) || 0) * 6 + order.valueOf(c),
  })).sort((a, b) => a.score - b.score);
  const out = scored.slice(0, count).map((x) => x.c);
  if (out.length < count) {
    const rest = hand.filter((c) => !out.includes(c))
      .sort((a, b) => pointsOf(a) - pointsOf(b) || order.valueOf(a) - order.valueOf(b));
    out.push(...rest.slice(0, count - out.length));
  }
  return out.map((c) => c.id);
}

// ─────────── 叫朋友（5 人） ───────────
export function chooseFriend(hand, level, trumpSuit) {
  const has = (s, r) => hand.some((c) => c.s === s && c.r === r);
  const suits = SUITS.filter((s) => s !== trumpSuit);
  for (const r of ['A', 'K']) {
    for (const s of suits) if (!has(s, r)) return { suit: s, rank: r, nth: 1 };
  }
  return { suit: suits[0] || 'S', rank: 'A', nth: 1 };
}
