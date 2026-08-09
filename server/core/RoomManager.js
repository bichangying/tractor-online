import { Room } from './Room.js';
import { Player } from './Player.js';
import { roomCode, uid } from '../util/id.js';
import { SUPPORTED_MODES, MODE_CONFIG } from '../../shared/config.js';
import { ERR, EV } from '../../shared/constants.js';
import { createLogger } from '../util/logger.js';

const log = createLogger('rooms');
const IDLE_MS = 1000 * 60 * 30; // 30 分钟无人自动回收

export class RoomManager {
  constructor(io) {
    this.io = io;
    this.rooms = new Map();     // roomId -> Room
    this.players = new Map();   // playerId -> Player（跨 socket 存活，支持重连）
    setInterval(() => this.gc(), 60 * 1000).unref?.();
  }

  // ── 玩家 ──
  ensurePlayer({ playerId, name, avatar }) {
    let p = playerId && this.players.get(playerId);
    if (!p) {
      p = new Player({ id: playerId || uid('u_'), name: name || '玩家', avatar: avatar || 0 });
      this.players.set(p.id, p);
    }
    if (name) p.name = String(name).slice(0, 12);
    if (avatar != null) p.avatar = avatar;
    return p;
  }

  // ── 房间 ──
  createRoom({ name, mode, options, hostId, password }) {
    if (!SUPPORTED_MODES.includes(Number(mode))) return { ok: false, code: 'BAD_MODE', msg: '仅支持 4/5/6 人' };
    let id = roomCode();
    while (this.rooms.has(id)) id = roomCode();
    const room = new Room({ io: this.io, id, name, mode: Number(mode), options, hostId, password });
    this.rooms.set(id, room);
    log.info('create', id, MODE_CONFIG[mode].label);
    this.pushLobby();
    return { ok: true, room };
  }

  get(id) { return this.rooms.get(String(id || '').toUpperCase()); }

  list() {
    return [...this.rooms.values()]
      .filter((r) => r.humanCount > 0 || !r.playing)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((r) => r.brief());
  }

  /** 快速加入：找一个人数没满、未开局的同模式房间 */
  quickJoin(mode) {
    for (const r of this.rooms.values()) {
      if (r.mode === Number(mode) && !r.playing && r.seatedCount < r.cfg.players && !r.password) return r;
    }
    return null;
  }

  destroy(id) {
    const r = this.rooms.get(id);
    if (!r) return;
    r.dispose();
    this.rooms.delete(id);
    this.pushLobby();
    log.info('destroy', id);
  }

  leaveAll(playerId) {
    const p = this.players.get(playerId);
    if (!p || !p.roomId) return;
    const r = this.rooms.get(p.roomId);
    if (r) r.leave(playerId);
  }

  pushLobby() {
    this.io.emit(EV.LOBBY_ROOMS, this.list());
  }

  gc() {
    const now = Date.now();
    for (const [id, r] of this.rooms) {
      const humans = [...r.members.values()].filter((m) => !m.bot);
      const anyOnline = humans.some((m) => m.connected);
      if (!humans.length || (!anyOnline && now - Math.max(...humans.map((m) => m.lastSeen), r.createdAt) > IDLE_MS)) {
        this.destroy(id);
      }
    }
  }
}

export { ERR };
