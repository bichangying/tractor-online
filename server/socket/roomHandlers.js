import { EV, ERR } from '../../shared/constants.js';

const fail = (code, msg) => ({ ok: false, code, msg });

export function registerRoom(io, socket, rm, ctx) {
  const cur = () => (ctx.roomId ? rm.get(ctx.roomId) : null);
  const guard = (ack, fn) => {
    const room = cur();
    if (!room) return ack?.(fail(ERR.ROOM_NOT_FOUND, '你不在任何房间'));
    ack?.(fn(room) || { ok: true });
  };

  socket.on(EV.ROOM_LEAVE, (_d, ack) => {
    const room = cur();
    if (room) {
      room.leave(ctx.player.id);
      socket.leave(room.key);
      if (room.humanCount === 0) rm.destroy(room.id);
    }
    ctx.roomId = null;
    rm.pushLobby();
    ack?.({ ok: true });
  });

  socket.on(EV.ROOM_SIT, (d = {}, ack) => guard(ack, (room) => {
    const r = room.sit(ctx.player.id, Number(d.seat));
    rm.pushLobby();
    return r;
  }));

  socket.on(EV.ROOM_STAND, (_d, ack) => guard(ack, (room) => {
    const r = room.stand(ctx.player.id);
    rm.pushLobby();
    return r;
  }));

  socket.on(EV.ROOM_READY, (d = {}, ack) => guard(ack, (room) => room.setReady(ctx.player.id, d.ready !== false)));

  socket.on(EV.ROOM_ADD_BOT, (d = {}, ack) => guard(ack, (room) => {
    const r = room.addBot(ctx.player.id, d.seat == null ? null : Number(d.seat));
    rm.pushLobby();
    return r;
  }));

  socket.on(EV.ROOM_KICK, (d = {}, ack) => guard(ack, (room) => room.kick(ctx.player.id, d.playerId)));

  socket.on(EV.ROOM_CONFIG, (d = {}, ack) => guard(ack, (room) => {
    const r = room.setConfig(ctx.player.id, d);
    rm.pushLobby();
    return r;
  }));

  socket.on(EV.ROOM_CHAT, (d = {}, ack) => guard(ack, (room) => room.chat(ctx.player.id, d.text || '')));
}
