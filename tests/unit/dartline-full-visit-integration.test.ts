import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {ScoringSession} from '../../src/server/scoring/session';
import {makeMatch} from '../helpers';
import type {MatchState} from '../../src/shared/types';
import type {BoardTip} from '../../src/shared/vision/types';
import {TemporalDartTracker,type TemporalFrame} from '../../src/client/lib/temporalDartEvidence';
import {scorePhysicalDart} from '../../src/client/lib/physicalBoardImpact';
import {VisualBoardReturn} from '../../src/client/lib/visualBoardReturn';
import {PhotoTakeoutConfirm} from '../../src/client/lib/photoTakeoutConfirm';

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

  it('rejects delayed ordinary AI reports after the current count changes',()=>{
    const g=game();
    try{
      const m=g.state(),key=[m.id,m.legs.length,m.visits.length,m.currentPlayerIndex].join(':');
      const a=point(500000,220000),b=point(610000,220000),c=point(430000,220000);
      expect(g.session.addGuardedTips('phone-1',[a],key,0)).toBe(true);
      expect(g.darts()).toBe(1);
      expect(g.session.addGuardedTips('phone-1',[b],key,0)).toBe(false);
      expect(g.darts()).toBe(1);
      expect(g.session.addGuardedTips('phone-1',[a,b],key,1)).toBe(true);
      expect(g.darts()).toBe(2);
      expect(g.session.addGuardedTips('phone-1',[a,b,c],key,2)).toBe(true);
      expect(g.darts()).toBe(3);
      g.submitAfterTakeout();
      expect(g.darts()).toBe(0);
      expect(g.session.addGuardedTips('phone-1',[a],key,0)).toBe(false);
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

  it('accepts one occluded estimate for the exact live visit and does not duplicate a later model sighting',()=>{
    const g=game();
    try{
      const first=point(500000,220000),second=point(506000,220000);
      g.session.addTips('phone-1',[first]);
      const m=g.state();
      const key=[m.id,m.legs.length,m.visits.length,m.currentPlayerIndex].join(':');
      expect(g.session.addEstimatedTip('wrong-camera',second,key,1)).toBe(false);
      expect(g.session.addEstimatedTip('phone-1',second,'stale',1)).toBe(false);
      expect(g.session.addEstimatedTip('phone-1',second,key,1)).toBe(true);
      expect(g.darts()).toBe(2);
      expect(g.state().currentVisit!.darts[1].detection?.estimated).toBe(true);
      expect(g.session.addEstimatedTip('phone-1',second,key,1)).toBe(false);
      g.session.addTips('phone-1',[first,second]);
      expect(g.darts()).toBe(2);
      g.session.addTips('phone-1',[first,second,point(420000,225000)]);
      expect(g.darts()).toBe(3);
      g.submitAfterTakeout();
      expect(g.state().visits).toHaveLength(1);
      expect(g.session.addEstimatedTip('phone-1',second,key,2)).toBe(false);
    }finally{g.close();}
  });
  it('rejects the estimate if normal AI has already scored that throw',()=>{
    const g=game();
    try{
      const first=point(500000,220000),second=point(550000,220000);
      g.session.addTips('phone-1',[first]);
      const m=g.state(),key=[m.id,m.legs.length,m.visits.length,m.currentPlayerIndex].join(':');
      g.session.addTips('phone-1',[first,second]);
      expect(g.session.addEstimatedTip('phone-1',second,key,1)).toBe(false);
      expect(g.darts()).toBe(2);
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

  it('keeps auto-submit available through twelve consecutive player turns and a camera reconnect',()=>{
    const g=game();
    try{
      const p=[point(500000,220000),point(550000,220000),
        point(450000,220000)];
      for(let turn=0;turn<12;turn++){
        if(turn===6){
          g.session.setCameraActive('phone-1',false);
          g.session.setCameraActive('phone-1',true);
          g.session.setVerifiedTakeout(true);
        }
        const expectedOwner=turn%2;
        expect(g.state().currentPlayerIndex).toBe(expectedOwner);
        g.session.addTips('phone-1',[p[0]]);
        expect(g.darts()).toBe(1);
        g.session.addTips('phone-1',[p[0],p[1]]);
        expect(g.darts()).toBe(2);
        g.session.addTips('phone-1',p);
        expect(g.darts()).toBe(3);
        if(turn===4){
          // The camera temporarily falsely thinks the board is empty,
          // but then sees the same 3 darts still physically in place.
          // This MUST NOT submit from a combination of old and new votes.
          g.session.addTips('phone-1',[]);
          expect(g.session.verifiedTakeoutStatus.confirmations).toBe(1);
          g.session.addTips('phone-1',p);
          expect(g.session.verifiedTakeoutStatus.confirmations).toBe(0);
        }
        g.submitAfterTakeout();
        expect(g.state().visits).toHaveLength(turn+1);
        expect(g.state().visits.at(-1)!.darts).toHaveLength(3);
        expect(g.darts()).toBe(0);
        expect(g.state().currentPlayerIndex).toBe((turn+1)%2);
      }
      expect(g.commits.length).toBeGreaterThanOrEqual(48);
    }finally{g.close();}
  });

  it('replays ten noisy three-dart visits through physical fallback, authoritative scoring and photo submission',()=>{
    const g=game();
    const size=256;
    const frame=():TemporalFrame=>{
      const data=new Uint8Array(size*size*4);
      for(let y=0;y<size;y++)for(let x=0;x<size;x++){
        const k=(y*size+x)*4;
        // Textured radial board with alternating sectors, not a blank image.
        const r=Math.hypot(x-128,y-128),angle=Math.atan2(x-128,128-y);
        const v=r>124?50:((Math.floor(angle*10/Math.PI)&1)?150:85)+(Math.floor(r)%11);
        data[k]=v;data[k+1]=v;data[k+2]=v;data[k+3]=255;
      }
      return {width:size,height:size,data};
    };
    const copy=(f:TemporalFrame):TemporalFrame=>({...f,data:f.data.slice()});
    const shaft=(f:TemporalFrame,x:number,y:number)=>{
      const out=copy(f);
      for(let xx=x;xx<x+40;xx++){
        const width=xx>x+29?4:1;
        for(let yy=y-width;yy<=y+width;yy++){
          const k=(yy*size+xx)*4;out.data[k]=240;out.data[k+1]=35;out.data[k+2]=210;
        }
      }
      return out;
    };
    const noisy=(f:TemporalFrame,i:number)=>{
      const out=copy(f);
      for(let y=8;y<248;y+=16)for(let x=8;x<248;x+=16){
        const k=(y*size+x+i%3)*4;out.data[k]=220;
      }
      return out;
    };
    const visual=new VisualBoardReturn(),photo=new PhotoTakeoutConfirm();
    const empty=frame(),project=(x:number,y:number)=>[x*1000000,(1-y)*1000000];
    let now=Date.now(),frameId=0;
    const step=(ms=200)=>{now+=ms;vi.setSystemTime(now);return now;};
    try{
      for(let turn=0;turn<10;turn++){
        const tracker=new TemporalDartTracker();
        const m=g.state(),key=[m.id,m.legs.length,m.visits.length,m.currentPlayerIndex].join(':');
        visual.startNextVisit();photo.reset();
        let image=empty;
        visual.observe(noisy(image,0),0,step(),true);
        visual.observeLocatedEmpty(noisy(image,0),true,now);
        visual.observe(noisy(image,1),0,step(350),true);
        expect(visual.observeLocatedEmpty(noisy(image,1),true,now)).toBe(true);
        tracker.prime(visual.emptyReference!);
        // Separate visible, clustered and just-outside-double-ring hits.
        for(const [index,x,y] of [[0,100,80],[1,105,86],[2,126,30]]){
          image=shaft(image,x,y);
          let estimate=null;
          for(let n=0;n<4;n++){
            const shot=noisy(image,n);
            const guess=tracker.observe(shot,step(),undefined,index,empty);
            visual.observe(shot,index,now,true);
            if(guess){estimate=scorePhysicalDart(guess,project);if(estimate)break;}
          }
          expect(estimate,'turn '+turn+' dart '+index).not.toBeNull();
          expect(g.session.addEstimatedTip('phone-1',{x:estimate!.x,y:estimate!.y,confidence:.85},key,index)).toBe(true);
          expect(g.darts()).toBe(index+1);
          visual.observe(image,index+1,step(),true);
          tracker.observe(image,now,undefined,index+1,empty);
        }
        expect(g.state().currentVisit!.darts[2].score.label).toBe('miss');
        visual.observe(noisy(empty,0),3,step(),true);
        let sent=0;
        for(let n=0;n<14 && g.darts()===3;n++){
          const shot=noisy(empty,n);
          visual.observe(shot,3,step(),true);
          const clear=visual.matchesCurrentEmpty(shot,3);
          if(clear&&photo.claim(key,now,true,true,++frameId)){
            g.session.addTips('phone-1',[]);sent++;
          }
        }
        expect(sent).toBe(2);
        expect(g.state().visits.length).toBe(turn+1);
        expect(g.darts()).toBe(0);
      }
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
