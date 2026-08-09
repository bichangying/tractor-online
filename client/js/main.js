import { store } from './store.js';
import { connect, tryCall } from './net.js';
import { createLobbyView } from './views/lobby.js';
import { createRoomView } from './views/room.js';
import { createReplayView } from './views/replay.js';
import { clear } from './util/dom.js';
import { EV } from '/shared/constants.js';

const app = document.getElementById('app');
let current = null;   // { name, key, view }

function parseHash() {
  const m = (location.hash || '#/').replace(/^#/, '');
  const seg = m.split('/').filter(Boolean);
  if (seg[0] === 'room' && seg[1]) return { name: 'room', id: seg[1].toUpperCase() };
  if (seg[0] === 'replay' && seg[1]) return { name: 'replay', id: seg[1] };
  return { name: 'lobby' };
}

function mount(name, key, factory) {
  if (current && current.name === name && current.key === key) return current.view;
  current?.view.destroy?.();
  clear(app);
  const view = factory();
  app.append(view.el);
  current = { name, key, view };
  return view;
}

function render(state) {
  const route = parseHash();

  if (route.name === 'replay') {
    if (state.view !== 'replay') store.state.view = 'replay';
    mount('replay', route.id, () => createReplayView(route.id));
    return;
  }
  if (state.view === 'replay') store.state.view = state.room ? 'room' : 'lobby';

  if (state.room) {
    const v = mount('room', state.room.room.id, createRoomView);
    if (location.hash !== `#/room/${state.room.room.id}`) {
      history.replaceState(null, '', `#/room/${state.room.room.id}`);
    }
    v.update(state);
  } else {
    const v = mount('lobby', '', createLobbyView);
    if (location.hash && location.hash !== '#/') history.replaceState(null, '', '#/');
    v.update(state);
  }
}

window.addEventListener('hashchange', () => {
  const r = parseHash();
  if (r.name === 'room' && (!store.state.room || store.state.room.room.id !== r.id)) {
    tryCall(EV.LOBBY_JOIN, { roomId: r.id });
  }
  store.emit();
});

store.sub(render);
connect();
render(store.state);

// 深链接：直接打开 #/room/XXXX 时自动加入
const boot = parseHash();
if (boot.name === 'room') {
  const t = setInterval(() => {
    if (!store.state.connected) return;
    clearInterval(t);
    if (!store.state.room) tryCall(EV.LOBBY_JOIN, { roomId: boot.id });
  }, 200);
}
