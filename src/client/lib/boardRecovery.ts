/** Recover a board from coherent landmarks below the model's strict 0.85 default.
 * Never guess a board from four arbitrary points: a bad homography can cause
 * incorrect scores. */
import type { Keypoint } from '../../shared/vision/types';
import { BOARD_MAX } from '../../shared/boardGeometry';
import { REFERENCE_POINTS, transformPoint } from '../../shared/vision/homography';
import { processPredictions, type PipelineResult } from '../vision/predictionPipeline';

const RECOVERY_CONFIDENCE = 0.55;
const MIN_RECOVERY_MARKERS = 5;
const MIN_NORMALIZED_SPAN = 0.25;
const MAX_REPROJECTION_ERROR = BOARD_MAX * 0.035;

/** Only accept a relaxed-threshold result when the landmarks agree with
 * independent known positions on the standard dartboard. */
export function recoverBoard(
  keypoints: Keypoint[], boardThreshold: number, tipThreshold: number, lensCalibration: number,
): PipelineResult | null {
  const normal = processPredictions(keypoints, boardThreshold, tipThreshold, lensCalibration);
  if (normal) return normal;
  if (boardThreshold <= RECOVERY_CONFIDENCE) return null;
  const landmarks = keypoints.filter((p) => p[3] >= 0 && p[3] < 8
    && p[2] >= RECOVERY_CONFIDENCE && Number.isFinite(p[0]) && Number.isFinite(p[1])
    && p[0] >= 0 && p[0] <= 1 && p[1] >= 0 && p[1] <= 1);
  if (landmarks.length < MIN_RECOVERY_MARKERS) return null;
  const xs = landmarks.map((p) => p[0]);
  const ys = landmarks.map((p) => p[1]);
  if (Math.max(...xs) - Math.min(...xs) < MIN_NORMALIZED_SPAN
    || Math.max(...ys) - Math.min(...ys) < MIN_NORMALIZED_SPAN) return null;
  const candidate = processPredictions(keypoints, RECOVERY_CONFIDENCE, tipThreshold, lensCalibration);
  if (!candidate || candidate.boardKeypoints < MIN_RECOVERY_MARKERS) return null;
  const good = landmarks.filter((p) => {
    const pos = transformPoint([p[0], p[1]], candidate.homography);
    const target = REFERENCE_POINTS[p[3]];
    return pos && target && Math.hypot(pos[0] - target[0], pos[1] - target[1]) < MAX_REPROJECTION_ERROR;
  });
  return good.length >= MIN_RECOVERY_MARKERS ? candidate : null;
}
