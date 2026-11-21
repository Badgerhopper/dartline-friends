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
    shutil.copyfile(BASE/"src/client/lib/boardRecovery.ts",root/"src/client/lib/boardRecovery.ts")
    shutil.copyfile(BASE/"tests/unit/dartline-board-recovery.test.ts",root/"tests/unit/dartline-board-recovery.test.ts")
    shutil.copyfile(BASE/"tests/unit/dartline-scan-assist.test.ts",root/"tests/unit/dartline-scan-assist.test.ts")
    runtime=root/"src/client/vision/visionRuntime.ts"
    replace(runtime,
      "import { processPredictions, type PipelineResult } from './predictionPipeline';",
      "import type { PipelineResult } from './predictionPipeline';\nimport { recoverBoard } from '../lib/boardRecovery';")
    replace(runtime,"  infer: () => Promise<BoardTip[]>;","  infer: () => Promise<BoardTip[]>;\n  /** Backup recognition must never send an empty takeout. */\n  inferPositiveOnly: () => Promise<BoardTip[]>;")
    replace(runtime,"  async function infer() {","  async function infer(publishEmpty = true) {")
    replace(runtime,"      const runner = await ensureModel();","      let runner = await ensureModel();")
    replace(runtime,"      const { outputs, preprocessMode } = await runner.run(video, inputSize(), { forceCpuPreprocessing });",
      "      let { outputs, preprocessMode } = await runner.run(video, inputSize(), { forceCpuPreprocessing });")
    replace(runtime,"      const keypoints = predictions[0];","      let keypoints = predictions[0];")
    replace(runtime,"done: inferFrame(cameraSession)","done: inferFrame(cameraSession, publishEmpty)")
    replace(runtime,"async function inferFrame(session: number): Promise<BoardTip[]> {","async function inferFrame(session: number, publishEmpty: boolean): Promise<BoardTip[]> {")
    replace(runtime,
      "      const result = processPredictions(keypoints, boardThreshold, tipThreshold, lensCalibration);",
      """      let result = recoverBoard(keypoints, boardThreshold, tipThreshold, lensCalibration);
      // A silent bad WebGPU output can contain no valid board points but raise
      // no exception. Retry *the same camera* with CPU inference and CPU
      // preprocessing instead of asking the user to switch settings manually.
      // Switch only once per runtime: repeated model recompilation is expensive.
      if (!result && !forceCpuInference && session === cameraSession) {
        forceCpuInference = true;
        forceCpuPreprocessing = true;
        modelNeedsReload = true;
        onStatus({ stage: 'model', text: 'Using CPU recognition compatibility mode' });
        runner = await ensureModel();
        const cpu = await runner.run(video, inputSize(), { forceCpuPreprocessing: true });
        if (session !== cameraSession) return [];
        if (cpu.outputs && cpu.outputs.length >= 2) {
          keypoints = postprocess(cpu.outputs[0], cpu.outputs[1], inputSize())[0];
          result = recoverBoard(keypoints, boardThreshold, tipThreshold, lensCalibration);
          preprocessMode = cpu.preprocessMode;
        }
      }""")
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
      boardLocated: Boolean(vision.frame?.result),
      possibleBoardPoints: vision.frame?.keypoints.filter((p) => p[3] >= 0 && p[3] <= 7 && p[2] >= vision.settings.boardThreshold).length ?? 0,
      possibleTipPoints: vision.frame?.keypoints.filter((p) => p[3] === 8 && p[2] >= vision.settings.tipThreshold).length ?? 0,
      inferred: Boolean(vision.frame),
      scanCount: vision.scanCount,
      error: vision.error ?? null,
      status,
    }, window.location.origin);
  }, [vision.cameraActive, vision.motion.armed, vision.frame, vision.scanCount, vision.error, scoring, status]);

  // A test scan can be started in the full-screen phone dock without
  // disabling automatic recognition or accidentally publishing empty takeouts.
  useEffect(() => {
    if (window.parent === window) return;
    const receiveScan = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== window.parent) return;
      if (event.data?.type === 'dartline:scan-now') {
        void vision.runtimeRef.current?.inferPositiveOnly();
      }
    };
    window.addEventListener('message', receiveScan);
    return () => window.removeEventListener('message', receiveScan);
  }, [vision.runtimeRef]);""")
    # Count AI frames even when no dart or board geometry was recognized.
    hook = root/"src/client/hooks/useVisionRuntime.ts"
    replace(hook,
      "  const [frame, setFrame] = useState<FrameInfo | null>(null);",
      "  const [frame, setFrame] = useState<FrameInfo | null>(null);\n  const [scanCount, setScanCount] = useState(0);")
    replace(hook,
      "        setFrame(info);",
      "        setFrame(info);\n        setScanCount((count) => count + 1);")
    replace(hook,
      "    frame,\n    settings,",
      "    frame,\n    scanCount,\n    settings,")
    # The original manual button was disabled whenever auto-scanning was armed.
    camera=root/"src/client/pages/scorer/CameraPanel.tsx"
    replace(camera,
      '            <Button variant="default" onClick={() => void vision.runtimeRef.current?.infer()} disabled={!vision.motion.canTrigger}>',
      '            <Button variant="default" onClick={() => void vision.runtimeRef.current?.inferPositiveOnly()} disabled={!vision.cameraActive}>')
    replace(camera,"          <FrameInfo vision={vision} />",
      """          <FrameInfo vision={vision} />
          <Text fz="xs" c="dimmed">
            Completed AI scans: {vision.scanCount}. Board points show whether the
            board was located; tips show recognized darts. A live picture by
            itself is not proof that the AI is recognizing anything.
          </Text>""")
    # An explicit public build marker lets us verify the deployed Vite asset.
    public_dir = root / "src/client/public"
    public_dir.mkdir(parents=True, exist_ok=True)
    (public_dir / "dartline-build.txt").write_text(
        "dartline-safe-scan-2026-11-20-v2\n", encoding="utf-8")
    print("DartLine positive-only backup recognition and diagnostics enabled")
if __name__=="__main__":
    try: install(Path(sys.argv[1]).resolve())
    except Exception as e: print("DartLine recognition integration failed:",e,file=sys.stderr);sys.exit(1)
