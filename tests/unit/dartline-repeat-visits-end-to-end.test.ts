import {describe,it,expect} from 'vitest';
import {FastBoardClear} from '../../src/client/lib/fastBoardClear';
import {VisitTipEvidence} from '../../src/client/lib/visitTipEvidence';
import {VerifiedBoardClear} from '../../src/server/scoring/verifiedBoardClear';

/** Model results and server reports are deliberately separate evidence. */
describe('realistic repeat-visit verified takeout, including a blind final frame',()=>{
  it('submits four consecutive 3-dart visits without borrowing old dart evidence',()=>{
    const evidence=new VisitTipEvidence();
    const camera=new FastBoardClear();
    const server=new VerifiedBoardClear();
    let now=1000,submitted=0;
    for(let visit=0;visit<4;visit++){
      const key='match:leg1:visit'+visit;
      evidence.updateVisit(key,true);
      expect(evidence.seenDuringThisVisit).toBe(false);
      camera.arm(false,now);
      server.reset();

      // The AI detects earlier darts, then sometimes misses ALL tips
      // on the final frame. This previously blocked auto-submit forever.
      evidence.observePositive(true,1,false);
      evidence.observePositive(true,2,false);
      evidence.observePositive(true,0,false);
      camera.arm(true,now,evidence.seenDuringThisVisit);
      expect(camera.hasSeenDarts).toBe(true);

      camera.noteRetrievalMotion();
      const first=camera.claim(now+1000,true);
      expect(first).not.toBeNull();
      const firstAction=camera.finish(first!,now+1060,'empty');
      expect(firstAction).toBe('send-empty');
      expect(server.observe(true,3,now+1060)).toBe(false);

      const second=camera.claim(now+2000,true);
      expect(second).not.toBeNull();
      const secondAction=camera.finish(second!,now+2060,'empty');
      expect(secondAction).toBe('send-empty');
      expect(server.observe(true,3,now+2060)).toBe(true);
      submitted++;
      evidence.updateVisit(key,false);
      camera.arm(false,now+2100);
      now+=5000;
    }
    expect(submitted).toBe(4);
  });

  it('never submits a fresh visit without newly observed physical tips',()=>{
    const evidence=new VisitTipEvidence();
    const camera=new FastBoardClear();
    evidence.updateVisit('match:visit1',true);
    evidence.observePositive(true,1,false);
    evidence.updateVisit('match:visit1',false);
    evidence.updateVisit('match:visit2',true);
    camera.arm(true,8000,evidence.seenDuringThisVisit);
    camera.noteRetrievalMotion();
    for(const t of [9000,10000,11000]){
      const token=camera.claim(t,true);
      expect(token).not.toBeNull();
      expect(camera.finish(token!,t+30,'empty')).toBeNull();
    }
  });

  it('recovers if the server drops the first confirmation pair',()=>{
    const evidence=new VisitTipEvidence();
    const camera=new FastBoardClear();
    const server=new VerifiedBoardClear();
    evidence.updateVisit('match:visit3',true);
    evidence.observePositive(true,3,false);
    camera.arm(true,1000,evidence.seenDuringThisVisit);
    camera.noteRetrievalMotion();
    for(const t of [2000,2900]){
      const token=camera.claim(t,true)!;
      expect(camera.finish(token,t+30,'empty')).toBe('send-empty');
      // Simulate one socket/report drop: client sends, server receives none.
    }
    for(const t of [5800,6800]){
      const token=camera.claim(t,true)!;
      expect(camera.finish(token,t+30,'empty')).toBe('send-empty');
      if(server.observe(true,3,t+30)) expect(t).toBe(6800);
    }
    expect(camera.retriesUsed).toBe(1);
  });
});
