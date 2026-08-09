import { EventEmitter } from 'node:events';
import { PHASE, GEV, ERR, NT, TRUMP, COMBO, TEAM } from '../../shared/constants.js';
import { MODE_CONFIG, normalizeOptions } from '../../shared/config.js';
import { buildDeck, shuffle, mulberry32, sumPoints, pickByIds, faceOf } from '../../shared/cards.js';
import { createOrder, parseDeclare, canOverride, settleHand, kittyFactorOf, bumpLevel, levelIndex, totalPointsOf } from '../../shared/rules.js';
import { comboOf, beatsCombo, validateFollow, throwCheck } from '../../shared/combos.js';

const ok = (data = {}) => ({ ok: true, ...data });
const err = (code, msg) => ({ ok: false, code, msg });

/**
 * ─────────────────── 棋牌游戏状态机 ───────────────────
 *
 *   WAITING ──start──► DEALING ──发完+宽限──► BURY ──扣底──► [CALL_FRIEND] ──► PLAYING
 *                                                                                │
 *                        FINISHED ◄──打到A── SETTLE ◄────────手牌出完─────────────┘
 *                                              │
 *                                              └──nextHand──► DEALING
 *
 * 引擎本身不认识 socket，只对外 emit 事件，由 Room 负责广播与持久化。
 * 事件：
 *   'event'   (type, payload)      公开事件（进入回放 & 广播）
 *   'private' (seat, type, payload) 单人可见（如摸到的牌、底牌）
 *   'state'   ()                   请求 Room 重新推送快照
 *   'autoplay'(seat)               该座位超时/托管，需要外部代打
 */
export class GameEngine extends EventEmitter {
  constructor({ mode, options, seats, levels, bankerSeat = null, seed, matchId }) {
    super();
    this.mode = mode;
    this.cfg = MODE_CONFIG[mode];
    this.opt = normalizeOptions(options);
    this.seats = seats;                     // [{playerId, name, bot}] 长度 = cfg.players
    this.matchId = matchId;
    this.seed = seed ?? ((Date.now() ^ Math.floor(Math.random() * 1e9)) >>> 0);
    this.rng = mulberry32(this.seed);
    this.handNo = 0;
    this.levels = levels || this.initLevels();
    this.bankerSeat = bankerSeat;
    this.timers = {};
    this.state = this.emptyState();
  }

  // ─────────── 基础 ───────────
  get N() { return this.cfg.players; }

  initLevels() {
    const l = {};
    if (this.cfg.teamMode === 'CALL_FRIEND') {
      for (let i = 0; i < this.cfg.players; i++) l[`p${i}`] = this.opt.startLevel;
    } else {
      l.A = this.opt.startLevel;
      l.B = this.opt.startLevel;
    }
    return l;
  }

  teamKeyOf(seat) {
    return this.cfg.teamMode === 'CALL_FRIEND' ? `p${seat}` : (seat % 2 === 0 ? 'A' : 'B');
  }

  /** 当前庄家阵营座位集合 */
  bankerSeats() {
    const s = this.state;
    if (this.cfg.teamMode === 'CALL_FRIEND') {
      const set = new Set([s.bankerSeat]);
      if (s.friendSeat != null) set.add(s.friendSeat);
      return set;
    }
    const set = new Set();
    for (let i = 0; i < this.N; i++) if (i % 2 === s.bankerSeat % 2) set.add(i);
    return set;
  }

  teamOf(seat) { return this.bankerSeats().has(seat) ? TEAM.BANKER : TEAM.DEFENDER; }

