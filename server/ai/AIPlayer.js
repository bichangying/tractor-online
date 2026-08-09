import { PHASE, TRUMP } from '../../shared/constants.js';
import { chooseLead, chooseFollow, chooseDeclare, chooseBury, chooseFriend } from './strategy.js';
import { createLogger } from '../util/logger.js';

const log = createLogger('ai');

const BOT_NAMES = ['小明', '阿强', '老王', '小芳', '大刘', '阿珍', '老李', '小美', '阿豪', '钱多多'];
let botSeq = 0;
export function nextBotName() { return `${BOT_NAMES[botSeq++ % BOT_NAMES.length]}·AI`; }

/**
 * AI / 托管决策器。
 * 只依赖 GameEngine 暴露的 order + hand + state，不直接改状态。
 * 未来接入更强的 AI（MCTS / 神经网络）只需替换 decide()。
 */
export class AIPlayer {
  constructor({ seat, level = 'normal' } = {}) {
    this.seat = seat;
    this.level = level;
  }

  /** 返回 { action, payload } | null */
  decide(engine, seat) {
    const s = engine.state;
    const hand = s.hands[seat] || [];
    try {
      switch (s.phase) {
        case PHASE.DEALING: {
          const ids = chooseDeclare(hand, s.level, s.declare, s.dealIdx / Math.max(1, s.deck.length));
          return ids ? { action: 'declare', payload: ids } : null;
        }
        case PHASE.BURY: {
          if (seat !== s.bankerSeat) return null;
          return { action: 'bury', payload: chooseBury(hand, engine.order, engine.cfg.kitty) };
        }
        case PHASE.CALL_FRIEND: {
          if (seat !== s.bankerSeat) return null;
          return { action: 'callFriend', payload: chooseFriend(hand, s.level, s.trumpSuit) };
        }
        case PHASE.PLAYING: {
          if (seat !== s.currentSeat) return null;
          const order = engine.order;
          if (!s.trick || s.trick.plays.length === 0) {
            return { action: 'play', payload: chooseLead(hand, order).map((c) => c.id) };
          }
          const lead = s.trick.leadCombo;
          const bankerSide = engine.bankerSeats();
          let best = s.trick.plays[0];
          for (const p of s.trick.plays) {
            if (p.combo && p.combo.signature === best.combo.signature) {
              // beatsCombo 在 chooseFollow 内再判一次，这里只找当前赢家
            }
          }
          best = s.trick.plays.reduce((acc, p) => {
            if (!acc) return p;
            return (p.combo && p.combo.signature === lead.signature && p.combo.top > acc.combo.top &&
              (p.combo.group === TRUMP || p.combo.group === acc.combo.group)) ? p : acc;
          }, null);
          const sameSide = bankerSide.has(seat) === bankerSide.has(best.seat);
          const cards = chooseFollow({
            hand, lead, plays: s.trick.plays, order,
            isPartnerWinning: sameSide && best.seat !== seat,
            isLast: s.trick.plays.length === engine.N - 1,
          });
          return { action: 'play', payload: cards.map((c) => c.id) };
        }
        default:
          return null;
      }
    } catch (e) {
      log.error('decide failed', e);
      // 兜底：随便出符合张数的牌
      if (s.phase === PHASE.PLAYING && s.trick) {
        const need = s.trick.leadCombo ? s.trick.leadCombo.size : 1;
        return { action: 'play', payload: hand.slice(0, need).map((c) => c.id) };
      }
      return null;
    }
  }
}
