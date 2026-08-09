# Socket.IO 通信协议（PROTOCOL）

拖拉机 Online 使用 **Socket.IO v4** 作为唯一的实时通信通道。服务端 `server/socket/*`
通过事件名（见 `shared/constants.js` 的 `EV` / `GEV`）与客户端 `client/js/net.js` 收发消息。

> 约定：
> - **C→S**：客户端发往服务端（通常带 `ack` 回调确认结果）
> - **S→C**：服务端广播 / 单发给客户端
> - 所有 C→S 动作类事件（除系统事件外）的 `ack` 返回统一结构 `{ ok:true, ... }` 或
>   `{ ok:false, code: ERR, msg: string }`

---

## 1. 握手（连接建立）

客户端在 `io(url, { auth })` 中携带身份：

```js
io('http://localhost:3000', {
  auth: { playerId, name, avatar }
})
```

| 字段      | 类型   | 说明 |
| --------- | ------ | ---- |
| playerId  | string | 客户端持久化在 `localStorage`，用于断线重连回原座位；缺省时服务端分配新 id |
| name      | string | 昵称（默认 `玩家xxxx`） |
| avatar    | number | 头像索引 0–7 |

连接成功后服务端立即下发：

| 事件 | 方向 | 载荷 |
| ---- | ---- | ---- |
| `sys:hello` | S→C | `{ playerId, name, avatar, serverTime }` |
| `lobby:rooms` | S→C | 房间列表数组（`Room.brief()` 投影，详见 §6） |

**断线重连**：若 `playerId` 已归属于某房间，服务端会自动 `socket.join(room.key)` 并回到原座位；
对局中掉线则座位保留为「托管」（`connected=false`），由 AI 代打，不会崩溃牌局。

---

## 2. 大厅事件（Lobby）

| 事件 | 方向 | 载荷（C→S） | ack 返回 |
| ---- | ---- | ----------- | -------- |
| `lobby:list` | C→S | — | `{ ok, rooms:[Room.brief] }` |
| `lobby:create` | C→S | `{ name?, mode:4|5|6, options?, password? }` | `{ ok, roomId }` 或错误 |
| `lobby:join` | C→S | `{ roomId, password?, seat?, spectate? }` | `{ ok, roomId }` 或错误 |
| `lobby:quick` | C→S | `{ mode? }` | `{ ok, roomId }` 或错误 |
| `lobby:rooms` | S→C | — | 房间列表变更时自动推送（`RoomManager.pushLobby`） |

- `lobby:create` 成功后自动加入该房间并占用第一个空座（房主）。
- `lobby:quick`：优先加入同模式下未满、无密码的房间；无则自动新建。
- 房间列表中的每条记录结构（`Room.brief`）：

```ts
interface RoomBrief {
  id: string; mode: number; label: string;
  seated: number; capacity: number; spectators: number;
  playing: boolean; hasPassword: boolean;
  phase: string;        // WAITING / DEALING / ... / FINISHED
  createdAt: number;
}
```

---

## 3. 房间事件（Room）

所有房间事件要求 `ctx.roomId` 存在（即当前已加入某房间），否则 `ack` 返回
`{ ok:false, code:'ROOM_NOT_FOUND', msg:'你不在任何房间' }`。

| 事件 | 方向 | 载荷（C→S） | 说明 |
| ---- | ---- | ----------- | ---- |
| `room:leave` | C→S | — | 离开房间；最后一名真人离开则销毁房间 |
| `room:sit` | C→S | `{ seat:number }` | 入座（对局中禁止） |
| `room:stand` | C→S | — | 站起 |
| `room:ready` | C→S | `{ ready?:boolean }` | 准备 / 取消准备 |
| `room:addBot` | C→S | `{ seat?:number }` | 房主添加 AI（自动找空座） |
| `room:kick` | C→S | `{ playerId }` | 房主踢人 |
| `room:config` | C→S | `{ name?, options? }` | 房主改房间设置 |
| `room:chat` | C→S | `{ text }` | 发送聊天（≤120 字） |

服务端推送：

| 事件 | 方向 | 载荷 |
| ---- | ---- | ---- |
| `room:state` | S→C | 房间完整快照（见 §6），**逐人脱敏单发** |
| `room:message` | S→C | `{ id, from, seat, text, at, kind:'chat'|'system' }` |

> 权限约束：
> - `addBot` / `kick` / `config` 仅房主（`hostId === 请求者`）可执行，否则 `NOT_HOST`。
> - `sit` / `stand` / `ready` 在对局进行中（`room.playing`）返回 `BAD_PHASE`。
> - 全部入座且全部准备 → `maybeAutoStart()` 自动开局。

---

## 4. 游戏事件（Game）

