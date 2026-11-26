#!/usr/bin/env python3
"""DartLine v4.1: recover from missing iframe visit handshake and silent motion.

The scoring server, not an optional HUD event, decides whether a scorer camera
is assigned. The HUD hint is used to suppress confirmed remote/full turns, but
absent hints cannot permanently disable recovery. The UI shows a real failure
instead of reporting "watching" while no model scans are completed.
"""
from pathlib import Path
import shutil, sys

ROOT=Path(__file__).resolve().parents[1]

def patch(p:Path, old:str, new:str):
    text=p.read_text(encoding='utf-8')
    n=text.count(old)
    if n != 1:
        raise RuntimeError(f'v4.1 patch mismatch in {p}: {old[:72]!r} x{n}')
    p.write_text(text.replace(old,new,1),encoding='utf-8')

def install(root:Path):
    for rel in (
      'src/client/lib/recoveryEligibility.ts',
      'tests/unit/dartline-recovery-eligibility.test.ts',
    ):
        p=root/rel
        p.parent.mkdir(parents=True,exist_ok=True)
        shutil.copyfile(ROOT/rel,p)
    scorer=root/'src/client/pages/scorer/ScorerPage.tsx'
    patch(scorer,
        "import { IdleTipRecovery, IDLE_RECOVERY_INTERVAL_MS } from '../../lib/idleTipRecovery';",
        "import { IdleTipRecovery, IDLE_RECOVERY_INTERVAL_MS } from '../../lib/idleTipRecovery';\n"
        "import { shouldRecoverSilentHits } from '../../lib/recoveryEligibility';")
    patch(scorer,
        """    if (!scoring || !vision.cameraActive || !vision.motion.armed || view !== 'scoring')
      return;""",
        """    // Keep a recovery path even if the impact-motion analyzer fails to arm.
    if (!scoring || !vision.cameraActive || view !== 'scoring')
      return;""")
    patch(scorer,
        """      return !disposed && !takeoutMonitorArmed && scoring &&
        ctx.active && ctx.key.length>0 && ctx.dartsRecorded<3 &&
        document.visibilityState === 'visible' &&
        latestDot.current !== 'pending' &&
        latestDot.current !== 'pendingLarge';""",
        """      // The scoring device's active server assignment is authoritative.
      // A lost HUD event and iOS backgrounded iframe visibility must not
      // turn off every possible recognition scan.
      return !disposed && shouldRecoverSilentHits({
        scoring, cameraActive:vision.cameraActive, view,
        takeoutMonitorArmed, hint:ctx,
      }) && Boolean(vision.runtimeRef.current?.camera.active);""")

    hud=root/'src/client/components/MobileMatchHUD.tsx'
    patch(hud,
      """  // Disarm only on an actual scoreboard unmount. A dart-count re-render""",
      """  // A scorer iframe may start before this mobile screen sends its first
  // visit event. Respond to explicit refresh requests, so a missed initial
  // event cannot permanently disable recovery.
  useEffect(() => {
    const resend = () => window.dispatchEvent(
      new CustomEvent('dartline:visit-context', {detail:{
        key:visitIdentity, active:ownsVisit, dartsRecorded:darts.length,
      }}));
    window.addEventListener('dartline:request-visit-context',resend);
    return () => window.removeEventListener('dartline:request-visit-context',resend);
  }, [visitIdentity,ownsVisit,darts.length]);
  // Disarm only on an actual scoreboard unmount. A dart-count re-render""")

    dock=root/'src/client/components/PhoneCameraDock.tsx'
    patch(dock,
      """      if (!data || data.type !== 'dartline:scorer-health') return;""",
      """      if (data?.type === 'dartline:request-visit-context') {
        window.dispatchEvent(new Event('dartline:request-visit-context'));
        return;
      }
      if (!data || data.type !== 'dartline:scorer-health') return;
      if (!currentVisit.current.key) {
        window.dispatchEvent(new Event('dartline:request-visit-context'));
      }""")
    patch(dock,
      """        motionFps: data.motionFps, error:data.error,
      }}));""",
      """        motionFps: data.motionFps, error:data.error,
        boardLocated: data.boardLocated,
        boardPoints: data.boardPoints,
        scanCount: data.scanCount,
        inferenceMs: data.inferenceMs,
        recoveryProbes: data.recoveryProbes,
        recoveryConfirmed: data.recoveryConfirmed,
      }}));""")

    camera=root/'src/client/lib/cameraHealth.ts'
    patch(camera,
      """  error:string|null;
}""",
      """  error:string|null;
  boardLocated?:boolean;
  boardPoints?:number;
  scanCount?:number;
  inferenceMs?:number;
  recoveryProbes?:number;
  recoveryConfirmed?:number;
}""")
    patch(camera,
      """  if (!report.scanning) return 'Auto scan off';""",
      """  if (!report.scanning && !report.recoveryProbes) return 'Auto scan off';
  if (report.recoveryProbes && report.boardLocated === false)
    return 'Board not found in latest AI scan';
  if (report.scanCount === 0 && now - report.armedSince > 12000)
    return 'AI has not completed a scan';""")

    (root/'src/client/public/dartline-build.txt').write_text(
        'dartline-v4.1-active-scoring-recovery-2026-11-26\n', encoding='utf-8')
    print('DartLine v4.1: no iframe-handshake deadlock; silent detection stays active')

if __name__=='__main__':
    try: install(Path(sys.argv[1]).resolve())
    except Exception as e:
        print('DartLine v4.1 patch failed:',e,file=sys.stderr)
        sys.exit(1)
