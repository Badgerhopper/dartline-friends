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
  it('prewarms from a two-dart board and recognizes immediate retrieval after the third',()=>{
    const monitor=new TakeoutSceneWitness(), baseline=still();
    // This reference was collected BEFORE the third recorded score.
    expect(monitor.observe(baseline,1000,false)).toBe(false);
    expect(monitor.observe(baseline,1260,false)).toBe(false);
    expect(monitor.observe(baseline,1520,false)).toBe(false);
    // No reset on the three-dart transition. Hand arrives immediately.
    expect(monitor.observe(hand(baseline),1780,true)).toBe(false);
    expect(monitor.observe(baseline,2040,true)).toBe(false);
    expect(monitor.observe(baseline,2300,true)).toBe(false);
    expect(monitor.observe(baseline,2560,true)).toBe(true);
  });
  it('never counts prewarm motion as takeout before the third dart',()=>{
    const monitor=new TakeoutSceneWitness(), baseline=still();
    monitor.observe(baseline,1000,false);
    monitor.observe(hand(baseline),1300,false);
    monitor.observe(baseline,1600,false);
    expect(monitor.observe(baseline,1900,true)).toBe(false);
    expect(monitor.observe(baseline,2200,true)).toBe(false);
  });
  it('ignores a uniform iPhone exposure change',()=>{
    const monitor=new TakeoutSceneWitness();
    monitor.observe(still(100),1000);
    expect(monitor.observe(still(130),1300)).toBe(false);
    expect(monitor.observe(still(130),1600)).toBe(false);
    expect(monitor.observe(still(130),1900)).toBe(false);
  });
  it('does not confuse a stationary hand still blocking the board with retrieval',()=>{
    const monitor=new TakeoutSceneWitness(), baseline=still(), moving=hand(baseline);
    expect(monitor.observe(baseline,1000)).toBe(false);
    expect(monitor.observe(moving,1300)).toBe(false);
    expect(monitor.observe(moving,1600)).toBe(false);
    expect(monitor.observe(moving,1900)).toBe(false);
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
