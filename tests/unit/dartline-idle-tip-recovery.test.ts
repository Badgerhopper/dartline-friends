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
    expect(recovered).toHaveLength(3);
    expect(recovered.map(x=>x.x).sort()).toEqual([510400,600500,720750]);
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
    expect(second).toHaveLength(2);
    expect(second.some(t=>t.x>565000)).toBe(true);
  });
  it('does not invent a third dart when confidence ordering steals a neighboring match',()=>{
    const gate=new IdleTipRecovery();
    const first=[tip(550000),tip(570000)];
    gate.observe(first,1000);
    expect(gate.observe(first,3200)).toHaveLength(2);
    // The strongest point can match either old dart. The weaker point can
    // only match the first. A greedy assignment creates a false new track.
    const ambiguous=[tip(559000,500000,.96),tip(541000,500000,.88)];
    expect(gate.observe(ambiguous,5400)).toEqual([]);
    expect(gate.observe(ambiguous,7600)).toEqual([]);
    expect(gate.observe(ambiguous,9800)).toEqual([]);
  });
  it('still confirms an actual third clustered dart after assignment',()=>{
    const gate=new IdleTipRecovery();
    const first=[tip(550000),tip(570000)];
    gate.observe(first,1000);
    expect(gate.observe(first,3200)).toHaveLength(2);
    const three=[tip(550000),tip(570000),tip(560000)];
    expect(gate.observe(three,5400)).toEqual([]);
    expect(gate.observe(three,7600)).toHaveLength(3);
  });
  it('tolerates one missed inference but requires extra evidence after a gap',()=>{
    const gate=new IdleTipRecovery();
    expect(gate.observe([tip(560000)],1000)).toEqual([]);
    expect(gate.observe([],3200)).toEqual([]);
    expect(gate.observe([tip(560800)],5400)).toEqual([]);
    expect(gate.observe([tip(560600)],7600)).toHaveLength(1);
  });
  it('does not promote a single false prediction separated by blank frames',()=>{
    const gate=new IdleTipRecovery();
    gate.observe([tip(560000)],1000);
    gate.observe([],3200);
    expect(gate.observe([tip(560600)],5400)).toEqual([]);
    gate.observe([],7600);
    gate.observe([],9800);
    expect(gate.observe([tip(560000)],12000)).toEqual([]);
  });
  it('never scores model tips outside the circular physical board',()=>{
    const gate=new IdleTipRecovery();
    expect(gate.observe([tip(999900)],1000)).toEqual([]);
    expect(gate.observe([tip(999900)],3200)).toEqual([]);
    expect(gate.observe([tip(999900)],5400)).toEqual([]);
    // Corner of square image/board coordinates is also outside the circle.
    expect(gate.observe([tip(980000,980000)],7600)).toEqual([]);
  });
  it('recovers strong MISS tips between double ring and the board edge',()=>{
    const gate=new IdleTipRecovery();
    expect(gate.observe([tip(905000,500000,.91)],1000)).toEqual([]);
    const recovered=gate.observe([tip(905600,500000,.93)],3200);
    expect(recovered).toHaveLength(1);
    expect(recovered[0].x).toBe(905300);
  });
  it('does not promote weak outside-double misses on repeated scans',()=>{
    const gate=new IdleTipRecovery();
    for(const [i,x] of [905000,905600,905400].entries()){
      expect(gate.observe([tip(x,500000,.73)],1000+i*2200)).toEqual([]);
    }
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
    gate.observe([],7600);
    expect(gate.observe([tip(550000)],9800)).toEqual([]);
    expect(gate.observe([tip(550300)],12000)).toHaveLength(1);
  });
});
