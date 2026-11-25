import {describe,it,expect} from 'vitest';
import {MotionRescueBudget,recentlyThrew,shouldProbeTakeout,TAKEOUT_SETTLE_MS,THROW_RESCUE_WINDOW_MS} from '../../src/client/lib/stabilityScan';
describe('DartLine motion-gated recognition',()=>{
 it('never starts background tip rescue on an idle unthrown board',()=>{
  expect(recentlyThrew(10000,0)).toBe(false);
  expect(recentlyThrew(10000,1)).toBe(false);
  expect(recentlyThrew(5000,5001)).toBe(false);
 });
 it('gives an actual throw a limited backup scan window',()=>{
  expect(recentlyThrew(1001,1000)).toBe(true);
  expect(recentlyThrew(1000+THROW_RESCUE_WINDOW_MS,1000)).toBe(true);
  expect(recentlyThrew(1001+THROW_RESCUE_WINDOW_MS,1000)).toBe(false);
 });
 it('never probes takeout before a three-dart visit is armed',()=>{
  expect(shouldProbeTakeout(2000,1000,false,'idle')).toBe(false);
  expect(shouldProbeTakeout(2000,0,true,'idle')).toBe(false);
 });
 it('requires removal motion to settle before a full empty-board scan',()=>{
  expect(shouldProbeTakeout(1000+TAKEOUT_SETTLE_MS-1,1000,true,'idle')).toBe(false);
  expect(shouldProbeTakeout(1000+TAKEOUT_SETTLE_MS,1000,true,'pendingLarge')).toBe(false);
  expect(shouldProbeTakeout(1000+TAKEOUT_SETTLE_MS,1000,true,'idle')).toBe(true);
 });
 it('stops checking after a brief confirmation window instead of continuously hallucinating',()=>{
  expect(shouldProbeTakeout(12000,1000,true,'idle')).toBe(false);
 });
});

describe('DartLine one backup scan per physical throw',()=>{
 it('prevents several fallback scans from inventing duplicate darts for one movement',()=>{
  const gate=new MotionRescueBudget();
  expect(gate.allow(1200,1000)).toBe(true);
  expect(gate.allow(1650,1000)).toBe(false);
  expect(gate.allow(1900,1000)).toBe(false);
  expect(gate.allow(2900,2800)).toBe(true);
 });
 it('does not scan a stationary board without a recent throw',()=>{
  const gate=new MotionRescueBudget();
  expect(gate.allow(2000,0)).toBe(false);
  expect(gate.allow(6000,1000)).toBe(false);
 });
});
