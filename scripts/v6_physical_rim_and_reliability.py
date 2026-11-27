#!/usr/bin/env python3
"""Unreleased v6: physical-board bounded MISS recovery and safe temporal ROI.

The project detects normal throws with the ORIGINAL motion/model pipeline.
Fallbacks must not classify wall-mounted spare darts as scored misses.
This overlay never changes model weights, homography calibration or model
thresholds inside the 170mm scoring wire. No production release.
"""
from pathlib import Path
import shutil,sys
BASE=Path(__file__).resolve().parents[1]
def patch(path:Path,before:str,after:str):
    s=path.read_text(encoding='utf-8')
    n=s.count(before)
    if n!=1:raise RuntimeError(f'v6 rim source mismatch {path} {before[:100]!r} x{n}')
    path.write_text(s.replace(before,after,1),encoding='utf-8')

def install(root:Path):
    for rel in (
      'src/client/lib/physicalBoardImpact.ts',
      'src/client/lib/idleTipRecovery.ts',
      'src/client/lib/temporalDartEvidence.ts',
      'tests/unit/dartline-physical-board-impact.test.ts',
      'tests/unit/dartline-idle-tip-recovery.test.ts',
      'tests/unit/dartline-temporal-evidence.test.ts',
    ):
      dst=root/rel
      dst.parent.mkdir(parents=True,exist_ok=True)
      shutil.copyfile(BASE/rel,dst)

    pipeline=root/'src/client/vision/predictionPipeline.ts'
    patch(pipeline,
      "import { BOARD_MAX } from '../../shared/scoring';",
      "import { BOARD_MAX } from '../../shared/scoring';\n"
      "import { boardImpactRegion } from '../lib/physicalBoardImpact';")
    patch(pipeline,
      """    const proj = transformPoint(correctedImage, homography);
    if (!proj) continue;
    tips.push({""",
      """    const proj = transformPoint(correctedImage, homography);
    if (!proj) continue;
    // The 451mm square covers wall/cabinet pixels outside the real circular
    // 450mm dartboard. Reject them BEFORE axis clamping into false misses.
    if(boardImpactRegion(proj[0],proj[1])==='outside')continue;
    tips.push({""")

    scorer=root/'src/client/pages/scorer/ScorerPage.tsx'
    patch(scorer,
      "import { TemporalDartTracker, readTemporalCamera, TEMPORAL_POLL_MS, type TemporalFrame } from '../../lib/temporalDartEvidence';",
      """import { TemporalDartTracker, readTemporalCamera, TEMPORAL_POLL_MS, type TemporalFrame } from '../../lib/temporalDartEvidence';
import { boardImpactRegion, strongNewPhysicalMiss, physicalBoardTipBatch } from '../../lib/physicalBoardImpact';""")
    patch(scorer,
      "  const onTipsWithMeter = useCallback((tips: BoardTip[], ms: number) => {",
      """  const onTipsWithMeter = useCallback((tips: BoardTip[], ms: number) => {
    // Reject keypoints mapped outside the ACTUAL circular dartboard face.
    // An off-board false positive must NEVER become a fake empty takeout.
    const onBoard=physicalBoardTipBatch(tips);
    if(onBoard===null)return;
    tips=onBoard;""")
    patch(scorer,
      """      const guess=temporalDartTracker.current.observe(image,now);
      if(!guess)return;
      // This is a physical before/after dart-shaped change, not a model
      // hallucination. Request the soonest SAFE serialized model inference,
      // then its independently spaced confirmation, without scoring here.
      rapidVisualRecovery.current.newPhysicalDart(now);
      const runtime=vision.runtimeRef.current;
      const frame=vision.frameRef.current;
      if(!runtime?.camera.active || !frame?.result)return;
      // Both this picture and model inference use the same center-square
      // camera crop. Correct the lens before projecting through its matrix.
      const lens=sliderValueToLensK1(runtime.lensCalibration);
      const p=undistortNormalizedPoint([guess.x,guess.y],lens);
      const board=transformPoint(p,frame.result.homography);
      if(!board || !board.every(Number.isFinite))return;""",
      """      const runtime=vision.runtimeRef.current;
      const frame=vision.frameRef.current;
      // Evaluate EVERY changed dart-shaped component against the physical
      // circular board instead of selecting a larger stored/wall dart first.
      // This also makes real near-wire/outer-board misses eligible.
      const lens=runtime?.camera.active
        ? sliderValueToLensK1(runtime.lensCalibration):0;
      const project=(gx:number,gy:number)=>{
        if(!frame?.result)return null;
        const p=undistortNormalizedPoint([gx,gy],lens);
        return transformPoint(p,frame.result.homography);
      };
      const guess=temporalDartTracker.current.observe(image,now,
        (gx,gy)=>{
          const point=project(gx,gy);
          return point!==null && boardImpactRegion(point[0],point[1])!=='outside';
        });
      if(!guess || !runtime?.camera.active || !frame?.result)return;
      rapidVisualRecovery.current.newPhysicalDart(now);
      const board=project(guess.x,guess.y);
      if(!board || !board.every(Number.isFinite))return;""")
    patch(scorer,
      """      const radial=Math.hypot(x-500000,y-500000);
      const result=scoreFromBoardCoords(x,y);
      // On the black NUMBER/SURROUND ring, a good silhouette is evidence
      // of a new MISS even when the network's tip filter omitted it.
      // Require clear shaft shape, distant from the double wire, and a
      // stable before/after pair. Never auto-score an ambiguous hidden tip.
      if(result.label==='miss' && radial>425000 && radial<=500000
         && guess.confidence>=0.80 && !guess.obscured
         && guess.length>=35 && guess.area>=35){""",
      """      const result=scoreFromBoardCoords(x,y);
      // Outer annulus: 170mm double wire to 225mm board edge. Real *new*
      // physical dart-shaped image difference ONLY. No wall or static spare
      // darts; the independent low confidence guess remains manual.
      if(strongNewPhysicalMiss(x,y,guess)){""")

    (root/'src/client/public/dartline-build.txt').write_text(
      'dartline-v6-physical-board-miss-recovery-DRAFT-DO-NOT-DEPLOY\n',
      encoding='utf-8')
    print('DartLine v6 DRAFT physical board-only MISS recognition enabled')

if __name__=='__main__':
    try:install(Path(sys.argv[1]).resolve())
    except Exception as exc:
      print('v6 physical rim assembly failed:',exc,file=sys.stderr)
      sys.exit(1)
