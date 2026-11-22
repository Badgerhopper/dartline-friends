import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
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
  const [view, setView] = useState<'setup' | 'preview' | 'hidden'>('setup');
  const [position, setPosition] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('dartline_camera_position_v1') ?? 'null');
      if (Number.isFinite(saved?.x) && Number.isFinite(saved?.y)) return { x: saved.x as number, y: saved.y as number };
    } catch { /* Local settings may be unavailable in private browsing. */ }
    return { x: Math.max(8, window.innerWidth - Math.min(window.innerWidth * .46, 190) - 8), y: 64 };
  });
  const drag = useRef<{ startX: number; startY: number; x: number; y: number } | null>(null);
  const positionRef = useRef(position);
  positionRef.current = position;
  const bounds = (x: number, y: number) => {
    const width = view === 'hidden' ? 54 : Math.min(window.innerWidth * .46, 190);
    const height = view === 'hidden' ? 54 : 190;
    return { x: Math.max(4, Math.min(Math.round(x), window.innerWidth - width - 4)),
      y: Math.max(4, Math.min(Math.round(y), window.innerHeight - height - 4)) };
  };
  const beginDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (view === 'setup') return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { startX: event.clientX, startY: event.clientY, ...positionRef.current };
    event.preventDefault();
  };
  const moveDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!drag.current) return;
    const d = drag.current;
    setPosition(bounds(d.x + event.clientX - d.startX, d.y + event.clientY - d.startY));
    event.preventDefault();
  };
  const endDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!drag.current) return;
    drag.current = null;
    try { localStorage.setItem('dartline_camera_position_v1', JSON.stringify(positionRef.current)); } catch {}
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  useEffect(() => {
    if (view === 'setup') return;
    const onResize = () => setPosition(old => ({
      x: Math.max(4, Math.min(old.x, window.innerWidth - (view === 'hidden' ? 54 : Math.min(window.innerWidth * .46, 190)) - 4)),
      y: Math.max(4, Math.min(old.y, window.innerHeight - (view === 'hidden' ? 54 : 190) - 4)),
    }));
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [view]);
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
      <button type="button" className="dartline-phone-launch" onClick={() => { setView('setup'); onEnable(); }}
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
    <section aria-label="DartLine phone camera" className={'dartline-phone-dock is-'+view}
      style={view === 'setup' ? undefined : { left: position.x, top: position.y }}>
      <div className="dartline-phone-header">
        {view !== 'setup' && (
          <button type="button" className="dartline-drag-handle" aria-label="Drag camera window"
            title="Drag to move" onPointerDown={beginDrag} onPointerMove={moveDrag}
            onPointerUp={endDrag} onPointerCancel={endDrag}>⠿</button>
        )}
        {view !== 'hidden' && <span className="dartline-phone-label"><span aria-hidden="true">●</span> {label}</span>}
        <div className="dartline-phone-actions">
          {view === 'setup' ? (
            <>
              <button type="button" onClick={() => setView('preview')}>Show game</button>
              <button type="button" onClick={onDisable} aria-label="Stop this phone's camera">Stop</button>
            </>
          ) : view === 'preview' ? (
            <>
              <button type="button" onClick={() => setView('setup')}>Setup</button>
              <button type="button" onClick={() => setView('hidden')}>Hide</button>
            </>
          ) : (
            <button type="button" aria-label="Show camera preview" onClick={() => setView('preview')}>🎯</button>
          )}
        </div>
      </div>
      {view === 'setup' && report && (
        <div className="dartline-phone-diagnostics" role="status" aria-live="polite">
          <strong>{details}</strong>
          <span>Completed AI scans: {report.scanCount} · {report.scanning ? 'Automatic scanning on' : 'Automatic scanning off'}</span>
          <span>{explanation}</span>
        </div>
      )}
      {view === 'setup' && !report && code !== null && (
        <div className="dartline-phone-diagnostics" role="status">
          Waiting for scoring camera diagnostics. Start the camera in the panel below.
        </div>
      )}
      {view === 'setup' && code !== null && (
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
      {view === 'preview' && <span className="dartline-phone-compact-hint">Drag ⠿ to move · Hide for a tiny button</span>}
    </section>
  );
}
