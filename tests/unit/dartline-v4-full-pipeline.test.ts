import { describe, expect, it } from 'vitest';
import { IdleTipRecovery } from '../../src/client/lib/idleTipRecovery';
import { DartTracker } from '../../src/server/scoring/tracker';
import { VerifiedBoardClear } from '../../src/server/scoring/verifiedBoardClear';
import type { BoardTip } from '../../src/shared/vision/types';

const dart=(x:number,y=500000,confidence=.91):BoardTip=>({x,y,confidence});
function createScoringHarness(){
  const gate = new IdleTipRecovery();
  const tracker = new DartTracker();
  const clear = new VerifiedBoardClear();
  const scores:string[]=[];
  return {
    gate, tracker, clear, scores,
    candidateFrame(tips:BoardTip[],when:number){
      const confirmed=gate.observe(tips,when);
      // Unpublished candidate frames can NEVER send an empty report to
      // VerifiedBoardClear. Only genuinely confirmed new tips are forwarded.
      if (confirmed.length) {
        for(const scored of tracker.ingest([{deviceId:'phone',tips:confirmed}]))
          scores.push(scored.score.label);
      }
      return confirmed;
    },
  };
}
describe('DartLine v4 full camera-to-server scoring contract',()=>{
  it('scores 3 physical darts in three silent frames with ZERO motion triggers',()=>{
    const h=createScoringHarness();
    expect(h.candidateFrame([dart(520000)],1000)).toHaveLength(0);
    expect(h.candidateFrame([dart(520300),dart(640000)],3200)).toHaveLength(1);
    expect(h.candidateFrame([dart(520500),dart(640200),dart(700000)],5400)).toHaveLength(1);
    expect(h.candidateFrame([dart(520600),dart(640500),dart(700400)],7600)).toHaveLength(1);
    expect(h.scores).toHaveLength(3);
    expect(h.tracker.count).toBe(3);
  });
  it('an idle-board false positive in one camera frame never reaches scoring',()=>{
    const h=createScoringHarness();
    h.candidateFrame([dart(600000)],1000);
    h.candidateFrame([],3200);
    h.candidateFrame([],5400);
    expect(h.scores).toEqual([]);
  });
  it('one stationary dart is never counted twice despite new candidate runs',()=>{
    const h=createScoringHarness();
    h.candidateFrame([dart(540000)],1000);
    h.candidateFrame([dart(542000)],3200);
    h.candidateFrame([dart(545000)],5400);
    h.candidateFrame([dart(548000)],7600);
    expect(h.scores).toHaveLength(1);
    expect(h.tracker.count).toBe(1);
  });
  it('two physically distinct close darts stay available after first is recorded',()=>{
    const h=createScoringHarness();
    h.candidateFrame([dart(540000)],1000);
    h.candidateFrame([dart(540200)],3200);
    h.candidateFrame([dart(540400),dart(550000)],5400);
    h.candidateFrame([dart(540300),dart(550500)],7600);
    expect(h.scores).toHaveLength(2);
  });
  it('candidate-only empty inference never advances takeout or a remote turn',()=>{
    const h=createScoringHarness();
    h.candidateFrame([dart(540000)],1000);
    h.candidateFrame([dart(540300)],3200);
    h.candidateFrame([],5400);
    h.candidateFrame([],7600);
    // No calls to clear.observe occur from candidate-only inference.
    // The server receives them ONLY through the separate movement-scoped
    // verified takeout pipeline.
    expect(h.scores).toHaveLength(1);
    expect(h.clear.observe(true,3,10000)).toBe(false);
    expect(h.clear.observe(true,3,10800)).toBe(true);
  });
  it('resets confirmation for new match visits',()=>{
    const h=createScoringHarness();
    h.candidateFrame([dart(540000)],1000);
    h.gate.reset();
    expect(h.candidateFrame([dart(540100)],3200)).toHaveLength(0);
    expect(h.candidateFrame([dart(540200)],5400)).toHaveLength(1);
  });
});
