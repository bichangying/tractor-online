const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const CURRENT = LEVELS[process.env.LOG_LEVEL || 'info'] ?? 20;

function ts() { return new Date().toISOString().slice(11, 23); }

function out(level, tag, args) {
  if (LEVELS[level] < CURRENT) return;
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  fn(`[${ts()}] ${level.toUpperCase().padEnd(5)} ${tag ? `(${tag}) ` : ''}`, ...args);
}

export function createLogger(tag = '') {
  return {
    debug: (...a) => out('debug', tag, a),
    info: (...a) => out('info', tag, a),
    warn: (...a) => out('warn', tag, a),
    error: (...a) => out('error', tag, a),
  };
}

export const log = createLogger();
