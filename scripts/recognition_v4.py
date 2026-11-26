#!/usr/bin/env python3
"""DartLine v4: confirmed, motion-independent dart recovery.

Motion-triggered scoring remains the low-latency primary path.
An independent camera inference every ~2.2 s recovers small impacts that the
motion detector misses. These inferences never publish raw tips: candidates
must persist in independent completed scans and pass the same board geometry.
The scoring server retains final authority, deduplication and remote turn
ownership. Retrieval verification has precedence after three registered darts.
"""
from pathlib import Path
import shutil
import sys

BASE=Path(__file__).resolve().parents[1]

def replace_one(path:Path,needle:str,replacement:str):
    contents=path.read_text(encoding="utf-8")
    count=contents.count(needle)
    if count!=1:
        raise RuntimeError(f"v4 integration anchor missing at {path}: {needle[:75]!r} matches={count}")
    path.write_text(contents.replace(needle,replacement,1),encoding="utf-8")

def install(root:Path):
    for rel in (
        'src/client/lib/idleTipRecovery.ts',
        'tests/unit/dartline-idle-tip-recovery.test.ts',
    ):
        dest=root/rel
        dest.parent.mkdir(parents=True,exist_ok=True)
        shutil.copyfile(BASE/rel,dest)

    runtime=root/'src/client/vision/visionRuntime.ts'
    replace_one(runtime,
        '  inferPositiveOnly: () => Promise<BoardTip[]>;',
        '''  inferPositiveOnly: () => Promise<BoardTip[]>;
  /** Model inference with no score or takeout published.
   * null means busy/inactive and must NEVER be treated as an empty board. */
  inferCandidates: () => Promise<BoardTip[] | null>;''')
    replace_one(runtime,
        '  async function infer(publishEmpty = true) {',
        '  async function infer(publishEmpty = true, publishTips = true) {')
    replace_one(runtime,
        'done: inferFrame(cameraSession, publishEmpty)',
        'done: inferFrame(cameraSession, publishEmpty, publishTips)')
    replace_one(runtime,
        'async function inferFrame(session: number, publishEmpty: boolean): Promise<BoardTip[]> {',
        'async function inferFrame(session: number, publishEmpty: boolean, publishTips: boolean): Promise<BoardTip[]> {')
    replace_one(runtime,
        '      if (tips.length > 0 || publishEmpty) onTips(tips);',
        '      if (publishTips && (tips.length > 0 || publishEmpty)) onTips(tips);')
    replace_one(runtime,
        '    inferPositiveOnly: () => infer(false),',
        '''    inferPositiveOnly: () => infer(false),
    // Do not even START inference if the primary motion-triggered model is
    // busy. A rejected request is distinguishable from a true empty board.
    inferCandidates: () => busy || !camera.active
      ? Promise.resolve(null) : infer(false, false),''')

    scorer=root/'src/client/pages/scorer/ScorerPage.tsx'
    replace_one(scorer,
        "import { shouldScanStationaryBoard } from '../../lib/scanAssist';",
        """import { shouldScanStationaryBoard } from '../../lib/scanAssist';
import { IdleTipRecovery, IDLE_RECOVERY_INTERVAL_MS } from '../../lib/idleTipRecovery';
import { recoverBoard } from '../../lib/boardRecovery';
import { RELAXED_TIP_THRESHOLD } from '../../lib/tipRescue';""")
    before='  // One positive-only second look after a REAL motion trigger. Never'
    inserted="""  // The mobile match sends the authoritative visit identity and number of
  // registered darts. The independent AI must never score the previous turn,
  // count a fourth dart, or compete with retrieval confirmation.
  const visitContext = useRef({key:'',active:false,dartsRecorded:0});
  const idleTipRecovery = useRef(new IdleTipRecovery());
  const movementEpoch = useRef(0);
  const latestDot = useRef(vision.motion.dot);
  const latestOnTips = useRef(onTipsWithMeter);
  latestOnTips.current = onTipsWithMeter;

  useEffect(() => {
    if (window.parent === window) return;
    const receiveContext = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== window.parent) return;
      if (event.data?.type !== 'dartline:visit-context') return;
      const msg = event.data;
      if (typeof msg.key !== 'string' || msg.key.length > 180 ||
          typeof msg.active !== 'boolean' ||
          !Number.isInteger(msg.dartsRecorded) ||
          msg.dartsRecorded < 0 || msg.dartsRecorded > 3) return;
      const old=visitContext.current;
      if (old.key !== msg.key || (old.active && !msg.active)) idleTipRecovery.current.reset();
      visitContext.current = {
        key:msg.key, active:msg.active, dartsRecorded:msg.dartsRecorded,
      };
    };
    window.addEventListener('message', receiveContext);
    return () => window.removeEventListener('message', receiveContext);
  }, []);

  useEffect(() => {
    const dot = vision.motion.dot;
    const pending = dot === 'pending' || dot === 'pendingLarge';
    const wasPending = latestDot.current === 'pending' || latestDot.current === 'pendingLarge';
    if (pending && !wasPending) movementEpoch.current++;
    latestDot.current=dot;
  }, [vision.motion.dot]);

  useEffect(() => {
    if (!scoring || !vision.cameraActive || !vision.motion.armed || view !== 'scoring')
      return;
    let pending = false;
    let disposed = false;
    const eligible=() => {
      const ctx=visitContext.current;
      return !disposed && !takeoutMonitorArmed && scoring &&
        ctx.active && ctx.key.length>0 && ctx.dartsRecorded<3 &&
        document.visibilityState === 'visible' &&
        latestDot.current !== 'pending' &&
        latestDot.current !== 'pendingLarge';
    };
    const timer=window.setInterval(() => {
      if (pending || !eligible()) return;
      const runtime=vision.runtimeRef.current;
      if (!runtime?.camera.active) return;
      const before=vision.frameRef.current;
      const initialEpoch=movementEpoch.current;
      const initialVisit=visitContext.current.key;
      pending=true;
      void runtime.inferCandidates().then(result => {
        // null = busy or stopped. In particular, do not confuse that with
        // a real empty board or a valid second confirmation frame.
        if (result === null || !eligible() || initialVisit !== visitContext.current.key ||
            movementEpoch.current !== initialEpoch) return;
        const frame=vision.frameRef.current;
        if (!frame || frame === before || !frame.result) return;
        // Recover 0.50-0.79 confidence model candidates, but only publish
        // them once the independent temporal gate has confirmed stability.
        // The normal 0.80 threshold remains untouched.
        const relaxed=recoverBoard(frame.keypoints,
          vision.settings.boardThreshold,
          Math.min(vision.settings.tipThreshold,RELAXED_TIP_THRESHOLD),
          runtime.lensCalibration);
        if (!relaxed) return;
        const recovered=idleTipRecovery.current.observe(relaxed.tips,Date.now());
        if (recovered.length && eligible() &&
            initialVisit === visitContext.current.key &&
            movementEpoch.current === initialEpoch) {
          latestOnTips.current(recovered,Math.round(frame.ms));
        }
      }).catch(() => {
        // A failed inference is not an empty board, not a scored dart and
        // never a reason to restart the scorer iframe.
      }).finally(() => { pending=false; });
    },IDLE_RECOVERY_INTERVAL_MS);
    return () => {
      disposed=true;
      window.clearInterval(timer);
    };
  }, [scoring,takeoutMonitorArmed,vision.cameraActive,
      vision.motion.armed,vision.runtimeRef,vision.frameRef,
      vision.settings.boardThreshold,vision.settings.tipThreshold,view]);

"""
    replace_one(scorer,before,inserted+before)

    hud=root/'src/client/components/MobileMatchHUD.tsx'
    before="  const cameraText = cameraHealthLabel(cameraReport,clock);"
    inserted="""  // An independent motion-free scan must know the authoritative turn and
  // dart count, not assume every observed tip belongs to the local player.
  const visitIdentity = [match.id, match.legs.length, match.visits.length,
    match.currentPlayerIndex].join(':');
  const ownsVisit = active && !remoteOpponent && match.status === 'in_progress';
  useEffect(() => {
    const announce=(isActive:boolean) => window.dispatchEvent(
      new CustomEvent('dartline:visit-context',{detail:{
        key:visitIdentity, active:isActive, dartsRecorded:darts.length,
      }}));
    announce(ownsVisit);
    return () => announce(false);
  }, [visitIdentity,ownsVisit,darts.length]);
"""
    replace_one(hud,before,inserted+before)

    dock=root/'src/client/components/PhoneCameraDock.tsx'
    before="  const takeoutMonitor = useRef(false);"
    inserted="""  // Keep the current scoreboard visit synchronized with the scorer iframe,
  // including after it reloads. This prevents ghost scores on the next turn.
  const currentVisit = useRef({key:'',active:false,dartsRecorded:0});
  useEffect(() => {
    const update=(event:Event) => {
      const next=(event as CustomEvent<{
        key:string;active:boolean;dartsRecorded:number;
      }>).detail;
      if (!next || typeof next.key !== 'string') return;
      currentVisit.current=next;
      frame.current?.contentWindow?.postMessage({
        type:'dartline:visit-context',...next,
      },window.location.origin);
    };
    window.addEventListener('dartline:visit-context',update);
    return () => window.removeEventListener('dartline:visit-context',update);
  },[]);
"""
    replace_one(dock,before,before+'\n'+inserted)
    before="""      frame.current?.contentWindow?.postMessage({
        type:'dartline:takeout-monitor', armed:takeoutMonitor.current,
      },window.location.origin);"""
    after=before+"""
      frame.current?.contentWindow?.postMessage({
        type:'dartline:visit-context', ...currentVisit.current,
      },window.location.origin);"""
    replace_one(dock,before,after)

    (root/'src/client/public/dartline-build.txt').write_text(
        'dartline-v4-confirmed-silent-hit-recovery-2026-11-26\n',
        encoding='utf-8'
    )
    print('DartLine v4: motion-independent, confirmed detection enabled')

if __name__=='__main__':
    try: install(Path(sys.argv[1]).resolve())
    except Exception as e:
        print('DartLine v4 recovery build failed:',e,file=sys.stderr)
        sys.exit(1)
