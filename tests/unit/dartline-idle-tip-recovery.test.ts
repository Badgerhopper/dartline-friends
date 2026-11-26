import { describe, expect, it } from 'vitest';
import { IdleTipRecovery, IDLE_RECOVERY_INTERVAL_MS } from '../../src/client/lib/idleTipRecovery';
import type { BoardTip } from '../../src/shared/vision/types';
const tip=(x:number,y=500000,confidence=.92):BoardTip=>({x,y,confidence});

describe('DartLine fallback for throws with NO motion trigger',()=>{
  it('recovers three separately visible high-confidence tips without any motion event',()=>{
    const gate=new IdleTipRecovery();
    expect(gate.observe([tip(510000)],1000)).toEqual([]);
    expect(gate.observe([tip(510900),tip(600000),tip(720000)],3200)).toHaveLength(1);
    const recovered=gate.observe([tip(510400),tip(601000),tip(721500)],5400);
    expect(recovered).toHaveLength(2);
    expect(recovered.map(x=>x.x).sort()).toEqual([600500,720750]);
  });
  it('does not auto-score a phantom that appears in only one frame',()=>{
    const gate=new IdleTipRecovery();
    expect(gate.observe([tip(550000)],1000)).toEqual([]);
    expect(gate.observe([],3200)).toEqual([]);
    expect(gate.observe([tip(550500)],5400)).toEqual([]);
  });
  it('requires THREE sightings for weak tips and does not loosen original strict scoring',()=>{
    const gate=new IdleTipRecovery();
    expect(gate.observe([tip(560000,500000,.62)],1000)).toEqual([]);
    expect(gate.observe([tip(561000,500000,.64)],3200)).toEqual([]);
    const found=gate.observe([tip(560300,500000,.60)],5400);
    expect(found).toHaveLength(1);
    expect(found[0].x).toBe(560300);
  });
  it('never publishes a stable already-confirmed candidate again while in view',()=>{
    const gate=new IdleTipRecovery();
    gate.observe([tip(560000)],1000);
    expect(gate.observe([tip(561000)],3200)).toHaveLength(1);
    for(let t=5400;t<=14200;t+=2200) {
      expect(gate.observe([tip(560500)],t)).toEqual([]);
    }
  });
  it('allows a genuine second dart close to a first dart when both are visible',()=>{
    const gate=new IdleTipRecovery();
    gate.observe([tip(560000)],1000);
    const first=gate.observe([tip(560300)],3200);
    expect(first).toHaveLength(1);
    // Two tips occupy the same small neighborhood but remain two model
    // observations and hence two independently trackable candidates.
    expect(gate.observe([tip(560500),tip(567000)],5400)).toEqual([]);
    const second=gate.observe([tip(560600),tip(567600)],7600);
    expect(second).toHaveLength(1);
    expect(second[0].x).toBeGreaterThan(565000);
  });
  it('does not score spurious out-of-ring misses on static scans',()=>{
    const gate=new IdleTipRecovery();
    expect(gate.observe([tip(990000)],1000)).toEqual([]);
    expect(gate.observe([tip(991000)],3200)).toEqual([]);
    expect(gate.observe([tip(992000)],5400)).toEqual([]);
  });
  it('does not turn duplicate or fast consecutive callbacks into two observations',()=>{
    const gate=new IdleTipRecovery();
    gate.observe([tip(550000)],1000);
    expect(gate.observe([tip(550000)],1050)).toEqual([]);
    expect(gate.observe([tip(550000)],1200)).toEqual([]);
    expect(gate.observe([tip(551000)],3200)).toHaveLength(1);
  });
  it('takes an independent recovery scan at an interval not tied to motion',()=>{
    expect(IDLE_RECOVERY_INTERVAL_MS).toBeGreaterThanOrEqual(1800);
    expect(IDLE_RECOVERY_INTERVAL_MS).toBeLessThanOrEqual(3500);
  });
  it('clearing/removing darts resets the recovery candidates for a new visit',()=>{
    const gate=new IdleTipRecovery();
    gate.observe([tip(550000)],1000);
    gate.observe([tip(551000)],3200);
    gate.observe([],5400);
    expect(gate.observe([tip(550000)],7600)).toEqual([]);
    expect(gate.observe([tip(550300)],9800)).toHaveLength(1);
  });
});
