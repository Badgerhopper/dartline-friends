#!/usr/bin/env python3
"""DartLine v3.5: fix repeated phantom scoring without replacing the model.

Two independent fixes:
1) A 1.7mm same-camera repeat filter was much tighter than actual camera
   projection jitter. Match one visible tip to each known dart per camera,
   keeping a second independently visible close dart eligible for scoring.
2) Unlimited idle-board backup scans kept creating hallucinated extra darts.
   Permit one positive-only backup scan per distinct motion trigger, retrying
   if the model was busy; never change the normal motion inference, settings
   or the separate takeout verifier.
"""
from pathlib import Path
import shutil
import sys
BASE = Path(__file__).resolve().parents[1]

def patch(path:Path, before:str, after:str) -> None:
    content = path.read_text(encoding='utf-8')
    count = content.count(before)
    if count != 1:
        raise RuntimeError(f'v3.5 source mismatch {path}: {before[:80]!r} ({count})')
    path.write_text(content.replace(before, after, 1), encoding='utf-8')

def install(root:Path) -> None:
    for name in (
      'src/server/scoring/repeatGuard.ts',
      'tests/unit/dartline-repeat-guard.test.ts',
      'src/client/lib/motionRescueGate.ts',
      'tests/unit/dartline-motion-rescue-gate.test.ts',
    ):
        destination = root / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(BASE / name, destination)

    cluster = root / 'src/server/scoring/cluster.ts'
    patch(cluster,
      "import { THROW_WINDOW_DART_RADIUS, REPEAT_FILTER_RADIUS } from '../../shared/vision/constants';",
      """import { THROW_WINDOW_DART_RADIUS } from '../../shared/vision/constants';
import { matchKnownCameraTips } from './repeatGuard';""")
    patch(cluster,
      """  const sorted = [...tips].sort((a, b) => b.confidence - a.confidence);

  for (const tip of sorted) {
    // Same-camera repeat: this camera already saw this dart → drop.
    const isRepeat = next.some((d) =>
      d.observations.some(
        (o) => o.deviceId === tip.deviceId && distance(tip.x, tip.y, o.x, o.y) < REPEAT_FILTER_RADIUS,
      ),
    );
    if (isRepeat) continue;""",
      """  // Match observed known tips to existing darts one-to-one. The old
  // 1.7mm filter allowed one physical dart to score twice as its estimated
  // position shifted between complete AI scans.
  const knownTips = matchKnownCameraTips(tips, next);
  const sorted = tips.map((tip,index) => ({tip,index}))
    .sort((a,b) => b.tip.confidence - a.tip.confidence);

  for (const {tip,index} of sorted) {
    if (knownTips.has(index)) continue;""")

    scorer = root / 'src/client/pages/scorer/ScorerPage.tsx'
    patch(scorer,
      "import { ASSIST_INTERVAL_MS, shouldScanStationaryBoard } from '../../lib/scanAssist';",
      """import { shouldScanStationaryBoard } from '../../lib/scanAssist';
import { MotionRescueGate } from '../../lib/motionRescueGate';""")
    patch(scorer,
      """  // Rescue recognition: on some phones, a small dart impact does not move enough
  // pixels to trigger the motion gate. During an assigned turn, inspect the now-
  // stationary board again. Never submit empty results from these extra scans,
  // which would risk ending an otherwise valid visit.
  useEffect(() => {
    const enabled = shouldScanStationaryBoard({
      scoring, cameraActive: vision.cameraActive, motionArmed: vision.motion.armed,
      cameraView: view, visibility: document.visibilityState,
    });
    if (!enabled) return;
    const timer = window.setInterval(() => {
      if (!shouldScanStationaryBoard({
        scoring, cameraActive: vision.cameraActive, motionArmed: vision.motion.armed,
        cameraView: view, visibility: document.visibilityState,
      })) return;
      void vision.runtimeRef.current?.inferPositiveOnly();
    }, ASSIST_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [scoring, vision.cameraActive, vision.motion.armed, vision.runtimeRef, view]);""",
      """  // One positive-only second look after a REAL motion trigger. Never
  // continuously poll an idle board: that produced false MISS and duplicate
  // scores when the model hallucinated a new location on a stationary dart.
  const motionRescue = useRef(new MotionRescueGate());
  useEffect(() => {
    motionRescue.current.observe(vision.motion.dot, Date.now());
  }, [vision.motion.dot]);

  useEffect(() => {
    // After three darts are recorded, removal verification owns the camera.
    // The ordinary positive-only backup scan must not compete with its
    // board-clear frames or delay automatic submission.
    const ready = () => !takeoutMonitorArmed && shouldScanStationaryBoard({
      scoring, cameraActive: vision.cameraActive, motionArmed: vision.motion.armed,
      cameraView: view, visibility: document.visibilityState,
    });
    if (!ready()) return;
    const timer = window.setInterval(() => {
      const token = motionRescue.current.claim(Date.now(), ready());
      if (token === null) return;
      const runtime = vision.runtimeRef.current;
      if (!runtime) { motionRescue.current.finish(token, false); return; }
      const before = vision.frameRef.current;
      void runtime.inferPositiveOnly().then(() => {
        // An already-busy AI declines a new inference. Its frame reference
        // remains identical, so retry instead of losing the one rescue scan.
        motionRescue.current.finish(token, vision.frameRef.current !== before);
      }).catch(() => { motionRescue.current.finish(token, false); });
    }, 650);
    return () => window.clearInterval(timer);
  }, [scoring, takeoutMonitorArmed, vision.cameraActive, vision.motion.armed,
      vision.runtimeRef, vision.frameRef, view]);""")

    (root/'src/client/public/dartline-build.txt').write_text(
      'dartline-v3.5-duplicate-guard-motion-rescue-2026-11-26\n', encoding='utf-8'
    )
    print('DartLine v3.5: repeat jitter corrected; idle backup polling removed')

if __name__ == '__main__':
    try: install(Path(sys.argv[1]).resolve())
    except Exception as exc:
        print('DartLine v3.5 duplicate guard failed:', exc, file=sys.stderr)
        sys.exit(1)
