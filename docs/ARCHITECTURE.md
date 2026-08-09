# 架构设计（ARCHITECTURE）

拖拉机 Online 采用 **「规则引擎（shared）+ 服务端状态机（server）+ 浏览器渲染层（client）」**
三层分离架构。规则与状态机完全运行在 Node 端，浏览器只负责渲染与服务端下发的脱敏快照，
因此**天然支持 AI、观战、回放**——三者都只是「换了数据来源 / 驱动方式」。

```
┌──────────────────────────────────────────────────────────────┐
│  client/  (浏览器 ES Module)                                  │
│   net.js ── Socket.IO ──┐    store.js(observer)  views/*      │
│                         │                                     │
│  server/  ◄─────────────┘                                     │
│   index.js(Express+IO) → socket/* (handlers)                  │
│                     → core/RoomManager → core/Room            │
│                                  ├─ core/GameEngine(状态机)    │
│                                  ├─ core/Recorder(回放)        │
│                                  └─ ai/AIPlayer+strategy       │
│                                                                │
│  shared/  (server & client 共用，浏览器经 /shared/* 直接 import)│
│   constants / config / cards / rules / combos                │
└──────────────────────────────────────────────────────────────┘
```

---

## 1. shared/ —— 零依赖规则内核

纯函数 + 纯数据，**不依赖任何运行时（Node 或浏览器均可 import）**，是整套系统的「真理之源」。

| 文件 | 职责 |
| ---- | ---- |
| `constants.js` | `SUITS/RANKS`、阶段 `PHASE`、牌型 `COMBO`、团队 `TEAM`、Socket 事件名 `EV`、动画事件 `GEV`、错误码 `ERR` |
| `config.js` | `MODE_CONFIG[4/5/6]`（牌副数、底牌、手牌、组队方式）、`DEFAULT_OPTIONS`、`normalizeOptions` |
| `cards.js` | `makeCard/buildDeck`（造牌）、`mulberry32`（可重现随机）、`shuffle`、`pointsOf/sumPoints`、`pickByIds` |
| `rules.js` | `createOrder`（主/副牌大小阶梯）、`parseDeclare/canOverride`（亮主）、`settleHand/bumpLevel/kittyFactorOf`（结算升级） |
| `combos.js` | `decompose`（牌型分解）、`comboOf`、`beatsCombo`（比大小）、`validateFollow`（跟牌校验）、`throwCheck`（甩牌校验） |

> **为什么可重现？** `buildDeck` 产出固定牌堆，`mulberry32(seed)` 提供确定性洗牌。
> 同一 `seed` + 同一动作序列 → 完全一致的牌局，这是回放与调试的基石。

---

## 2. server/core/GameEngine —— 棋牌状态机

`GameEngine extends EventEmitter`，**不认识 socket**，只通过事件与外界通信：

```
事件             说明
'event'   (type, payload)  公开事件 → 广播 + 进回放
'private' (seat, type, payload) 单桌可见（摸到的牌 / 底牌）→ 逐 socket 单发
'state'   ()                请求 Room 重推快照
'autoplay'(seat)            该座位超时/掉线 → 需外部代打
```

### 阶段流转（PHASE）

```
WAITING ──start──► DEALING ──发完+宽限──► BURY ──扣底──► [CALL_FRIEND] ──► PLAYING
                                                                          │
                    FINISHED ◄──打到A── SETTLE ◄────手牌出完──────────────┘
                                          │
                                          └─nextHand(9s)──► DEALING
```

- **DEALING**：逐张发牌（默认 110ms/张），发完后开 4s 亮主宽限；宽限到点 `lockTrump()`。
- **BURY**：庄家扣底（张数 = 该模式底牌数），扣完 5 人模式进入 `CALL_FRIEND`，其余模式直入 `PLAYING`。
- **PLAYING**：轮转出牌，`resolveTrick()` 收墩，手牌全空触发 `settle()`。
- **SETTLE**：结算升级换庄；若某队级牌达到 `winLevel`（默认 A）则进入 `FINISHED`。

### 关键设计点

- **脱敏快照**：`snapshotFor(seat, {revealAll})` 按视角返回数据——只含本人 `myHand`，
  对手手牌只暴露 `handCounts`。
- **计时哨兵**：`armTurn()` / `armTimeout()` 在每个需要操作的座位上挂 `playTimeoutMs` 定时器，
  到点 emit `'autoplay'` → Room 让 AI 代打，避免卡局。
- **严格跟牌 / 甩牌**：由 `comboOf + validateFollow + throwCheck` 统一裁决，逻辑全部在 `shared/combos.js`。

---

## 3. server/core/Room —— 一间牌桌的全部

