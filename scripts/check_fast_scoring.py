#!/usr/bin/env python3
"""Fail the production build if the DartLine fast-camera fixes are missing.
This checks the fully assembled InstaDarts tree, not merely the patch sources.
"""
from pathlib import Path
import sys

def verify(root: Path) -> None:
    runtime = (root/'src/client/vision/visionRuntime.ts').read_text(encoding='utf-8')
    scorer = (root/'src/client/pages/scorer/ScorerPage.tsx').read_text(encoding='utf-8')
    dock = (root/'src/client/components/PhoneCameraDock.tsx').read_text(encoding='utf-8')
    health = (root/'src/client/lib/cameraHealth.ts').read_text(encoding='utf-8')
    hud = (root/'src/client/components/MobileMatchHUD.tsx').read_text(encoding='utf-8')
    marker = (root/'src/client/public/dartline-build.txt').read_text(encoding='utf-8').strip()
    checks = {
        'CPU only when GPU inference throws': (
            'GPU recognition failed; using CPU compatibility mode' in runtime and
            'if (!result && !forceCpuInference' not in runtime and
            'Using CPU recognition compatibility mode' not in runtime
        ),
        'Board geometry can fail without CPU switch': (
            'let result = recoverBoard(keypoints, boardThreshold, tipThreshold, lensCalibration)' in runtime
        ),
        'No heartbeat-triggered iframe reload': (
            'shouldRecoverCameraLink' not in dock and 'setFrameGeneration' not in dock
        ),
        'No misleading camera-link failure badge': (
            'Camera update delayed' in health and 'Camera link paused' not in health
        ),
        'One scoring backup scan per motion': (
            'motionRescue.current.claim' in scorer and
            'motionRescue.current.observe' in scorer
        ),
        'Dart removal gets the camera exclusively after three scores': (
            '!takeoutMonitorArmed && shouldScanStationaryBoard' in scorer and
            'removalMonitor.current.claim' in scorer
        ),
        'Conservative duplicate and correction protections retained': (
            "matchKnownCameraTips" in (root/'src/server/scoring/cluster.ts').read_text(encoding='utf-8')
        ),
        'Release marker and visible version match': (
            marker == 'dartline-v3.6-fast-camera-verified-takeout-2026-11-26'
            and 'DARTLINE v3.6' in hud
        ),
    }
    failed = [name for name, success in checks.items() if not success]
    for name, success in checks.items():
        print(('PASS' if success else 'FAIL') + ': ' + name)
    if failed:
        raise RuntimeError('DartLine v3.6 assembly checks failed: ' + ', '.join(failed))

if __name__ == '__main__':
    try:
        verify(Path(sys.argv[1]).resolve())
    except Exception as exc:
        print(exc, file=sys.stderr)
        sys.exit(1)
