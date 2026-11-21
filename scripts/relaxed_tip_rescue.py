#!/usr/bin/env python3
"""Stabilize weak dart-tip confidence from the pinned InstaDarts detector."""
from pathlib import Path
import shutil,sys
ROOT=Path(__file__).resolve().parents[1]

def replace(path,needle,replacement):
    text=path.read_text(encoding='utf-8')
    if text.count(needle)!=1: raise RuntimeError(f"unexpected source in {path}: {needle[:95]} ({text.count(needle)} matches)")
    path.write_text(text.replace(needle,replacement,1),encoding='utf-8')

def patch(root):
    shutil.copyfile(ROOT/'src/client/lib/tipRescue.ts',root/'src/client/lib/tipRescue.ts')
    shutil.copyfile(ROOT/'tests/unit/dartline-tip-rescue.test.ts',root/'tests/unit/dartline-tip-rescue.test.ts')
    runtime=root/'src/client/vision/visionRuntime.ts'
    replace(runtime,
        "import { recoverBoard } from '../lib/boardRecovery';",
        """import { recoverBoard } from '../lib/boardRecovery';
import { StableTipRescue, mergeRescuedTips, RELAXED_TIP_THRESHOLD } from '../lib/tipRescue';""")
    replace(runtime,
        "  let tipThreshold = DEFAULT_TIP_THRESHOLD;",
        "  let tipThreshold = DEFAULT_TIP_THRESHOLD;\n  const rescuedTips = new StableTipRescue();")
    replace(runtime,
        "  function forgetBoard(): void {\n    lastHomography = null;",
        "  function forgetBoard(): void {\n    rescuedTips.reset();\n    lastHomography = null;")
    replace(runtime,
        "      onFrame({\n        keypoints,",
        """      // This is deliberately separate from the strict 0.80 detection.
      // A weak tip must agree spatially across two independent inferences.
      // It is never counted on its first appearance, and a camera reset clears it.
      if (result) {
        const relaxed = recoverBoard(keypoints, boardThreshold,
          Math.min(tipThreshold, RELAXED_TIP_THRESHOLD), lensCalibration);
        const confirmed = rescuedTips.observe(relaxed?.tips ?? [], performance.now());
        if (confirmed.length > 0) {
          result = { ...result, tips: mergeRescuedTips(result.tips, confirmed) };
        }
      }
      onFrame({
        keypoints,""")
    scorer=root/'src/client/pages/scorer/ScorerPage.tsx'
    replace(scorer,
        "      possibleTipPoints: vision.frame?.keypoints.filter((p) => p[3] === 8 && p[2] >= vision.settings.tipThreshold).length ?? 0,",
        """      possibleTipPoints: vision.frame?.keypoints.filter((p) => p[3] === 8 && p[2] >= vision.settings.tipThreshold).length ?? 0,
      peakTipConfidence: vision.frame?.keypoints.filter((p) => p[3] === 8).reduce(
        (max, point) => Math.max(max, point[2]), 0) ?? 0,""")
    dock=root/'src/client/components/PhoneCameraDock.tsx'
    replace(dock,"  possibleTipPoints: number;\n  inferred: boolean;",
        "  possibleTipPoints: number;\n  peakTipConfidence: number;\n  inferred: boolean;")
    replace(dock,"        || typeof data.possibleTipPoints !== 'number'",
        "        || typeof data.possibleTipPoints !== 'number'\n        || typeof data.peakTipConfidence !== 'number'")
    replace(dock,"        possibleTipPoints: data.possibleTipPoints, scanCount: data.scanCount,",
        "        possibleTipPoints: data.possibleTipPoints, peakTipConfidence: data.peakTipConfidence, scanCount: data.scanCount,")
    replace(dock,
        "          <span>Completed AI scans: {report.scanCount} · {report.scanning ? 'Automatic scanning on' : 'Automatic scanning off'}</span>",
        """          <span>Completed AI scans: {report.scanCount} · peak tip confidence: {(report.peakTipConfidence * 100).toFixed(0)}%</span>
          <span>{report.scanning ? 'Automatic scanning on' : 'Automatic scanning off'} · stable weak tips require confirmation</span>""")
    # Aim the backup at stationary darts faster, without changing the standard
    # motion detector or its takeout semantics.
    assist=root/'src/client/lib/scanAssist.ts'
    replace(assist,"export const ASSIST_INTERVAL_MS = 2600;","export const ASSIST_INTERVAL_MS = 1200;")
    unit=root/'tests/unit/dartline-scan-assist.test.ts'
    replace(unit,"expect(ASSIST_INTERVAL_MS).toBeGreaterThanOrEqual(2000);",
        "expect(ASSIST_INTERVAL_MS).toBeGreaterThanOrEqual(1000);")
    print('Stable dart-tip rescue installed; strong detections unchanged.')

if __name__=='__main__':
    try: patch(Path(sys.argv[1]).resolve())
    except Exception as exc: print('Tip rescue integration failed:',exc,file=sys.stderr);sys.exit(1)
