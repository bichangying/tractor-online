/**
 * 全局常量 —— server / client 共用（浏览器通过 /shared/constants.js 直接 import）
 */

// ───────────────────────── 牌面 ─────────────────────────
export const SUITS = ['S', 'H', 'C', 'D']; // 黑桃 红桃 梅花 方块
export const JOKER_SUIT = 'T'; // 王
export const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
export const JOKER_SMALL = 'sj';
export const JOKER_BIG = 'bj';

export const SUIT_SYMBOL = { S: '♠', H: '♥', C: '♣', D: '♦', T: '★' };
export const SUIT_NAME = { S: '黑桃', H: '红桃', C: '梅花', D: '方块', T: '王' };

/** 主牌花色的特殊值：无主（打无主 / 天地主） */
export const NT = 'NT';
/** 主牌组标识（decompose / order 中使用） */
export const TRUMP = 'T';

export const GROUP_LABEL = { T: '主牌', S: '黑桃', H: '红桃', C: '梅花', D: '方块' };

// ───────────────────────── 状态机 ─────────────────────────
export const PHASE = {
  WAITING: 'WAITING',       // 房间等待，玩家坐下 / 准备
  DEALING: 'DEALING',       // 发牌中（可亮主 / 反主）
  BURY: 'BURY',             // 庄家扣底
  CALL_FRIEND: 'CALL_FRIEND', // 5 人叫朋友
  PLAYING: 'PLAYING',       // 出牌
  SETTLE: 'SETTLE',         // 本局结算
  FINISHED: 'FINISHED',     // 整场结束（打到 A）
};

export const COMBO = {
  SINGLE: 'SINGLE',
  PAIR: 'PAIR',
  TRIPLE: 'TRIPLE',
  TRACTOR: 'TRACTOR',
  THROW: 'THROW',
};

export const TEAM = { BANKER: 'BANKER', DEFENDER: 'DEFENDER' };

// ───────────────────────── Socket.IO 事件名 ─────────────────────────
export const EV = {
  // system
  HELLO: 'sys:hello',
  ERROR: 'sys:error',
  TOAST: 'sys:toast',

  // lobby（C→S 均带 ack 回调）
  LOBBY_LIST: 'lobby:list',
  LOBBY_CREATE: 'lobby:create',
  LOBBY_JOIN: 'lobby:join',
  LOBBY_QUICK: 'lobby:quick',
  LOBBY_ROOMS: 'lobby:rooms',       // S→C 推送房间列表

  // room
  ROOM_LEAVE: 'room:leave',
  ROOM_SIT: 'room:sit',
  ROOM_STAND: 'room:stand',
  ROOM_READY: 'room:ready',
  ROOM_ADD_BOT: 'room:addBot',
  ROOM_KICK: 'room:kick',
  ROOM_CHAT: 'room:chat',
  ROOM_CONFIG: 'room:config',
  ROOM_STATE: 'room:state',         // S→C 房间快照（含 game 快照，按人视角脱敏）
  ROOM_MESSAGE: 'room:message',     // S→C 聊天/系统消息

  // game
  GAME_START: 'game:start',
  GAME_DECLARE: 'game:declare',     // 亮主 / 反主 / 加固
  GAME_PASS: 'game:pass',           // 不亮
  GAME_BURY: 'game:bury',           // 扣底
  GAME_CALL_FRIEND: 'game:callFriend',
  GAME_PLAY: 'game:play',
  GAME_EVENT: 'game:event',         // S→C 动画事件流

  // replay
  REPLAY_LIST: 'replay:list',
  REPLAY_LOAD: 'replay:load',
};

/** GAME_EVENT 的 type 枚举 —— 客户端据此播放动画 */
export const GEV = {
  PRIVATE_CARD: 'privateCard',   // 只发给本人：摸到一张牌
  PRIVATE_KITTY: 'privateKitty', // 只发给庄家：底牌
  DEAL_TICK: 'dealTick',
  DECLARE: 'declare',
  TRUMP_LOCKED: 'trumpLocked',
  KITTY_TAKEN: 'kittyTaken',
  BURIED: 'buried',
  FRIEND_CALLED: 'friendCalled',
  FRIEND_REVEALED: 'friendRevealed',
  PLAY: 'play',
  THROW_FAILED: 'throwFailed',
  TRICK_END: 'trickEnd',
  SETTLE: 'settle',
  MATCH_END: 'matchEnd',
  PHASE: 'phase',
};

// ───────────────────────── 错误码 ─────────────────────────
export const ERR = {
  ROOM_NOT_FOUND: 'ROOM_NOT_FOUND',
  ROOM_FULL: 'ROOM_FULL',
  SEAT_TAKEN: 'SEAT_TAKEN',
  NOT_HOST: 'NOT_HOST',
  NOT_SEATED: 'NOT_SEATED',
  BAD_PHASE: 'BAD_PHASE',
  NOT_YOUR_TURN: 'NOT_YOUR_TURN',
  CARD_NOT_IN_HAND: 'CARD_NOT_IN_HAND',
  BAD_COUNT: 'BAD_COUNT',
  MIXED_SUIT: 'MIXED_SUIT',
  MUST_FOLLOW: 'MUST_FOLLOW',
  NEED_PAIR: 'NEED_PAIR',
  NEED_TRACTOR: 'NEED_TRACTOR',
  BAD_DECLARE: 'BAD_DECLARE',
  WEAK_DECLARE: 'WEAK_DECLARE',
  NOT_BANKER: 'NOT_BANKER',
  INTERNAL: 'INTERNAL',
};
