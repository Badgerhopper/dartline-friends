import { useState } from 'react';
import { Button } from '@mantine/core';
import type { MatchState, ModePanel, ModeView, Player } from '../../shared/types';
import { textOf } from '../../shared/types';
import type { VideoFeedId } from '../../shared/media';
import type { VideoFeedView } from '../hooks/useVideoFeed';
import { VirtualBoard, type LiveBoardView } from './VirtualBoard';
import { ModePanelBlock } from './ModePanelBlock';

type Props = {
  match: MatchState;
  view: ModeView;
  panel?: ModePanel;
  opponent: Player;
  ownPlayerIds: readonly string[];
  liveBoard: LiveBoardView | null;
  straightenVideo: boolean;
  videoOffers: readonly VideoFeedView[];
  onAcceptVideo: (id: VideoFeedId) => void;
  onDeclineVideo: (id: VideoFeedId) => void;
  onLeave: () => void;
};

/** Read-only remote viewing mode. The server's turn change switches the parent
 * back to its interactive scorer when the local player's turn begins.
 * Scores and the virtual board work even if peer-to-peer video never connects. */
export function OpponentTurnView({
  match, view, panel, opponent, ownPlayerIds, liveBoard, straightenVideo,
  videoOffers, onAcceptVideo, onDeclineVideo, onLeave,
}: Props) {
  const [details, setDetails] = useState(false);
  const opponentBoardId = opponent.boardId ?? opponent.id;
  const offer = videoOffers.find(f => f.playerId === opponentBoardId &&
    f.choice === 'accepted' && f.status === 'live')
    ?? videoOffers.find(f => f.playerId === opponentBoardId);
  const playingVideo = Boolean(offer?.choice === 'accepted' && offer.status === 'live' && liveBoard);
  const canChooseVideo = Boolean(offer?.decoderSupported);
  const ownPlayers = match.players.filter(p => ownPlayerIds.includes(p.id));
  const opponentDarts = match.currentVisit?.playerId === opponent.id
    ? match.currentVisit.darts : [];
  const displayedSlots = view.slots ?? opponentDarts.map(d => d.score.label);
  const currentTotal = textOf(view.visitTotal);
  const summaryRows = panel?.rows.filter(r => r.values[opponent.id] !== undefined).slice(0, 3) ?? [];
  const videoMessage = playingVideo ? 'Live camera connected'
    : !offer ? 'Your friend has not shared a live board. Scores and darts still update.'
    : !offer.decoderSupported ? 'Live video is unsupported here. Scoring still works.'
    : offer.choice === 'pending' ? 'Accept the video invitation to see their camera.'
    : offer.choice === 'declined' ? 'Video off. The virtual dartboard still shows each throw.'
    : offer.status === 'unavailable' ? 'Direct video connection unavailable. Scores still synchronize.'
    : offer.status === 'stalled' ? 'Camera feed interrupted. Scores still synchronize.'
    : 'Connecting to your friend’s board camera…';

  return (
    <section className="dartline-remote-turn" aria-label="Watching remote opponent">
      <div className="dartline-remote-top">
        <div>
          <span className="dartline-remote-eyebrow">DARTLINE v2.5 · REMOTE MATCH</span>
          <strong>{opponent.name} is throwing</strong>
        </div>
        <button type="button" onClick={onLeave}>Leave</button>
      </div>

      <div className="dartline-remote-scores" aria-live="polite">
        <div className="dartline-remote-score is-mine">
          <small>YOUR SCORE</small>
          {ownPlayers.map(p => (
            <div className="dartline-remote-score-line" key={p.id}>
              {ownPlayers.length > 1 && <span>{p.name}</span>}
              <strong>{textOf(view.playerScores[p.id] ?? '—')}</strong>
            </div>
          ))}
        </div>
        <div className="dartline-remote-score is-opponent">
          <small>{opponent.name.toUpperCase()} · REMAINING</small>
          <strong>{textOf(view.playerScores[opponent.id] ?? '—')}</strong>
        </div>
      </div>

      <div className="dartline-remote-main">
        <div className="dartline-remote-camera-bar">
          <strong>{playingVideo ? '● LIVE BOARD' : '🎯 OPPONENT BOARD'}</strong>
          {offer && canChooseVideo && (
            <Button size="compact-xs" color="teal"
              variant={offer.choice === 'accepted' ? 'subtle' : 'filled'}
              onClick={() => offer.choice === 'accepted'
                ? onDeclineVideo(offer.feedId) : onAcceptVideo(offer.feedId)}>
              {offer.choice === 'accepted' ? 'Stop video' : 'Watch video'}
            </Button>
          )}
        </div>
        <div className="dartline-remote-board">
          <VirtualBoard darts={opponentDarts} dartsPerVisit={Math.max(3,view.dartsPerVisit)}
            onAddDart={() => {}} disabled={true}
            liveBoard={playingVideo ? liveBoard : null}
            straightenVideo={straightenVideo}
            videoOffers={[]} />
        </div>
        <p className={'dartline-remote-feed-state'+(playingVideo?' is-live':'')} role="status">
          {videoMessage}
        </p>

        <div className="dartline-remote-visit">
          <div className="dartline-remote-visit-title">
            <span>{opponent.name}’s current throw</span>
            <strong>{currentTotal || '0'} points</strong>
          </div>
          <div className="dartline-remote-darts">
            {Array.from({length:Math.max(1,view.dartsPerVisit)},(_,i)=>(
              <div key={i}>
                <small>DART {i+1}</small>
                <strong>{opponentDarts[i] ? textOf(displayedSlots[i]) || opponentDarts[i].score.label : '—'}</strong>
              </div>
            ))}
          </div>
        </div>

        {summaryRows.length > 0 && (
          <div className="dartline-remote-stat-row">
            {summaryRows.map(row => (
              <div key={row.label}>
                <small>{row.label}</small>
                <strong>{textOf(row.values[opponent.id])}</strong>
              </div>
            ))}
          </div>
        )}
        {panel && <button className="dartline-remote-more" type="button"
          onClick={()=>setDetails(v=>!v)} aria-expanded={details}>
          {details ? 'Hide match statistics' : 'View full match statistics'}
        </button>}
        {details && panel && (
          <div className="dartline-remote-detail">
            <ModePanelBlock modeId={match.settings.mode} panel={panel}/>
          </div>
        )}
      </div>

      <div className="dartline-remote-bottom">
        <span>Waiting for {opponent.name} to submit their turn</span>
        <small>Your scoring screen returns automatically when it’s your turn.</small>
      </div>
    </section>
  );
}