  emptyState() {
    return {
      phase: PHASE.WAITING,
      handNo: 0,
      level: this.opt.startLevel,
      trumpSuit: null,
      bankerSeat: this.bankerSeat,
      declarer: null,
      declare: null,          // {seat, suit, strength, cards}
      hands: [],
      kitty: [],
      kittyOwner: null,
      deck: [],
      dealIdx: 0,
      currentSeat: null,
      trick: null,            // {leadSeat, leadCombo, plays:[{seat,cards,combo}]}
      tricks: [],
      defenderPoints: 0,
      collected: [],          // 闲家吃到的分牌
      friendSpec: null,
      friendSeat: null,
      friendHits: 0,
      deadline: 0,
      settle: null,
      winnerTeam: null,
    };
  }

  clearTimers() {
    for (const k of Object.keys(this.timers)) clearTimeout(this.timers[k]);
    for (const k of Object.keys(this.timers)) clearInterval(this.timers[k]);
    this.timers = {};
  }

  destroy() { this.clearTimers(); this.removeAllListeners(); }

  pub(type, payload = {}) { this.emit('event', type, payload); }
  priv(seat, type, payload = {}) { this.emit('private', seat, type, payload); }
  sync() { this.emit('state'); }

  setPhase(p, extra = {}) {
    this.state.phase = p;
    this.pub(GEV.PHASE, { phase: p, ...extra });
    this.sync();
  }

  // ─────────────────── 开局 / 发牌 ───────────────────
  startMatch() {
    this.handNo = 0;
    this.nextHand(true);
  }

  nextHand(first = false) {
    this.clearTimers();
    const prev = this.state;
    const s = this.emptyState();
    s.handNo = ++this.handNo;
    s.bankerSeat = first ? this.bankerSeat : prev.nextBankerSeat ?? this.bankerSeat;
    if (s.bankerSeat == null && !first) s.bankerSeat = 0;
    s.level = s.bankerSeat == null ? this.opt.startLevel : this.levels[this.teamKeyOf(s.bankerSeat)];
    this.state = s;

    const deck = shuffle(buildDeck(this.cfg.decks), this.rng);
    s.kitty = deck.slice(deck.length - this.cfg.kitty);
    s.deck = deck.slice(0, deck.length - this.cfg.kitty);
    s.hands = Array.from({ length: this.N }, () => []);
    s.dealIdx = 0;

    this.setPhase(PHASE.DEALING, { handNo: s.handNo, level: s.level, bankerSeat: s.bankerSeat });
    this.startDealLoop();
  }

  startDealLoop() {
    const s = this.state;
    const start = s.bankerSeat ?? 0;
    const step = () => {
      if (s.phase !== PHASE.DEALING) return;
      if (s.dealIdx >= s.deck.length) return this.finishDealing();
      const seat = (start + s.dealIdx) % this.N;
      const card = s.deck[s.dealIdx++];
      s.hands[seat].push(card);
      this.priv(seat, 'card', { card });
      this.pub(GEV.DEAL_TICK, { seat, dealt: s.dealIdx, total: s.deck.length });
      this.timers.deal = setTimeout(step, this.opt.dealIntervalMs);
    };
    this.timers.deal = setTimeout(step, 300);
  }

  finishDealing() {
    const s = this.state;
    s.deadline = Date.now() + this.opt.declareGraceMs;
    this.pub(GEV.PHASE, { phase: PHASE.DEALING, dealDone: true, deadline: s.deadline });
    this.sync();
    this.timers.grace = setTimeout(() => this.lockTrump(), this.opt.declareGraceMs);
  }