| 事件 | 方向 | 载荷（C→S） | 对应引擎动作 |
| ---- | ---- | ----------- | ------------ |
| `game:start` | C→S | — | 房主开局（`Room.startGame`） |
| `game:declare` | C→S | `[cardId, ...]` 或 `{ cards:[...] }` | 亮主 / 反主 / 加固（`Engine.declare`） |
| `game:pass` | C→S | — | 不亮（`applyAction` 返回 ok） |
| `game:bury` | C→S | `[cardId, ...]` | 庄家扣底（`Engine.bury`） |
| `game:callFriend` | C→S | `{ suit, rank, nth }` | 5 人叫朋友（`Engine.callFriend`） |
| `game:play` | C→S | `[cardId, ...]` 或 `{ cards:[...] }` | 出牌（`Engine.play`） |

> `gameHandlers.js` 中 `act(type)` 统一从 `d.cards ?? d.spec ?? d` 取出牌 id 数组，
> 交给 `Room.action(playerId, type, payload)` → `Engine` 相应方法。返回非 ok 时通过
> `sys:error` 单发错误（`{ ok:false, code, msg }`）。

**`game:event`（S→C 动画事件流）**

服务端引擎对外 emit 的公开事件，经 `Room.bindEngine` 转发为 `game:event`，
结构为 `{ type: GEV, payload }`。`GEV` 枚举：

| GEV.type | 触发时机 | payload 关键字段 |
| -------- | -------- | ---------------- |
| `dealTick` | 每发出一张牌 | `{ seat, dealt, total }` |
| `declare` | 有人亮主 | `{ seat, suit, strength, kind, cards }` |
| `trumpLocked` | 主花色锁定 | `{ trumpSuit, byFlip?, flip?, seat? }` |
| `kittyTaken` | 底牌进庄家手 | `{ seat, count }` |
| `buried` | 庄家完成扣底 | `{ seat, count }` |
| `friendCalled` | 5 人叫朋友 | `{ seat, spec }` |
| `friendRevealed` | 朋友现形 | `{ seat, spec }` |
| `play` | 有人出牌 | `{ seat, cards, type, forced? }` |
| `throwFailed` | 甩牌被压 | `{ seat, forced }` |
| `trickEnd` | 一墩结束 | `{ winnerSeat, points, byDefenders, defenderPoints, trickNo }` |
| `settle` | 本局结算 | `Engine.settle` 的结算对象（详见 §6） |
| `matchEnd` | 整场结束 | `{ winnerTeam, levels }` |
| `phase` | 阶段切换 | `{ phase, ...extra }` |

**私密事件（逐 socket 单发，不走房间广播）**

| GEV.type | 单发对象 | payload |
| -------- | -------- | ------- |
| `privateCard` | 摸牌者本人 | `{ card }` 当前摸到的那张牌 |
| `privateKitty` | 庄家本人 | `{ cards }` 8 张（或 7/6 张）底牌 |

---

## 5. 回放事件（Replay）

| 事件 | 方向 | 载荷 | 返回 |
| ---- | ---- | ---- | ---- |
| `replay:list` | C→S | — | `{ ok, replays:[{ id, mode, seats, frames, createdAt, size }] }` |
| `replay:load` | C→S | `{ id }` | `{ ok, replay }` 或 `{ ok:false, code:'NOT_FOUND' }` |

回放文件位于 `data/replays/<matchId>.json`，结构：

```ts
interface ReplayFile {
  version: 1; matchId: string; mode: number;
  options: object; seed: number; createdAt: string;
  seats: { name: string; bot: boolean }[];
  frames: { t: number; type: GEV; payload: any; snapshot: PublicSnapshot }[];
}
```

前端 `client/js/views/replay.js` 逐帧回放 `frames`，直接用其中的 `snapshot` 喂给渲染层，
**无需重跑引擎**。

---

## 6. 快照结构（Snapshot）

### 6.1 房间级快照（`room:state` 的 `game` 之外部分）

```ts
interface RoomSnapshot {
  room: { id, name, mode, label, hostId, options, capacity };
  me:   { id, name, seat, bot, connected, ready, isHost };
  seats: { seat, id?, name?, bot?, connected?, ready?, empty? }[];
  spectators: { id, name, connected }[];
  messages: RoomMessage[];           // 最近 40 条
  game: GameSnapshot | null;
}
```

### 6.2 棋牌级快照（`Engine.snapshotFor(seat, {revealAll})`）

> 脱敏规则：每个玩家只看到自己的 `myHand`；`allHands` 仅当 `revealAll`（观战开启 `spectatorSeeAll`）
> 或 `phase ∈ {SETTLE, FINISHED}` 时存在；`kitty`（底牌）仅在结算/结束或 `revealAll` 可见。

