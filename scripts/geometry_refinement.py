#!/usr/bin/env python3
"""Strengthen the actual AI scoring geometry, not its detection thresholds.

The original homography RANSAC returns a perfect four-point fit even when
five to eight board landmarks agree. Refine the result by least squares over
only those agreeing landmarks, and reject any worse or degenerate refit.
No changes to camera inference, tip detection, repeat guard or auto-submit.
"""
from pathlib import Path
import shutil, sys
BASE = Path(__file__).resolve().parents[1]

def replace_one(path: Path, old: str, new: str):
    text = path.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'Geometry refinement source mismatch in {path}: '
                           f'{old[:70]!r} ({count})')
    path.write_text(text.replace(old, new, 1), encoding='utf-8')

def install(root: Path):
    for relative in (
        'src/shared/vision/homographyRefine.ts',
        'tests/unit/dartline-homography-refinement.test.ts',
    ):
        dest = root / relative
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(BASE / relative, dest)

    homography = root / 'src/shared/vision/homography.ts'
    replace_one(
        homography,
        "import { distortNormalizedPoint } from './lensDistortion';",
        "import { distortNormalizedPoint } from './lensDistortion';\n"
        "import { refineHomographyWithInliers } from './homographyRefine';"
    )
    replace_one(
        homography,
        """  // Most inliers wins, tiebreak on lowest mean error.
  return candidates.reduce((best, c) => {
    if (c.inliers > best.inliers) return c;
    if (c.inliers === best.inliers && c.meanError < best.meanError) return c;
    return best;
  }, candidates[0]).matrix;""",
        """  // Keep RANSAC's robust outlier rejection. Unlike the original,
  // improve the winning perspective fit using all agreeing landmarks,
  // not just the four in the winning RANSAC sample.
  const best = candidates.reduce((winner, c) => {
    if (c.inliers > winner.inliers) return c;
    if (c.inliers === winner.inliers && c.meanError < winner.meanError) return c;
    return winner;
  }, candidates[0]);
  return refineHomographyWithInliers(src, dst, best.matrix, threshold);"""
    )

    (root / 'src/client/public/dartline-build.txt').write_text(
        'dartline-v3.7-refined-board-geometry-2026-11-26\n',
        encoding='utf-8'
    )
    print('DartLine v3.7: RANSAC landmark-consensus refinement installed')

if __name__ == '__main__':
    try:
        install(Path(sys.argv[1]).resolve())
    except Exception as error:
        print('DartLine geometry refinement failed:', error, file=sys.stderr)
        sys.exit(1)
