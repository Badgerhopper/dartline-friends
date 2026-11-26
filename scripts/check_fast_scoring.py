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
            '!takeoutMonitorArmed && shouldScanStationaryBoard' in scorer
            and 'fastBoardClear.current.claim' in scorer
            and 'takeoutExclusive.current=enabled' in scorer
            and 'allowVerifiedEmpty.current=true' in scorer
        ),
        'Conservative duplicate and correction protections retained': (
            "matchKnownCameraTips" in (root/'src/server/scoring/cluster.ts').read_text(encoding='utf-8')
        ),
        'Precise board pose refit is installed after robust RANSAC': (
            "import { refineHomographyWithInliers } from './homographyRefine';"
            in (root/'src/shared/vision/homography.ts').read_text(encoding='utf-8')
            and 'return refineHomographyWithInliers(src, dst, best.matrix, threshold);'
            in (root/'src/shared/vision/homography.ts').read_text(encoding='utf-8')
        ),
        'Independent scoring never publishes unconfirmed inference': (
            'inferCandidates: () => busy || !camera.active' in runtime
            and 'if (publishTips && (tips.length > 0 || publishEmpty)) onTips(tips);' in runtime
            and 'if (result && publishTips)' in runtime
        ),
        'Motion-free recovery confirms actual candidate frames': (
            'runtime.inferCandidates()' in scorer
            and 'idleTipRecovery.current.observe(relaxed.tips,Date.now())' in scorer
            and 'movementEpoch.current !== initialEpoch' in scorer
        ),
        'No AI recovery after three registered darts or during retrieval': (
            'shouldRecoverSilentHits({' in scorer
            and 'takeoutMonitorArmed, hint:ctx' in scorer
            and 'hint.active && hint.dartsRecorded < 3' in
            (root/'src/client/lib/recoveryEligibility.ts').read_text(encoding='utf-8')
        ),
        'Match turn identity reaches the camera iframe': (
            "type:'dartline:visit-context'" in dock
            and 'const currentVisit = useRef(' in dock
        ),
        'Missing optional HUD events cannot suppress recognition': (
            'shouldRecoverSilentHits({' in scorer
            and "import { shouldRecoverSilentHits }" in scorer
            and "document.visibilityState === 'visible'" not in scorer[scorer.find('const idleTipRecovery'):scorer.find('const motionRescue')]
        ),
        'Retrieval still takes precedence, no phantom auto-submit': (
            '!takeoutMonitorArmed' in scorer
            and 'takeoutMonitorArmed, hint:ctx' in scorer
        ),
        'Full-speed scanner preserves two or three independent confirmations': (
            'IDLE_RECOVERY_INTERVAL_MS = 950' in
                (root/'src/client/lib/idleTipRecovery.ts').read_text(encoding='utf-8')
            and 'candidate.count < required' in
                (root/'src/client/lib/idleTipRecovery.ts').read_text(encoding='utf-8')
        ),
        'No motion gate or blind empty submission for verified takeout': (
            'fastBoardClear.current.claim(' in scorer
            and 'runtime.inferCandidates()' in scorer
            and 'allowVerifiedEmpty.current=true' in scorer
            and 'takeoutExclusive.current && !allowVerifiedEmpty.current' in scorer
            and 'relaxed.tips.length' in scorer
            and 'takeoutScene.current.observe(gray,Date.now(),' in scorer
            and 'fastBoardClear.current.noteRetrievalMotion()' in scorer
            and 'this.sawRetrievalMotion' in
                 (root/'src/client/lib/fastBoardClear.ts').read_text(encoding='utf-8')
        ),
        'Manual submit remains possible if auto-submit lags': (
            "autoTakeout ? 'Submit now'" in hud
        ),
        'The camera carries observed tips within the active visit only': (
            'visitTipEvidence.current.observePositive(scoring, tips.length' in scorer
            and 'visitTipEvidence.current.updateVisit(msg.key,msg.active)' in scorer
            and 'visitTipEvidence.current.seenDuringThisVisit' in scorer
        ),
        'Auto takeout can safely retry missed server confirmations': (
            'FAST_CLEAR_MAX_PAIRS = 3' in
             (root/'src/client/lib/fastBoardClear.ts').read_text(encoding='utf-8')
            and 'this.completedPairs++' in
             (root/'src/client/lib/fastBoardClear.ts').read_text(encoding='utf-8')
            and 'this.sawRetrievalMotion' in
             (root/'src/client/lib/fastBoardClear.ts').read_text(encoding='utf-8')
        ),
        'Server takeout setting is idempotent, confirmed and reconnect-safe': (
            'if(this.takeoutMode===desired) return;' in
              (root/'src/server/scoring/session.ts').read_text(encoding='utf-8')
            and "type:'verified_takeout_status'" in
              (root/'src/server/wsHandler.ts').read_text(encoding='utf-8')
            and 'window.setInterval(() => onAutoTakeoutChange(true),5000)' in hud
        ),
        'UI reports verified server takeout confirmation, not just local toggle': (
            'takeoutServer?.enabled' in hud
            and 'takeoutServer.confirmations===1' in hud
            and "'dartline:verified-takeout-status'" in
              (root/'src/client/hooks/useMatch.ts').read_text(encoding='utf-8')
        ),
        'Temporal vision actually compares before/after video, not just model confidence': (
            'temporalDartTracker.current.observe(image,now)' in scorer
            and 'readTemporalCamera(vision.refs.video.current' in scorer
            and 'detectTemporalDart(' in
             (root/'src/client/lib/temporalDartEvidence.ts').read_text(encoding='utf-8')
        ),
        'Occluded-tip guesses require human confirmation': (
            "type:'dartline:temporal-guess'" in scorer
            and "window.dispatchEvent(new CustomEvent('dartline:temporal-guess'" in dock
            and 'scoreFromBoardCoords(temporalGuess.x,temporalGuess.y)' in hud
            and 'Use estimate' in hud
        ),
        'Clear exterior-ring MISS detection has geometry and visual guards': (
            "result.label==='miss' && radial>425000" in scorer
            and 'guess.confidence>=0.80 && !guess.obscured' in scorer
        ),
        'Fast verified removal prewarms from second dart without early submit': (
            'const prepareTakeout = autoTakeout' in hud
            and 'darts.length>=2' in hud
            and 'takeoutMonitorPrepared' in scorer
            and 'takeoutExclusive.current))' in scorer
            and 'visitContext.current.dartsRecorded===3' in scorer
        ),
        'Physical empty-board return is scoped to the same current visit': (
            'visualBoardReturn.current.reset()' in scorer
            and 'visualBoardReturn.current.observe(image,ctx.dartsRecorded,now)' in scorer
            and 'fastBoardClear.current.noteVisualClear(now)' in scorer
            and 'FAST_CLEAR_PHOTO_PROOF_MS = 5000' in
              (root/'src/client/lib/fastBoardClear.ts').read_text(encoding='utf-8')
            and 'this.photoClearUntil>now' in
              (root/'src/client/lib/fastBoardClear.ts').read_text(encoding='utf-8')
        ),
        'Release marker and visible version match': (
            marker == 'dartline-v5-hybrid-temporal-vision-2026-11-26'
            and 'DARTLINE v5.0' in hud
        ),
    }
    failed = [name for name, success in checks.items() if not success]
    for name, success in checks.items():
        print(('PASS' if success else 'FAIL') + ': ' + name)
    if failed:
        raise RuntimeError('DartLine v4 assembly checks failed: ' + ', '.join(failed))

if __name__ == '__main__':
    try:
        verify(Path(sys.argv[1]).resolve())
    except Exception as exc:
        print(exc, file=sys.stderr)
        sys.exit(1)
