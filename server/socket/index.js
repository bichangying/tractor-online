import { EV } from '../../shared/constants.js';
import { registerLobby, joinRoom } from './lobbyHandlers.js';
import { registerRoom } from './roomHandlers.js';
import { registerGame } from './gameHandlers.js';
import { createLogger } from '../util/logger.js';

const log = createLogger('socket');

/**
 * 握手参数（socket.handshake.auth）：
 *   { playerId?, name?, avatar? }
 * playerId 由客户端持久化在 localStorage，用于断线重连回原座位。
 */
export function registerSockets(io, rm) {
  io.on('connection', (socket) => {
    const auth = socket.handshake.auth || {};
    const player = rm.ensurePlayer({ playerId: auth.playerId, name: auth.name, avatar: auth.avatar });
    player.attach(socket.id);
    const ctx = { player, roomId: player.roomId || null };

    socket.emit(EV.HELLO, {
      playerId: player.id, name: player.name, avatar: player.avatar,
      serverTime: Date.now(),
    });
    socket.emit(EV.LOBBY_ROOMS, rm.list());

    // 断线重连：自动回到原房间
    if (player.roomId) {
      const room = rm.get(player.roomId);
      if (room) {
        socket.join(room.key);
        ctx.roomId = room.id;
        player.connected = true;
        room.system(`${player.name} 重新连接`);
        room.sync();
        room.tickBots();
      } else {
        player.roomId = null;
      }
    }

    registerLobby(io, socket, rm, ctx);
    registerRoom(io, socket, rm, ctx);
    registerGame(io, socket, rm, ctx);

    socket.on('disconnect', (reason) => {
      log.debug('disconnect', player.name, reason);
      player.detach();
      const room = ctx.roomId ? rm.get(ctx.roomId) : null;
      if (room) {
        if (room.playing && player.seat >= 0) {
          room.system(`${player.name} 掉线，已托管`);
          room.sync();
          room.tickBots();
        } else {
          room.leave(player.id);
          if (room.humanCount === 0) rm.destroy(room.id);
        }
      }
      rm.pushLobby();
    });
  });
}

export { joinRoom };
