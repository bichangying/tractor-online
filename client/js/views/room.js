import { h, clear, toast } from '../util/dom.js';
import { store } from '../store.js';
import { tryCall, onGame } from '../net.js';
import { TableView, seatName } from '../render/tableView.js';
import { EV, GEV, PHASE, NT, SUITS, RANKS, SUIT_NAME, SUIT_SYMBOL } from '/shared/constants.js';
import { createOrder, parseDeclare } from '/shared/rules.js';
import { comboOf, validateFollow } from '/shared/combos.js';

const QUICK = ['快点呀！', '好牌！', '这波稳了', '把分甩过来', '别拆对子', '打得漂亮 👍'];

export function createRoomView() {
  const table = new TableView({ interactive: true });
  const sideBody = h('div.side-body');
  const chatInput = h('input', {
    placeholder: '说点什么…', maxlength: 60,
    onkeydown: (e) => { if (e.key === 'Enter') send(); },
  });
  let tab = 'chat';
  const tabs = h('div.side-tabs', {},
    ...['chat', 'log', 'players'].map((k) =>
      h('button', { class: k === tab ? 'on' : '', onclick: () => { tab = k; syncTabs(); paintSide(); } },
        { chat: '聊天', log: '战报', players: '玩家' }[k])));
  const side = h('div.side', {}, tabs, sideBody,
    h('div.quickchat', {}, QUICK.map((t) => h('button.sm.ghost', { onclick: () => tryCall(EV.ROOM_CHAT, { text: t }) }, t))),
    h('div.side-foot', {}, chatInput, h('button.sm', { onclick: send }, '发送')));

  const topBar = h('div.hud');
  const sideToggle = h('button.sm.ghost.side-toggle', { onclick: () => side.classList.toggle('open') }, '💬');
  const el = h('div', { style: { flex: '1', display: 'flex', flexDirection: 'column', minHeight: '0' } },
    topBar, h('div.game', {}, table.root, side, sideToggle));

  const trickLog = [];
  const offs = [
    onGame(GEV.TRICK_END, (p) => {
      const st = store.state.room;
      trickLog.unshift(`第 ${p.trickNo} 墩 · ${seatName(st?.seats, p.winnerSeat)} 收牌${p.points ? ` (+${p.points} 分)` : ''}${p.byDefenders ? ' [闲]' : ''}`);
      if (trickLog.length > 60) trickLog.pop();
      if (tab === 'log') paintSide();
    }),
    onGame(GEV.PHASE, (p) => { if (p.phase === PHASE.DEALING) trickLog.length = 0; }),
    onGame(GEV.DECLARE, (p) => {
      const st = store.state.room;
      toast(`${seatName(st?.seats, p.seat)} 亮主：${p.suit === NT ? '无主' : SUIT_NAME[p.suit]}`);
    }),
    onGame(GEV.THROW_FAILED, () => toast('甩牌失败，已强制打出最小一组', 'err')),
  ];

  function send() {
    const t = chatInput.value.trim();
    if (!t) return;
    chatInput.value = '';
    tryCall(EV.ROOM_CHAT, { text: t });
  }
  function syncTabs() {
    [...tabs.children].forEach((b, i) => b.classList.toggle('on', ['chat', 'log', 'players'][i] === tab));
  }

  // ─────────── 交互 ───────────
  function toggleCard(card) {
    const sel = store.state.selected;
    if (sel.has(card.id)) sel.delete(card.id); else sel.add(card.id);
    store.emit();
  }
  function selectedCards() {
    const map = new Map(store.state.hand.map((c) => [c.id, c]));
    return [...store.state.selected].map((id) => map.get(id)).filter(Boolean);
  }
  function clearSel() { store.state.selected.clear(); store.emit(); }

  table.table.addEventListener('click', (e) => {
    const seatEl = e.target.closest('.seat');
    if (!seatEl) return;
    const snap = store.state.room;
    if (!snap || snap.game) return;
    const seat = Number(seatEl.dataset.seat);
    if (snap.seats[seat]?.empty) tryCall(EV.ROOM_SIT, { seat });
  });

  // ─────────── 动作栏 ───────────
  function paintActions(state) {
    const box = clear(table.actions);
    const snap = state.room;
    if (!snap) return;
    const g = snap.game;
    const me = snap.me;
    const mySeat = me && me.seat >= 0 ? me.seat : null;
    const isHost = me?.isHost;

    if (!g || g.phase === PHASE.WAITING) {
      const seated = snap.seats.filter((s) => !s.empty).length;
      box.append(
        mySeat == null
          ? h('button', { onclick: () => tryCall(EV.ROOM_SIT, { seat: snap.seats.findIndex((s) => s.empty) }) }, '入座')
          : h('button.ghost', { onclick: () => tryCall(EV.ROOM_STAND) }, '离座'),
        mySeat != null ? h('button', {
          class: me.ready ? 'ghost' : 'primary',
          onclick: () => tryCall(EV.ROOM_READY, { ready: !me.ready }),
        }, me.ready ? '取消准备' : '准备') : null,
        isHost ? h('button', { onclick: () => tryCall(EV.ROOM_ADD_BOT, {}) }, '＋ 添加 AI') : null,
        isHost ? h('button.primary', {
          disabled: seated !== snap.room.capacity,
          onclick: () => tryCall(EV.GAME_START),
        }, '开始游戏') : null,
        h('span.hint', {}, `${seated}/${snap.room.capacity} 人已入座${seated < snap.room.capacity ? '，可添加 AI 补位' : ''}`),
      );
      return;
    }

    if (mySeat == null) {
      box.append(h('span.hint', {}, '👀 观战中'));
      return;
    }

    const sel = selectedCards();
    const order = createOrder(g.trumpSuit || NT, g.level);

    if (g.phase === PHASE.DEALING) {
      const d = sel.length ? parseDeclare(sel, g.level) : null;
      const cur = g.declare;
      const canDeclare = !!d && (!cur || (cur.seat === mySeat ? d.suit === cur.suit && d.strength > cur.strength : d.strength > cur.strength));
      box.append(
        h('button.primary', {
          disabled: !canDeclare,
          onclick: async () => { await tryCall(EV.GAME_DECLARE, { cards: [...store.state.selected] }); clearSel(); },
        }, d ? `亮主 ${d.suit === NT ? '无主' : SUIT_NAME[d.suit]}` : '亮主'),
        h('button.ghost', { onclick: () => { clearSel(); tryCall(EV.GAME_PASS); } }, '不亮'),
        h('span.hint', {}, cur
          ? `当前：${seatName(snap.seats, cur.seat)} 亮了 ${cur.suit === NT ? '无主' : SUIT_NAME[cur.suit]}（强度 ${cur.strength}）`
          : `选中级牌【${g.level}】亮主，王对可亮无主`),
      );
      return;
    }

    if (g.phase === PHASE.BURY) {
      const need = g.kittyCount;
      if (mySeat !== g.bankerSeat) { box.append(h('span.hint', {}, '等待庄家扣底…')); return; }
      box.append(
        h('button.primary', {
          disabled: sel.length !== need,
          onclick: async () => { await tryCall(EV.GAME_BURY, { cards: [...store.state.selected] }); clearSel(); },
        }, `扣底（${sel.length}/${need}）`),
        h('button.ghost', { onclick: clearSel }, '清空'),
        h('span.hint', {}, '选择要埋入底牌的牌，尽量别埋分牌'),
      );
      return;
    }

    if (g.phase === PHASE.CALL_FRIEND) {
      if (mySeat !== g.bankerSeat) { box.append(h('span.hint', {}, '等待庄家叫朋友…')); return; }
      const suitSel = h('select', {}, SUITS.map((s) => h('option', { value: s }, `${SUIT_SYMBOL[s]} ${SUIT_NAME[s]}`)));
      const rankSel = h('select', {}, ['A', 'K', 'Q', 'J', '10'].map((r) => h('option', { value: r }, r)));
      const nthSel = h('select', {}, [1, 2, 3].slice(0, g.config.decks).map((n) => h('option', { value: n }, `第 ${n} 张`)));
      box.append(
        h('div.friend-form', {}, suitSel, rankSel, nthSel,
          h('button.primary', {
            onclick: () => tryCall(EV.GAME_CALL_FRIEND, {
              spec: { suit: suitSel.value, rank: rankSel.value, nth: Number(nthSel.value) },
            }),
          }, '叫朋友')),
        h('span.hint', {}, '打出这张牌的玩家将成为你的队友'),
      );
      return;
    }

    if (g.phase === PHASE.PLAYING) {
      const myTurn = g.currentSeat === mySeat;
      let hint = myTurn ? '请出牌' : `等待 ${seatName(snap.seats, g.currentSeat)} 出牌…`;
      let can = myTurn && sel.length > 0;
      if (myTurn && sel.length) {
        const isLead = !g.trick || g.trick.plays.length === 0;
        if (isLead) {
          const c = comboOf(sel, order);
          if (!c) { can = false; hint = '首攻必须同一门花色'; }
          else hint = `${comboLabel(c)} · ${sel.length} 张`;
        } else {
          const leadCards = g.trick.plays[0].cards;
          const lead = comboOf(leadCards, order);
          const v = validateFollow({ hand: store.state.hand, played: sel, lead, order, strict: g.options?.strictFollow !== false });
          if (!v.ok) { can = false; hint = v.msg; } else hint = `跟牌 ${sel.length} 张`;
        }
      }
      box.append(
        h('button.primary', {
          disabled: !can,
          onclick: async () => { await tryCall(EV.GAME_PLAY, { cards: [...store.state.selected] }); clearSel(); },
        }, '出牌'),
        h('button.ghost', { onclick: clearSel }, '取消选择'),
        h('span', { class: `hint ${can || !sel.length ? '' : 'warn'}` }, hint),
      );
      return;
    }

    if (g.phase === PHASE.SETTLE) box.append(h('span.hint', {}, '本局结算中…'));
    if (g.phase === PHASE.FINISHED) {
      box.append(h('button.primary', { onclick: () => tryCall(EV.ROOM_READY, { ready: true }) }, '再来一局'));
    }
  }

  function comboLabel(c) {
    return { SINGLE: '单张', PAIR: '对子', TRIPLE: '三张', TRACTOR: `拖拉机(${c.comps[0].len} 连对)`, THROW: '甩牌' }[c.type] || c.type;
  }

  // ─────────── 顶栏 & 侧栏 ───────────
  function paintTop(state) {
    const snap = state.room;
    const box = clear(topBar);
    if (!snap) return;
    box.append(
      h('div.chip', {}, snap.room.name, ' ', h('b', {}, `#${snap.room.id}`)),
      h('div.chip', {}, snap.room.label),
      h('div.chip.small', {}, state.connected ? '🟢 已连接' : '🔴 断线重连中'),
      h('div.spacer'),
      h('button.sm.ghost', {
        onclick: () => { navigator.clipboard?.writeText(location.origin + `/#/room/${snap.room.id}`); toast('邀请链接已复制'); },
      }, '复制邀请'),
      h('button.sm.danger', {
        onclick: async () => { await tryCall(EV.ROOM_LEAVE); store.set({ view: 'lobby', room: null, hand: [] }); location.hash = '#/'; },
      }, '离开房间'),
    );
  }

  function paintSide() {
    const snap = store.state.room;
    const box = clear(sideBody);
    if (!snap) return;
    if (tab === 'chat') {
      for (const m of snap.messages || []) {
        box.append(h('div', { class: `msg ${m.kind}` },
          m.kind === 'system' ? m.text : [h('span.who', {}, `${m.from}：`), m.text]));
      }
      sideBody.scrollTop = sideBody.scrollHeight;
    } else if (tab === 'log') {
      if (!trickLog.length) box.append(h('div.muted.small', {}, '还没有出牌记录'));
      for (const t of trickLog) box.append(h('div.trick-log', {}, t));
    } else {
      for (const s of snap.seats) {
        box.append(h('div.row', {},
          h('span.tag', {}, `座位 ${s.seat + 1}`),
          h('span', {}, s.empty ? '空位' : s.name),
          h('div.spacer'),
          s.bot ? h('span.tag', {}, 'AI') : null,
          s.connected === false ? h('span.tag.red', {}, '离线') : null));
      }
      if (snap.spectators?.length) {
        box.append(h('div.section-title', {}, '观战'));
        for (const p of snap.spectators) box.append(h('div.muted.small', {}, p.name));
      }
    }
  }

  function update(state) {
    const snap = state.room;
    if (!snap) return;
    paintTop(state);
    table.update({
      game: snap.game,
      seats: snap.seats,
      mySeat: snap.me && snap.me.seat >= 0 ? snap.me.seat : null,
      hand: state.hand,
      selected: state.selected,
      onCardClick: toggleCard,
    });
    paintActions(state);
    paintSide();
  }

  return { el, update, destroy() { offs.forEach((f) => f()); table.destroy(); } };
}
