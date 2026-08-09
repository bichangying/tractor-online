/**
 * 人数模式配置表 —— 4 / 5 / 6 人
 *
 *  人数  牌副数  总牌数  底牌  每人手牌  组队方式
 *   4      2      108     8      25      固定 2v2（座位交替）
 *   5      3      162     7      31      叫朋友（庄 +1 friend vs 3）
 *   6      3      162     6      26      固定 3v3（座位交替）
 */
export const MODE_CONFIG = {
  4: { players: 4, decks: 2, kitty: 8, hand: 25, teamMode: 'FIXED', teamSize: 2, label: '4 人 · 2 副牌 · 2v2' },
  5: { players: 5, decks: 3, kitty: 7, hand: 31, teamMode: 'CALL_FRIEND', teamSize: 0, label: '5 人 · 3 副牌 · 叫朋友' },
  6: { players: 6, decks: 3, kitty: 6, hand: 26, teamMode: 'FIXED', teamSize: 3, label: '6 人 · 3 副牌 · 3v3' },
};

export const SUPPORTED_MODES = [4, 5, 6];

export const DEFAULT_OPTIONS = {
  startLevel: '2',        // 起始级牌
  winLevel: 'A',          // 打到该级别即整场结束
  strictFollow: true,     // 严格跟牌（对子/拖拉机必须跟）
  allowThrow: true,       // 允许甩牌
  dealIntervalMs: 110,    // 发牌节奏
  declareGraceMs: 4000,   // 发完牌后亮主宽限
  buryTimeoutMs: 60000,   // 扣底超时
  playTimeoutMs: 30000,   // 出牌超时（超时托管）
  kittyMultiplier: 'byCount', // 底牌翻倍：byCount = 2 × 最后一墩获胜牌张数
  spectatorSeeAll: false, // 观战是否可见所有手牌
  botDelayMin: 550,
  botDelayMax: 1300,
  recordReplay: true,
};

export function normalizeOptions(opt = {}) {
  const out = { ...DEFAULT_OPTIONS };
  for (const k of Object.keys(DEFAULT_OPTIONS)) {
    if (opt[k] !== undefined && opt[k] !== null) out[k] = opt[k];
  }
  return out;
}
