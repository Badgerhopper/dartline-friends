import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {ScoringSession} from '../../src/server/scoring/session';
import {makeMatch} from '../helpers';
import type {MatchState} from '../../src/shared/types';
import type {BoardTip} from '../../src/shared/vision/types';

/**
 * Integration of REAL scoring session, real duplicate tracker, real x01 match
 * mutation, and real server verified-takeout engine. No mocking the scoring
 * algorithm or bypassing the server submission path.
 *
 * What this does NOT test: actual iOS camera hardware, LiteRT model latency,
 * rendered frames, WebSocket loss, or false positives from a physical board.
 */
const point=(x:number,y:number):BoardTip=>({x,y,confidence:0.98});

function game(){
  let match:MatchState=makeMatch({
    settings:{startScore:701,doubleIn:false,doubleOut:false},
  });
  const commits:MatchState[]=[];
  const session=new ScoringSession({
    getMatch:()=>match,
    ownerPlayerIds:['p1','p2'],
    scorerLabel:()=> 'iPhone scoring camera',
    scorerId:()=> 'phone-1',
    commit:(updated)=>{match=updated;commits.push(updated);},
  });
  session.setCameraActive('phone-1',true);
  session.setVerifiedTakeout(true);
  const state=()=>match;
  const darts=()=>match.currentVisit?.darts.length??0;
  const submitAfterTakeout=()=>{
    expect(darts()).toBe(3);
    session.addTips('phone-1',[]);
    expect(session.verifiedTakeoutStatus.confirmations).toBe(1);
    expect(darts()).toBe(3);
    vi.advanceTimersByTime(900);
    session.addTips('phone-1',[]);
  };
  const close=()=>session.stop();
  return {session,state,darts,commits,submitAfterTakeout,close};
}
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(20_000);});
afterEach(()=>{vi.useRealTimers();});

describe('camera reports -> server tracker -> match -> verified takeout -> next turn',()=>{
  it('scores 3 darts, rejects early auto-submit, advances and scores the next player',()=>{
    const g=game();
    try{
      const p=[point(500000,220000),point(550000,220000),point(450000,220000)];
      g.session.addTips('phone-1',[p[0]]);
      expect(g.darts()).toBe(1);
      g.session.addTips('phone-1',[p[0],p[1]]);
      expect(g.darts()).toBe(2);
      g.session.addTips('phone-1',p);
      expect(g.darts()).toBe(3);
      expect(g.state().currentPlayerIndex).toBe(0);
      expect(g.state().visits).toHaveLength(0);
      g.submitAfterTakeout();
      expect(g.state().currentPlayerIndex).toBe(1);
      expect(g.state().visits).toHaveLength(1);
      expect(g.state().visits[0].darts).toHaveLength(3);
      expect(g.darts()).toBe(0);
      // Same physical camera scores the next player's same part of the
      // board. The server must forget the previous visit's dart tracker.
      g.session.addTips('phone-1',[p[0]]);
      expect(g.darts()).toBe(1);
      g.session.addTips('phone-1',[p[0],p[1]]);
      g.session.addTips('phone-1',p);
      expect(g.darts()).toBe(3);
      g.submitAfterTakeout();
      expect(g.state().currentPlayerIndex).toBe(0);
      expect(g.state().visits).toHaveLength(2);
      expect(g.state().visits[1].darts).toHaveLength(3);
    }finally{g.close();}
  });

  it('does not duplicate a stationary dart after repeated complete AI reports',()=>{
    const g=game();
    try{
      const first=point(500000,205000),second=point(545000,220000);
      for(let n=0;n<8;n++)g.session.addTips('phone-1',[first]);
      expect(g.darts()).toBe(1);
      for(let n=0;n<8;n++)g.session.addTips('phone-1',[first,second]);
      expect(g.darts()).toBe(2);
      g.session.addTips('phone-1',[first,second,point(420000,225000)]);
      expect(g.darts()).toBe(3);
      g.submitAfterTakeout();
      expect(g.state().visits[0].darts).toHaveLength(3);
    }finally{g.close();}
  });

  it('will not auto-submit after fewer than 3 darts, even with timed empty reports',()=>{
    const g=game();
    try{
      const first=point(500000,205000),second=point(550000,230000);
      g.session.addTips('phone-1',[first,second]);
      expect(g.darts()).toBe(2);
      g.session.addTips('phone-1',[]);
      vi.advanceTimersByTime(1000);
      g.session.addTips('phone-1',[]);
      expect(g.state().currentPlayerIndex).toBe(0);
      expect(g.state().visits).toHaveLength(0);
      expect(g.darts()).toBe(2);
    }finally{g.close();}
  });

  it('two empty reports from much different times cannot complete a visit',()=>{
    const g=game();
    try{
      const p=[point(500000,220000),point(550000,220000),point(450000,220000)];
      g.session.addTips('phone-1',p);
      expect(g.darts()).toBe(3);
      g.session.addTips('phone-1',[]);
      expect(g.session.verifiedTakeoutStatus.confirmations).toBe(1);
      vi.advanceTimersByTime(5_000);
      g.session.addTips('phone-1',[]);
      expect(g.state().visits).toHaveLength(0);
      expect(g.session.verifiedTakeoutStatus.confirmations).toBe(1);
      vi.advanceTimersByTime(900);
      g.session.addTips('phone-1',[]);
      expect(g.state().visits).toHaveLength(1);
    }finally{g.close();}
  });
});
