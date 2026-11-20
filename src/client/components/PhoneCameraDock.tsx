import { useState } from 'react';
import { scorerPath } from '../lib/phoneCamera';

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
  if (!enabled) {
    return (
      <button type="button" className="dartline-phone-launch" onClick={() => { setExpanded(true); onEnable(); }}
        aria-label="Use this phone as the dartboard camera">
        🎯 Use this phone's camera
      </button>
    );
  }
  const label = cameraError ? 'Camera needs attention' : cameraActive ? 'Camera scoring active' :
    connected ? 'Camera setup' : 'Connecting to game server';
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
      {cameraError && <div className="dartline-phone-error" role="alert">{cameraError}</div>}
      {code === null
        ? <div className="dartline-phone-wait" role="status">
            <p>{connected ? 'Pairing this phone automatically…' : 'Connecting…'}</p>
            <button type="button" onClick={onRetry} disabled={!connected}>Get a new camera code</button>
          </div>
        : <iframe
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
