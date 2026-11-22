import { describe, expect, it } from 'vitest';
import { StableTipRescue, mergeRescuedTips, RELAXED_TIP_THRESHOLD } from '../../src/client/lib/tipRescue';
import type { BoardTip } from '../../src/shared/vision/types';

const t=(x:number,y=500000,confidence=.61):BoardTip => ({x,y,confidence});
describe('DartLine fast, stable dart-tip recovery', () => {
  it('confirms a normal weak dart after two sightings', () => {
    const gate=new StableTipRescue();
    expect(gate.observe([t(525000)],0)).toEqual([]);
    expect(gate.observe([t(528000)],550)).toEqual([t(526500)]);
  });
  it('continues after one missed scan (1 of 3 is now recoverable)', () => {
    const gate=new StableTipRescue();
    expect(gate.observe([t(510000)],0)).toEqual([]);
    expect(gate.observe([],550)).toEqual([]);
    expect(gate.observe([],1100)).toEqual([]);
    expect(gate.observe([t(511000)],1650)).toEqual([t(510500)]);
  });
  it('requires three sightings below 50 percent confidence', () => {
    const gate=new StableTipRescue();
    expect(RELAXED_TIP_THRESHOLD).toBeLessThan(.5);
    expect(gate.observe([t(510000,500000,.44)],0)).toEqual([]);
    expect(gate.observe([t(511000,500000,.45)],550)).toEqual([]);
    expect(gate.observe([t(509000,500000,.46)],1100)).toEqual([t(510000,500000,.46)]);
  });
  it('anchors coordinates across many scans instead of inventing another dart', () => {
    const gate=new StableTipRescue();
    gate.observe([t(501000)],0);
    for (let i=1;i<=12;i++){
      const result=gate.observe([t(501000+(i%2?5000:-5000))],i*500);
      expect(result).toHaveLength(1);
      expect(result[0].x).toBe(503500);
    }
  });
  it('expires unsupported evidence, and camera reset clears it', () => {
    const gate=new StableTipRescue();
    gate.observe([t(510000)],0);
    expect(gate.observe([t(510000)],2500)).toEqual([]);
    gate.reset();
    expect(gate.observe([t(510000)],2900)).toEqual([]);
  });
  it('does not accept isolated or off-board noise', () => {
    const gate=new StableTipRescue();
    expect(gate.observe([t(530000)],0)).toEqual([]);
    expect(gate.observe([],400)).toEqual([]);
    expect(gate.observe([t(990000)],650)).toEqual([]);
    expect(gate.observe([t(990000)],1100)).toEqual([]);
    expect(gate.observe([t(550000,500000,.30)],1450)).toEqual([]);
  });
  it('preserves two separate visible darts even when their anchors are close', () => {
    const gate=new StableTipRescue();
    gate.observe([t(510000),t(520000)],0);
    const result=gate.observe([t(512000),t(522000)],550);
    expect(result).toHaveLength(2);
    expect(result.map(x=>x.x).sort()).toEqual([511000,521000]);
  });
  it('prefers a high-confidence position when it follows a tentative weak tip', () => {
    const gate = new StableTipRescue();
    gate.observe([t(523000,500000,.55)],0);
    expect(gate.observe([t(528000,500000,.93)],550)).toEqual([t(528000,500000,.93)]);
  });
  it('stabilizes strict detections without duplicating a recovered tip', () => {
    expect(mergeRescuedTips([t(525000,500000,.85)],[t(521000)])).toEqual([t(521000,500000,.85)]);
    expect(mergeRescuedTips([t(525000,500000,.85)],[t(560000)])).toHaveLength(2);
  });
  it('does not accept non-finite predictions', () => {
    const gate=new StableTipRescue();
    expect(gate.observe([t(NaN),t(500000,NaN),t(500000,500000,Infinity)],0)).toEqual([]);
  });
});
