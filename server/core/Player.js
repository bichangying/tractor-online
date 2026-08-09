/**
 * 一个 Player 代表"人"或"机器人"，跨 socket 存活（支持断线重连）。
 */
export class Player {
  constructor({ id, name, bot = false, avatar = 0 }) {
    this.id = id;
    this.name = name;
    this.bot = bot;
    this.avatar = avatar;
    this.socketId = null;
    this.roomId = null;
    this.seat = -1;          // -1 = 未入座（观战）
    this.ready = false;
    this.connected = bot;    // bot 恒为在线
    this.lastSeen = Date.now();
  }

  attach(socketId) {
    this.socketId = socketId;
    this.connected = true;
    this.lastSeen = Date.now();
  }

  detach() {
    this.socketId = null;
    this.connected = false;
    this.lastSeen = Date.now();
  }

  brief() {
    return {
      id: this.id, name: this.name, bot: this.bot, avatar: this.avatar,
      seat: this.seat, ready: this.ready, connected: this.connected,
    };
  }
}
