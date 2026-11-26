#!/usr/bin/env python3
"""DartLine v5.2: faster confirmed detection, fewer duplicate reports.

An actual NEW dart-shaped scene change raises priority for existing model-only
recovery. Two independent AI confirmations are still required for strong tips,
three for weak tips. Normal motion-triggered AI is untouched.

An identical FULL tip batch from an essentially unchanged 256x256 video image
is not forwarded repeatedly during a visit. Close physical darts still count:
the new pixels and/or extra tip keypoint force the original server's one-to-one
matchKnownCameraTips algorithm to run. A bounded retry permits recovery after
lost network reports. Auto-submit has priority and is never deduplicated.

No model weights, camera resolution, server scoring geometry, turn rules,
takeout verifier or remote-player behavior are changed.
"""
from pathlib import Path
import shutil
import sys

BASE=Path(__file__).resolve().parents[1]

def patch(path:Path,before:str,after:str):
    code=path.read_text(encoding='utf-8')
    n=code.count(before)
    if n!=1:raise RuntimeError(
       f'v5.2 assembly mismatch: {path}: {before[:100]!r} occurrences={n}')
    path.write_text(code.replace(before,after,1),encoding='utf-8')

def install(root:Path):
    for relative in (
        'src/client/lib/rapidVisualScoring.ts',
        'tests/unit/dartline-rapid-visual-scoring.test.ts',
    ):
        dest=root/relative
        dest.parent.mkdir(parents=True,exist_ok=True)
        shutil.copyfile(BASE/relative,dest)

    scorer=root/'src/client/pages/scorer/ScorerPage.tsx'
    patch(scorer,
       "import { PendingRemovalWitness } from '../../lib/pendingRemovalWitness';",
       """import { PendingRemovalWitness } from '../../lib/pendingRemovalWitness';
import {
  VisualScoringDeduper, RapidVisualRecovery, RAPID_RECOVERY_POLL_MS,
} from '../../lib/rapidVisualScoring';""")
    patch(scorer,
       "import { IdleTipRecovery, IDLE_RECOVERY_INTERVAL_MS } from '../../lib/idleTipRecovery';",
       "import { IdleTipRecovery } from '../../lib/idleTipRecovery';")
    patch(scorer,
       "  const meter = useRef(new LatencyMeter());",
       """  const meter = useRef(new LatencyMeter());
  const visualScoringDeduper = useRef(new VisualScoringDeduper());
  const rapidVisualRecovery = useRef(new RapidVisualRecovery());
  const scoringComparisonCanvas = useRef<HTMLCanvasElement|null>(null);
  const scoringCameraVideo = useRef<HTMLVideoElement|null>(null);
  const scoringVisitKey = useRef('');""")
    patch(scorer,
       """    visitTipEvidence.current.observePositive(scoring, tips.length,
      takeoutExclusive.current);
    meter.current.onTipsReceived(tips.length > 0);""",
       """    visitTipEvidence.current.observePositive(scoring, tips.length,
      takeoutExclusive.current);
    // No extra model work or network reports for the same physical board:
    // unchanged RGB photo + unchanged one-to-one tip set means this is an
    // identical, jittered re-sighting. Never filter an empty takeout frame
    // or alter a batch containing a genuinely new close tip.
    if(tips.length && !takeoutExclusive.current && scoringCameraVideo.current){
      if(!scoringComparisonCanvas.current)
        scoringComparisonCanvas.current=document.createElement('canvas');
      const shot=readTemporalCamera(
        scoringCameraVideo.current,scoringComparisonCanvas.current);
      if(!visualScoringDeduper.current.shouldForward(
         scoringVisitKey.current,tips,shot,Date.now()))return;
    }
    meter.current.onTipsReceived(tips.length > 0);""")
    patch(scorer,
       """  const vision = useVisionRuntime({ onTips: onTipsWithMeter, onCameraActive });""",
       """  const vision = useVisionRuntime({ onTips: onTipsWithMeter, onCameraActive });
  // The onTips callback above is asynchronous. This ref gives it the live
  // frame without violating React hook order or starting a second camera.
  scoringCameraVideo.current=vision.refs.video.current;""")
    patch(scorer,
       """      visitTipEvidence.current.updateVisit(msg.key,msg.active);
      visitContext.current = {""",
       """      visitTipEvidence.current.updateVisit(msg.key,msg.active);
      if(old.key!==msg.key || (old.active&&!msg.active)){
        visualScoringDeduper.current.reset();
        rapidVisualRecovery.current.reset();
      }
      scoringVisitKey.current=msg.active?msg.key:'';
      visitContext.current = {""")
    patch(scorer,
       """      const guess=temporalDartTracker.current.observe(image,now);
      if(!guess)return;""",
       """      const guess=temporalDartTracker.current.observe(image,now);
      if(!guess)return;
      // This is a physical before/after dart-shaped change, not a model
      // hallucination. Request the soonest SAFE serialized model inference,
      // then its independently spaced confirmation, without scoring here.
      rapidVisualRecovery.current.newPhysicalDart(now);""")
    patch(scorer,
       """    const timer=window.setInterval(() => {
      if (pending || !eligible()) return;
      const runtime=vision.runtimeRef.current;""",
       """    const timer=window.setInterval(() => {
      if (pending || !rapidVisualRecovery.current.shouldProbe(
         Date.now(),eligible())) return;
      const runtime=vision.runtimeRef.current;""")
    patch(scorer,
       """      void runtime.inferCandidates().then(result => {
        // null = busy or stopped. In particular, do not confuse that with
        // a real empty board or a valid second confirmation frame.""",
       """      void runtime.inferCandidates().then(result => {
        // A busy/skipped inference is NOT a completed independent sample.
        // The fast priority survives and retries at the next cheap tick.
        rapidVisualRecovery.current.finished(Date.now(),
          result!==null && vision.frameRef.current!==before);
        // null = busy or stopped. In particular, do not confuse that with
        // a real empty board or a valid second confirmation frame.""")
    patch(scorer,
       """    },IDLE_RECOVERY_INTERVAL_MS);
    return () => {
      disposed=true;
      window.clearInterval(timer);
    };""",
       """    },RAPID_RECOVERY_POLL_MS);
    return () => {
      disposed=true;
      window.clearInterval(timer);
    };""")

    (root/'src/client/public/dartline-build.txt').write_text(
       'dartline-v5.2-visual-dedupe-fast-recovery-2026-11-26\n',encoding='utf-8')
    print('DartLine v5.2: priority model confirmations after NEW visible shaft, identical image dedupe')

if __name__=='__main__':
    try:install(Path(sys.argv[1]).resolve())
    except Exception as error:
        print('DartLine v5.2 integration failed:',error,file=sys.stderr)
        sys.exit(1)