  /** 亮主 / 反主 / 加固 */
  declare(seat, cardIds) {
    const s = this.state;
    if (s.phase !== PHASE.DEALING) return err(ERR.BAD_PHASE, '现在不能亮主');
    const cards = pickByIds(s.hands[seat], cardIds);
    if (!cards) return err(ERR.CARD_NOT_IN_HAND, '牌不在手上');
    const d = parseDeclare(cards, s.level);
    if (!d) return err(ERR.BAD_DECLARE, '不是合法的亮主牌型');
    if (!canOverride(s.declare, d, s.declare && s.declare.seat === seat)) {
      return err(ERR.WEAK_DECLARE, '亮主强度不够');
    }
    s.declare = { seat, suit: d.suit, strength: d.strength, kind: d.kind, cards };
    s.declarer = seat;
    s.trumpSuit = d.suit;
    this.pub(GEV.DECLARE, { seat, suit: d.suit, strength: d.strength, kind: d.kind, cards });
    // 发牌已结束时，亮主后重置宽限窗口，给别人反主机会
    if (s.dealIdx >= s.deck.length) {
      clearTimeout(this.timers.grace);
      s.deadline = Date.now() + this.opt.declareGraceMs;
      this.timers.grace = setTimeout(() => this.lockTrump(), this.opt.declareGraceMs);
    }
    this.sync();
    return ok();
  }

  lockTrump() {
    const s = this.state;
    if (s.phase !== PHASE.DEALING) return;
    clearTimeout(this.timers.grace);

    if (!s.declare) {
      // 无人亮主：翻底定主（取第一张非王底牌），首局庄家默认 0 号位
      const flip = s.kitty.find((c) => c.s !== 'T');
      s.trumpSuit = flip ? flip.s : NT;
      this.pub(GEV.TRUMP_LOCKED, { trumpSuit: s.trumpSuit, byFlip: true, flip: flip || null });
    } else {
      this.pub(GEV.TRUMP_LOCKED, { trumpSuit: s.trumpSuit, seat: s.declare.seat });
    }
    if (s.bankerSeat == null) s.bankerSeat = s.declarer ?? 0;

    this.order = createOrder(s.trumpSuit, s.level);
    // 底牌进庄家手
    s.hands[s.bankerSeat] = s.hands[s.bankerSeat].concat(s.kitty);
    s.kittyOwner = s.bankerSeat;
    this.priv(s.bankerSeat, 'kitty', { cards: s.kitty });
    this.pub(GEV.KITTY_TAKEN, { seat: s.bankerSeat, count: s.kitty.length });
    s.kitty = [];
    s.deadline = Date.now() + this.opt.buryTimeoutMs;
    this.setPhase(PHASE.BURY, { bankerSeat: s.bankerSeat, deadline: s.deadline });
    this.armTimeout(s.bankerSeat, this.opt.buryTimeoutMs);
  }

  /** 扣底 */
  bury(seat, cardIds) {
    const s = this.state;
    if (s.phase !== PHASE.BURY) return err(ERR.BAD_PHASE, '现在不能扣底');
    if (seat !== s.bankerSeat) return err(ERR.NOT_BANKER, '只有庄家能扣底');
    if (cardIds.length !== this.cfg.kitty) return err(ERR.BAD_COUNT, `必须扣 ${this.cfg.kitty} 张`);
    const cards = pickByIds(s.hands[seat], cardIds);
    if (!cards) return err(ERR.CARD_NOT_IN_HAND, '牌不在手上');
    const ids = new Set(cards.map((c) => c.id));
    s.hands[seat] = s.hands[seat].filter((c) => !ids.has(c.id));
    s.kitty = cards;
    this.pub(GEV.BURIED, { seat, count: cards.length });
    clearTimeout(this.timers.turn);

    if (this.cfg.teamMode === 'CALL_FRIEND') {
      s.deadline = Date.now() + this.opt.buryTimeoutMs;
      this.setPhase(PHASE.CALL_FRIEND, { deadline: s.deadline });
      this.armTimeout(seat, this.opt.buryTimeoutMs);
    } else {
      this.beginPlaying();
    }
    return ok();
  }

