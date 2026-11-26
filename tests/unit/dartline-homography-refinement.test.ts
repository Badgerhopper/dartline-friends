import { describe, expect, it } from 'vitest';
import {
  REFERENCE_POINTS, computeSpiderHomography, transformPoint,
} from '../../src/shared/vision/homography';
import { refineHomographyWithInliers } from '../../src/shared/vision/homographyRefine';
import { BOARD_MAX } from '../../src/shared/boardGeometry';
import type { Matrix3x3, Keypoint, Point2D } from '../../src/shared/vision/types';

/** Synthetic but perspective-skewed dartboard camera with known ground truth. */
const CAMERA: Matrix3x3 = [
  [0.90 / BOARD_MAX, 0.10 / BOARD_MAX, 0.02],
  [-0.06 / BOARD_MAX, -0.85 / BOARD_MAX, 0.93],
  [0.10 / BOARD_MAX, 0.14 / BOARD_MAX, 1],
];
const target: Point2D[] = [
  [500000,500000], [500000,700000], [790000,500000],
  [510000,825000], [340000,410000],
];
const sourceOf = (point: Point2D): Point2D => {
  const projected = transformPoint(point, CAMERA);
  if (!projected) throw new Error('Failed synthetic camera projection');
  return projected;
};
const landmarks = (sample = 0): Keypoint[] => REFERENCE_POINTS.map((point, id) => {
  const [x, y] = sourceOf(point);
  // A reproducible subpixel-to-one-pixel landmark error in a 1280px camera.
  return [
    x + Math.sin((sample + 1) * 1.234 + id * 2.17) * 0.00065,
    y + Math.cos((sample + 1) * 1.919 + id * 1.43) * 0.00065,
    0.94, id,
  ] as Keypoint;
});
const oldFour = (points: Keypoint[]): Matrix3x3 => {
  const selected = points.filter((p) => [0,2,4,6].includes(p[3]));
  const h = computeSpiderHomography(selected);
  if (!h) throw new Error('Four-point source did not solve');
  return h;
};
function averageError(h: Matrix3x3): number {
  return target.reduce((total, point) => {
    const solved = transformPoint(sourceOf(point), h);
    if (!solved) throw new Error('Projected tip could not be scored');
    return total + Math.hypot(solved[0] - point[0], solved[1] - point[1]);
  }, 0) / target.length;
}

describe('DartLine board geometry refinement', () => {
  it('does not alter a four-keypoint-only fit', () => {
    const kps = landmarks();
    const prior = oldFour(kps);
    const selected = kps.filter(p => [0,2,4,6].includes(p[3]));
    expect(refineHomographyWithInliers(
      selected.map(p => [p[0],p[1]]),
      selected.map(p => REFERENCE_POINTS[p[3]]),
      prior, 5000
    )).toBe(prior);
  });

  it('reduces average scoring-coordinate error with noisy landmarks', () => {
    let previousError = 0;
    let refinedError = 0;
    for (let sample = 0; sample < 60; sample++) {
      const kps = landmarks(sample);
      const before = oldFour(kps);
      const after = refineHomographyWithInliers(
        kps.map(p => [p[0],p[1]] as Point2D),
        kps.map(p => REFERENCE_POINTS[p[3]]),
        before, 5000
      );
      previousError += averageError(before);
      refinedError += averageError(after);
    }
    expect(refinedError).toBeLessThan(previousError * 0.95);
  });

  it('rejects a high-confidence false landmark rather than moving the board to it', () => {
    const kps = landmarks(7);
    kps[3] = [kps[3][0]+0.08, kps[3][1]-0.05, 0.99, 3];
    const before = oldFour(kps);
    const after = refineHomographyWithInliers(
      kps.map(p => [p[0],p[1]] as Point2D),
      kps.map(p => REFERENCE_POINTS[p[3]]),
      before, 5000
    );
    expect(Number.isFinite(averageError(after))).toBe(true);
    expect(averageError(after)).toBeLessThan(averageError(before) * 1.1);
  });

  it('the actual board pipeline remains usable with an outlier and noisy markers', () => {
    const kps = landmarks(12);
    kps[5] = [kps[5][0]-0.07,kps[5][1]+0.065,0.96,5];
    const result = computeSpiderHomography(kps);
    expect(result).not.toBeNull();
    expect(averageError(result!)).toBeLessThan(6500);
  });
});
