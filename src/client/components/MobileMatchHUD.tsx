import { useState } from 'react';
import { Button, Modal, NativeSelect } from '@mantine/core';
import type { DartThrow, MatchState, ModeView } from '../../shared/types';
import { textOf } from '../../shared/types';
import { correctedDart, type ManualRing } from '../lib/manualCorrection';
import { VirtualBoard } from './VirtualBoard';
import type { LiveBoardView } from './VirtualBoard';
import type { VideoFeedView } from '../hooks/useVideoFeed';
import type { VideoFeedId } from '../../shared/media';

interface Props {
  match: MatchState;
  view: ModeView;
  isMyTurn: boolean;
  isSpectator: boolean;
  canAddDart: boolean;
  onLeave: () => void;
  onAddDart: (dart: DartThrow) => void;
  onUndoDart: () => void;
  onSubmitVisit: () => void;
  liveBoard: LiveBoardView | null;
  straightenVideo: boolean;
  videoOffers: readonly VideoFeedView[];
  onAcceptVideo: (id: VideoFeedId) => void;
  onDeclineVideo: (id: VideoFeedId) => void;
}

/**
 * A mobile-first scorekeeper. Everything needed between throws is above the fold;
 * the shared camera remains owned by PhoneCameraDock, not by this view.
 * The original desktop grid stays intact for wide screens.
 */
