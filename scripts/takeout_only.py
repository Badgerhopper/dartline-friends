#!/usr/bin/env python3
"""Install optional verified dart-removal submission without changing detection.

The motion-triggered recognition code, stable-tip tracking, clustering,
thresholds, inference frequency and normal throw handling remain exactly as
they were before automatic takeout was first introduced.
"""
from pathlib import Path
import sys

def install(root: Path) -> None:
    scorer = root / 'src/client/pages/scorer/ScorerPage.tsx'
    contents = scorer.read_text(encoding='utf-8')
    anchor = '  // Rescue recognition: on some phones, a small dart impact does not move enough'
    if contents.count(anchor) != 1:
        raise RuntimeError('Could not find the established scorer insertion point')
    monitor = """  // Optional takeout only. This does not run during ordinary detection or
  // after 0-2 throws, so the original dart recognition loop is untouched.
  const [takeoutMonitorArmed, setTakeoutMonitorArmed] = useState(false);
  const lastRemovalMotionAt = useRef(0);
  const takeoutScanBudget = useRef({ movement: 0, used: 0 });
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

  useEffect(() => {
    if (!takeoutMonitorArmed || !scoring) {
      lastRemovalMotionAt.current = 0;
      takeoutScanBudget.current = { movement: 0, used: 0 };
      return;
    }
    if (vision.motion.dot === 'pending' || vision.motion.dot === 'pendingLarge') {
      lastRemovalMotionAt.current = Date.now();
      takeoutScanBudget.current = { movement: lastRemovalMotionAt.current, used: 0 };
    }
  }, [takeoutMonitorArmed, scoring, vision.motion.dot]);

  useEffect(() => {
    if (!takeoutMonitorArmed || !scoring || !vision.cameraActive || !vision.motion.armed)
      return;
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      const movement = lastRemovalMotionAt.current;
      const elapsed = Date.now() - movement;
      if (!movement || elapsed < 700 || elapsed > 8500 ||
          vision.motion.dot === 'pending' || vision.motion.dot === 'pendingLarge') return;
      const budget = takeoutScanBudget.current;
      if (budget.movement !== movement || budget.used >= 4) return;
      // Full (empty-capable) scans are needed for the server's two-frame
      // verification. Never infer just to watch an empty board in normal play.
      budget.used += 1;
      void vision.runtimeRef.current?.infer();
    }, 1250);
    return () => window.clearInterval(timer);
  }, [takeoutMonitorArmed, scoring, vision.cameraActive,
      vision.motion.armed, vision.motion.dot, vision.runtimeRef]);

"""
    scorer.write_text(contents.replace(anchor, monitor + anchor, 1), encoding='utf-8')
    (root / 'src/client/public/dartline-build.txt').write_text(
        'dartline-pre-auto-detection-plus-opt-in-takeout-v3.1-2026-11-25\n',
        encoding='utf-8')
    print('v3.1: pre-auto-submit recognition preserved; optional removal-only scan installed')

if __name__ == '__main__':
    try:
        install(Path(sys.argv[1]).resolve())
    except Exception as exc:
        print('Optional takeout integration failed:', exc, file=sys.stderr)
        sys.exit(1)
