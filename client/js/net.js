import { EV, GEV } from '/shared/constants.js';
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
    if (!g) patch.hand = [];
    else if (g.myHand && g.myHand.length >= store.state.hand.length) patch.hand = g.myHand;
    else if (g.myHand && g.myHand.length === 0 && g.phase !== 'DEALING') patch.hand = [];
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
