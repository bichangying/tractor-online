/**
 * 无头压力测试：让 AI 自己打完整局，验证状态机不会卡死 / 出非法牌。
 * 用法：node test/simulate.js [mode=4|5|6] [hands=3]
 */
import { GameEngine } from '../server/core/GameEngine.js';
import { AIPlayer } from '../server/ai/AIPlayer.js';
import { PHASE, GEV } from '../shared/constants.js';

const mode = Number(process.argv[2] || 4);
const maxHands = Number(process.argv[3] || 2);

const seats = Array.from({ length: mode }, (_, i) => ({ seat: i, playerId: `b${i}`, name: `BOT${i}`, bot: true }));
const engine = new GameEngine({
  mode,
  options: { dealIntervalMs: 0, declareGraceMs: 5, playTimeoutMs: 999999, buryTimeoutMs: 999999, botDelayMin: 0, botDelayMax: 0 },
  seats, matchId: 'sim',
});
const ai = new AIPlayer();

let illegal = 0, plays = 0, hands = 0, ticks = 0;
const declared = new Set();

function actorSeat() {
  const s = engine.state;
  if (s.phase === PHASE.BURY || s.phase === PHASE.CALL_FRIEND) return s.bankerSeat;
  if (s.phase === PHASE.PLAYING) return s.currentSeat;
  return null;
}

function step() {
  if (++ticks > 400000) { console.error('❌ 死循环保护触发'); process.exit(1); }
  const s = engine.state;
  if (s.phase === PHASE.DEALING) {
    if (s.dealIdx >= s.deck.length) {
      for (let i = 0; i < mode; i++) {
        if (declared.has(i)) continue;
        declared.add(i);
        const d = ai.decide(engine, i);
        if (d?.action === 'declare') engine.declare(i, d.payload);
      }
    }
    return;
  }
  const seat = actorSeat();
  if (seat == null) return;
  const d = ai.decide(engine, seat);
  if (!d) return;
  const r = engine.applyLike ? null : null;
  let res;
  if (d.action === 'declare') res = engine.declare(seat, d.payload);
  else if (d.action === 'bury') res = engine.bury(seat, d.payload);
  else if (d.action === 'callFriend') res = engine.callFriend(seat, d.payload);
  else if (d.action === 'play') { res = engine.play(seat, d.payload); plays++; }
  if (res && !res.ok) {
    illegal++;
    if (process.env.DEBUG_SIM) {
      console.error('  ✗', s.phase, d.action, res.code, res.msg, '| payload', d.payload,
        '| handIds', engine.state.hands[seat].map((c) => c.id).join(','));
    }
    if (d.action !== 'play') { console.error('❌ 非出牌动作失败', d.action, res); process.exit(1); }
    const hand = engine.state.hands[seat];
    const need = engine.state.trick?.leadCombo?.size || 1;
    let fixed = false;
    for (let i = 0; i + need <= hand.length && !fixed; i++) {
      fixed = engine.play(seat, hand.slice(i, i + need).map((c) => c.id)).ok;
    }
    if (!fixed) { console.error('❌ 无法自救', res, 'seat', seat); process.exit(1); }
  }
}

engine.on('event', (type, payload) => {
  if (type === GEV.SETTLE) {
    hands++;
    console.log(`  局 ${payload.handNo}: 闲家 ${payload.totalPoints} 分 (底 ${payload.kittyPoints}×${payload.kittyFactor}) → ` +
      (payload.bankerKeeps ? `庄家 +${payload.bankerUp}` : `闲家上台 +${payload.defenderUp}`) +
      `  级别 ${JSON.stringify(payload.levels)}`);
    if (hands >= maxHands) {
      console.log(`\n✅ ${mode} 人模式通过：${plays} 次出牌，${illegal} 次 AI 决策被拒（已自动纠正）`);
      engine.destroy();
      process.exit(0);
    }
  }
});

const loop = setInterval(step, 0);
engine.startMatch();
console.log(`▶ 模拟 ${mode} 人局（${engine.cfg.decks} 副牌，每人 ${engine.cfg.hand} 张，底牌 ${engine.cfg.kitty} 张）…`);
setTimeout(() => { console.error('❌ 超时未打完'); process.exit(1); }, 60000);
