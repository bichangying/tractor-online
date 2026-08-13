import { h, clear, modal, toast } from '../util/dom.js';
import { store, saveIdentity } from '../store.js';
import { call, tryCall, socket } from '../net.js';
import { EV } from '/shared/constants.js';
import { MODE_CONFIG, SUPPORTED_MODES } from '/shared/config.js';

export function createLobbyView() {
  const el = h('div.lobby');
  const list = h('div.grid');
  const replayList = h('div.grid');

  const nameInput = h('input', {
    value: store.state.me.name || '', maxlength: 12, placeholder: '昵称',
    onchange: (e) => {
      saveIdentity(null, e.target.value.trim() || '玩家');
      if (socket) socket.auth.name = store.state.me.name;
      toast('昵称已更新，下次连接生效');
    },
  });

  const head = h('div.lobby-head', {},
    h('div.logo', {}, '拖拉机 ', h('span', {}, 'Online')),
    h('span.tag', {}, '4 / 5 / 6 人'),
    h('div.spacer'),
    h('div.me-box', {}, h('span.muted.small', {}, '我：'), nameInput),
    h('button.primary', { onclick: openCreate }, '＋ 创建房间'),
    h('button', { onclick: () => openQuick() }, '⚡ 快速开始'),
    h('button.ghost', { onclick: refresh }, '刷新'),
  );

  el.append(head,
    h('div.section-title', {}, '房间列表'),
    list,
    h('div.section-title', {}, '对局回放'),
    replayList);

  async function refresh() {
    const r = await tryCall(EV.LOBBY_LIST);
    if (r) store.set({ rooms: r.rooms });
    loadReplays();
  }

  async function loadReplays() {
    try {
      const res = await fetch('/api/replays');
      const j = await res.json();
      renderReplays(j.replays || []);
    } catch { renderReplays([]); }
  }

  function renderReplays(items) {
    const box = clear(replayList);
    if (!items.length) { box.append(h('div.empty', {}, '暂无回放，打完一局后自动生成')); return; }
    for (const r of items) {
      box.append(h('div.panel.room-card', { onclick: () => { location.hash = `#/replay/${r.id}`; } },
        h('div.rc-top', {}, h('span.rc-name', {}, `${r.mode || '?'} 人局`), h('div.spacer'),
          h('span.tag', {}, `${r.frames || 0} 帧`)),
        h('div.muted.small', {}, (r.seats || []).map((s) => s.name).join(' · ')),
        h('div.muted.small', {}, new Date(r.createdAt || Date.now()).toLocaleString('zh-CN')),
      ));
    }
  }

  function openQuick() {
    const box = h('div', {},
      h('div.field', {}, h('label', {}, '选择人数'),
        h('div.mode-pick', {}, SUPPORTED_MODES.map((m) =>
          h('button', { onclick: async () => { m1.close(); const r = await tryCall(EV.LOBBY_QUICK, { mode: m }); if (r) toast(`已加入 ${r.roomId}`); } },
            `${m} 人`)))),
      h('div.muted.small', {}, '会自动匹配一个未开局的公开房间，没有就新建一个。'));
    const m1 = modal(h('div.modal', {}, h('h3', {}, '快速开始'), box));
  }

  function openCreate() {
    let mode = 4;
    const nameF = h('input', { value: `${store.state.me.name || '玩家'}的房间`, maxlength: 20 });
    const pwdF = h('input', { placeholder: '留空则公开', maxlength: 12 });
    const strict = h('input', { type: 'checkbox', checked: true });
    const allowThrow = h('input', { type: 'checkbox', checked: true });
    const specSee = h('input', { type: 'checkbox' });
    let botN = mode - 1;
    const botOptions = () => Array.from({ length: mode }, (_, n) =>
      h('button', {
        class: n === botN ? 'on' : '',
        onclick: (e) => {
          botN = n;
          [...e.target.parentNode.children].forEach((b) => b.classList.remove('on'));
          e.target.classList.add('on');
        },
      }, n === mode - 1 ? '补满' : `${n} 个`));
    const botBtns = h('div.mode-pick', {}, botOptions());
    const modeBtns = SUPPORTED_MODES.map((m) =>
      h('button', {
        class: m === 4 ? 'on' : '',
        onclick: (e) => {
          mode = m;
          botN = Math.min(botN, mode - 1);
          botBtns.replaceChildren(...botOptions());
          [...e.target.parentNode.children].forEach((b) => b.classList.remove('on'));
          e.target.classList.add('on');
          desc.textContent = MODE_CONFIG[m].label + ` · 每人 ${MODE_CONFIG[m].hand} 张 · 底牌 ${MODE_CONFIG[m].kitty} 张`;
        },
      }, `${m} 人`));
    const desc = h('div.muted.small', {}, MODE_CONFIG[4].label + ` · 每人 ${MODE_CONFIG[4].hand} 张 · 底牌 ${MODE_CONFIG[4].kitty} 张`);

    const body = h('div.modal', {},
      h('h3', {}, '创建房间'),
      h('div.field', {}, h('label', {}, '房间名'), nameF),
      h('div.field', {}, h('label', {}, '人数模式'), h('div.mode-pick', {}, modeBtns), desc),
      h('div.field', {}, h('label', {}, '房间密码（可选）'), pwdF),
      h('div.field', {}, h('label', {}, 'AI 玩家（单人也能开）'), botBtns,
        h('div.muted.small', {}, '选「补满」= 你 + AI 自动开局；也可选较少数量，进房后再手动「＋ 添加 AI」')),
      h('div.field', {},
        h('label', {}, '玩法选项'),
        h('label.switch', {}, strict, '严格跟牌（对子 / 拖拉机必须跟）'),
        h('label.switch', {}, allowThrow, '允许甩牌'),
        h('label.switch', {}, specSee, '观战者可见所有手牌')),
      h('div.row', {}, h('div.spacer'),
        h('button.ghost', { onclick: () => m2.close() }, '取消'),
        h('button.primary', {
          onclick: async () => {
            const r = await tryCall(EV.LOBBY_CREATE, {
              name: nameF.value.trim(), mode, password: pwdF.value.trim(), botCount: botN,
              options: { strictFollow: strict.checked, allowThrow: allowThrow.checked, spectatorSeeAll: specSee.checked },
            });
            if (r) { m2.close(); toast(`房间 ${r.roomId} 已创建`); }
          },
        }, '创建')));
    const m2 = modal(body);
  }

  async function joinRoom(room) {
    if (room.hasPassword) {
      const pf = h('input', { placeholder: '房间密码' });
      const m3 = modal(h('div.modal', {}, h('h3', {}, `加入 ${room.name}`),
        h('div.field', {}, h('label', {}, '密码'), pf),
        h('div.row', {}, h('div.spacer'),
          h('button.primary', {
            onclick: async () => {
              const r = await tryCall(EV.LOBBY_JOIN, { roomId: room.id, password: pf.value, seat: null, autoSit: true });
              if (r) m3.close();
            },
          }, '进入'))));
      return;
    }
    await tryCall(EV.LOBBY_JOIN, { roomId: room.id });
  }

  function update(state) {
    const box = clear(list);
    if (!state.rooms.length) {
      box.append(h('div.empty', {}, '还没有房间，点右上角「创建房间」开一桌 🀄'));
    }
    for (const r of state.rooms) {
      box.append(h('div.panel.room-card', { onclick: () => joinRoom(r) },
        h('div.rc-top', {},
          h('span.rc-name', {}, r.name),
          h('span.rc-id', {}, `#${r.id}`),
          h('div.spacer'),
          r.hasPassword ? h('span.tag', {}, '🔒') : null,
          h('span', { class: `tag ${r.playing ? 'red' : 'blue'}` }, r.playing ? '对局中' : '等待中')),
        h('div.row', {},
          h('span.tag.gold', {}, r.label),
          h('div.spacer'),
          h('div.seat-dots', {}, Array.from({ length: r.capacity }, (_, i) =>
            h('i', { class: i < r.seated ? 'on' : '' })))),
        h('div.muted.small', {}, `${r.seated}/${r.capacity} 人在座 · ${r.spectators} 人观战`),
      ));
    }
  }

  refresh();
  return { el, update, destroy() {} };
}
