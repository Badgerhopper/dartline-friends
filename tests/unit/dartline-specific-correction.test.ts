import { describe, expect, it, afterEach } from 'vitest';
import type { WebSocket } from 'ws';
import { makeDart, makeMatch } from '../helpers';
import { addDartToMatch, correctDartInMatch, viewOf } from '../../src/server/match';
import { correctedDart } from '../../src/client/lib/manualCorrection';
import { handleMessage, handleClientLeave, registerClient, removeClient } from '../../src/server/wsHandler';
import { releaseRateLimit } from '../../src/server/rateLimit';
import { deleteLobby, deleteMatch, getAllLobbies, getAllMatches } from '../../src/server/store';
import type { ServerMessage } from '../../src/shared/protocol';

function add(match:ReturnType<typeof makeMatch>, label:string) {
  const result=addDartToMatch(match, 'p1', makeDart(label));
  if (!result.success) throw new Error(result.error);
  return result.match;
}

describe('DartLine atomic specific-dart correction',()=>{
  it('corrects Dart 1 while keeping Darts 2 and 3, their identities and the visit total',()=>{
    let match=makeMatch();
    match=add(add(add(match,'S20'),'T20'),'S5');
    const darts=match.currentVisit!.darts;
    const result=correctDartInMatch(match,0,darts[0].id!,makeDart('T20'));
    expect(result.success).toBe(true);
    if (!result.success) return;
    const corrected=result.match.currentVisit!.darts;
    expect(corrected.map(d=>d.score.label)).toEqual(['T20','T20','S5']);
    expect(corrected.map(d=>d.id)).toEqual(darts.map(d=>d.id));
    expect(viewOf(result.match).visitTotal).toBe('125');
    expect(match.currentVisit!.darts[0].score.label).toBe('S20');
  });
  it('recalculates the bust/locked state after correcting an earlier throw',()=>{
    let match=makeMatch({settings:{startScore:80,doubleOut:true}});
    match=add(add(match,'S20'),'T20');
    expect(match.currentVisit!.locked).toBe(true);
    const prev=match.currentVisit!.darts[0];
    const fixed=correctDartInMatch(match,0,prev.id!,makeDart('S5'));
    expect(fixed.success).toBe(true);
    if(!fixed.success) return;
    expect(fixed.match.currentVisit!.locked).toBe(false);
    expect(viewOf(fixed.match).playerScores.p1).toBe('15');
  });
  it('refuses stale ids and invalid/out-of-range target indexes',()=>{
    let match=add(makeMatch(),'S20');
    const stale=correctDartInMatch(match,0,'wrong-id',makeDart('T20'));
    expect(stale.success).toBe(false);
    expect(correctDartInMatch(match,1,match.currentVisit!.darts[0].id!,makeDart('T20')).success).toBe(false);
    expect(correctDartInMatch(match,-1,match.currentVisit!.darts[0].id!,makeDart('T20')).success).toBe(false);
    expect(correctDartInMatch(match,NaN,match.currentVisit!.darts[0].id!,makeDart('T20')).success).toBe(false);
    expect(match.currentVisit!.darts[0].score.label).toBe('S20');
  });
  it('cannot edit an already finished match',()=>{
    const match=add(makeMatch(),'S20');
    const result=correctDartInMatch({...match,status:'finished'},0,match.currentVisit!.darts[0].id!,makeDart('T20'));
    expect(result.success).toBe(false);
  });
  it('supports manual miss corrections with zero points',()=>{
    expect(correctedDart('MISS','single').score).toMatchObject({label:'miss',points:0});
    expect(()=>correctedDart('MISS','triple')).toThrow();
  });
});

let seq=0;const openSockets:WebSocket[]=[];
function connect(){
  const sessionId=`correction-${++seq}`;
  const received:ServerMessage[]=[];
  const ws={readyState:1,OPEN:1,send:(raw:string)=>received.push(JSON.parse(raw))} as unknown as WebSocket;
  registerClient(ws,{sessionId,lobbyId:null,matchId:null,isSpectator:false,deviceId:null});
  openSockets.push(ws);
  return {
    ws, received,
    send(m:object){releaseRateLimit(sessionId,null);handleMessage(ws,JSON.stringify(m));},
    state(){return received.filter(x=>x.type==='match_state').at(-1) as Extract<ServerMessage,{type:'match_state'}>},
    error(){return received.filter(x=>x.type==='error').at(-1) as Extract<ServerMessage,{type:'error'}>|undefined},
  };
}
afterEach(()=>{
  for (const ws of openSockets.splice(0)) {handleClientLeave(ws);removeClient(ws);}
  for (const m of getAllMatches()) deleteMatch(m.id);
  for (const l of getAllLobbies()) deleteLobby(l.id);
});

describe('DartLine correction socket security and actual game state',()=>{
  it('corrects only a live selected dart via the normal authenticated client connection',()=>{
    const p=connect();
    p.send({type:'create_lobby',acceptsJoins:false});
    p.send({type:'add_local_player',playerName:'Shooter'});
    p.send({type:'start_match'});
    p.send({type:'add_dart',dart:correctedDart('20','single')});
    p.send({type:'add_dart',dart:correctedDart('5','single')});
    const old=p.state().match.currentVisit!.darts;
    const second=old[1].id!;
    p.send({type:'correct_dart',index:0,expectedDartId:old[0].id,dart:correctedDart('20','triple')});
    const edited=p.state().match.currentVisit!.darts;
    expect(edited.map(d=>d.score.label)).toEqual(['T20','S5']);
    expect(edited[1].id).toBe(second);
    p.send({type:'correct_dart',index:0,expectedDartId:'stale',dart:correctedDart('1','single')});
    expect(p.error()?.message).toContain('Dart changed');
    expect(p.state().match.currentVisit!.darts[0].score.label).toBe('T20');
    p.send({type:'correct_dart',index:0,expectedDartId:old[0].id,dart:{x:Infinity,y:0}});
    expect(p.error()?.message).toBe('Invalid dart correction');
  });
});
