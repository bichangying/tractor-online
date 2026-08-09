import { EV, ERR } from '../../shared/constants.js';
import { listReplays, readReplay } from '../core/Recorder.js';

const fail = (code, msg) => ({ ok: false, code, msg });

export function registerGame(io, socket, rm, ctx) {
  const cur = () => (ctx.roomId ? rm.get(ctx.roomId) : null);
  const act = (type) => (d = {}, ack) => {
    const room = cur();
    if (!room) return ack?.(fail(ERR.ROOM_NOT_FOUND, '你不在任何房间'));
    const payload = d.cards ?? d.spec ?? d;
    const r = room.action(ctx.player.id, type, payload);
    if (!r.ok) socket.emit(EV.ERROR, r);
    ack?.(r);
  };

  socket.on(EV.GAME_START, (_d, ack) => {
    const room = cur();
    if (!room) return ack?.(fail(ERR.ROOM_NOT_FOUND, '你不在任何房间'));
    const r = room.startGame(ctx.player.id);
    rm.pushLobby();
    ack?.(r);
  });

  socket.on(EV.GAME_DECLARE, act('declare'));
  socket.on(EV.GAME_PASS, act('pass'));
  socket.on(EV.GAME_BURY, act('bury'));
  socket.on(EV.GAME_CALL_FRIEND, act('callFriend'));
  socket.on(EV.GAME_PLAY, act('play'));

  socket.on(EV.REPLAY_LIST, (_d, ack) => ack?.({ ok: true, replays: listReplays() }));
  socket.on(EV.REPLAY_LOAD, (d = {}, ack) => {
    const r = readReplay(d.id);
    ack?.(r ? { ok: true, replay: r } : fail('NOT_FOUND', '回放不存在'));
  });
}
