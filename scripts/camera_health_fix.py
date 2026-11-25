#!/usr/bin/env python3
"""DartLine v2.8: an idle motion-triggered AI is NOT a stalled camera.
Report scorer heartbeat + real motion analyzer frame rate to the match HUD.
Never run extra model inferences just to update a status badge."""
from pathlib import Path
import shutil,sys
BASE=Path(__file__).resolve().parents[1]
def patch(path:Path,old:str,new:str)->None:
    s=path.read_text(encoding='utf-8')
    if s.count(old)!=1:
        raise RuntimeError(f'Camera status overlay mismatch in {path}: {old[:85]!r} count={s.count(old)}')
    path.write_text(s.replace(old,new,1),encoding='utf-8')

def apply(root:Path)->None:
    for name in (
      'src/client/components/MobileMatchHUD.tsx',
      'src/client/components/PhoneCameraDock.tsx',
      'src/client/lib/cameraHealth.ts',
      'tests/unit/dartline-camera-health.test.ts',
    ):
        target=root/name
        target.parent.mkdir(parents=True,exist_ok=True)
        shutil.copyfile(BASE/name,target)

    scorer=root/'src/client/pages/scorer/ScorerPage.tsx'
    patch(scorer,
        """  useEffect(() => {
    if (window.parent === window) return;
    window.parent.postMessage({
      type: 'dartline:scorer-health',""",
        """  useEffect(() => {
    if (window.parent === window) return;
    // Heartbeat must continue even with no model inference. No inference
    // is expected on an unchanged board: the motion scanner is waiting for
    // a dart, not necessarily frozen. This does not call infer or score.
    const sendHealth = () => window.parent.postMessage({
      type: 'dartline:scorer-health',""")
    patch(scorer,
        "      scanning: vision.motion.armed,\n      boardPoints:",
        "      scanning: vision.motion.armed,\n      motionFps: vision.motion.fps ?? 0,\n      boardPoints:")
    patch(scorer,
        """      status,
    }, window.location.origin);
  }, [vision.cameraActive, vision.motion.armed, vision.frame, vision.scanCount, vision.error, scoring, status]);""",
        """      status,
    }, window.location.origin);
    sendHealth();
    const heartbeat = window.setInterval(sendHealth, 2500);
    return () => window.clearInterval(heartbeat);
  }, [vision.cameraActive, vision.motion.armed, vision.motion.fps,
      vision.frame, vision.scanCount, vision.error, scoring, status]);""")

    (root/'src/client/public/dartline-build.txt').write_text(
        'dartline-camera-health-heartbeat-v2.8-2026-11-25\n',encoding='utf-8')
    print('DartLine v2.8: accurate motion readiness and continuous scorer heartbeat installed')
if __name__=='__main__':
    try:apply(Path(sys.argv[1]).resolve())
    except Exception as exc:
        print('DartLine v2.8 overlay failed:',exc,file=sys.stderr)
        sys.exit(1)
