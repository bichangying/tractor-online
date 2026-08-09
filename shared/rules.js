import { SUITS, RANKS, NT, TRUMP, JOKER_SUIT, JOKER_SMALL, JOKER_BIG, GROUP_LABEL } from './constants.js';

/**
 * ─────────────── 大小序（Order） ───────────────
 *
 * 给定「主花色 trumpSuit」与「级牌 level」，把每张牌映射到：
 *   group : 'T'（主牌组）或 'S'/'H'/'C'/'D'（副牌组）
 *   value : 该组阶梯上的序号（越大越大）
 *
 * 主牌组阶梯（trumpSuit = ♠, level = 5 为例）：
 *   ♠2 ♠3 ♠4 ♠6 … ♠A  <  副级牌(♥5/♣5/♦5)  <  主级牌(♠5)  <  小王  <  大王
 * 副牌组阶梯（如 ♥）：
 *   ♥2 ♥3 ♥4 ♥6 … ♥A     （级牌被抽走，所以 ♥4 与 ♥6 相邻 → 可组拖拉机）
 *
 * 无主(NT) 时主牌组只有：级牌(四色等值) < 小王 < 大王
 */
export function createOrder(trumpSuit, level) {
  const plain = RANKS.filter((r) => r !== level);
  const ladders = {};
  for (const s of SUITS) if (s !== trumpSuit) ladders[s] = plain.map((r) => s + r);

  const t = [];
  if (trumpSuit !== NT) for (const r of plain) t.push(trumpSuit + r);
  t.push('#off');                       // 副级牌（四色等值，同色才成对）
  if (trumpSuit !== NT) t.push('#main'); // 主级牌
  t.push('#sj', '#bj');
  ladders[TRUMP] = t;

  const idx = {};
  for (const g of Object.keys(ladders)) idx[g] = new Map(ladders[g].map((k, i) => [k, i]));

  function groupOf(c) {
    if (c.s === JOKER_SUIT) return TRUMP;
    if (c.r === level) return TRUMP;
    if (c.s === trumpSuit) return TRUMP;
    return c.s;
  }
  function keyOf(c) {
    if (c.r === JOKER_BIG) return '#bj';
    if (c.r === JOKER_SMALL) return '#sj';
    if (c.r === level) return c.s === trumpSuit ? '#main' : '#off';
    return c.s + c.r;
  }
  function valueOf(c) {
    const g = groupOf(c);
    const v = idx[g] && idx[g].get(keyOf(c));
    return v === undefined ? -1 : v;
  }
  const isTrump = (c) => groupOf(c) === TRUMP;

  /** 展示排序：主牌在最左，其余按花色，组内从大到小 */
  const groupRank = { T: 0, S: 1, H: 2, C: 3, D: 4 };
  function sortHand(cards) {
    return cards.slice().sort((a, b) => {
      const ga = groupOf(a), gb = groupOf(b);
      if (ga !== gb) return groupRank[ga] - groupRank[gb];
      const d = valueOf(b) - valueOf(a);
      if (d !== 0) return d;
      return a.s === b.s ? 0 : a.s < b.s ? -1 : 1;
    });
  }

  return {
    trumpSuit, level, ladders,
    groupOf, keyOf, valueOf, isTrump, sortHand,
    groupLabel: (g) => GROUP_LABEL[g] || g,
    ladderSize: (g) => (ladders[g] ? ladders[g].length : 0),
  };
}

// ─────────────── 亮主 ───────────────
/**
 * 亮主强度：
 *   1 = 单张级牌（定该花色为主）
 *   2 = 对级牌
 *   3 = 一对小王（无主）
 *   4 = 一对大王（无主）
 * 后手必须严格大于当前强度；本人可"加固"（同花色升级强度）。
 */
export function parseDeclare(cards, level) {
  if (!cards || cards.length === 0) return null;
  const [a] = cards;
  if (cards.length === 1) {
    if (a.s === JOKER_SUIT || a.r !== level) return null;
    return { suit: a.s, strength: 1, kind: 'single' };
  }
  if (cards.length === 2) {
    const [x, y] = cards;
    if (x.s !== y.s || x.r !== y.r) return null;
    if (x.s === JOKER_SUIT) {
      return { suit: NT, strength: x.r === JOKER_BIG ? 4 : 3, kind: x.r === JOKER_BIG ? 'bigJokerPair' : 'smallJokerPair' };
    }
    if (x.r !== level) return null;
    return { suit: x.s, strength: 2, kind: 'pair' };
  }
  return null;
}

export function canOverride(current, next, sameSeat) {
  if (!current) return true;
  if (sameSeat) return next.suit === current.suit && next.strength > current.strength;
  return next.strength > current.strength;
}

// ─────────────── 升级 / 结算 ───────────────
export const LEVELS = RANKS;

export function levelIndex(l) { return LEVELS.indexOf(l); }
export function bumpLevel(l, up, cap = 'A') {
  const i = Math.min(levelIndex(l) + up, levelIndex(cap));
  return LEVELS[i];
}

/**
 * 结算：
 *   单位分 U = 20 × 牌副数（2 副 → 40，3 副 → 60）
 *   闲家总分 p：
 *     p = 0            → 庄家升 3 级
 *     0 < p < U        → 庄家升 2 级
 *     U ≤ p < 2U       → 庄家升 1 级
 *     2U ≤ p < 3U      → 庄家下台，双方不升级
 *     p ≥ 3U           → 庄家下台，闲家升 floor((p-2U)/U) 级
 */
export function settleHand({ decks, defenderPoints, kittyPoints, lastTrickByDefenders, kittyFactor }) {
  const U = 20 * decks;
  const bonus = lastTrickByDefenders ? kittyPoints * kittyFactor : 0;
  const p = defenderPoints + bonus;
  let bankerUp = 0, defenderUp = 0, bankerKeeps = true;
  if (p === 0) bankerUp = 3;
  else if (p < U) bankerUp = 2;
  else if (p < 2 * U) bankerUp = 1;
  else if (p < 3 * U) { bankerKeeps = false; }
  else { bankerKeeps = false; defenderUp = Math.floor((p - 2 * U) / U); }
  return { unit: U, totalPoints: p, kittyBonus: bonus, bankerUp, defenderUp, bankerKeeps };
}

/** 底牌翻倍系数：2 × 最后一墩获胜牌型的张数 */
export function kittyFactorOf(winningCardCount, mode = 'byCount') {
  if (mode === 'fixed2') return 2;
  return 2 * Math.max(1, winningCardCount);
}

/** 该模式下的满分（用于进度条） */
export function totalPointsOf(decks) { return 100 * decks; }
