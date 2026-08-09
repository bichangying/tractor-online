import { SUITS, RANKS, JOKER_SUIT, JOKER_SMALL, JOKER_BIG } from './constants.js';

/**
 * 牌对象：{ id, s(花色), r(点数), d(第几副) }
 * id 形如 "SA#0" / "H10#1" / "Tbj#2"，全局唯一，网络传输只传 id。
 */
export function makeCard(suit, rank, deckIndex) {
  return { id: `${suit}${rank}#${deckIndex}`, s: suit, r: rank, d: deckIndex };
}

export function buildDeck(deckCount) {
  const cards = [];
  for (let d = 0; d < deckCount; d++) {
    for (const s of SUITS) for (const r of RANKS) cards.push(makeCard(s, r, d));
    cards.push(makeCard(JOKER_SUIT, JOKER_SMALL, d));
    cards.push(makeCard(JOKER_SUIT, JOKER_BIG, d));
  }
  return cards;
}

/** 同"面"判定用的 key（花色+点数），对子必须同面 */
export function faceOf(c) { return c.s + c.r; }

export function isJoker(c) { return c.s === JOKER_SUIT; }

/** 分值：5 = 5 分，10 / K = 10 分 */
export function pointsOf(c) {
  if (c.r === '5') return 5;
  if (c.r === '10' || c.r === 'K') return 10;
  return 0;
}

export function sumPoints(cards) {
  let n = 0;
  for (const c of cards) n += pointsOf(c);
  return n;
}

/** 可复现随机数（回放需要同一 seed 复原发牌） */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle(arr, rnd = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 把 id 数组还原成牌对象数组（从给定牌堆里找） */
export function pickByIds(pool, ids) {
  const map = new Map(pool.map((c) => [c.id, c]));
  const out = [];
  for (const id of ids) {
    const c = map.get(id);
    if (!c) return null;
    out.push(c);
    map.delete(id); // 防止同一 id 重复使用
  }
  return out;
}

export function cardLabel(c) {
  if (c.r === JOKER_BIG) return '大王';
  if (c.r === JOKER_SMALL) return '小王';
  return `${c.s}${c.r}`;
}
