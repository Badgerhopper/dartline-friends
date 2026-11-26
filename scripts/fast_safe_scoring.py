#!/usr/bin/env python3
"""DartLine v4.2: faster temporal hits and safe motion-independent takeout.

This overlay executes LAST, after v4.1. Inference is still serialized and
server-side authority, one-to-one duplicate matching, and robust homography
are unchanged. The camera checks a stable board promptly and requires real
independent located frames to verify dart removal.
"""
from pathlib import Path
import shutil
import sys

BASE=Path(__file__).resolve().parents[1]

def replace_one(path:Path, before:str, after:str):
    source=path.read_text(encoding='utf-8')
    hits=source.count(before)
    if hits!=1: raise RuntimeError(
        f'DartLine v4.2 patch mismatch {path}: {before[:80]!r} ({hits} occurrences)')
    path.write_text(source.replace(before,after,1),encoding='utf-8')

def install(root:Path):
    for relative in [
        'src/client/lib/fastBoardClear.ts',
        'tests/unit/dartline-fast-board-clear.test.ts',
        'src/client/lib/takeoutSceneWitness.ts',
        'tests/unit/dartline-takeout-scene-witness.test.ts',
    ]:
        dest=root/relative
        dest.parent.mkdir(parents=True,exist_ok=True)
        shutil.copyfile(BASE/relative,dest)

    # One in-flight inference at a time. A 950ms polling timer replaces the
    # original 2200ms blind wait, but slow devices naturally skip busy ticks.
    # Strong tips still require two different completed model results; weak
    # 0.50 confidence tips still require three. No threshold is loosened.
    gate=root/'src/client/lib/idleTipRecovery.ts'
    replace_one(gate,
        'export const IDLE_RECOVERY_INTERVAL_MS = 2200;',
        'export const IDLE_RECOVERY_INTERVAL_MS = 950;')
    replace_one(gate,
        'export const IDLE_RECOVERY_MIN_SEPARATION_MS = 800;',
        'export const IDLE_RECOVERY_MIN_SEPARATION_MS = 550;')
    gate_test=root/'tests/unit/dartline-idle-tip-recovery.test.ts'
    replace_one(gate_test,
        'expect(IDLE_RECOVERY_INTERVAL_MS).toBeGreaterThanOrEqual(1800);',
        'expect(IDLE_RECOVERY_INTERVAL_MS).toBeGreaterThanOrEqual(800);')
    replace_one(gate_test,
        'expect(IDLE_RECOVERY_INTERVAL_MS).toBeLessThanOrEqual(3500);',
        'expect(IDLE_RECOVERY_INTERVAL_MS).toBeLessThanOrEqual(1500);')

    scorer=root/'src/client/pages/scorer/ScorerPage.tsx'
    replace_one(scorer,
        "import { RemovalMonitor } from '../../lib/removalMonitor';",
        "import { RemovalMonitor } from '../../lib/removalMonitor';\n"
        "import { FastBoardClear, FAST_CLEAR_TICK_MS } from '../../lib/fastBoardClear';\n"
        "import { TakeoutSceneWitness, readTakeoutScene } from '../../lib/takeoutSceneWitness';")
    replace_one(scorer,
        "  const meter = useRef(new LatencyMeter());",
        """  const meter = useRef(new LatencyMeter());
  // Raw model empties during verified takeout must NOT reach the server.
  // Only independent, checked board-clear frames may vote on submission.
  const takeoutExclusive = useRef(false);
  const allowVerifiedEmpty = useRef(false);""")
    replace_one(scorer,
        """  const onTipsWithMeter = useCallback((tips: BoardTip[], ms: number) => {
    meter.current.onTipsReceived(tips.length > 0);""",
        """  const onTipsWithMeter = useCallback((tips: BoardTip[], ms: number) => {
    if (tips.length === 0 && takeoutExclusive.current && !allowVerifiedEmpty.current) {
      return;
    }
    meter.current.onTipsReceived(tips.length > 0);""")
    replace_one(scorer,
        """  const removalMonitor = useRef(new RemovalMonitor());
  const [takeoutMonitorArmed, setTakeoutMonitorArmed] = useState(false);""",
        """  const removalMonitor = useRef(new RemovalMonitor());
  const fastBoardClear = useRef(new FastBoardClear());
  const takeoutScene = useRef(new TakeoutSceneWitness());
  const takeoutCanvas = useRef<HTMLCanvasElement | null>(null);
  const [takeoutMonitorArmed, setTakeoutMonitorArmed] = useState(false);""")
    replace_one(scorer,
        """      if (event.data?.type === 'dartline:takeout-monitor') {
        setTakeoutMonitorArmed(event.data.armed === true);
      }""",
        """      if (event.data?.type === 'dartline:takeout-monitor') {
        const enabled=event.data.armed === true;
        takeoutExclusive.current=enabled;
        setTakeoutMonitorArmed(enabled);
      }""")
    replace_one(scorer,
        """  // Wait for the third scored impact to settle before believing another
  // movement is the player retrieving their darts.
  useEffect(() => {
    removalMonitor.current.update(
      takeoutMonitorArmed && scoring && vision.cameraActive,
      vision.motion.dot,
      Date.now()
    );
  }, [takeoutMonitorArmed, scoring, vision.cameraActive, vision.motion.dot]);""",
        """  // A real recorded visit with darts visible becomes the baseline for
  // removal confirmation. Gentle hand retrieval need not trigger the motion
  // detector at all. Motion, when present, simply accelerates confirmation.
  useEffect(() => {
    const enabled=takeoutMonitorArmed && scoring && vision.cameraActive;
    const now=Date.now();
    removalMonitor.current.update(enabled, vision.motion.dot, now);
    fastBoardClear.current.arm(enabled, now,
      Boolean(vision.frameRef.current?.result?.tips.length));
    if (removalMonitor.current.checkingRemoval) {
      fastBoardClear.current.noteRetrievalMotion();
    }
  }, [takeoutMonitorArmed, scoring, vision.cameraActive, vision.motion.dot,
      vision.frame, vision.frameRef]);""")
    # Independent tiny video motion check: a model that misses all the darts
    # for several frames cannot automatically advance the match.
    # The actual hand must enter and then EXIT the video and the picture
    # must settle. At most 48x48 grayscale data stays within the iPhone.
    replace_one(scorer,
        '  // A real recorded visit with darts visible becomes the baseline for',
        """  useEffect(() => {
    takeoutScene.current.reset();
    if (!takeoutMonitorArmed || !scoring || !vision.cameraActive) return;
    const timer=window.setInterval(() => {
      const video=vision.refs.video.current;
      if (!takeoutCanvas.current) takeoutCanvas.current=document.createElement('canvas');
      const gray=readTakeoutScene(video,takeoutCanvas.current);
      if (gray && takeoutScene.current.observe(gray,Date.now())) {
        fastBoardClear.current.noteRetrievalMotion();
      }
    },250);
    return () => window.clearInterval(timer);
  }, [takeoutMonitorArmed,scoring,vision.cameraActive,vision.refs.video]);

  // A real recorded visit with darts visible becomes the baseline for""")

    # Replace ONLY the takeout interval, not the motion-triggered recognition
    # or the independent missed-throw inference.
    before="""  useEffect(() => {
    if (!takeoutMonitorArmed || !scoring || !vision.cameraActive || !vision.motion.armed) return;
    const timer = window.setInterval(() => {
      const token = removalMonitor.current.claim(
        Date.now(), document.visibilityState === 'visible',
        Boolean(vision.runtimeRef.current?.camera.active)
      );
      if (token === null) return;
      const runtime = vision.runtimeRef.current;
      const before = vision.frameRef.current;
      if (!runtime) {
        removalMonitor.current.complete(token, Date.now(), false);
        return;
      }
      // Unlike the old 4-attempt timer, this waits for the actual inference.
      // If another scan is still running, infer() is a no-op and frameRef
      // stays unchanged. That skipped call must NOT use a clear-scan slot.
      void runtime.infer().then(() => {
        const after = vision.frameRef.current;
        removalMonitor.current.complete(token, Date.now(),
          after !== before && Boolean(after?.result));
      }).catch(() => {
        removalMonitor.current.complete(token, Date.now(), false);
      });
    }, 500);
    return () => window.clearInterval(timer);
  }, [takeoutMonitorArmed, scoring, vision.cameraActive, vision.motion.armed,
      vision.runtimeRef, vision.frameRef]);"""
    after="""  useEffect(() => {
    if (!takeoutMonitorArmed || !scoring || !vision.cameraActive || view !== 'scoring') return;
    let disposed=false;
    const timer=window.setInterval(() => {
      if (disposed || !takeoutExclusive.current) return;
      const runtime=vision.runtimeRef.current;
      const token=fastBoardClear.current.claim(
        Date.now(), Boolean(runtime?.camera.active));
      if (token===null || !runtime) return;
      const before=vision.frameRef.current;
      // Candidate-only inference: unlike infer(), this NEVER publishes an
      // empty result to the match server without physical-clear validation.
      void runtime.inferCandidates().then(result => {
        const frame=vision.frameRef.current;
        if (disposed || result===null || !frame || frame===before) {
          fastBoardClear.current.finish(token, Date.now(), 'skipped');
          return;
        }
        if (!frame.result) {
          fastBoardClear.current.finish(token, Date.now(), 'unlocated');
          return;
        }
        // Even a weak >=0.50 dart-tip candidate means this is NOT confirmed
        // empty. This is more conservative than the ordinary 0.80 scoring
        // threshold and avoids false auto-submit while darts remain.
        const relaxed=recoverBoard(frame.keypoints,
          vision.settings.boardThreshold,
          Math.min(vision.settings.tipThreshold, RELAXED_TIP_THRESHOLD),
          runtime.lensCalibration);
        if (!relaxed) {
          fastBoardClear.current.finish(token, Date.now(), 'unlocated');
          return;
        }
        const action=fastBoardClear.current.finish(token, Date.now(),
          relaxed.tips.length ? 'occupied' : 'empty');
        if (disposed || !takeoutExclusive.current) return;
        if (action==='send-empty') {
          allowVerifiedEmpty.current=true;
          try { latestOnTips.current([],Math.round(frame.ms)); }
          finally { allowVerifiedEmpty.current=false; }
        } else if (action==='send-occupied') {
          // Cancel an earlier empty vote with an actual observed tip.
          latestOnTips.current(relaxed.tips,Math.round(frame.ms));
        }
      }).catch(() => {
        fastBoardClear.current.finish(token, Date.now(), 'skipped');
      });
    }, FAST_CLEAR_TICK_MS);
    return () => {disposed=true;window.clearInterval(timer);};
  }, [takeoutMonitorArmed, scoring, vision.cameraActive, view,
      vision.settings.boardThreshold, vision.settings.tipThreshold,
      vision.runtimeRef, vision.frameRef]);"""
    replace_one(scorer,before,after)

    hud=root/'src/client/components/MobileMatchHUD.tsx'
    replace_one(hud,
        '  const canSubmit = active && !Boolean(view.autoSubmit);',
        """  // An automatic removal verifier is a convenience, not a lock. Let a
  // player immediately submit the registered darts instead of waiting for
  // the camera if it fails to confirm board clearance.
  const canSubmit = active && darts.length>0 &&
    (autoTakeout || !Boolean(view.autoSubmit));""")
    replace_one(hud,
        'onClick={onSubmitVisit}>Submit ↗</Button>',
        "onClick={onSubmitVisit}>{autoTakeout ? 'Submit now' : 'Submit ↗'}</Button>")
    replace_one(hud,
        """the turn only after removal motion and two clear scans. Check scores before retrieving.""",
        """the turn after the camera sees retrieval and confirms the board is empty. Use Submit now if the camera lags.""")

    (root/'src/client/public/dartline-build.txt').write_text(
        'dartline-v4.2-faster-confirmed-scoring-2026-11-26\n',
        encoding='utf-8')
    print('DartLine v4.2: faster temporal hit recovery and verified no-motion takeout installed')

if __name__=='__main__':
    try: install(Path(sys.argv[1]).resolve())
    except Exception as error:
        print('DartLine v4.2 install failed:',error,file=sys.stderr)
        sys.exit(1)
