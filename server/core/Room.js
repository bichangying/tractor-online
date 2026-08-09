import { EV, GEV, PHASE, ERR } from '../../shared/constants.js';
import { MODE_CONFIG, normalizeOptions } from '../../shared/config.js';
import { GameEngine } from './GameEngine.js';
import { Recorder } from './Recorder.js';
import { AIPlayer, nextBotName } from '../ai/AIPlayer.js';
import { Player } from './Player.js';
import { uid, matchId as newMatchId, randInt } from '../util/id.js';
import { createLogger } from '../util/logger.js';

const log = createLogger('room');
const ok = (d = {}) => ({ ok: true, ...d });
const err = (code, msg) => ({ ok: false, code, msg });

/**
 * 房间 = 座位管理 + 观战席 + 聊天 + 一台 GameEngine + 一个 Recorder
 *
 * Socket.IO 房间键：`r:<roomId>`  （所有成员，含观战）
 * 私密信息不走房间广播，逐 socket 单发。
 */
export class Room {
  constructor({ io, id, name, mode, options, hostId, password = '' }) {
    this.io = io;
    this.id = id;
    this.name = name || `房间 ${id}`;
    this.mode = mode;
    this.cfg = MODE_CONFIG[mode];
    this.options = normalizeOptions(options);
    this.password = password;
    this.hostId = hostId;
    this.createdAt = Date.now();

    this.members = new Map();                       // playerId -> Player
    this.seats = Array(this.cfg.players).fill(null); // seat -> playerId
    this.messages = [];
    this.engine = null;
    this.recorder = null;
    this.ai = new AIPlayer();
    this.botTimers = new Set();
    this._syncPending = false;
  }

  get key() { return `r:${this.id}`; }
  get playing() { return !!this.engine && this.engine.state.phase !== PHASE.WAITING; }
  get seatedCount() { return this.seats.filter(Boolean).length; }
  get humanCount() { return [...this.members.values()].filter((p) => !p.bot).length; }

  brief() {
    return {
      id: this.id, name: this.name, mode: this.mode, label: this.cfg.label,
      seated: this.seatedCount, capacity: this.cfg.players,
      spectators: [...this.members.values()].filter((p) => p.seat < 0 && !p.bot).length,
      playing: this.playing, hasPassword: !!this.password,
      phase: this.engine ? this.engine.state.phase : PHASE.WAITING,
      createdAt: this.createdAt,
    };
  }

  // ─────────────── 成员管理 ───────────────
  join(player, { password } = {}) {
    if (this.password && password !== this.password && !this.members.has(player.id)) {
      return err('BAD_PASSWORD', '房间密码错误');
    }
    if (!this.members.has(player.id)) {
      player.seat = -1;
      player.ready = false;
      this.members.set(player.id, player);
      this.system(`${player.name} 进入房间`);
    }
    player.roomId = this.id;
    this.sync();
    return ok();
  }

  leave(playerId) {
    const p = this.members.get(playerId);
    if (!p) return err(ERR.ROOM_NOT_FOUND, '不在房间中');
    if (p.seat >= 0) {
      if (this.playing) {
        // 对局中离开 → 座位保留为托管（防止牌局崩溃）
        p.connected = false;
        this.system(`${p.name} 掉线，已进入托管`);
        this.sync();
        this.tickBots();
        return ok({ kept: true });
      }
      this.seats[p.seat] = null;
      p.seat = -1;
    }
    this.members.delete(playerId);
    p.roomId = null;
    this.system(`${p.name} 离开房间`);
    if (this.hostId === playerId) {
      const next = [...this.members.values()].find((m) => !m.bot);
      this.hostId = next ? next.id : null;
    }
    this.sync();
    return ok();
  }

  sit(playerId, seat) {
    if (this.playing) return err(ERR.BAD_PHASE, '对局进行中，无法入座');
    const p = this.members.get(playerId);
    if (!p) return err(ERR.ROOM_NOT_FOUND, '不在房间中');
    if (seat < 0 || seat >= this.cfg.players) return err(ERR.SEAT_TAKEN, '座位不存在');
    if (this.seats[seat]) return err(ERR.SEAT_TAKEN, '座位已被占用');
    if (p.seat >= 0) this.seats[p.seat] = null;
    this.seats[seat] = playerId;
    p.seat = seat;
    p.ready = false;
    this.sync();
    return ok();
  }

  stand(playerId) {
    if (this.playing) return err(ERR.BAD_PHASE, '对局进行中，无法站起');
    const p = this.members.get(playerId);
    if (!p || p.seat < 0) return err(ERR.NOT_SEATED, '你不在座位上');
    this.seats[p.seat] = null;
    p.seat = -1;
    p.ready = false;
    this.sync();
    return ok();
  }

  setReady(playerId, ready) {
    const p = this.members.get(playerId);
    if (!p || p.seat < 0) return err(ERR.NOT_SEATED, '请先入座');
    p.ready = !!ready;
    this.sync();
    this.maybeAutoStart();
    return ok();
  }

