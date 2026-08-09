import { randomBytes } from 'node:crypto';

const ROOM_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

export function roomCode(len = 5) {
  const b = randomBytes(len);
  let s = '';
  for (let i = 0; i < len; i++) s += ROOM_ALPHABET[b[i] % ROOM_ALPHABET.length];
  return s;
}

export function uid(prefix = '') {
  return prefix + randomBytes(8).toString('hex');
}

export function matchId() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${randomBytes(3).toString('hex')}`;
}

export function randInt(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }
