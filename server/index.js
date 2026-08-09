import express from 'express';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';

import { RoomManager } from './core/RoomManager.js';
import { registerSockets } from './socket/index.js';
import { listReplays, readReplay } from './core/Recorder.js';
import { MODE_CONFIG, SUPPORTED_MODES, DEFAULT_OPTIONS } from '../shared/config.js';
import { createLogger } from './util/logger.js';

const log = createLogger('http');
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT || 3000);

const app = express();
app.use(express.json());
app.use('/shared', express.static(path.join(ROOT, 'shared'), { extensions: ['js'] }));
app.use('/', express.static(path.join(ROOT, 'client')));

app.get('/api/health', (_req, res) => res.json({ ok: true, up: process.uptime() }));
app.get('/api/modes', (_req, res) => res.json({
  ok: true, modes: SUPPORTED_MODES.map((m) => ({ mode: m, ...MODE_CONFIG[m] })), defaults: DEFAULT_OPTIONS,
}));
app.get('/api/rooms', (_req, res) => res.json({ ok: true, rooms: rm.list() }));
app.get('/api/replays', (_req, res) => res.json({ ok: true, replays: listReplays() }));
app.get('/api/replays/:id', (req, res) => {
  const r = readReplay(req.params.id);
  if (!r) return res.status(404).json({ ok: false, msg: 'not found' });
  res.json({ ok: true, replay: r });
});
// SPA 兜底
app.get('*', (_req, res) => res.sendFile(path.join(ROOT, 'client', 'index.html')));

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*' },
  pingInterval: 20000,
  pingTimeout: 25000,
});

const rm = new RoomManager(io);
registerSockets(io, rm);

httpServer.listen(PORT, () => {
  log.info(`拖拉机 Online 已启动 → http://localhost:${PORT}`);
});

process.on('SIGINT', () => {
  log.info('shutting down…');
  for (const r of rm.rooms.values()) r.dispose();
  process.exit(0);
});