  /** 5 人叫朋友：{ suit, rank, nth } */
  callFriend(seat, spec) {
    const s = this.state;
    if (s.phase !== PHASE.CALL_FRIEND) return err(ERR.BAD_PHASE, '现在不能叫朋友');
    if (seat !== s.bankerSeat) return err(ERR.NOT_BANKER, '只有庄家能叫朋友');
    const nth = Math.max(1, Math.min(this.cfg.decks, Number(spec?.nth) || 1));
    if (!spec || !spec.suit || !spec.rank) return err(ERR.BAD_DECLARE, '朋友牌不合法');
    s.friendSpec = { suit: spec.suit, rank: spec.rank, nth };
    s.friendHits = 0;
    this.pub(GEV.FRIEND_CALLED, { seat, spec: s.friendSpec });
    clearTimeout(this.timers.turn);
    this.beginPlaying();
    return ok();
  }

  beginPlaying() {
    const s = this.state;
    s.currentSeat = s.bankerSeat;
    s.trick = { leadSeat: s.bankerSeat, leadCombo: null, plays: [] };
    this.setPhase(PHASE.PLAYING, { currentSeat: s.currentSeat });
    this.armTurn();
  }

  // ─────────────────── 出牌 ───────────────────
  play(seat, cardIds) {
    const s = this.state;
    if (s.phase !== PHASE.PLAYING) return err(ERR.BAD_PHASE, '现在不能出牌');
    if (seat !== s.currentSeat) return err(ERR.NOT_YOUR_TURN, '还没轮到你');
    if (!s.hands[seat] || s.hands[seat].length === 0) return err(ERR.CARD_NOT_IN_HAND, '手牌已出完');
    let cards = pickByIds(s.hands[seat], cardIds);
    if (!cards || cards.length === 0) return err(ERR.CARD_NOT_IN_HAND, '牌不在手上');

    const isLead = s.trick.plays.length === 0;
    let combo;
    let forcedNote = null;

    if (isLead) {
      combo = comboOf(cards, this.order);
      if (!combo) return err(ERR.MIXED_SUIT, '首攻必须同一门花色');
      if (combo.type === COMBO.THROW) {
        if (!this.opt.allowThrow) return err(ERR.MIXED_SUIT, '本房间禁止甩牌');
        const others = s.hands.filter((_, i) => i !== seat);
        const chk = throwCheck(cards, others, this.order);
        if (!chk.ok) {
          cards = chk.forced;
          combo = comboOf(cards, this.order);
          forcedNote = { reason: 'THROW_FAILED' };
          this.pub(GEV.THROW_FAILED, { seat, forced: cards });
        }
      }
      s.trick.leadCombo = combo;
    } else {
      const v = validateFollow({
        hand: s.hands[seat], played: cards, lead: s.trick.leadCombo,
        order: this.order, strict: this.opt.strictFollow,
      });
      if (!v.ok) return err(v.code, v.msg);
      combo = comboOf(cards, this.order) || { group: null, comps: [], signature: '', size: cards.length, cards, type: 'MIXED' };
    }

    const ids = new Set(cards.map((c) => c.id));
    s.hands[seat] = s.hands[seat].filter((c) => !ids.has(c.id));
    s.trick.plays.push({ seat, cards, combo });
    clearTimeout(this.timers.turn);
    this.pub(GEV.PLAY, { seat, cards, type: combo.type, forced: forcedNote });

    this.checkFriendReveal(seat, cards);

    if (s.trick.plays.length >= this.N) {
      this.resolveTrick();
    } else {
      s.currentSeat = (seat + 1) % this.N;
      this.armTurn();
      this.sync();
    }
    return ok();
  }

  checkFriendReveal(seat, cards) {
    const s = this.state;
    if (!s.friendSpec || s.friendSeat != null) return;
    for (const c of cards) {
      if (c.s === s.friendSpec.suit && c.r === s.friendSpec.rank) {
        s.friendHits++;
        if (s.friendHits >= s.friendSpec.nth && seat !== s.bankerSeat) {
          s.friendSeat = seat;
          this.pub(GEV.FRIEND_REVEALED, { seat, spec: s.friendSpec });
          return;
        }
      }
    }
  }

