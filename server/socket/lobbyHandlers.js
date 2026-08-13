import { EV, ERR } from '../../shared/constants.js';

const fail = (code, msg) => ({ ok: false, code, msg });

export function registerLobby(io, socket, rm, ctx) {
  const me = () => ctx.player;

  socket.on(EV.LOBBY_LIST, (_data, ack) => {
    ack?.({ ok: true, rooms: rm.list() });
  });

  socket.on(EV.LOBBY_CREATE, (data = {}, ack) => {
    const p = me();
    const r = rm.createRoom({
      name: data.name, mode: data.mode, options: data.options,
      hostId: p.id, password: data.password || '',
    });
    if (!r.ok) return ack?.(r);
    joinRoom(io, socket, rm, ctx, r.room, {});
    // 单人快速开局：建房时指定 AI 数量，自动补位并开局（即使只有房主一人也能玩）
    const maxBots = r.room.cfg.players - 1;
    const want = Math.max(0, Math.min(Number(data.botCount) || 0, maxBots));
    if (want > 0) {
      const room = r.room;
      const seat0 = room.seats.findIndex((s) => !s);
      if (seat0 >= 0) room.sit(p.id, seat0);
      for (let i = 0; i < want; i++) room.addBot(p.id, null);
      room.setReady(p.id, true);
      room.maybeAutoStart();
    }
    ack?.({ ok: true, roomId: r.room.id });
  });

  socket.on(EV.LOBBY_JOIN, (data = {}, ack) => {
    const room = rm.get(data.roomId);
    if (!room) return ack?.(fail(ERR.ROOM_NOT_FOUND, '房间不存在'));
    const res = joinRoom(io, socket, rm, ctx, room, { password: data.password, seat: data.seat, spectate: data.spectate });
    ack?.(res.ok ? { ok: true, roomId: room.id } : res);
  });

  socket.on(EV.LOBBY_QUICK, (data = {}, ack) => {
    let room = rm.quickJoin(data.mode || 4);
    if (!room) {
      const r = rm.createRoom({ name: `${me().name}的房间`, mode: data.mode || 4, hostId: me().id });
      if (!r.ok) return ack?.(r);
      room = r.room;
    }
    const res = joinRoom(io, socket, rm, ctx, room, { autoSit: true });
    ack?.(res.ok ? { ok: true, roomId: room.id } : res);
  });
}

export function joinRoom(io, socket, rm, ctx, room, { password, seat, spectate, autoSit } = {}) {
  const p = ctx.player;
  if (p.roomId && p.roomId !== room.id) rm.leaveAll(p.id);
  const r = room.join(p, { password });
  if (!r.ok) return r;
  socket.join(room.key);
  ctx.roomId = room.id;
  if (!spectate && (autoSit || seat != null) && !room.playing) {
    const target = seat != null ? seat : room.seats.findIndex((s) => !s);
    if (target >= 0) room.sit(p.id, target);
  }
  rm.pushLobby();
  room.sync();
  return { ok: true };
}
