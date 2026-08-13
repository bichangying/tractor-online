// 端到端验证：单人建房 + 指定 AI 数量，应自动补位并自动开局
import { io } from 'socket.io-client';

const URL = process.env.URL || 'http://127.0.0.1:3000';
const MODE = Number(process.env.MODE || 4);
const BOTS = Number(process.env.BOTS || MODE - 1);

const s = io(URL, { auth: { name: '测试员' }, transports: ['websocket'] });
let started = false;
let seenSeats = '';

s.on('connect', () => {
  console.log('[connected]', s.id);
  s.emit('lobby:create', { name: '单测房', mode: MODE, botCount: BOTS, options: {} }, (ack) => {
    console.log('[create ack]', JSON.stringify(ack));
  });
});

s.on('room:state', (st) => {
  const hasGame = !!st?.game;
  const seats = (st?.seats || []).map((x) => (x?.empty ? '空' : (x?.bot ? 'AI' : (x?.name || '人')))).join(',');
  seenSeats = seats;
  console.log(`[room:state] game? ${hasGame} phase=${st?.game?.phase || '-'} seats=[${seats}]`);
  if (hasGame && !started) {
    started = true;
    console.log(`AUTO-START OK ✅ 模式${MODE} 房主+${BOTS}AI 已自动开局，座位=[${seats}]`);
    s.close();
    process.exit(0);
  }
});

s.on('game:event', (e) => console.log('[game:event]', e?.type));

s.on('connect_error', (e) => { console.log('[conn_error]', e.message); process.exit(2); });

setTimeout(() => {
  console.log(started ? 'done' : `TIMEOUT ❌ 未自动开局，最后座位=[${seenSeats}]`);
  s.close();
  process.exit(started ? 0 : 1);
}, 12000);
