import { h, clear } from '../util/dom.js';
import { cardEl, backRow, suitSpan } from './cardView.js';
import { seatLayout } from './layout.js';
import { PHASE, NT, TEAM, SUIT_NAME } from '/shared/constants.js';
import { createOrder } from '/shared/rules.js';

const PHASE_TEXT = {
  WAITING: '等待开始', DEALING: '发牌中', BURY: '庄家扣底',
  CALL_FRIEND: '庄家叫朋友', PLAYING: '出牌中', SETTLE: '本局结算', FINISHED: '整场结束',
};

/**
 * 牌桌渲染器：对局界面 & 回放界面共用。
 * update(ctx) 里的 ctx：
 *   { game, seats, mySeat, selected:Set, interactive, onCardClick, hand }
 */
export class TableView {
  constructor({ interactive = true } = {}) {
    this.interactive = interactive;
    this.root = h('div.game-main');
    this.hud = h('div.hud');
    this.table = h('div.table');
    this.wrap = h('div.table-wrap', {}, this.table);
    this.handEl = h('div.hand');
    this.handScroll = h('div.hand-scroll', {}, this.handEl);
    this.actions = h('div.actions');
    this.handArea = h('div.hand-area', {}, this.handScroll, this.actions);
    this.root.append(this.hud, this.wrap);
    if (interactive) this.root.append(this.handArea);
    this._timer = setInterval(() => this.paintTimer(), 250);
    this.ctx = null;
  }

  destroy() { clearInterval(this._timer); }

  mount(parent) { parent.append(this.root); return this; }

  update(ctx) {
    this.ctx = ctx;
    this.paintHud(ctx);
    this.paintTable(ctx);
    if (this.interactive) this.paintHand(ctx);
  }

  // ───────────── HUD ─────────────
  paintHud({ game, seats, mySeat }) {
    const el = clear(this.hud);
    if (!game) {
      el.append(h('div.chip', {}, '等待开局…'));
      return;
    }
    const pct = Math.min(100, (game.defenderPoints / (game.maxPoints || 200)) * 100);
    const unit = 20 * (game.config?.decks || 2);
    el.append(
      h('div.chip', {}, '第 ', h('b', {}, String(game.handNo || 1)), ' 局'),
      h('div.chip', {}, '级牌 ', h('b', {}, game.level || '2')),
      h('div.chip', {}, '主牌 ', suitSpan(game.trumpSuit)),
      h('div.chip', {}, '庄家 ', h('b', {}, seatName(seats, game.bankerSeat))),
      h('div.chip', {},
        '闲家 ', h('b', {}, String(game.defenderPoints)), ` / ${2 * unit}`,
        h('div.score-bar', {}, h('i', { style: { width: `${pct}%` } }),
          h('div.mark', { style: { left: `${(2 * unit / game.maxPoints) * 100}%` } }))),
      h('div.chip', {}, PHASE_TEXT[game.phase] || game.phase),
      game.friendSpec ? h('div.chip', {}, '朋友 ',
        h('b', {}, `${SUIT_NAME[game.friendSpec.suit]}${game.friendSpec.rank}·第${game.friendSpec.nth}张`)) : null,
      h('div.spacer'),
      h('div.chip.small', {}, `${game.mode} 人 · ${game.config?.decks || 2} 副`),
    );
  }

  // ───────────── 桌面 ─────────────
  paintTable(ctx) {
    const { game, seats, mySeat } = ctx;
    const el = clear(this.table);
    const n = seats.length;
    const layout = seatLayout(n, mySeat);
    this.layout = layout;

    // 底牌堆
    if (game) {
      el.append(h('div.kitty-pile', {},
        backRow(Math.min(game.kittyCount || 0, 6), 'xs'),
        h('span.tag', {}, `底牌 ${game.kittyCount || 0}`)));
    }

    // 中央信息
    el.append(h('div.center-info', {},
      h('div.big', {}, game ? (game.trumpSuit === NT ? '无主' : (game.trumpSuit ? SUIT_NAME[game.trumpSuit] : '—')) : '拖拉机'),
      h('div.sub', {}, game
        ? (game.phase === PHASE.DEALING ? `发牌 ${game.dealt}/${game.dealTotal}` : `第 ${game.trickNo || 0} 墩`)
        : `${n} 人桌`)));

    // 座位 + 出牌区
    const winner = game?.lastTrick && game?.trick && game.trick.plays.length === 0 ? game.lastTrick.winnerSeat : null;
    for (const L of layout) {
      const p = seats[L.seat] || { seat: L.seat, empty: true };
      el.append(this.seatNode(p, L, ctx));
      const plays = game?.trick?.plays?.find((x) => x.seat === L.seat);
      const showLast = !plays && game?.lastTrick && game.trick && game.trick.plays.length === 0
        ? game.lastTrick.plays.find((x) => x.seat === L.seat) : null;
      const cards = (plays || showLast)?.cards || [];
      if (cards.length) {
        el.append(h('div', {
          class: `played ${winner === L.seat ? 'win-mark' : ''}`,
          style: { left: `${L.playPos.x}%`, top: `${L.playPos.y}%` },
        }, h('div.card-row.sm', {}, cards.map((c) => cardEl(c, { size: 'sm' })))));
      }
    }

    // 结算浮层
    if (game && (game.phase === PHASE.SETTLE || game.phase === PHASE.FINISHED) && game.settle) {
      el.append(this.settleNode(game, seats));
    }
  }

