import { describe, expect, it } from 'vitest';
import { TakeoutSceneWitness, TAKEOUT_SAMPLE_PIXELS } from '../../src/client/lib/takeoutSceneWitness';
const size=TAKEOUT_SAMPLE_PIXELS*TAKEOUT_SAMPLE_PIXELS;
const still=(brightness=100)=>new Uint8Array(size).fill(brightness);
const hand=(old:Uint8Array)=>{const changed=old.slice();for(let i=300;i<1100;i++)changed[i]=220;return changed;};
describe('independent retrieval scene witness',()=>{
  it('never triggers for a still board whose AI sometimes misses tips',()=>{
    const monitor=new TakeoutSceneWitness();
    for(let i=0;i<20;i++)expect(monitor.observe(still(),1000+i*300)).toBe(false);
  });
  it('ignores a uniform iPhone exposure change',()=>{
    const monitor=new TakeoutSceneWitness();
    monitor.observe(still(100),1000);
    expect(monitor.observe(still(130),1300)).toBe(false);
    expect(monitor.observe(still(130),1600)).toBe(false);
    expect(monitor.observe(still(130),1900)).toBe(false);
  });
  it('detects real hand motion followed by two quiet video frames',()=>{
    const monitor=new TakeoutSceneWitness(), baseline=still(), moving=hand(baseline);
    expect(monitor.observe(baseline,1000)).toBe(false);
    expect(monitor.observe(moving,1300)).toBe(false);
    expect(monitor.observe(moving,1600)).toBe(false);
    expect(monitor.observe(moving,1900)).toBe(true);
    expect(monitor.observe(moving,2200)).toBe(false);
  });
  it('can confirm when the hand exits and the board is stable again',()=>{
    const monitor=new TakeoutSceneWitness(), baseline=still();
    monitor.observe(baseline,1000);
    monitor.observe(hand(baseline),1300);
    monitor.observe(baseline,1600);
    expect(monitor.observe(baseline,1900)).toBe(false);
    expect(monitor.observe(baseline,2200)).toBe(true);
  });
  it('does not trigger from invalid or motionless frames',()=>{
    const monitor=new TakeoutSceneWitness();
    expect(monitor.observe(new Uint8Array(0),1000)).toBe(false);
    monitor.observe(still(),1000);
    expect(monitor.observe(still(),1400)).toBe(false);
  });
  it('reset prevents movement from the prior visit counting as this visit',()=>{
    const monitor=new TakeoutSceneWitness(), baseline=still();
    monitor.observe(baseline,1000);
    monitor.observe(hand(baseline),1300);
    monitor.reset();
    expect(monitor.observe(baseline,1600)).toBe(false);
    expect(monitor.observe(baseline,1900)).toBe(false);
  });
});
