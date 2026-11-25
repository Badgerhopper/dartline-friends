import { describe, it, expect, vi, afterEach } from 'vitest';
import { makeMatch, makeDart } from '../helpers';
import { addDartToMatch, insertDartIntoMatch, viewOf } from '../../src/server/match';
import { ScoringSession } from '../../src/server/scoring/session';
import { correctedDart } from '../../src/client/lib/manualCorrection';
import type { MatchState } from '../../src/shared/types';

function withDarts(...labels:string[]) {
  let match=makeMatch();
  for(const label of labels) {
    const x=addDartToMatch(match,'p1',makeDart(label));
    if(!x.success) throw new Error(x.error);
    match=x.match;
  }
  return match;
}
describe('DartLine insertion of undetected throws',()=>{
  it('inserts a missing first dart without changing the existing detected shots',()=>{
    const original=withDarts('T20','S5');
    const old=original.currentVisit!.darts;
    const changed=insertDartIntoMatch(original,'p1',0,old.map(x=>x.id!),correctedDart('MISS','single'));
    expect(changed.success).toBe(true);
    if(!changed.success) return;
    expect(changed.match.currentVisit!.darts.map(x=>x.score.label)).toEqual(['miss','T20','S5']);
    expect(changed.match.currentVisit!.darts.slice(1).map(x=>x.id)).toEqual(old.map(x=>x.id));
    expect(viewOf(changed.match).visitTotal).toBe('65');
  });
  it('inserts a missed second dart before a camera-detected third',()=>{
    const original=withDarts('T20','S20');
    const old=original.currentVisit!.darts;
    const changed=insertDartIntoMatch(original,'p1',1,old.map(x=>x.id!),makeDart('T5'));
    expect(changed.success).toBe(true);
    if(!changed.success) return;
    expect(changed.match.currentVisit!.darts.map(x=>x.score.label)).toEqual(['T20','T5','S20']);
    expect(changed.match.currentVisit!.darts[2].id).toBe(old[1].id);
    expect(viewOf(changed.match).visitTotal).toBe('95');
  });
  it('supports manually entering Dart 1 when nothing was detected',()=>{
    const m=makeMatch();
    const changed=insertDartIntoMatch(m,'p1',0,[],makeDart('S7'));
    expect(changed.success).toBe(true);
    if(!changed.success) return;
    expect(changed.match.currentVisit?.darts[0].score.label).toBe('S7');
  });
  it('rejects stale ID lists and late arrivals',()=>{
    const m=withDarts('T20','S5');
    const ids=m.currentVisit!.darts.map(d=>d.id!);
    expect(insertDartIntoMatch(m,'p1',1,[ids[0],'stale'],makeDart('S9')).success).toBe(false);
    expect(insertDartIntoMatch(m,'p1',1,[],makeDart('S9')).success).toBe(false);
    expect(insertDartIntoMatch(m,'p1',3,ids,makeDart('S9')).success).toBe(false);
    expect(insertDartIntoMatch(m,'p2',1,ids,makeDart('S9')).success).toBe(false);
  });
  it('never creates a fourth dart or modifies a finished match',()=>{
    const m=withDarts('S20','S5','S1');
    expect(insertDartIntoMatch(m,'p1',2,m.currentVisit!.darts.map(d=>d.id!),makeDart('S4')).success).toBe(false);
    expect(insertDartIntoMatch({...m,status:'finished'},'p1',2,[],makeDart('S4')).success).toBe(false);
  });
});
afterEach(()=>vi.useRealTimers());
function session(match:MatchState) {
  let state=match, commits=0;
  const scoring=new ScoringSession({
    getMatch:()=>state, ownerPlayerIds:['p1'],
    commit:(next)=>{state=next;commits++;},
    scorerLabel:()=> 'camera',scorerId:()=> 'camera-id',
  });
  scoring.setCameras(['camera']);
  return {scoring, read:()=>state, commits:()=>commits};
}
describe('DartLine opt-in verified takeout end-to-end through scoring session',()=>{
  it('disabled option does not submit a three-dart visit even with repeated clear frames',()=>{
    vi.useFakeTimers();vi.setSystemTime(1000);
    const {scoring,read}=session(withDarts('T20','S20','S5'));
    scoring.setVerifiedTakeout(false);
    scoring.addTips('camera',[]);
    vi.setSystemTime(2000);
    scoring.addTips('camera',[]);
    expect(read().visits).toHaveLength(0);
    scoring.stop();
  });
  it('enabled option submits only after a second verified empty scan at least 750ms later',()=>{
    vi.useFakeTimers();vi.setSystemTime(1000);
    const {scoring,read,commits}=session(withDarts('T20','S20','S5'));
    scoring.setVerifiedTakeout(true);
    scoring.addTips('camera',[]);
    expect(read().visits).toHaveLength(0);
    vi.setSystemTime(1500);
    scoring.addTips('camera',[]);
    expect(read().visits).toHaveLength(0);
    vi.setSystemTime(2000);
    scoring.addTips('camera',[]);
    expect(read().visits).toHaveLength(1);
    expect(commits()).toBe(1);
    scoring.stop();
  });
  it('never submits an undetected third dart as a zero merely because the board clears',()=>{
    vi.useFakeTimers();vi.setSystemTime(1000);
    const {scoring,read}=session(withDarts('T20','S5'));
    scoring.setVerifiedTakeout(true);
    scoring.addTips('camera',[]);
    vi.setSystemTime(2200);
    scoring.addTips('camera',[]);
    expect(read().visits).toHaveLength(0);
    scoring.stop();
  });
});
