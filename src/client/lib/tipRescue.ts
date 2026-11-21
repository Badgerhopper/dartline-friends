import type { BoardTip } from '../../shared/vision/types';

/**
 * Original InstaDarts keeps its conservative 0.80 tip-confidence setting.
 * This auxiliary detector only publishes relaxed (>=0.50) predictions after
 * the *same* physical tip appears in two consecutive camera inferences.
 * It is not a substitute for a trained model that cannot see the tip at all.
 */
export const RELAXED_TIP_THRESHOLD = 0.50;
const MATCH_RADIUS = 15000; // 6.77 mm in 451 mm board coordinates
const MAX_GAP_MS = 4500;
const DOUBLE_OUTER_RADIUS = 170 * (1_000_000 / 451);

function scoreSurface(t: BoardTip): boolean {
  const r = Math.hypot(t.x - 500000, t.y - 500000);
  return Number.isFinite(r) && r <= DOUBLE_OUTER_RADIUS
    && Number.isFinite(t.confidence) && t.confidence >= RELAXED_TIP_THRESHOLD;
}
function nearby(a: BoardTip, b: BoardTip): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) <= MATCH_RADIUS;
}
type Candidate = { tip: BoardTip; hits: number; lastSeen: number };

/** Stateful across inferences but always reset on a camera change. */
export class StableTipRescue {
  private previous: Candidate[] = [];
  reset(): void { this.previous = []; }

  observe(tips: readonly BoardTip[], now: number): BoardTip[] {
    const eligible = tips.filter(scoreSurface);
    const prior = this.previous.filter((c) => now - c.lastSeen >= 0 && now - c.lastSeen <= MAX_GAP_MS);
    const used = new Set<number>();
    const next: Candidate[] = [];
    const confirmed: BoardTip[] = [];
    for (const tip of eligible) {
      let match = -1;
      let best = Infinity;
      for (let i = 0; i < prior.length; i++) {
        if (used.has(i)) continue;
        const distance = Math.hypot(tip.x - prior[i].tip.x, tip.y - prior[i].tip.y);
        if (distance <= MATCH_RADIUS && distance < best) { best = distance; match = i; }
      }
      if (match >= 0) used.add(match);
      const hits = match >= 0 ? prior[match].hits + 1 : 1;
      next.push({tip, hits, lastSeen: now});
      if (hits >= 2) confirmed.push(tip);
    }
    // Missing predictions must break a streak: we do not trust sporadic noise.
    this.previous = next;
    return confirmed;
  }
}

export function mergeRescuedTips(strict: readonly BoardTip[], rescued: readonly BoardTip[]): BoardTip[] {
  const result = [...strict];
  for (const t of rescued) if (!result.some((s) => nearby(s, t))) result.push(t);
  return result;
}