```ts
interface GameSnapshot {
  matchId, mode, phase, handNo, level, levels, trumpSuit;
  bankerSeat, declarer, declare;
  dealt, dealTotal;                  // 发牌进度
  handCounts: number[];              // 各座位剩余手牌数
  myHand: Card[];                    // 当前视角手牌（已按主→副、组内大到小排序）
  allHands?: Card[][] | null;
  kittyCount: number;
  kitty?: Card[] | null;
  currentSeat: number | null;
  deadline: number;                  // 当前动作截止时间戳（超时托管）
  trick: { leadSeat, plays:[{seat,cards,type}] } | null;
  lastTrick, trickNo, defenderPoints, maxPoints;
  teams: ('BANKER'|'DEFENDER')[];
  friendSpec?, friendSeat?;          // 5 人模式
  settle?, winnerTeam?;
  config: { decks, kitty, hand, players, teamMode };
  options: { strictFollow, allowThrow, winLevel };
}
```

---

## 7. HTTP REST 接口

服务端同时暴露少量只读 REST（`server/index.js`），便于调试 / 健康检查：

| 方法 | 路径 | 返回 |
| ---- | ---- | ---- |
| GET | `/api/health` | `{ ok, up }` |
| GET | `/api/modes` | `{ ok, modes:[MODE_CONFIG], defaults:DEFAULT_OPTIONS }` |
| GET | `/api/rooms` | `{ ok, rooms:[Room.brief] }` |
| GET | `/api/replays` | `{ ok, replays:[...] }` |
| GET | `/api/replays/:id` | `{ ok, replay }` 或 404 |
| GET | `/*` | SPA 兜底返回 `client/index.html` |

静态资源：`/shared/*`（`shared/` 下的 ES Module，浏览器直接 `import`），
`/` 为 `client/` 前端根目录。

---

## 8. 错误码（ERR）

| code | 含义 |
| ---- | ---- |
| `ROOM_NOT_FOUND` | 房间不存在 / 不在任何房间 |
| `ROOM_FULL` | 房间已满 / 无空位 |
| `SEAT_TAKEN` | 座位已被占用 / 不存在 |
| `NOT_HOST` | 非房主操作 |
| `NOT_SEATED` | 未入座 / 观战中操作 |
| `BAD_PHASE` | 当前阶段不允许该操作 |
| `NOT_YOUR_TURN` | 还没轮到你出牌 |
| `CARD_NOT_IN_HAND` | 牌不在手上 / 手牌已出完 |
| `BAD_COUNT` | 出牌张数不符 |
| `MIXED_SUIT` | 首攻混花色 / 甩牌非法 |
| `MUST_FOLLOW` | 必须跟该门花色 |
| `NEED_PAIR` | 必须打出足够的对子 |
| `NEED_TRACTOR` | 必须打出足够的连对 |
| `BAD_DECLARE` | 亮主牌型非法 |
| `WEAK_DECLARE` | 亮主强度不足（不可反主） |
| `NOT_BANKER` | 非庄家操作 |
| `INTERNAL` | 服务端内部错误 |

---

## 9. 完整一局时序（以 4 人模式为例）

```
Client                             Server / Engine
  │                                    │
  │─ lobby:create {mode:4} ──────────►│ 建房间 + 自动入座
  │◄─ ack {roomId} ───────────────────│
  │◄──────────── room:state ──────────│ 全员各收到脱敏快照
  │  (其余 3 人 join/sit/ready)        │
  │◄────── room:state ×N ─────────────│
  │─ game:start ─────────────────────►│ Room.startGame → Engine.startMatch
  │◄── game:event {type:'dealTick'} ──│ 发牌循环（每 110ms 一张）
  │◄── game:event {type:'privateCard'}│ 每人各收到自己摸到的牌（单发）
  │◄── game:event {type:'phase',DEALING+dealDone}
  │  (亮主宽限 4s)                     │ lockTrump() 到点
  │◄── game:event {type:'trumpLocked'}│ 主花色确定，底牌进庄家
  │◄── game:event {type:'privateKitty'}│ 庄家收到底牌（单发）
  │◄── game:event {type:'phase',BURY} │
  │─ game:bury [8 ids] ──────────────►│ Engine.bury
  │◄── game:event {type:'buried'} ────│
  │◄── game:event {type:'phase',PLAYING}
  │  (庄家首攻)                        │
  │─ game:play [ids] ────────────────►│ Engine.play → resolveTrick
  │◄── game:event {type:'play'} ──────│ 其余玩家依次出牌
  │◄── game:event {type:'trickEnd'} ──│ 一墩结束，胜者得墩
  │   ... 直至手牌出完 ...             │
  │◄── game:event {type:'settle'} ────│ 结算 → 升级 → 换庄
  │◄── game:event {type:'phase',SETTLE}
  │  (9s 后自动 nextHand)             │
  │◄── game:event {type:'phase',DEALING}
  │   ... 直至某队打到 A ...           │
  │◄── game:event {type:'matchEnd'} ──│ 整场结束，Recorder 落盘
```