`Room` 把「座位管理 + 观战席 + 聊天 + 一台 Engine + 一个 Recorder」打包在一起：

| 关注点 | 实现 |
| ------ | ---- |
| 成员 | `members: Map<playerId, Player>`、`seats: (playerId|null)[]` |
| 观战 | `seat < 0` 即观战席；观战者 `action()` 返回 `NOT_SEATED` |
| 聊天 | `chat()` / `system()` 推送 `room:message`，保留最近 100 条 |
| 引擎桥接 | `bindEngine()`：把 Engine 的 `event/private/state/autoplay` 翻译为 IO 广播 |
| 快照 | `sync()` 去抖（`setImmediate`）后逐人单发 `room:state` |
| 自动开局 | 全部入座且全部准备 → `maybeAutoStart()` |

`RoomManager` 负责房间生命周期：建/删、列表推送（`pushLobby`）、无人时 GC 销毁。

### 自动代打（AI / 托管）

```
Room.isAutoSeat(seat)  => 该座是 bot 或 已掉线(connected=false)
Room.tickBots()        => 扫描当前阶段该行动的座位，调用 scheduleAuto()
scheduleAuto(seat)     => 延迟 botDelayMin~Max 后 autoAct()
autoAct(seat, forced)
   └─ AIPlayer.decide(engine, seat)  => { action, payload }
   └─ applyAction(...)               => 引擎执行
   └─ 决策非法(play) => 退化到「最小合法出牌」兜底
```

> 掉线托管与 AI 共用同一套 `autoAct` 路径，因此「真人掉线 → 立即被 AI 接管」是自然结果，
> 且重连后可无缝夺回座位。

---

## 4. server/ai/ —— 策略与决策

| 文件 | 职责 |
| ---- | ---- |
| `AIPlayer.js` | `decide(engine, seat)` 总调度：根据阶段分发到 `strategy` 的对应函数 |
| `strategy.js` | `chooseLead / chooseFollow / chooseDeclare / chooseBury / chooseFriend`，纯启发式 |

策略均为**启发式贪心 + 随机扰动**，不依赖搜索树，适合在 1060 这类弱算力下实时运行：
- 首攻优先打「该门最大」的结构牌，无大牌时探路最小无分副牌；
- 跟牌按 `validateFollow` 的强制要求出牌，必要时用主牌「毙」；
- 亮主偏好「手牌最长的花色 + 对级牌」，必要时王对叫无主；
- 扣底优先扣「分低 + 短门 + 牌小」。

---

## 5. server/core/Recorder —— 回放

`Recorder.push(type, payload, snapshot)` 在每次 Engine 公开事件时记录一帧：
`{ t, type:GEV, payload, snapshot }`。`snapshot` 是**公开视角**，回放时直接喂渲染层，
无需重跑引擎。`settle` / `matchEnd` 时 `save()` 落盘到 `data/replays/<matchId>.json`。

> 因为随机种子固定、`snapshot` 已脱敏且自包含，回放天然可「快进 / 逐帧 / 跳到结算」。

---

## 6. client/ —— 渲染层

| 路径 | 职责 |
| ---- | ---- |
| `index.html` + `css/*` | 单页（hash 路由）+ 牌桌/卡牌/布局样式 |
| `js/net.js` | Socket.IO 客户端封装：`call()`/`tryCall()`（带 ack）、`onGame()`（订阅 `game:event`） |
| `js/store.js` | Observer 状态仓 + `localStorage` 持久化身份（playerId/name/avatar） |
| `js/render/layout.js` | `seatLayout(n, mySeat)`：椭圆座位分布，「我」固定底部，按 `deg=90+rel*360/n` 旋转 |
| `js/render/cardView.js` | 卡牌 DOM 渲染 |
| `js/render/tableView.js` | `TableView` 类：整体牌桌渲染 + 动画事件驱动 |
| `js/views/lobby.js` `room.js` `replay.js` | 大厅 / 牌桌 / 回放三个视图 |

客户端**从不计算规则**，只消费服务端下发的 `snapshot` 与 `game:event`，
因此规则改动集中在 `shared/` 与 `server/`，前端无需改动即可保持一致。

---

## 7. 三类「后续能力」如何复用同一内核

| 能力 | 复用方式 |
| ---- | -------- |
| **AI** | 直接调用 `AIPlayer.decide(engine, seat)`，与真人走同一 `applyAction` 入口 |
| **观战** | `seat=-1` 进入观战席，收 `room:state`（可开 `spectatorSeeAll` 看全手牌），只读不可操作 |
| **回放** | 读取 `data/replays/*.json`，逐帧 `frames[].snapshot` 喂 `TableView`，不重跑引擎 |

三者都不需要新增规则代码，这正是「逻辑与渲染分离」架构的核心收益。
