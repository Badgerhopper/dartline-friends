import { describe, expect, it } from 'vitest';
import { recoverBoard } from '../../src/client/lib/boardRecovery';
import { BOARD_MAX } from '../../src/shared/boardGeometry';
import { REFERENCE_POINTS } from '../../src/shared/vision/homography';
import type { Keypoint } from '../../src/shared/vision/types';

function coherentBoard(confidence = 0.62): Keypoint[] {
  return REFERENCE_POINTS.map(([x, y], i) => [
    0.1 + x / BOARD_MAX * 0.8,
    0.9 - y / BOARD_MAX * 0.8,
    confidence, i,
  ]);
}

describe('DartLine low-confidence board recovery', () => {
  it('keeps normal high-confidence board recognition working', () => {
    expect(recoverBoard(coherentBoard(0.97), 0.85, 0.8, 0)?.boardKeypoints).toBe(8);
  });
  it('recovers the geometry of a lower-confidence but coherent dartboard', () => {
    expect(recoverBoard(coherentBoard(), 0.85, 0.8, 0)?.boardKeypoints).toBe(8);
  });
  it('does not guess from fewer than five independent landmarks', () => {
    expect(recoverBoard(coherentBoard().slice(0, 4), 0.85, 0.8, 0)).toBeNull();
  });
  it('does not guess from low-confidence noise', () => {
    expect(recoverBoard(coherentBoard(0.2), 0.85, 0.8, 0)).toBeNull();
  });
  it('rejects a tight cluster of otherwise coherent markers', () => {
    const clustered: Keypoint[] = coherentBoard().map((p) => [
      0.49 + p[0] * 0.02, 0.49 + p[1] * 0.02, p[2], p[3],
    ]);
    expect(recoverBoard(clustered, 0.85, 0.8, 0)).toBeNull();
  });
});
