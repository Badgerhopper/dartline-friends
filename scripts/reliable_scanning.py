#!/usr/bin/env python3
"""Extend pinned InstaDarts with safe positive-only periodic dart recognition."""
from pathlib import Path
import shutil
import sys
BASE=Path(__file__).resolve().parents[1]
def replace(path, old, new):
    s=path.read_text(encoding="utf-8")
    if s.count(old)!=1: raise RuntimeError(f"Upstream changed at {path}: {old[:60]!r}, count {s.count(old)}")
    path.write_text(s.replace(old,new,1),encoding="utf-8")
def install(root):
    shutil.copyfile(BASE/"src/client/lib/scanAssist.ts",root/"src/client/lib/scanAssist.ts")
    shutil.copyfile(BASE/"tests/unit/dartline-scan-assist.test.ts",root/"tests/unit/dartline-scan-assist.test.ts")
    runtime=root/"src/client/vision/visionRuntime.ts"
    replace(runtime,"  infer: () => Promise<BoardTip[]>;","  infer: () => Promise<BoardTip[]>;\n  /** Backup recognition must never send an empty takeout. */\n  inferPositiveOnly: () => Promise<BoardTip[]>;")
    replace(runtime,"  async function infer() {","  async function infer(publishEmpty = true) {")
    replace(runtime,"done: inferFrame(cameraSession)","done: inferFrame(cameraSession, publishEmpty)")
    replace(runtime,"async function inferFrame(session: number): Promise<BoardTip[]> {","async function inferFrame(session: number, publishEmpty: boolean): Promise<BoardTip[]> {")
    replace(runtime,"      onTips(tips);\n      return tips;","      if (tips.length > 0 || publishEmpty) onTips(tips);\n      return tips;")
    replace(runtime,"    motion,\n    infer,","    motion,\n    infer,\n    inferPositiveOnly: () => infer(false),")
    scorer=root/"src/client/pages/scorer/ScorerPage.tsx"
    replace(scorer,"import { useVisionRuntime } from '../../hooks/useVisionRuntime';","import { useVisionRuntime } from '../../hooks/useVisionRuntime';\nimport { ASSIST_INTERVAL_MS, shouldScanStationaryBoard } from '../../lib/scanAssist';")
    replace(scorer,
      "  const [settingsOpen, setSettingsOpen] = useState(false);",
      """  const [settingsOpen, setSettingsOpen] = useState(false);

  // Rescue recognition: on some phones, a small dart impact does not move enough
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
  }, [scoring, vision.cameraActive, vision.motion.armed, vision.runtimeRef, view]);""")
    replace(scorer,
      "  useEffect(() => { onStandbyChange(power.standby); }, [power.standby, onStandbyChange]);",
      """  useEffect(() => { onStandbyChange(power.standby); }, [power.standby, onStandbyChange]);

  // The parent cannot conclude that scoring works merely from cameraActive.
  // Share the true server scoring assignment and latest model result securely
  // with this same-origin embedded scorer's host.
  useEffect(() => {
    if (window.parent === window) return;
    window.parent.postMessage({
      type: 'dartline:scorer-health',
      cameraActive: vision.cameraActive,
      scoring,
      scanning: vision.motion.armed,
      boardPoints: vision.frame?.result?.boardKeypoints ?? 0,
      tips: vision.frame?.result?.tips.length ?? 0,
      inferred: Boolean(vision.frame),
      status,
    }, window.location.origin);
  }, [vision.cameraActive, vision.motion.armed, vision.frame, scoring, status]);""")
    # Reinforce the meaning of these numbers in the expanded camera screen.
    camera=root/"src/client/pages/scorer/CameraPanel.tsx"
    replace(camera,"          <FrameInfo vision={vision} />",
      """          <FrameInfo vision={vision} />
          <Text fz="xs" c="dimmed">
            Board points confirm alignment. Tips count darts recognized in the last image,
            not necessarily darts credited to the match. Keep the camera linked to your turn.
          </Text>""")
    # An explicit public build marker lets us verify that Render picked up this revision.
    public_dir = root / "public"
    public_dir.mkdir(parents=True, exist_ok=True)
    (public_dir / "dartline-build.txt").write_text(
        "dartline-safe-scan-2026-11-20-v2\n", encoding="utf-8")
    print("DartLine positive-only backup recognition and diagnostics enabled")
if __name__=="__main__":
    try: install(Path(sys.argv[1]).resolve())
    except Exception as e: print("DartLine recognition integration failed:",e,file=sys.stderr);sys.exit(1)
