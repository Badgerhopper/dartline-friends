import type { BoardTip } from '../../shared/vision/types';

/**
 * Secondary tip recovery using the original InstaDarts model. Weak predictions
 * are not accepted until repeated at the same board coordinate. A dart may
 * disappear for a frame without resetting that evidence. The reported location
 * stays anchored after confirmation so repeated scans do not double count it.
 */
export const RELAXED_TIP_THRESHOLD = 0.42;
export const TIP_MATCH_RADIUS = 10500; // ~4.7mm; keep a stationary dart anchored despite tip jitter
const MAX_GAP_MS = 2300;
// Do not auto-create zero-point darts from low-confidence noise on the board
// surround. A user can still enter an actual outer-board miss manually.
// This is intentionally conservative until a dart-vs-background classifier
// is validated on a physical board.
const VALID_BOARD_RADIUS = 170 * (1_000_000 / 451);
const STANDARD_CONFIRMATIONS = 2;
const VERY_WEAK_CONFIRMATIONS = 3;
const VERY_WEAK_THRESHOLD = 0.50;

type Candidate = {
  anchor: BoardTip;
  lastSeen: number;
  hits: number;
  peakConfidence: number;
};

function validTip(t: BoardTip): boolean {
  if (!Number.isFinite(t.x) || !Number.isFinite(t.y) || !Number.isFinite(t.confidence)) return false;
  if (t.confidence < RELAXED_TIP_THRESHOLD) return false;
  return Math.hypot(t.x - 500000, t.y - 500000) <= VALID_BOARD_RADIUS;
}

function distance(a: BoardTip, b: BoardTip): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Evidence accumulator for the lifetime of one running camera. */
export class StableTipRescue {
  private candidates: Candidate[] = [];

  reset(): void { this.candidates = []; }

  observe(tips: readonly BoardTip[], now: number): BoardTip[] {
    if (!Number.isFinite(now)) return [];
    const recent = this.candidates.filter(c => now >= c.lastSeen && now - c.lastSeen <= MAX_GAP_MS);
    const matched = new Set<number>();
    const next = [...recent];
    const confirmed: BoardTip[] = [];

    // Highest-confidence candidates get first choice of matching an existing
    // anchor; a second close-by dart gets its own track, not a duplicate of one.
    for (const tip of tips.filter(validTip).sort((a, b) => b.confidence - a.confidence)) {
      let best = -1;
      let bestDistance = TIP_MATCH_RADIUS;
      for (let i = 0; i < recent.length; i++) {
        if (matched.has(i)) continue;
        const d = distance(tip, recent[i].anchor);
        if (d <= bestDistance) {
          best = i;
          bestDistance = d;
        }
      }
      if (best < 0) {
        next.push({ anchor: { ...tip }, lastSeen: now, hits: 1, peakConfidence: tip.confidence });
        continue;
      }
      matched.add(best);
      const item = next[best];
      // The first weak location can be off by a few mm. Before the dart is
      // confirmed, average successive weak sightings so the ring position
      // is less sensitive to one noisy frame. High-confidence sightings
      // stay anchored to avoid re-scoring the same existing dart.
      const wasUnconfirmed = item.hits < (item.peakConfidence >= VERY_WEAK_THRESHOLD
        ? STANDARD_CONFIRMATIONS : VERY_WEAK_CONFIRMATIONS);
      if (wasUnconfirmed && item.peakConfidence < 0.8) {
        if (tip.confidence >= 0.8) {
          item.anchor = { ...tip };
        } else {
          item.anchor = {
            x: Math.round((item.anchor.x * item.hits + tip.x) / (item.hits + 1)),
            y: Math.round((item.anchor.y * item.hits + tip.y) / (item.hits + 1)),
            confidence: Math.max(item.anchor.confidence, tip.confidence),
          };
        }
      }
      item.hits += 1;
      item.lastSeen = now;
      item.peakConfidence = Math.max(item.peakConfidence, tip.confidence);
      const needed = item.peakConfidence >= VERY_WEAK_THRESHOLD
        ? STANDARD_CONFIRMATIONS : VERY_WEAK_CONFIRMATIONS;
      if (item.hits >= needed) {
        // Never publish the drifting tip position; it would look like a second
        // nearby dart to the server's tighter repeat filter.
        confirmed.push({ ...item.anchor, confidence: item.peakConfidence });
      }
    }
    this.candidates = next;
    return confirmed;
  }
}

/** Anchor a strict (immediate) detection to its previously observed position
 * when possible; append remaining stable weak tips once each. */
export function mergeRescuedTips(strict: readonly BoardTip[], rescued: readonly BoardTip[]): BoardTip[] {
  const result = strict.map(t => ({...t}));
  const used = new Set<number>();
  for (const stable of rescued) {
    let best = -1;
    let bestDistance = TIP_MATCH_RADIUS;
    for (let i = 0; i < result.length; i++) {
      if (used.has(i)) continue;
      const d = distance(result[i], stable);
      if (d <= bestDistance) {
        best = i;
        bestDistance = d;
      }
    }
    if (best >= 0) {
      used.add(best);
      result[best] = { ...stable, confidence: Math.max(result[best].confidence, stable.confidence) };
    } else {
      result.push({...stable});
      used.add(result.length - 1);
    }
  }
  return result;
}
