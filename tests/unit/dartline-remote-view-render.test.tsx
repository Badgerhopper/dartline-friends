import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MantineProvider } from '@mantine/core';
import { MobileMatchHUD } from '../../src/client/components/MobileMatchHUD';
import { viewOf } from '../../src/server/match';
import { makeMatch } from '../helpers';

function screen(currentPlayerIndex: number, sameBoard = false) {
  const match = makeMatch({ currentPlayerIndex });
  match.players = match.players.map((p,i)=>({
    ...p, boardId:sameBoard?'one-board':(i===0?'local-board':'remote-board'),
    sessionId:undefined,
  }));
  const html=renderToStaticMarkup(
    <MantineProvider>
    <MobileMatchHUD
      match={match}
      view={viewOf(match)}
      ownPlayerIds={['p1']}
      isMyTurn={currentPlayerIndex===0}
      isSpectator={false}
      canAddDart={currentPlayerIndex===0}
      onLeave={()=>{}}
      onAddDart={()=>{}}
      onUndoDart={()=>{}}
      onCorrectDart={()=>{}}
      onInsertDart={()=>{}}
      onAutoTakeoutChange={()=>{}}
      onSubmitVisit={()=>{}}
      liveBoard={null}
      straightenVideo={false}
      videoOffers={[]}
      onAcceptVideo={()=>{}}
      onDeclineVideo={()=>{}}
    />
    </MantineProvider>
  );
  return html;
}

describe('DartLine v2.5 opponent screen rendering',()=>{
  it('renders own remote turn with interactive scoring and no watch-only message',()=>{
    const html=screen(0);
    expect(html).toContain('DartLine mobile scoreboard');
    expect(html).toContain('Submit');
    expect(html).not.toContain('Waiting for Bob to submit their turn');
  });
  it('renders opponent video area, live scores and virtual-board fallback on remote turn',()=>{
    const html=screen(1);
    expect(html).toContain('Watching remote opponent');
    expect(html).toContain('Bob is throwing');
    expect(html).toContain('YOUR SCORE');
    expect(html).toContain('501');
    expect(html).toContain('Your friend has not shared a live board');
    expect(html).toContain('Waiting for Bob to submit their turn');
    expect(html).toContain('data-testid="dartboard"');
    expect(html).not.toContain('Submit ↗');
  });
  it('does not switch to remote view when both players share a local dartboard',()=>{
    const html=screen(1,true);
    expect(html).toContain('DartLine mobile scoreboard');
    expect(html).not.toContain('Watching remote opponent');
  });
});