  addBot(requesterId, seat) {
    if (requesterId !== this.hostId) return err(ERR.NOT_HOST, '只有房主能添加 AI');
    if (this.playing) return err(ERR.BAD_PHASE, '对局进行中');
    let target = seat;
    if (target == null || target < 0) target = this.seats.findIndex((s) => !s);
    if (target < 0) return err(ERR.ROOM_FULL, '没有空位');
    if (this.seats[target]) return err(ERR.SEAT_TAKEN, '座位已占用');
    const bot = new Player({ id: uid('bot_'), name: nextBotName(), bot: true, avatar: randInt(0, 7) });
    bot.roomId = this.id;
    bot.seat = target;
    bot.ready = true;
    this.members.set(bot.id, bot);
    this.seats[target] = bot.id;
    this.system(`${bot.name} 加入了牌桌`);
    this.sync();
    this.maybeAutoStart();
    return ok({ seat: target });
  }

  kick(requesterId, targetId) {
    if (requesterId !== this.hostId) return err(ERR.NOT_HOST, '只有房主能踢人');
    if (this.playing) return err(ERR.BAD_PHASE, '对局进行中');
    const t = this.members.get(targetId);
    if (!t) return err(ERR.ROOM_NOT_FOUND, '玩家不存在');
    if (t.seat >= 0) this.seats[t.seat] = null;
    this.members.delete(targetId);
    t.roomId = null;
    t.seat = -1;
    this.system(`${t.name} 被移出房间`);
    this.sync();
    return ok();
  }

  setConfig(requesterId, patch) {
    if (requesterId !== this.hostId) return err(ERR.NOT_HOST, '只有房主能改设置');
    if (this.playing) return err(ERR.BAD_PHASE, '对局进行中');
    if (patch.name) this.name = String(patch.name).slice(0, 24);
    if (patch.options) this.options = normalizeOptions({ ...this.options, ...patch.options });
    this.sync();
    return ok();
  }

  chat(playerId, text) {
    const p = this.members.get(playerId);
    if (!p) return err(ERR.ROOM_NOT_FOUND, '不在房间中');
    const msg = { id: uid('m_'), from: p.name, seat: p.seat, text: String(text).slice(0, 120), at: Date.now(), kind: 'chat' };
    this.messages.push(msg);
    if (this.messages.length > 100) this.messages.shift();
    this.io.to(this.key).emit(EV.ROOM_MESSAGE, msg);
    return ok();
  }

  system(text) {
    const msg = { id: uid('m_'), from: '系统', seat: -1, text, at: Date.now(), kind: 'system' };
    this.messages.push(msg);
    if (this.messages.length > 100) this.messages.shift();
    this.io.to(this.key).emit(EV.ROOM_MESSAGE, msg);
  }

  maybeAutoStart() {
    if (this.playing) return;
    if (this.seatedCount !== this.cfg.players) return;
    const allReady = this.seats.every((id) => this.members.get(id)?.ready);
    if (allReady) this.startGame(this.hostId, true);
  }

  // ─────────────── 对局 ───────────────
  startGame(requesterId, auto = false) {
    if (!auto && requesterId !== this.hostId) return err(ERR.NOT_HOST, '只有房主能开始游戏');
    if (this.playing) return err(ERR.BAD_PHASE, '对局已在进行');
    if (this.seatedCount !== this.cfg.players) return err(ERR.BAD_PHASE, `需要 ${this.cfg.players} 名玩家入座`);

    const seatInfo = this.seats.map((pid, i) => {
      const p = this.members.get(pid);
      return { seat: i, playerId: pid, name: p.name, bot: p.bot };
    });
    const mid = newMatchId();
    this.engine = new GameEngine({
      mode: this.mode, options: this.options, seats: seatInfo, matchId: mid,
    });
    if (this.options.recordReplay) {
      this.recorder = new Recorder({
        matchId: mid, mode: this.mode, options: this.options,
        seed: this.engine.seed, seats: seatInfo,
      });
    }
    this.bindEngine();
    this.system('对局开始，发牌中…');
    this.engine.startMatch();
    return ok({ matchId: mid });
  }

  bindEngine() {
    const e = this.engine;
    e.on('event', (type, payload) => {
      this.io.to(this.key).emit(EV.GAME_EVENT, { type, payload });
      if (this.recorder) {
        this.recorder.push(type, payload, e.snapshotFor(null));
        if (type === GEV.SETTLE || type === GEV.MATCH_END) this.recorder.save();
      }
      if (type === GEV.SETTLE) this.system(`第 ${payload.handNo} 局结束：闲家 ${payload.totalPoints} 分`);
      if (type === GEV.MATCH_END) this.system('整场结束！');
      this.tickBots();
    });
    e.on('private', (seat, type, payload) => {
      const pid = this.seats[seat];
      const p = this.members.get(pid);
      if (!p || !p.socketId) return;
      const t = type === 'kitty' ? GEV.PRIVATE_KITTY : GEV.PRIVATE_CARD;
      this.io.to(p.socketId).emit(EV.GAME_EVENT, { type: t, payload });
    });
    e.on('state', () => { this.sync(); this.tickBots(); });
    e.on('autoplay', (seat) => this.autoAct(seat, true));
  }

