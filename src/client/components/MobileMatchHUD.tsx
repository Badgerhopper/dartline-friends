import { useEffect, useMemo, useState } from 'react';
import { Button, Modal, NativeSelect } from '@mantine/core';
import type { DartThrow, MatchState, ModePanel, ModeView } from '../../shared/types';
import { textOf } from '../../shared/types';
import { correctedDart, type ManualRing } from '../lib/manualCorrection';
import { checkoutSuggestions } from '../lib/x01Checkout';
import { VirtualBoard } from './VirtualBoard';
import { ModePanelBlock } from './ModePanelBlock';
import { OpponentTurnView } from './OpponentTurnView';
import { remoteTurnOpponent } from '../lib/remoteTurn';
import { cameraHealthLabel, type CameraHealth } from '../lib/cameraHealth';
import type { LiveBoardView } from './VirtualBoard';
import type { VideoFeedView } from '../hooks/useVideoFeed';
import type { VideoFeedId } from '../../shared/media';

interface Props {
  match: MatchState;
  view: ModeView;
  panel?: ModePanel;
  isMyTurn: boolean;
  ownPlayerIds: readonly string[];
  isSpectator: boolean;
  canAddDart: boolean;
  onLeave: () => void;
  onAddDart: (dart: DartThrow) => void;
  onUndoDart: () => void;
  onCorrectDart: (index: number, expectedDartId: string, dart: DartThrow) => void;
  onInsertDart: (index: number, expectedIds: string[], dart: DartThrow) => void;
  onAutoTakeoutChange: (enabled: boolean) => void;
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
  match, view, panel, isMyTurn, ownPlayerIds, isSpectator, canAddDart,
  onLeave, onAddDart, onUndoDart, onCorrectDart, onInsertDart, onAutoTakeoutChange, onSubmitVisit,
  liveBoard, straightenVideo, videoOffers, onAcceptVideo, onDeclineVideo,
}: Props) {
  const [correctingIndex, setCorrectingIndex] = useState<number | null>(null);
  const [editKind, setEditKind] = useState<'replace' | 'insert'>('replace');
  const [autoTakeout, setAutoTakeout] = useState(() => {
    try { return window.localStorage.getItem('dartline_verified_takeout_v1') === '1'; }
    catch { return false; }
  });
  const [sector, setSector] = useState('20');
  const [ring, setRing] = useState<ManualRing>('triple');
  const [boardOpen, setBoardOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const current = match.players[match.currentPlayerIndex];
  const darts = match.currentVisit?.darts ?? [];
  const active = !isSpectator && isMyTurn;
  const slots = view.slots ?? darts.map(d => `${d.score.label} (${d.score.points})`);
  const score = textOf(view.playerScores[current?.id ?? ''] ?? '—');
  const total = textOf(view.visitTotal);
  const canCorrect = active && darts.length > 0;
  const canInsert = active && canAddDart && darts.length < view.dartsPerVisit;
  // The per-board setting is sent to the scoring server when a match begins.
  // It is opt-in, since weak camera recognition must never silently advance
  // a turn without the player's explicit preference.
  useEffect(() => {
    if (match.status === 'in_progress') onAutoTakeoutChange(autoTakeout);
  }, [match.id, match.status, onAutoTakeoutChange, autoTakeout]);
  const changeAutoTakeout = () => {
    const next = !autoTakeout;
    setAutoTakeout(next);
    try { window.localStorage.setItem('dartline_verified_takeout_v1', next ? '1' : '0'); } catch {}
  };
  const canSubmit = active && !Boolean(view.autoSubmit);
  const remaining = Number(score);
  const dartsAvailable = Math.max(0, view.dartsPerVisit - darts.length);
  const doubleOut = match.settings.modeSettings.doubleOut !== false;
  const waitingForDoubleIn = Boolean(view.notice && /double.in required/i.test(textOf(view.notice)))
    && !darts.some(d => d.score.mult === 2 || d.score.label === 'DB');
  const routes = useMemo(() =>
    match.settings.mode === 'x01' && Number.isInteger(remaining) && !waitingForDoubleIn
      ? checkoutSuggestions({ remaining, dartsAvailable, doubleOut })
      : [],
    [match.settings.mode, remaining, dartsAvailable, doubleOut, waitingForDoubleIn],
  );
  const openCamera = () => window.dispatchEvent(new Event('dartline:open-camera'));

  const beginMissing = (index: number) => {
    if (!canInsert) return;
    setEditKind('insert');
    setCorrectingIndex(Math.min(index, darts.length));
    setSector('20');
    setRing('single');
  };
  const beginCorrection = (index: number) => {
    if (!canCorrect || index < 0 || index >= darts.length) return;
    setEditKind('replace');
    const label = darts[index]?.score.label ?? 'S20';
    const match = /^([SDT])(\\d+)$/.exec(label);
    if (match) {
      setSector(match[2]);
      setRing(match[1] === 'T' ? 'triple' : match[1] === 'D' ? 'double' : 'single');
    } else if (label === 'SB' || label === 'DB') {
      setSector('BULL');
      setRing(label === 'DB' ? 'double' : 'single');
    } else {
      setSector('MISS'); setRing('single');
    }
    setCorrectingIndex(index);
  };
  const applyCorrection = () => {
    if (correctingIndex === null) return;
    try {
      const corrected = correctedDart(sector, sector === 'BULL' && ring === 'triple' ? 'single' : ring);
      if (editKind === 'insert') {
        if (!canInsert || !darts.every(d => Boolean(d.id))) return;
        onInsertDart(correctingIndex, darts.map(d => d.id!), corrected);
      } else {
        const selected = darts[correctingIndex];
        if (!canCorrect || !selected?.id) return;
        onCorrectDart(correctingIndex, selected.id, corrected);
      }
      setCorrectingIndex(null);
    } catch {
      // Invalid input is not sent; the modal stays open for the user to adjust it.
    }
  };
  const [cameraReport, setCameraReport] = useState<CameraHealth | null>(null);
  const [clock, setClock] = useState(Date.now());
  useEffect(() => {
    const onHealth = (event: Event) => {
      const data=(event as CustomEvent<{
        cameraActive:boolean; scoring:boolean; scanning:boolean;
        scanCount:number; motionFps:number; error:string|null;
      }>).detail;
      if (!data) return;
      const now=Date.now();
      setCameraReport(current => ({
        ...data,
        lastHealthAt:now,
        armedSince: current?.scanning && data.scanning ? current.armedSince : now,
      }));
    };
    window.addEventListener('dartline:camera-health', onHealth);
    const ticker=window.setInterval(() => setClock(Date.now()), 3000);
    return () => {
      window.removeEventListener('dartline:camera-health', onHealth);
      window.clearInterval(ticker);
    };
  }, []);
  const remoteOpponent = remoteTurnOpponent(match, ownPlayerIds, isSpectator);
  // The scoring iframe lives outside the mobile match screen. Explicitly arm
  // removal checks ONLY while this board owns a three-dart visit, and disarm
  // as soon as the player submits, switches turns, or disables the setting.
  const monitorTakeout = autoTakeout && active && !remoteOpponent
    && match.status === 'in_progress' && darts.length === 3;
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('dartline:takeout-monitor', {
      detail:{armed:monitorTakeout},
    }));
    return () => {
      window.dispatchEvent(new CustomEvent('dartline:takeout-monitor', {
        detail:{armed:false},
      }));
    };
  },[monitorTakeout,match.id,match.currentPlayerIndex,match.visits.length]);
  const cameraText = cameraHealthLabel(cameraReport,clock);

  // Turn changes arrive with the authoritative match state over WebSocket.
  // Recompute from the active player's board, never from a client-side timer.
  // A single-board match or a player who owns both local slots stays on the
  // usual scoring screen, while the remote board is read-only.
  if (remoteOpponent) {
    return <OpponentTurnView match={match} view={view} panel={panel}
      opponent={remoteOpponent} ownPlayerIds={ownPlayerIds}
      liveBoard={liveBoard} straightenVideo={straightenVideo}
      videoOffers={videoOffers} onAcceptVideo={onAcceptVideo}
      onDeclineVideo={onDeclineVideo} onLeave={onLeave} />;
  }

  return (
    <section className="dartline-mobile-hud" aria-label="DartLine mobile scoreboard">
      <div className="dartline-hud-top">
        <div className="dartline-hud-brand">
          <span className="dartline-hud-eyebrow">DARTLINE v6.2 RC · NOT RELEASED · {textOf(view.headline)}</span>
          <strong>{current?.name ?? 'Dart match'} {isMyTurn ? <em>YOUR TURN</em> : <em>THROWING</em>}</strong>
        </div>
        <div className="dartline-hud-top-actions">
          <span className={'dartline-hud-camera-health '+(cameraText==='Watching for dart'?'is-scanning':'is-warning')}
            aria-live="polite">{cameraText}</span>
          <button type="button" onClick={openCamera} className="dartline-hud-camera" aria-label="Open camera setup">📷 Camera</button>
          <button type="button" onClick={onLeave} className="dartline-hud-leave">Leave</button>
        </div>
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
            <button type="button" className="dartline-hud-dart" key={i}
              disabled={!active || (i>=darts.length && !canInsert)}
              aria-label={darts[i] ? `Correct or insert before dart ${i+1}: ${darts[i].score.label}` : `Manually enter missing dart ${i+1}`}
              onClick={() => i<darts.length ? beginCorrection(i) : beginMissing(i)}>
              <small>DART {i+1}{i<darts.length ? ' ✎' : ''}</small>
              <strong>{slots[i] === undefined ? '—' : textOf(slots[i])}</strong>
            </button>
          ))}
        </div>
      </div>

      <div className="dartline-hud-slot-hint">Tap any dart slot to correct it or enter a missed throw.</div>
      {match.settings.mode === 'x01' && Number.isInteger(remaining) && remaining > 0 && remaining <= 170 && (
        <div className="dartline-hud-checkout" aria-label="X01 checkout suggestions" aria-live="polite">
          <span className="dartline-hud-checkout-caption">🎯 CHECKOUT · {dartsAvailable} {dartsAvailable===1?'DART':'DARTS'} LEFT</span>
          {waitingForDoubleIn ? (
            <strong>Double-in required first</strong>
          ) : routes.length ? (
            <>
              <strong>{routes[0].darts.join(' → ')}</strong>
              {routes.length > 1 && <small>Other routes: {routes.slice(1).map(r => r.darts.join(' → ')).join('  |  ')}</small>}
            </>
          ) : (
            <strong>{dartsAvailable === 0 ? 'Submit this visit' : 'No finish with darts left. Set up a double.'}</strong>
          )}
        </div>
      )}
      <div className="dartline-hud-extras">
      <div className="dartline-hud-secondary">
        <button type="button" onClick={() => setBoardOpen(true)} aria-haspopup="dialog">
          🎯 Manual board
        </button>
        {panel && (
          <button type="button" onClick={() => setStatsOpen(v=>!v)} aria-expanded={statsOpen}>
            {statsOpen ? '▴ Hide stats' : '▾ Game stats'}
          </button>
        )}
        <button type="button" onClick={() => setDetailsOpen(v=>!v)} aria-expanded={detailsOpen}>
          {detailsOpen ? '▴ Hide history' : '▾ History'}
        </button>
      </div>
      <button type="button" className={'dartline-hud-auto-takeout '+(autoTakeout?'is-on':'')}
        onClick={changeAutoTakeout} aria-pressed={autoTakeout}>
        {autoTakeout ? '✓ Auto-submit on board clear: ON' : 'Auto-submit on board clear: OFF'}
      </button>
      {autoTakeout && <p className="dartline-hud-takeout-note">After all 3 darts are scored, removing them submits
        the turn only after removal motion and two clear scans. Check scores before retrieving.</p>}
      {panel && statsOpen && (
        <div className="dartline-hud-game-stats">
          <ModePanelBlock modeId={match.settings.mode} panel={panel} />
        </div>
      )}
      {detailsOpen && (
        <div className="dartline-hud-history">
          {view.history.filter(h => textOf(h).trim()).slice(0,8).map((h,i) => <p key={i}>{textOf(h)}</p>)}
          {view.history.every(h => !textOf(h).trim()) && <p>No completed visits yet.</p>}
        </div>
      )}

      </div>
      <div className="dartline-hud-actions" role="group" aria-label="Throw controls">
        <Button variant="light" color="gray" disabled={!active || darts.length===0} onClick={onUndoDart}>↶ Undo</Button>
        <Button variant="light" color="yellow" disabled={!canCorrect}
          onClick={() => beginCorrection(darts.length-1)}>✎ Correct</Button>
        <Button variant="filled" color="teal" disabled={!canSubmit}
          onClick={onSubmitVisit}>Submit ↗</Button>
      </div>

      <Modal opened={boardOpen} onClose={() => setBoardOpen(false)}
        title="Manual dartboard · tap where the dart landed" centered size="lg" zIndex={1700}>
        <div className="dartline-hud-board">
          <VirtualBoard darts={darts} dartsPerVisit={view.dartsPerVisit}
            onAddDart={dart => { if (canAddDart) { onAddDart(dart); setBoardOpen(false); } }}
            disabled={!canAddDart} liveBoard={null}
            straightenVideo={false} videoOffers={[]}
          />
        </div>
        <p className="dartline-hud-hint">Tap the board to add a missed dart. To change an already scored dart,
          tap its numbered score on the main screen, or use Correct.</p>
      </Modal>
      <Modal opened={correctingIndex !== null} onClose={() => setCorrectingIndex(null)}
        title={editKind === 'insert' ? 'Enter a missed throw' : 'Correct a specific dart'} centered size="sm" zIndex={1800}>
        <div className="dartline-hud-correction">
          <p>{editKind === 'insert'
            ? 'Insert a missed throw at the selected position. Later scored darts move over one slot. A dart outside the number rings counts as MISS (0).'
            : 'Correct this dart without changing the other shots. If the camera skipped a dart before this one, choose Insert missed instead.'}</p>
          <div className="dartline-hud-edit-tabs">
            <Button variant={editKind==='replace'?'filled':'light'} disabled={!canCorrect}
              onClick={() => {setEditKind('replace'); setCorrectingIndex(Math.min(correctingIndex??0,darts.length-1));}}>
              Correct score
            </Button>
            <Button variant={editKind==='insert'?'filled':'light'} disabled={!canInsert}
              onClick={() => {setEditKind('insert'); setCorrectingIndex(Math.min(correctingIndex??0,darts.length));}}>
              Insert missed
            </Button>
          </div>
          <NativeSelect label={editKind==='insert'?'Insert position':'Which dart?'} value={String(correctingIndex ?? 0)}
            onChange={e => {
              const index=Number(e.currentTarget.value);
              if (editKind==='insert') setCorrectingIndex(index);
              else beginCorrection(index);
            }}
            data={editKind==='insert'
              ? Array.from({length:darts.length+1},(_,i)=>({value:String(i),
                label:i<darts.length ? `Before scored Dart ${i+1}` : `After last scored dart (Dart ${i+1})`}))
              : darts.map((d, i) => ({value:String(i),label:`Dart ${i+1}: ${d.score.label} (${d.score.points})`}))} />
          <NativeSelect label="Segment" value={sector}
            onChange={e => { setSector(e.currentTarget.value); if (e.currentTarget.value === 'MISS') setRing('single'); }}
            data={[...Array.from({length:20},(_,i)=>String(i+1)), 'BULL', 'MISS']} />
          {sector !== 'MISS' && (
            <NativeSelect label="Ring" value={sector==='BULL'&&ring==='triple'?'single':ring}
              onChange={e=>setRing(e.currentTarget.value as ManualRing)}
              data={sector==='BULL'
                ? [{value:'single',label:'Outer bull (25)'},{value:'double',label:'Bullseye (50)'}]
                : [{value:'single',label:'Single'},{value:'double',label:'Double'},{value:'triple',label:'Triple'}]} />
          )}
          <Button fullWidth color="teal" disabled={correctingIndex === null ||
            (editKind==='insert' ? !canInsert : !canCorrect || !darts[correctingIndex]?.id)}
            onClick={applyCorrection}>
            {editKind==='insert' ? 'Add missed dart' : `Save correction for Dart ${(correctingIndex ?? 0)+1}`}
          </Button>
        </div>
      </Modal>
    </section>
  );
}
