import type { Matrix3x3, Point2D } from './types';

/**
 * Refine a robust four-landmark RANSAC result using every landmark that agrees
 * with it. The original solve always returned the matrix from exactly four
 * landmarks, even when up to eight independent board wires agreed.
 *
 * Fit in normalized board coordinates to keep the linear algebra conditioned;
 * the caller and returned matrix still use the original 1e6 board units.
 * An outlier or degenerate configuration never overrides the RANSAC result.
 */
const BOARD_SCALE = 1_000_000;
const MIN_REFINEMENT_INLIERS = 5;

function project(point: Point2D, h: Matrix3x3): Point2D | null {
  const [x, y] = point;
  const w = h[2][0] * x + h[2][1] * y + h[2][2];
  if (!Number.isFinite(w) || Math.abs(w) < 1e-10) return null;
  const u = (h[0][0] * x + h[0][1] * y + h[0][2]) / w;
  const v = (h[1][0] * x + h[1][1] * y + h[1][2]) / w;
  return Number.isFinite(u) && Number.isFinite(v) ? [u, v] : null;
}

function solve8(a: number[][], b: number[]): number[] | null {
  const n = b.length;
  const rows = a.map((r, i) => [...r, b[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(rows[row][col]) > Math.abs(rows[pivot][col])) pivot = row;
    }
    if (!Number.isFinite(rows[pivot][col]) || Math.abs(rows[pivot][col]) < 1e-12) return null;
    [rows[col], rows[pivot]] = [rows[pivot], rows[col]];
    const scale = rows[col][col];
    for (let j = col; j <= n; j++) rows[col][j] /= scale;
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const mult = rows[row][col];
      for (let j = col; j <= n; j++) rows[row][j] -= mult * rows[col][j];
    }
  }
  const answer = rows.map(r => r[n]);
  return answer.every(Number.isFinite) ? answer : null;
}

function fitConsensus(src: readonly Point2D[], dst: readonly Point2D[]): Matrix3x3 | null {
  const ata: number[][] = Array.from({ length: 8 }, () => Array(8).fill(0));
  const atb = Array(8).fill(0);
  for (let i = 0; i < src.length; i++) {
    const [x, y] = src[i];
    const u = dst[i][0] / BOARD_SCALE;
    const v = dst[i][1] / BOARD_SCALE;
    if (![x, y, u, v].every(Number.isFinite)) return null;
    const rows: [number[], number][] = [
      [[x, y, 1, 0, 0, 0, -u * x, -u * y], u],
      [[0, 0, 0, x, y, 1, -v * x, -v * y], v],
    ];
    for (const [coeff, target] of rows) {
      for (let col = 0; col < 8; col++) {
        atb[col] += coeff[col] * target;
        for (let k = 0; k < 8; k++) ata[col][k] += coeff[col] * coeff[k];
      }
    }
  }
  const p = solve8(ata, atb);
  if (!p) return null;
  const result: Matrix3x3 = [
    [p[0] * BOARD_SCALE, p[1] * BOARD_SCALE, p[2] * BOARD_SCALE],
    [p[3] * BOARD_SCALE, p[4] * BOARD_SCALE, p[5] * BOARD_SCALE],
    [p[6], p[7], 1],
  ];
  return result;
}

export function refineHomographyWithInliers(
  src: readonly Point2D[],
  dst: readonly Point2D[],
  original: Matrix3x3,
  inlierThreshold: number,
): Matrix3x3 {
  if (src.length !== dst.length || !Number.isFinite(inlierThreshold) || inlierThreshold <= 0) return original;
  const goodSrc: Point2D[] = [];
  const goodDst: Point2D[] = [];
  let oldSquaredError = 0;
  for (let i = 0; i < src.length; i++) {
    const projected = project(src[i], original);
    if (!projected) continue;
    const error = Math.hypot(projected[0] - dst[i][0], projected[1] - dst[i][1]);
    if (error > inlierThreshold) continue;
    goodSrc.push(src[i]);
    goodDst.push(dst[i]);
    oldSquaredError += (error / BOARD_SCALE) ** 2;
  }
  if (goodSrc.length < MIN_REFINEMENT_INLIERS) return original;
  const candidate = fitConsensus(goodSrc, goodDst);
  if (!candidate) return original;

  // A new fit is only accepted if it still explains every landmark that the
  // original RANSAC winner accepted, and its total error is no worse. The
  // fallback is the unmodified upstream result, never a guessed board pose.
  let newSquaredError = 0;
  for (let i = 0; i < goodSrc.length; i++) {
    const projected = project(goodSrc[i], candidate);
    if (!projected) return original;
    const error = Math.hypot(projected[0] - goodDst[i][0], projected[1] - goodDst[i][1]);
    if (!Number.isFinite(error) || error > inlierThreshold) return original;
    newSquaredError += (error / BOARD_SCALE) ** 2;
  }
  return newSquaredError <= oldSquaredError * 1.01 ? candidate : original;
}
