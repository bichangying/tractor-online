import test from 'node:test';
import assert from 'node:assert/strict';

import { makeCard, sumPoints, buildDeck } from '../shared/cards.js';
import { createOrder, parseDeclare, settleHand, bumpLevel } from '../shared/rules.js';
import { comboOf, beatsCombo, validateFollow, throwCheck } from '../shared/combos.js';
import { COMBO, NT, TRUMP } from '../shared/constants.js';
import { MODE_CONFIG } from '../shared/config.js';

const C = (s, r, d = 0) => makeCard(s, r, d);

test('牌副数 / 底牌 / 手牌数自洽', () => {
  for (const [m, cfg] of Object.entries(MODE_CONFIG)) {
    const total = cfg.decks * 54;
    assert.equal(total - cfg.kitty, cfg.hand * cfg.players, `${m} 人模式牌数不匹配`);
    assert.equal(buildDeck(cfg.decks).length, total);
  }
});

test('分值统计：5=5，10/K=10', () => {
  assert.equal(sumPoints([C('S', '5'), C('H', '10'), C('D', 'K'), C('C', 'A')]), 25);
});

test('大小序：王 > 主级牌 > 副级牌 > 主花色', () => {
  const o = createOrder('S', '5');
  const bj = C('T', 'bj'), sj = C('T', 'sj');
  const mainLevel = C('S', '5'), offLevel = C('H', '5'), sa = C('S', 'A');
  assert.equal(o.groupOf(offLevel), TRUMP);
  assert.ok(o.valueOf(bj) > o.valueOf(sj));
  assert.ok(o.valueOf(sj) > o.valueOf(mainLevel));
  assert.ok(o.valueOf(mainLevel) > o.valueOf(offLevel));
  assert.ok(o.valueOf(offLevel) > o.valueOf(sa));
});

test('级牌被抽走后，副牌相邻可组拖拉机', () => {
  const o = createOrder('S', '5');
  const cards = [C('H', '4'), C('H', '4', 1), C('H', '6'), C('H', '6', 1)];
  const c = comboOf(cards, o);
  assert.equal(c.type, COMBO.TRACTOR);
  assert.equal(c.comps[0].len, 2);
});

test('副级牌不同花色不成对，也不成拖拉机', () => {
  const o = createOrder('S', '5');
  const c = comboOf([C('H', '5'), C('D', '5')], o);
  assert.equal(c.type, COMBO.THROW); // 两个单张 → 甩牌
});

test('牌型识别：单张 / 对子 / 连对 / 甩牌', () => {
  const o = createOrder('S', '2');
  assert.equal(comboOf([C('H', 'A')], o).type, COMBO.SINGLE);
  assert.equal(comboOf([C('H', 'A'), C('H', 'A', 1)], o).type, COMBO.PAIR);
  assert.equal(comboOf([C('H', 'K'), C('H', 'K', 1), C('H', 'A'), C('H', 'A', 1)], o).type, COMBO.TRACTOR);
  assert.equal(comboOf([C('H', '3'), C('H', 'A'), C('H', 'A', 1)], o).type, COMBO.THROW);
  assert.equal(comboOf([C('H', '3'), C('D', '3')], o), null); // 跨花色首攻非法
});

test('比大小：同花色比点数，主牌毙副牌，形状不同不能压', () => {
  const o = createOrder('S', '2');
  const lead = comboOf([C('H', 'K'), C('H', 'K', 1)], o);
  assert.ok(beatsCombo(comboOf([C('H', 'A'), C('H', 'A', 1)], o), lead));
  assert.ok(!beatsCombo(comboOf([C('H', 'Q'), C('H', 'Q', 1)], o), lead));
  assert.ok(beatsCombo(comboOf([C('S', '3'), C('S', '3', 1)], o), lead));       // 主牌对毙
  assert.ok(!beatsCombo(comboOf([C('S', '3'), C('S', '4')], o), lead));          // 形状不符
  assert.ok(!beatsCombo(comboOf([C('D', 'A'), C('D', 'A', 1)], o), lead));       // 别的副牌不算
});