  resolveTrick() {
    const s = this.state;
    let best = s.trick.plays[0];
    for (let i = 1; i < s.trick.plays.length; i++) {
      const p = s.trick.plays[i];
      if (p.combo && beatsCombo(p.combo, best.combo)) best = p;
    }
    const all = s.trick.plays.flatMap((p) => p.cards);
    const pts = sumPoints(all);
    const winnerSeat = best.seat;
    const bankerSide = this.bankerSeats().has(winnerSeat);
    if (!bankerSide && pts > 0) {
      s.defenderPoints += pts;
      s.collected.push(...all.filter((c) => c.r === '5' || c.r === '10' || c.r === 'K'));
    }
    const trick = {
      no: s.tricks.length + 1,
      leadSeat: s.trick.leadSeat,
      plays: s.trick.plays.map((p) => ({ seat: p.seat, cards: p.cards })),
      winnerSeat, points: pts, byDefenders: !bankerSide,
      winningCards: best.cards,
    };
    s.tricks.push(trick);
    this.pub(GEV.TRICK_END, {
      winnerSeat, points: pts, byDefenders: !bankerSide,
      defenderPoints: s.defenderPoints, trickNo: trick.no,
    });

    const done = s.hands.every((h) => h.length === 0);
    if (done) {
      s.currentSeat = null;
      s.trick = { leadSeat: s.trick.leadSeat, leadCombo: null, plays: [] };
      clearTimeout(this.timers.turn);
      this.timers.settle = setTimeout(() => this.settle(trick), 1200);
    } else {
      s.currentSeat = winnerSeat;
      s.trick = { leadSeat: winnerSeat, leadCombo: null, plays: [] };
      this.timers.next = setTimeout(() => { this.armTurn(); this.sync(); }, 1100);
    }
    this.sync();
  }

  // ─────────────────── 结算 ───────────────────
  settle(lastTrick) {
    const s = this.state;
    const kittyPoints = sumPoints(s.kitty);
    const byDef = lastTrick.byDefenders;
    const factor = kittyFactorOf(lastTrick.winningCards.length, this.opt.kittyMultiplier);
    const r = settleHand({
      decks: this.cfg.decks,
      defenderPoints: s.defenderPoints,
      kittyPoints, lastTrickByDefenders: byDef, kittyFactor: factor,
    });

    const bankerTeamSeats = [...this.bankerSeats()];
    const defenderSeats = [];
    for (let i = 0; i < this.N; i++) if (!this.bankerSeats().has(i)) defenderSeats.push(i);

    const upSeats = r.bankerUp > 0 ? bankerTeamSeats : (r.defenderUp > 0 ? defenderSeats : []);
    const upBy = r.bankerUp > 0 ? r.bankerUp : r.defenderUp;
    const touched = new Set();
    for (const seat of upSeats) {
      const key = this.teamKeyOf(seat);
      if (touched.has(key)) continue;
      touched.add(key);
      this.levels[key] = bumpLevel(this.levels[key], upBy, this.opt.winLevel);
    }

    // 下一局庄家
    let nextBanker;
    if (r.bankerKeeps) {
      nextBanker = this.cfg.teamMode === 'CALL_FRIEND'
        ? s.bankerSeat
        : (s.bankerSeat + 2) % this.N;
    } else {
      nextBanker = (s.bankerSeat + 1) % this.N;
    }
    s.nextBankerSeat = nextBanker;
    this.bankerSeat = nextBanker;

    // 是否整场结束
    // 升到 winLevel 即整场结束
    const capIdx = levelIndex(this.opt.winLevel);
    let finished = null;
    if (upBy > 0) {
      for (const seat of upSeats) {
        const key = this.teamKeyOf(seat);
        if (levelIndex(this.levels[key]) >= capIdx) { finished = key; break; }
      }
    }

    s.settle = {
      handNo: s.handNo, level: s.level, trumpSuit: s.trumpSuit,
      bankerSeat: s.bankerSeat, bankerTeamSeats, defenderSeats,
      defenderPoints: s.defenderPoints, kittyPoints, kittyFactor: factor,
      kittyBonus: r.kittyBonus, totalPoints: r.totalPoints, unit: r.unit,
      maxPoints: totalPointsOf(this.cfg.decks),
      bankerUp: r.bankerUp, defenderUp: r.defenderUp, bankerKeeps: r.bankerKeeps,
      levels: { ...this.levels }, kitty: s.kitty, nextBankerSeat: nextBanker,
      lastTrickByDefenders: byDef,
    };
    this.setPhase(PHASE.SETTLE, {});
    this.pub(GEV.SETTLE, s.settle);

    if (finished) {
      s.winnerTeam = finished;
      this.setPhase(PHASE.FINISHED, {});
      this.pub(GEV.MATCH_END, { winnerTeam: finished, levels: { ...this.levels } });
    } else {
      this.timers.nextHand = setTimeout(() => this.nextHand(false), 9000);
    }
  }

