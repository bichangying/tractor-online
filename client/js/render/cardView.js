import { h } from '../util/dom.js';
import { SUIT_SYMBOL } from '/shared/constants.js';

const RED = new Set(['H', 'D']);

export function cardEl(card, { size = '', picked = false, pickable = false, dim = false, onclick } = {}) {
  if (!card) return h('div.card.back', { class: size });
  const isJoker = card.s === 'T';
  const cls = [
    'card', size,
    isJoker ? `joker ${card.r === 'bj' ? 'big' : 'small'}` : (RED.has(card.s) ? 'red' : 'black'),
    picked ? 'picked' : '', pickable ? 'pickable' : '', dim ? 'dim' : '',
  ].filter(Boolean).join(' ');

  const el = h('div', { class: cls, dataset: { id: card.id } });
  if (isJoker) {
    el.append(h('div.r', {}, card.r === 'bj' ? '大王' : '小王'));
  } else {
    el.append(
      h('div.corner', {}, card.r === '10' ? '10' : card.r),
      h('div.r', {}, card.r === '10' ? '10' : card.r),
      h('div.s', {}, SUIT_SYMBOL[card.s]),
    );
  }
  if (onclick) el.addEventListener('click', () => onclick(card));
  return el;
}

export function backRow(count, size = 'xs', max = 12) {
  const row = h('div.card-row.stack');
  const n = Math.min(count, max);
  for (let i = 0; i < n; i++) row.append(h('div', { class: `card back ${size}` }));
  return row;
}

export function suitSpan(suit) {
  if (!suit) return h('span.suit', {}, '—');
  if (suit === 'NT') return h('span.suit', {}, '无主');
  return h('span', { class: `suit ${RED.has(suit) ? 'red' : 'black'}` }, SUIT_SYMBOL[suit]);
}
