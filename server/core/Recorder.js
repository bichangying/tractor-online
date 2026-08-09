import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLogger } from '../util/logger.js';

const log = createLogger('replay');
const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPLAY_DIR = path.resolve(__dirname, '../../data/replays');

function ensureDir() {
  if (!fs.existsSync(REPLAY_DIR)) fs.mkdirSync(REPLAY_DIR, { recursive: true });
}

/**
 * 回放录制器
 * 文件结构：
 * {
 *   matchId, mode, options, seed, createdAt, seats:[{name,bot}],
 *   frames: [ { t, type, payload, snapshot } ]   // snapshot 为公开视角，可直接喂给渲染层
 * }
 * 前端 /js/views/replay.js 逐帧播放，无需重跑引擎。
 */
export class Recorder {
  constructor({ matchId, mode, options, seed, seats }) {
    this.data = {
      version: 1,
      matchId, mode, options, seed,
      createdAt: new Date().toISOString(),
      seats: seats.map((s) => ({ name: s.name, bot: !!s.bot })),
      frames: [],
    };
    this.t0 = Date.now();
    this.dirty = false;
  }

  push(type, payload, snapshot) {
    this.data.frames.push({ t: Date.now() - this.t0, type, payload, snapshot });
    this.dirty = true;
    if (this.data.frames.length > 20000) this.data.frames.shift();
  }

  save() {
    if (!this.dirty) return null;
    try {
      ensureDir();
      const file = path.join(REPLAY_DIR, `${this.data.matchId}.json`);
      fs.writeFileSync(file, JSON.stringify(this.data));
      this.dirty = false;
      log.info('saved', this.data.matchId, `${this.data.frames.length} frames`);
      return file;
    } catch (e) {
      log.error('save failed', e);
      return null;
    }
  }
}

export function listReplays(limit = 50) {
  ensureDir();
  return fs.readdirSync(REPLAY_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort().reverse().slice(0, limit)
    .map((f) => {
      const p = path.join(REPLAY_DIR, f);
      const st = fs.statSync(p);
      let head = {};
      try {
        const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
        head = { mode: raw.mode, seats: raw.seats, frames: raw.frames.length, createdAt: raw.createdAt };
      } catch { /* ignore */ }
      return { id: f.replace(/\.json$/, ''), size: st.size, ...head };
    });
}

export function readReplay(id) {
  ensureDir();
  const safe = String(id).replace(/[^\w-]/g, '');
  const p = path.join(REPLAY_DIR, `${safe}.json`);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}