  /** 玩家动作统一入口 */
  action(playerId, type, payload) {
    const p = this.members.get(playerId);
    if (!p) return err(ERR.ROOM_NOT_FOUND, '不在房间中');
    if (p.seat < 0) return err(ERR.NOT_SEATED, '观战中，无法操作');
    if (!this.engine) return err(ERR.BAD_PHASE, '对局未开始');
    return this.applyAction(p.seat, type, payload);
  }

  applyAction(seat, type, payload) {
    const e = this.engine;
    switch (type) {
      case 'declare': return e.declare(seat, payload);
      case 'pass': return ok();
      case 'bury': return e.bury(seat, payload);
      case 'callFriend': return e.callFriend(seat, payload);
      case 'play': return e.play(seat, payload);
      default: return err(ERR.INTERNAL, '未知操作');
    }
  }

  // ─────────────── AI / 托管 ───────────────
  isAutoSeat(seat) {
    const p = this.members.get(this.seats[seat]);
    return !!p && (p.bot || !p.connected);
  }

  tickBots() {
    if (!this.engine) return;
    const s = this.engine.state;
    if (s.phase === PHASE.DEALING) {
      for (let i = 0; i < this.cfg.players; i++) {
        if (this.isAutoSeat(i)) this.scheduleAuto(i, randInt(400, 1600));
      }
      return;
    }
    let actor = null;
    if (s.phase === PHASE.BURY || s.phase === PHASE.CALL_FRIEND) actor = s.bankerSeat;
    else if (s.phase === PHASE.PLAYING) actor = s.currentSeat;
    if (actor == null) return;
    if (this.isAutoSeat(actor)) {
      this.scheduleAuto(actor, randInt(this.options.botDelayMin, this.options.botDelayMax));
    }
  }

  scheduleAuto(seat, delay) {
    const kseat = `auto_${seat}`;
    if (this[kseat]) return;
    this[kseat] = setTimeout(() => {
      this[kseat] = null;
      this.autoAct(seat, false);
    }, delay);
  }

  autoAct(seat, forced) {
    if (!this.engine) return;
    if (!forced && !this.isAutoSeat(seat)) return;
    const d = this.ai.decide(this.engine, seat);
    if (!d) return;
    const r = this.applyAction(seat, d.action, d.payload);
    if (!r.ok && d.action === 'play') {
      // 决策非法 → 退化为最简单的合法出牌
      const s = this.engine.state;
      const need = s.trick?.leadCombo ? s.trick.leadCombo.size : 1;
      const hand = s.hands[seat] || [];
      for (let i = 0; i + need <= hand.length; i++) {
        const t = this.engine.play(seat, hand.slice(i, i + need).map((c) => c.id));
        if (t.ok) return;
      }
      log.warn('autoAct failed', seat, r);
    }
  }

  // ─────────────── 快照广播 ───────────────
  sync() {
    if (this._syncPending) return;
    this._syncPending = true;
    setImmediate(() => {
      this._syncPending = false;
      for (const p of this.members.values()) {
        if (!p.socketId) continue;
        this.io.to(p.socketId).emit(EV.ROOM_STATE, this.snapshotFor(p.id));
      }
    });
  }

  snapshotFor(playerId) {
    const me = this.members.get(playerId);
    const seat = me && me.seat >= 0 ? me.seat : null;
    const revealAll = seat == null && this.options.spectatorSeeAll;
    return {
      room: {
        id: this.id, name: this.name, mode: this.mode, label: this.cfg.label,
        hostId: this.hostId, options: this.options, capacity: this.cfg.players,
      },
      me: me ? { ...me.brief(), isHost: me.id === this.hostId } : null,
      seats: this.seats.map((pid, i) => {
        const p = pid ? this.members.get(pid) : null;
        return p ? { seat: i, ...p.brief() } : { seat: i, empty: true };
      }),
      spectators: [...this.members.values()].filter((p) => p.seat < 0)
        .map((p) => ({ id: p.id, name: p.name, connected: p.connected })),
      messages: this.messages.slice(-40),
      game: this.engine ? this.engine.snapshotFor(seat, { revealAll }) : null,
    };
  }

  dispose() {
    for (const k of Object.keys(this)) if (k.startsWith('auto_') && this[k]) clearTimeout(this[k]);
    if (this.recorder) this.recorder.save();
    if (this.engine) this.engine.destroy();
    this.engine = null;
  }
}
