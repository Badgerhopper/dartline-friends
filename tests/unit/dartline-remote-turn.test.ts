import { describe, it, expect } from 'vitest';
import { remoteTurnOpponent } from '../../src/client/lib/remoteTurn';
import type { MatchState } from '../../src/shared/types';
import { makeMatch } from '../helpers';

const roster=(boardA='home',boardB='away'):MatchState=>{
  const m=makeMatch();
  return {...m,players:[
    {...m.players[0],boardId:boardA,sessionId:undefined},
    {...m.players[1],boardId:boardB,sessionId:undefined},
  ]};
};
describe('DartLine automatic remote opponent view',()=>{
  it('shows normal scoring screen on my turn',()=>{
    expect(remoteTurnOpponent(roster(),['p1'],false)).toBeNull();
  });
  it('automatically shows the remote board once my visit is submitted',()=>{
    const m={...roster(),currentPlayerIndex:1};
    expect(remoteTurnOpponent(m,['p1'],false)?.id).toBe('p2');
  });
  it('switches back to my scoring screen on the next turn',()=>{
    const m={...roster(),currentPlayerIndex:0};
    expect(remoteTurnOpponent(m,['p1'],false)).toBeNull();
  });
  it('never switches for two local players at the same board',()=>{
    const m={...roster('same-board','same-board'),currentPlayerIndex:1};
    expect(remoteTurnOpponent(m,['p1'],false)).toBeNull();
  });
  it('never switches when one browser owns both players',()=>{
    const m={...roster(),currentPlayerIndex:1};
    expect(remoteTurnOpponent(m,['p1','p2'],false)).toBeNull();
  });
  it('never takes over a spectator, finished match, or pre-seat screen',()=>{
    const m={...roster(),currentPlayerIndex:1};
    expect(remoteTurnOpponent(m,['p1'],true)).toBeNull();
    expect(remoteTurnOpponent({...m,status:'finished'},['p1'],false)).toBeNull();
    expect(remoteTurnOpponent(m,[],false)).toBeNull();
  });
  it('uses server-side session identity as a safe fallback for shared local boards',()=>{
    const m=makeMatch();
    m.players=[{...m.players[0],sessionId:'same',boardId:undefined},{...m.players[1],sessionId:'same',boardId:undefined}];
    m.currentPlayerIndex=1;
    expect(remoteTurnOpponent(m,['p1'],false)).toBeNull();
  });
  it('treats multiple owned boards and another board independently',()=>{
    const m=roster();
    m.players=[...m.players,{id:'p3',name:'Third',boardId:'other'}];
    m.currentPlayerIndex=2;
    expect(remoteTurnOpponent(m,['p1','p2'],false)?.id).toBe('p3');
  });
});
