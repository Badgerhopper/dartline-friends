import type { DartPoint } from '../../shared/vision/types';

/** The server's old repeat radius was ~1.7 mm; a camera can shift a stationary
 * projected tip by much more than that between homographies. We match observed
 * tips to existing darts one-to-one so a second *visible* close dart can still
 * survive alongside the old one.
 */
export const SAME_CAMERA_REPEAT_RADIUS = 14500; // ~6.54 mm on 451-mm board
export interface KnownCameraDart {
  observations: ReadonlyArray<DartPoint>;
}

/**
 * Return the indices of input tips which are re-sightings of known darts.
 * A previously recorded dart can consume only ONE tip per camera per frame.
 * Without this limit, a new real dart close to an existing one would vanish.
 */
export function matchKnownCameraTips(
  tips: readonly DartPoint[], tracked: readonly KnownCameraDart[],
): Set<number> {
  type Pair = { tipIndex: number; dartIndex: number; camera: string; distance: number };
  const pairs: Pair[] = [];
  tips.forEach((tip, tipIndex) => {
    if (!Number.isFinite(tip.x) || !Number.isFinite(tip.y)) return;
    tracked.forEach((dart, dartIndex) => {
      let best = Infinity;
      for (const observation of dart.observations) {
        if (observation.deviceId !== tip.deviceId) continue;
        const d = Math.hypot(tip.x - observation.x, tip.y - observation.y);
        if (d < best) best = d;
      }
      if (best < SAME_CAMERA_REPEAT_RADIUS) {
        pairs.push({tipIndex, dartIndex, camera: tip.deviceId, distance: best});
      }
    });
  });
  pairs.sort((a,b) => a.distance - b.distance);
  const seenTips = new Set<number>();
  const claimed = new Set<string>();
  for (const pair of pairs) {
    const key = pair.dartIndex + ':' + pair.camera;
    if (seenTips.has(pair.tipIndex) || claimed.has(key)) continue;
    seenTips.add(pair.tipIndex);
    claimed.add(key);
  }
  return seenTips;
}