export function MobileMatchHUD({
  match, view, isMyTurn, isSpectator, canAddDart,
  onLeave, onAddDart, onUndoDart, onSubmitVisit,
  liveBoard, straightenVideo, videoOffers, onAcceptVideo, onDeclineVideo,
}: Props) {
  const [correcting, setCorrecting] = useState(false);
  const [sector, setSector] = useState('20');
  const [ring, setRing] = useState<ManualRing>('triple');
  const [boardOpen, setBoardOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const current = match.players[match.currentPlayerIndex];
  const darts = match.currentVisit?.darts ?? [];
  const active = !isSpectator && isMyTurn;
  const slots = view.slots ?? darts.map(d => `${d.score.label} (${d.score.points})`);
  const score = textOf(view.playerScores[current?.id ?? ''] ?? '—');
  const total = textOf(view.visitTotal);
  const canCorrect = active && darts.length > 0;
  const canSubmit = active && !Boolean(view.autoSubmit);

  const applyCorrection = () => {
    if (!canCorrect) return;
    try {
      const corrected = correctedDart(sector, ring);
      // Ordered over the same WebSocket. Undo removes the last accepted dart
      // before the replacement is added through the existing server validation.
      onUndoDart();
      onAddDart(corrected);
      setCorrecting(false);
    } catch {
      // Invalid options are excluded by the form; do not send a malformed dart.
    }
  };

  return (
    <section className="dartline-mobile-hud" aria-label="DartLine mobile scoreboard">
      <div className="dartline-hud-top">
        <div className="dartline-hud-brand">
          <span className="dartline-hud-eyebrow">DARTLINE · {textOf(view.headline)}</span>
          <strong>{current?.name ?? 'Dart match'} {isMyTurn ? <em>YOUR TURN</em> : <em>THROWING</em>}</strong>
        </div>
        <button type="button" onClick={onLeave} className="dartline-hud-leave">Leave</button>
      </div>

      <div className="dartline-hud-score-row">
        <div className="dartline-hud-primary" aria-live="polite">
          <span>{current?.name ?? 'Player'} · current score</span>
          <strong>{score}</strong>
        </div>
        <div className="dartline-hud-opponents">
          {match.players.filter(p => p.id !== current?.id).map(p => (
            <div className="dartline-hud-opponent" key={p.id}>
              <span>{p.name}</span>
              <strong>{textOf(view.playerScores[p.id] ?? '—')}</strong>
            </div>
          ))}
          {match.players.length === 1 && <span className="dartline-hud-solo">Solo practice</span>}
        </div>
      </div>

      {view.notice && <div className="dartline-hud-notice">{textOf(view.notice)}</div>}
      <div className="dartline-hud-round" aria-live="polite">
        <div className="dartline-hud-round-label">
          <span>THIS THROW</span>
          <strong>{total ? `Visit: ${total}` : `${darts.length} / ${view.dartsPerVisit} darts`}</strong>
        </div>
        <div className="dartline-hud-dart-row">
          {Array.from({length:view.dartsPerVisit}, (_,i) => (
            <div className="dartline-hud-dart" key={i}>
              <small>DART {i+1}</small>
              <strong>{slots[i] === undefined ? '—' : textOf(slots[i])}</strong>
            </div>
          ))}
        </div>
      </div>

      <div className="dartline-hud-secondary">
        <button type="button" onClick={() => setBoardOpen(v=>!v)} aria-expanded={boardOpen}>
          {boardOpen ? '▴ Hide board' : '🎯 Show board / add missed dart'}
        </button>
        <button type="button" onClick={() => setDetailsOpen(v=>!v)} aria-expanded={detailsOpen}>
          {detailsOpen ? '▴ Hide history' : '▾ Visit history'}
        </button>
      </div>
      {boardOpen && (
        <div className="dartline-hud-board">
          <VirtualBoard
            darts={darts} dartsPerVisit={view.dartsPerVisit}
            onAddDart={onAddDart} disabled={!canAddDart}
            liveBoard={liveBoard} straightenVideo={straightenVideo}
            videoOffers={videoOffers} onAcceptVideo={onAcceptVideo} onDeclineVideo={onDeclineVideo}
          />
        </div>
      )}
      {detailsOpen && (
        <div className="dartline-hud-history">
          {view.history.filter(h => textOf(h).trim()).slice(0,8).map((h,i) => <p key={i}>{textOf(h)}</p>)}
          {view.history.every(h => !textOf(h).trim()) && <p>No completed visits yet.</p>}
        </div>
      )}

      <div className="dartline-hud-actions" role="group" aria-label="Throw controls">
        <Button variant="light" color="gray" disabled={!active || darts.length===0} onClick={onUndoDart}>↶ Undo</Button>
        <Button variant="light" color="yellow" disabled={!canCorrect} onClick={()=>{
          const label = darts.at(-1)?.score.label ?? 'T20';
          if (/^[SDT]\d+$/.test(label)) {
            setSector(label.slice(1));
            setRing(label[0] === 'T' ? 'triple' : label[0] === 'D' ? 'double' : 'single');
          } else if (label === 'SB' || label === 'DB') {
            setSector('BULL'); setRing(label === 'DB' ? 'double' : 'single');
          }
          setCorrecting(true);
        }}>Correct</Button>
        <Button variant="filled" color="teal" disabled={!canSubmit}
          onClick={onSubmitVisit}>Submit ↗</Button>
      </div>

      <Modal opened={correcting} onClose={()=>setCorrecting(false)} title="Correct last dart" centered size="sm">
        <div className="dartline-hud-correction">
          <p>Select the actual segment and ring. DartLine will replace the last recognized dart.</p>
          <NativeSelect label="Segment" value={sector} onChange={e=>setSector(e.currentTarget.value)}
            data={[...Array.from({length:20},(_,i)=>String(i+1)), 'BULL']} />
          <NativeSelect label="Ring" value={sector==='BULL'&&ring==='triple'?'single':ring}
            onChange={e=>setRing(e.currentTarget.value as ManualRing)}
            data={sector==='BULL'
              ? [{value:'single',label:'Outer bull (25)'},{value:'double',label:'Bullseye (50)'}]
              : [{value:'single',label:'Single'},{value:'double',label:'Double'},{value:'triple',label:'Triple'}]} />
          <Button fullWidth color="teal" onClick={applyCorrection}>Replace last dart</Button>
        </div>
      </Modal>
    </section>
  );
}
