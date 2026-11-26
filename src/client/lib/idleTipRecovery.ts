import type { BoardTip } from '../../shared/vision/types';

/**
 * Recover a missed throw even when motion gating saw no impact. Background
 * camera frames are NOT scored directly: tips must recur at nearly the same
 * position in independent completed model inferences.
 *
 * Normal impact-triggered scoring and the server's one-to-one duplicate guard
 * remain authoritative. This is a conservative second chance, not a license
 * to score every pixel the model calls a tip.
 */
export const IDLE_RECOVERY_INTERVAL_MS = 2200;
export const IDLE_RECOVERY_MIN_SEPARATION_MS = 800;
export const IDLE_RECOVERY_MAX_GAP_MS = 7500;
export const IDLE_RECOVERY_MATCH_RADIUS = 14500; // 6.54mm board plane
export const IDLE_RECOVERY_MIN_CONFIDENCE = 0.50;
export const IDLE_RECOVERY_STRONG_CONFIDENCE = 0.80;
const DOUBLE_OUTER_RADIUS = 170 * (1_000_000 / 451);

type Candidate = {
  observations: BoardTip[];
  count: number;
  lastSeen: number;
  emitted: boolean;
};

function valid(tip: BoardTip): boolean {
  return Number.isFinite(tip.x) && Number.isFinite(tip.y) &&
    Number.isFinite(tip.confidence) &&
    tip.x >= 0 && tip.x <= 1_000_000 &&
    tip.y >= 0 && tip.y <= 1_000_000 &&
    tip.confidence >= IDLE_RECOVERY_MIN_CONFIDENCE &&
    // The old continuous scan hallucinated "MISS" outside the scoring area.
    // Keep physical misses editable manually until external board-tip samples
    // show those predictions are reliable enough to register automatically.
    Math.hypot(tip.x - 500000, tip.y - 500000) <= DOUBLE_OUTER_RADIUS;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[index] : (sorted[index - 1] + sorted[index]) / 2;
}

function representative(candidate: Candidate): BoardTip {
  const window = candidate.observations.slice(-3);
  return {
    x: Math.round(median(window.map((o) => o.x))),
    y: Math.round(median(window.map((o) => o.y))),
    confidence: Math.max(...window.map((o) => o.confidence)),
  };
}

/**
 * A high-confidence tip needs two different completed scans; a weak, rescued
 * tip needs at least three. The scan interval is independent of motion events.
 * Each tracked candidate may be published once until a genuine empty scan or
 * a long gap removes it.
 */
export class IdleTipRecovery {
  private candidates: Candidate[] = [];
  private lastScanAt = 0;

  reset(): void {
    this.candidates = [];
    this.lastScanAt = 0;
  }

  observe(tips: readonly BoardTip[], now: number): BoardTip[] {
    if (!Number.isFinite(now) || now <= 0) return [];
    // Never count two callbacks or stale frames as independent evidence.
    if (this.lastScanAt && now - this.lastScanAt < IDLE_RECOVERY_MIN_SEPARATION_MS) return [];
    this.lastScanAt = now;

    const eligible = tips.filter(valid);
    if (!eligible.length) {
      this.candidates = [];
      return [];
    }

    const prior = this.candidates.filter(c =>
      now >= c.lastSeen && now - c.lastSeen <= IDLE_RECOVERY_MAX_GAP_MS
    );
    const next: Candidate[] = [];
    const usedPrior = new Set<number>();
    const sorted = [...eligible].sort((a, b) => b.confidence - a.confidence);

    for (const tip of sorted) {
      let nearest = -1;
      let best = Infinity;
      for (let i = 0; i < prior.length; i++) {
        if (usedPrior.has(i)) continue;
        const prev = representative(prior[i]);
        const distance = Math.hypot(tip.x - prev.x, tip.y - prev.y);
        if (distance < IDLE_RECOVERY_MATCH_RADIUS && distance < best) {
          nearest = i;
          best = distance;
        }
      }
      if (nearest >= 0) usedPrior.add(nearest);
      const previous = nearest >= 0 ? prior[nearest] : null;
      next.push({
        observations: [...(previous?.observations ?? []).slice(-2), tip],
        count: (previous?.count ?? 0) + 1,
        lastSeen: now,
        emitted: previous?.emitted ?? false,
      });
    }

    const newlyConfirmed: BoardTip[] = [];
    for (const candidate of next) {
      if (candidate.emitted) continue;
      const strongest = Math.max(...candidate.observations.map(o => o.confidence));
      const required = strongest >= IDLE_RECOVERY_STRONG_CONFIDENCE ? 2 : 3;
      if (candidate.count < required) continue;
      candidate.emitted = true;
      newlyConfirmed.push(representative(candidate));
    }
    this.candidates = next;
    return newlyConfirmed;
  }
}