  // ─────────────────── 计时 / 托管 ───────────────────
  armTurn() {
    const s = this.state;
    s.deadline = Date.now() + this.opt.playTimeoutMs;
    this.armTimeout(s.currentSeat, this.opt.playTimeoutMs);
  }

  armTimeout(seat, ms) {
    clearTimeout(this.timers.turn);
    this.timers.turn = setTimeout(() => this.emit('autoplay', seat), ms);
  }

  // ─────────────────── 快照（按视角脱敏） ───────────────────
  snapshotFor(seat, { revealAll = false } = {}) {
    const s = this.state;
    const order = this.order;
    const showKitty = s.phase === PHASE.SETTLE || s.phase === PHASE.FINISHED || revealAll;
    const myHand = seat != null && s.hands[seat]
      ? (order ? order.sortHand(s.hands[seat]) : s.hands[seat])
      : [];
    return {
      matchId: this.matchId,
      mode: this.mode,
      phase: s.phase,
      handNo: s.handNo,
      level: s.level,
      levels: { ...this.levels },
      trumpSuit: s.trumpSuit,
      bankerSeat: s.bankerSeat,
      declarer: s.declarer,
      declare: s.declare ? { seat: s.declare.seat, suit: s.declare.suit, strength: s.declare.strength, cards: s.declare.cards } : null,
      dealt: s.dealIdx,
      dealTotal: s.deck.length,
      handCounts: s.hands.map((h) => h.length),
      myHand,
      allHands: revealAll ? s.hands : null,
      kittyCount: this.cfg.kitty,
      kitty: showKitty ? s.kitty : null,
      currentSeat: s.currentSeat,
      deadline: s.deadline,
      trick: s.trick ? {
        leadSeat: s.trick.leadSeat,
        plays: s.trick.plays.map((p) => ({ seat: p.seat, cards: p.cards, type: p.combo?.type })),
      } : null,
      lastTrick: s.tricks.length ? s.tricks[s.tricks.length - 1] : null,
      trickNo: s.tricks.length,
      defenderPoints: s.defenderPoints,
      maxPoints: totalPointsOf(this.cfg.decks),
      teams: Array.from({ length: this.N }, (_, i) => this.teamOf(i)),
      friendSpec: s.friendSpec,
      friendSeat: s.friendSeat,
      settle: s.settle,
      winnerTeam: s.winnerTeam,
      config: { decks: this.cfg.decks, kitty: this.cfg.kitty, hand: this.cfg.hand, players: this.N, teamMode: this.cfg.teamMode },
      options: { strictFollow: this.opt.strictFollow, allowThrow: this.opt.allowThrow, winLevel: this.opt.winLevel },
    };
  }

  /** 供 AI / 托管使用的完整视角 */
  viewFor(seat) {
    return {
      order: this.order,
      hand: this.state.hands[seat] || [],
      state: this.state,
      engine: this,
    };
  }
}
