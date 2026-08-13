import { EV, GEV, PHASE } from '/shared/constants.js';
import { store, saveIdentity, randomName } from './store.js';
import { toast } from './util/dom.js';

export let socket = null;
const bus = new Map(); // gameEvent type -> Set<fn>

export function onGame(type, fn) {
  if (!bus.has(type)) bus.set(type, new Set());
  bus.get(type).add(fn);
  return () => bus.get(type).delete(fn);
}
function fire(type, payload) {
  for (const fn of bus.get(type) || []) fn(payload);
  for (const fn of bus.get('*') || []) fn({ type, payload });
}

export function connect() {
  if (socket) return socket;
  if (!store.state.me.name) saveIdentity(null, randomName());
  socket = io({
    auth: { playerId: store.state.me.id, name: store.state.me.name },
    transports: ['websocket', 'polling'],
  });

  socket.on('connect', () => store.set({ connected: true }));
  socket.on('disconnect', () => store.set({ connected: false }));

  socket.on(EV.HELLO, (d) => {
    saveIdentity(d.playerId, d.name);
    store.emit();
  });

  socket.on(EV.LOBBY_ROOMS, (rooms) => store.set({ rooms }));

  socket.on(EV.ROOM_STATE, (snap) => {
    const prev = store.state.room;
    const patch = { room: snap };
    const g = snap.game;
    if (!g) {
      patch.hand = [];
    } else if (g.myHand) {
      // g.myHand 是该视角玩家的权威手牌。
      // 仅在「发牌动画中途」保留本地由 PRIVATE_CARD 增量构建的结果，避免被局部快照回退；
      // 其余阶段（出牌后手牌自然变少、新一轮发牌开始 myHand 为空）一律直接采用服务器快照。
      const dealingPartial = g.phase === PHASE.DEALING
        && g.myHand.length > 0
        && g.myHand.length < store.state.hand.length;
      if (!dealingPartial) {
        patch.hand = g.myHand;
        // 顺手清理已不在手牌中的选择，避免高亮已打出的牌
        if (store.state.selected.size) {
          const ids = new Set(g.myHand.map((c) => c.id));
          const kept = new Set([...store.state.selected].filter((id) => ids.has(id)));
          if (kept.size !== store.state.selected.size) patch.selected = kept;
        }
      }
    }
    if (!prev || prev.room.id !== snap.room.id) patch.selected = new Set();
    if (store.state.view !== 'replay') patch.view = 'room';
    store.set(patch);
  });

  socket.on(EV.ROOM_MESSAGE, (msg) => {
    const r = store.state.room;
    if (!r) return;
    r.messages = [...(r.messages || []), msg].slice(-60);
    store.emit();
  });

  socket.on(EV.ERROR, (e) => toast(e.msg || e.code || '操作失败', 'err'));

  socket.on(EV.GAME_EVENT, ({ type, payload }) => {
    if (type === GEV.PRIVATE_CARD) {
      store.state.hand = [...store.state.hand, payload.card];
      store.emit();
    } else if (type === GEV.PRIVATE_KITTY) {
      store.state.hand = [...store.state.hand, ...payload.cards];
      store.emit();
    }
    fire(type, payload);
  });

  return socket;
}

/** 带 ack 的请求 */
export function call(ev, data = {}) {
  return new Promise((resolve, reject) => {
    if (!socket) return reject(new Error('未连接'));
    socket.timeout(9000).emit(ev, data, (timeoutErr, res) => {
      if (timeoutErr) return reject(new Error('服务器无响应'));
      if (res && res.ok === false) return reject(Object.assign(new Error(res.msg || res.code), res));
      resolve(res || { ok: true });
    });
  });
}

export async function tryCall(ev, data) {
  try { return await call(ev, data); }
  catch (e) { toast(e.message || '操作失败', 'err'); return null; }
}
