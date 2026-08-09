import { h, clear, toast } from '../util/dom.js';
import { TableView } from '../render/tableView.js';
import { store } from '../store.js';

/**
 * 回放播放器：直接消费录制文件里的 snapshot 帧，不重跑引擎。
 * 支持 逐帧 / 自动播放 / 变速 / 拖动进度。
 */
export function createReplayView(replayId) {
  const table = new TableView({ interactive: false });
  const info = h('div.hud');
  const range = h('input', { type: 'range', min: 0, max: 0, value: 0, oninput: () => seek(Number(range.value)) });
  const tLabel = h('span.t', {}, '0 / 0');
  let playing = false, speed = 1, timer = null, data = null, idx = 0;

  const playBtn = h('button.sm.primary', { onclick: toggle }, '▶ 播放');
  const bar = h('div.replay-bar', {},
    h('button.sm.ghost', { onclick: () => seek(0) }, '⏮'),
    h('button.sm.ghost', { onclick: () => seek(idx - 1) }, '◀'),
    playBtn,
    h('button.sm.ghost', { onclick: () => seek(idx + 1) }, '▶'),
    range, tLabel,
    h('select', {
      style: { width: 'auto' },
      onchange: (e) => { speed = Number(e.target.value); if (playing) { stop(); start(); } },
    }, [0.5, 1, 2, 4, 8].map((s) => h('option', { value: s, selected: s === 1 }, `${s}×`))),
    h('button.sm.ghost', { onclick: () => { location.hash = '#/'; } }, '返回大厅'),
  );

  const el = h('div', { style: { flex: '1', display: 'flex', flexDirection: 'column', minHeight: '0' } },
    info, h('div.game', {}, table.root), bar);

  function seatsOf() {
    return (data?.seats || []).map((s, i) => ({ seat: i, name: s.name, bot: s.bot, connected: true }));
  }

  function paint() {
    const f = data?.frames?.[idx];
    const box = clear(info);
    box.append(
      h('div.chip', {}, '回放 ', h('b', {}, data?.matchId || replayId)),
      h('div.chip', {}, `${data?.mode || '?'} 人局`),
      h('div.chip', {}, '事件 ', h('b', {}, f?.type || '-')),
      h('div.spacer'),
      h('div.chip.small', {}, new Date(data?.createdAt || Date.now()).toLocaleString('zh-CN')),
    );
    table.update({ game: f?.snapshot || null, seats: seatsOf(), mySeat: null, hand: [], selected: new Set() });
    tLabel.textContent = `${idx + 1} / ${data?.frames?.length || 0}`;
    range.value = String(idx);
  }

  function seek(i) {
    if (!data) return;
    idx = Math.max(0, Math.min(data.frames.length - 1, i));
    paint();
  }

  function start() {
    playing = true; playBtn.textContent = '⏸ 暂停';
    timer = setInterval(() => {
      if (!data || idx >= data.frames.length - 1) return stop();
      idx++; paint();
    }, 650 / speed);
  }
  function stop() { playing = false; playBtn.textContent = '▶ 播放'; clearInterval(timer); timer = null; }
  function toggle() { playing ? stop() : start(); }

  (async () => {
    try {
      const res = await fetch(`/api/replays/${encodeURIComponent(replayId)}`);
      const j = await res.json();
      if (!j.ok) throw new Error('回放不存在');
      data = j.replay;
      range.max = String(Math.max(0, data.frames.length - 1));
      store.set({ replay: data });
      paint();
    } catch (e) {
      toast(e.message || '加载回放失败', 'err');
      location.hash = '#/';
    }
  })();

  return { el, update() {}, destroy() { stop(); table.destroy(); } };
}
