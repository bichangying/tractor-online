/** 全局状态（极简观察者） */
const LS_ID = 'tractor.playerId';
const LS_NAME = 'tractor.name';

export const store = {
  state: {
    view: 'lobby',        // lobby | room | replay
    me: { id: localStorage.getItem(LS_ID) || null, name: localStorage.getItem(LS_NAME) || '' },
    rooms: [],
    room: null,           // Room 快照（含 game）
    hand: [],             // 本地手牌（发牌动画期间增量维护）
    selected: new Set(),
    connected: false,
    replay: null,
  },
  subs: new Set(),
  set(patch) { Object.assign(this.state, patch); this.emit(); },
  emit() { for (const f of [...this.subs]) f(this.state); },
  sub(f) { this.subs.add(f); return () => this.subs.delete(f); },
};

export function saveIdentity(id, name) {
  if (id) localStorage.setItem(LS_ID, id);
  if (name) localStorage.setItem(LS_NAME, name);
  store.state.me = { id: id || store.state.me.id, name: name || store.state.me.name };
}

export function randomName() {
  const a = ['快乐', '闪电', '无敌', '沉稳', '一击', '摸鱼', '硬核', '低调'];
  const b = ['小拖', '拖拉机', '甩牌王', '大王', '扣底手', '主宰', '闲家'];
  return a[Math.floor(Math.random() * a.length)] + b[Math.floor(Math.random() * b.length)];
}
