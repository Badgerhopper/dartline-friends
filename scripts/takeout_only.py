#!/usr/bin/env python3
"""Install optional verified dart-removal submission without changing detection.

The motion-triggered recognition code, stable-tip tracking, clustering,
thresholds, inference frequency and normal throw handling remain exactly as
they were before automatic takeout was first introduced.
"""
from pathlib import Path
import sys
import shutil
BASE = Path(__file__).resolve().parents[1]

def install(root: Path) -> None:
    for name in ('src/client/lib/removalMonitor.ts',
                 'tests/unit/dartline-removal-monitor.test.ts'):
        destination = root / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(BASE / name, destination)
    scorer = root / 'src/client/pages/scorer/ScorerPage.tsx'
    contents = scorer.read_text(encoding='utf-8')
    anchor = '  // Rescue recognition: on some phones, a small dart impact does not move enough'
    if contents.count(anchor) != 1:
        raise RuntimeError('Could not find the established scorer insertion point')
    importAnchor = "import { useVisionRuntime } from '../../hooks/useVisionRuntime';"
    if contents.count(importAnchor) != 1:
        raise RuntimeError('Could not import isolated removal verifier')
    contents = contents.replace(
        importAnchor,
        importAnchor + "\nimport { RemovalMonitor } from '../../lib/removalMonitor';",
        1
    )
    monitor = """  // Opt-in removal verification only. The normal recognition pipeline and
  // strict/weak tip detection are never changed by this feature.
  const removalMonitor = useRef(new RemovalMonitor());
  const [takeoutMonitorArmed, setTakeoutMonitorArmed] = useState(false);
  useEffect(() => {
    if (window.parent === window) return;
    const receive = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== window.parent) return;
      if (event.data?.type === 'dartline:takeout-monitor') {
        setTakeoutMonitorArmed(event.data.armed === true);
      }
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, []);

  // Wait for the third scored impact to settle before believing another
  // movement is the player retrieving their darts.
  useEffect(() => {
    removalMonitor.current.update(
      takeoutMonitorArmed && scoring && vision.cameraActive,
      vision.motion.dot,
      Date.now()
    );
  }, [takeoutMonitorArmed, scoring, vision.cameraActive, vision.motion.dot]);

  useEffect(() => {
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
      vision.runtimeRef, vision.frameRef]);
  
"""
    scorer.write_text(contents.replace(anchor, monitor + anchor, 1), encoding='utf-8')
    (root / 'src/client/public/dartline-build.txt').write_text(
        'dartline-v3.4-serialized-removal-validation-2026-11-25\n',
        encoding='utf-8')
    print('v3.4: serial board-clear confirmation only after fresh retrieval motion')

if __name__ == '__main__':
    try:
        install(Path(sys.argv[1]).resolve())
    except Exception as exc:
        print('Optional takeout integration failed:', exc, file=sys.stderr)
        sys.exit(1)
