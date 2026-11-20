import { useEffect, useRef, useState } from 'react';
import { scorerPath } from '../lib/phoneCamera';

type ScorerReport = {
  cameraActive: boolean;
  scoring: boolean;
  scanning: boolean;
  boardPoints: number;
  tips: number;
  boardLocated: boolean;
  possibleBoardPoints: number;
  possibleTipPoints: number;
  inferred: boolean;
  scanCount: number;
  error: string | null;
  status: string;
};

type Props = {
  enabled: boolean;
  connected: boolean;
  code: string | null; // null = waiting for pairing code; '' = resume existing pairing
  cameraActive: boolean;
  cameraError?: string;
  onEnable: () => void;
  onDisable: () => void;
  onRetry: () => void;
};

/**
 * Keeps the scorer document visible in a same-origin iframe on the *same phone*
 * as the match. Unlike opening another Safari tab, the camera does not have to
 * run in the browser background. Source is held stable when panel size changes.
 * Camera permission remains under the user's control inside the scorer frame.
 */
export function PhoneCameraDock({ enabled, connected, code, cameraActive, cameraError,
  onEnable, onDisable, onRetry }: Props) {
  const [expanded, setExpanded] = useState(true);
  const frame = useRef<HTMLIFrameElement>(null);
  const [report, setReport] = useState<ScorerReport | null>(null);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== frame.current?.contentWindow) return;
      const data = event.data;
      if (!data || data.type !== 'dartline:scorer-health') return;
      if (typeof data.cameraActive !== 'boolean' || typeof data.scoring !== 'boolean'
        || typeof data.scanning !== 'boolean' || typeof data.boardPoints !== 'number'
        || typeof data.tips !== 'number' || typeof data.inferred !== 'boolean'
        || typeof data.boardLocated !== 'boolean'
        || typeof data.possibleBoardPoints !== 'number'
        || typeof data.possibleTipPoints !== 'number'
        || typeof data.scanCount !== 'number'
        || !(data.error === null || typeof data.error === 'string')
        || typeof data.status !== 'string') return;
      setReport({
        cameraActive: data.cameraActive, scoring: data.scoring, scanning: data.scanning,
        boardPoints: data.boardPoints, tips: data.tips, inferred: data.inferred,
        boardLocated: data.boardLocated, possibleBoardPoints: data.possibleBoardPoints,
        possibleTipPoints: data.possibleTipPoints, scanCount: data.scanCount,
        error: data.error, status: data.status,
      });
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, []);
  useEffect(() => { setReport(null); }, [code]);
  if (!enabled) {
    return (
      <button type="button" className="dartline-phone-launch" onClick={() => { setExpanded(true); onEnable(); }}
        aria-label="Use this phone as the dartboard camera">
        🎯 Use this phone's camera
      </button>
    );
  }
  const label = cameraError ? 'Camera needs attention'
    : report?.cameraActive && report.scoring ? 'Camera connected to match'
    : cameraActive ? 'Camera on · not scoring' : connected ? 'Camera setup'
    : 'Connecting to game server';
  const details = !report?.inferred ? 'AI has not completed a scan yet'
    : report.boardLocated
      ? `${report.boardPoints} board points · ${report.tips} dart tips recognized`
      : `Board not located · ${report.possibleBoardPoints} usable board markers · ${report.possibleTipPoints} tip candidates`;
  const explanation = !report?.cameraActive ? 'The camera is not running.'
    : report.error ? 'AI error: ' + report.error
    : !report.inferred ? 'Use Test AI recognition to check that model inference runs.'
    : !report.boardLocated ? 'Center and zoom the entire dartboard. Change the phone angle or lighting if needed.'
    : !report.scoring ? 'Board detection is separate from scoring. Start a match and check camera assignment.'
    : report.tips === 0 ? 'Board located, but no dart tip recognized in the latest image.'
    : 'Darts detected by AI. If the score stays unchanged, check that this camera is assigned to the match.';
  return (
    <section aria-label="DartLine phone camera" className={'dartline-phone-dock '+(expanded?'is-expanded':'is-compact')}>
      <div className="dartline-phone-header">
        <span className="dartline-phone-label"><span aria-hidden="true">●</span> {label}</span>
        <div className="dartline-phone-actions">
          <button type="button" onClick={() => setExpanded(!expanded)}>
            {expanded ? 'Show game' : 'Camera setup'}
          </button>
          <button type="button" onClick={onDisable} aria-label="Stop this phone's camera">Stop</button>
        </div>
      </div>
      {expanded && report && (
        <div className="dartline-phone-diagnostics" role="status" aria-live="polite">
          <strong>{details}</strong>
          <span>Completed AI scans: {report.scanCount} · {report.scanning ? 'Automatic scanning on' : 'Automatic scanning off'}</span>
          <span>{explanation}</span>
        </div>
      )}
      {expanded && report?.cameraActive && (
        <div className="dartline-scan-controls">
          <button type="button" onClick={() => frame.current?.contentWindow?.postMessage(
            { type: 'dartline:scan-now' }, window.location.origin
          )}>Test AI recognition now</button>
        </div>
      )}
      {cameraError && <div className="dartline-phone-error" role="alert">{cameraError}</div>}
      {code === null
        ? <div className="dartline-phone-wait" role="status">
            <p>{connected ? 'Pairing this phone automatically…' : 'Connecting…'}</p>
            <button type="button" onClick={onRetry} disabled={!connected}>Get a new camera code</button>
          </div>
        : <iframe
            ref={frame}
            key={code || 'resume'}
            title="DartLine scoring camera"
            src={scorerPath(code)}
            allow="camera; microphone; autoplay"
            referrerPolicy="same-origin"
            className="dartline-phone-frame"
          />}
      {!expanded && <span className="dartline-phone-compact-hint">Tap Camera setup to adjust the view</span>}
    </section>
  );
}