test('跟牌：门长必须跟完 + 有对必出对', () => {
  const o = createOrder('S', '2');
  const lead = comboOf([C('H', 'K'), C('H', 'K', 1)], o);
  const hand = [C('H', '7'), C('H', '7', 1), C('H', '9'), C('S', 'A')];

  assert.equal(validateFollow({ hand, played: [C('H', '7'), C('H', '9')], lead, order: o }).ok, false);
  assert.equal(validateFollow({ hand, played: [C('H', '7'), C('H', '7', 1)], lead, order: o }).ok, true);
  // 张数不符
  assert.equal(validateFollow({ hand, played: [C('H', '7')], lead, order: o }).ok, false);
  // 有该门却垫别的花色
  assert.equal(validateFollow({ hand, played: [C('S', 'A'), C('H', '9')], lead, order: o }).ok, false);
});

test('跟牌：无该门花色可任意垫牌 / 用主牌毙', () => {
  const o = createOrder('S', '2');
  const lead = comboOf([C('H', 'K'), C('H', 'K', 1)], o);
  const hand = [C('S', '3'), C('S', '3', 1), C('D', '9')];
  assert.equal(validateFollow({ hand, played: [C('S', '3'), C('S', '3', 1)], lead, order: o }).ok, true);
  assert.equal(validateFollow({ hand, played: [C('S', '3'), C('D', '9')], lead, order: o }).ok, true);
});

test('甩牌：能被别家压住则失败，退化为最小组件', () => {
  const o = createOrder('S', '2');
  const leadCards = [C('H', '9'), C('H', 'A')];
  const others = [[C('H', '10'), C('H', '3')]];       // 有 ♥10 > ♥9
  const r = throwCheck(leadCards, others, o);
  assert.equal(r.ok, false);
  assert.equal(r.forced.length, 1);
  assert.equal(r.forced[0].r, '9');

  const r2 = throwCheck(leadCards, [[C('H', '3'), C('H', '4')]], o);
  assert.equal(r2.ok, true);
});

test('亮主强度：单张 < 对子 < 小王对 < 大王对', () => {
  assert.equal(parseDeclare([C('H', '5')], '5').strength, 1);
  assert.equal(parseDeclare([C('H', '5'), C('H', '5', 1)], '5').strength, 2);
  assert.equal(parseDeclare([C('T', 'sj'), C('T', 'sj', 1)], '5').suit, NT);
  assert.equal(parseDeclare([C('T', 'bj'), C('T', 'bj', 1)], '5').strength, 4);
  assert.equal(parseDeclare([C('H', '6')], '5'), null);
});

test('结算：2 副牌 U=40，80 分上台', () => {
  const base = { decks: 2, kittyPoints: 0, lastTrickByDefenders: false, kittyFactor: 2 };
  assert.equal(settleHand({ ...base, defenderPoints: 0 }).bankerUp, 3);
  assert.equal(settleHand({ ...base, defenderPoints: 35 }).bankerUp, 2);
  assert.equal(settleHand({ ...base, defenderPoints: 40 }).bankerUp, 1);
  assert.equal(settleHand({ ...base, defenderPoints: 80 }).bankerKeeps, false);
  assert.equal(settleHand({ ...base, defenderPoints: 120 }).defenderUp, 1);
  assert.equal(settleHand({ ...base, defenderPoints: 200 }).defenderUp, 3);
});

test('结算：底牌翻倍只在闲家收最后一墩时生效', () => {
  const r = settleHand({ decks: 2, defenderPoints: 40, kittyPoints: 20, lastTrickByDefenders: true, kittyFactor: 4 });
  assert.equal(r.totalPoints, 120);
  const r2 = settleHand({ decks: 2, defenderPoints: 40, kittyPoints: 20, lastTrickByDefenders: false, kittyFactor: 4 });
  assert.equal(r2.totalPoints, 40);
});

test('升级封顶在 A', () => {
  assert.equal(bumpLevel('K', 3, 'A'), 'A');
  assert.equal(bumpLevel('2', 2, 'A'), '4');
});