  seatNode(p, L, { game, seats, mySeat }) {
    const isTurn = game && game.currentSeat === L.seat && [PHASE.PLAYING].includes(game.phase);
    const isActor = game && game.phase === PHASE.BURY && game.bankerSeat === L.seat;
    const team = game?.teams?.[L.seat];
    const teamCls = game && game.config?.teamMode === 'FIXED' ? (L.seat % 2 === 0 ? 'team-A' : 'team-B') : '';
    const node = h('div', {
      class: ['seat', p.empty ? 'empty-seat' : '', (isTurn || isActor) ? 'turn' : '',
        p.connected === false ? 'offline' : '', teamCls].filter(Boolean).join(' '),
      style: { left: `${L.seatPos.x}%`, top: `${L.seatPos.y}%` },
      dataset: { seat: L.seat },
    });

    const av = h('div.avatar', {}, p.empty ? '＋' : (p.bot ? '🤖' : '🙂'));
    if (game && game.bankerSeat === L.seat) av.append(h('div.badge-banker', {}, '庄'));
    node.append(av);
    node.append(h('div.nm', {}, p.empty ? `座位 ${L.seat + 1}` : p.name));

    const meta = h('div.meta');
    if (!p.empty) {
      if (game) meta.append(h('div.cnt', {}, '🂠 ', String(game.handCounts?.[L.seat] ?? 0)));
      if (p.bot) meta.append(h('span.tag', {}, 'AI'));
      if (p.connected === false) meta.append(h('span.tag.red', {}, '托管'));
      if (!game && p.ready) meta.append(h('span.tag.blue', {}, '已准备'));
      if (game && game.friendSeat === L.seat) meta.append(h('span.tag.gold', {}, '朋友'));
      if (game && team === TEAM.DEFENDER && game.config?.teamMode !== 'FIXED') meta.append(h('span.tag', {}, '闲'));
    }
    node.append(meta);
    node.append(h('div.timer', {}, h('i', { style: { width: '0%' } })));
    return node;
  }

  settleNode(game, seats) {
    const s = game.settle;
    const kv = (k, v) => h('div.kv', {}, h('span', {}, k), h('b', {}, v));
    const win = s.bankerKeeps ? '庄家守擂成功' : '闲家上台！';
    return h('div.settle-mask', {}, h('div.settle', {},
      h('h3', {}, `第 ${s.handNo} 局结算 · ${win}`),
      h('div.muted.small', {}, `主牌 ${s.trumpSuit === NT ? '无主' : SUIT_NAME[s.trumpSuit] || '-'} · 级牌 ${s.level}`),
      h('div', { style: { marginTop: '10px' } },
        kv('闲家吃分', `${s.defenderPoints} 分`),
        kv('底牌分', `${s.kittyPoints} 分 ${s.lastTrickByDefenders ? `× ${s.kittyFactor} = ${s.kittyBonus}` : '（庄家守住底牌）'}`),
        kv('合计', `${s.totalPoints} / ${s.maxPoints}（一台 = ${s.unit} 分）`),
        kv('升级', s.bankerUp > 0 ? `庄家方 +${s.bankerUp} 级` : (s.defenderUp > 0 ? `闲家方 +${s.defenderUp} 级` : '双方不升级')),
        kv('下局庄家', seatName(seats, s.nextBankerSeat)),
        kv('当前级别', Object.entries(s.levels).map(([k, v]) => `${k}:${v}`).join('   ')),
      ),
      h('div.muted.small', { style: { marginTop: '10px' } }, '底牌：'),
      h('div.card-row.sm.kitty-cards', {}, (s.kitty || []).map((c) => cardEl(c, { size: 'sm' }))),
      game.phase === PHASE.FINISHED
        ? h('div.tag.gold', { style: { marginTop: '12px', display: 'inline-block' } }, `🏆 ${game.winnerTeam} 队获胜`)
        : h('div.muted.small', { style: { marginTop: '12px' } }, '9 秒后自动开始下一局…'),
    ));
  }

  // ───────────── 手牌 ─────────────
  paintHand({ game, hand, selected, onCardClick }) {
    const el = clear(this.handEl);
    if (!hand || !hand.length) {
      el.append(h('div.muted.small', {}, game ? '手牌已出完' : '尚未开局'));
      return;
    }
    const order = createOrder(game?.trumpSuit || NT, game?.level || '2');
    const sorted = order.sortHand(hand);
    let lastGroup = null;
    for (const c of sorted) {
      const g = order.groupOf(c);
      const node = cardEl(c, {
        picked: selected?.has(c.id),
        pickable: !!onCardClick,
        onclick: onCardClick,
      });
      if (lastGroup !== null && g !== lastGroup) node.classList.add('group-gap');
      lastGroup = g;
      el.append(node);
    }
  }

  paintTimer() {
    const g = this.ctx?.game;
    if (!g || !g.deadline) return;
    const seat = g.phase === 'PLAYING' ? g.currentSeat
      : (g.phase === 'BURY' || g.phase === 'CALL_FRIEND') ? g.bankerSeat : null;
    for (const node of this.table.querySelectorAll('.seat')) {
      const bar = node.querySelector('.timer i');
      if (!bar) continue;
      if (Number(node.dataset.seat) !== seat) { bar.style.width = '0%'; continue; }
      const total = g.phase === 'PLAYING' ? 30000 : 60000;
      const left = Math.max(0, g.deadline - Date.now());
      bar.style.width = `${Math.min(100, (left / total) * 100)}%`;
    }
  }
}

export function seatName(seats, seat) {
  if (seat == null || !seats?.[seat]) return '—';
  return seats[seat].name || `座位${seat + 1}`;
}
