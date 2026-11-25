import {describe,it,expect} from 'vitest';
import {filterKnownTips,clusterNewTips} from '../../src/server/scoring/cluster';
import type {DartPoint} from '../../src/shared/vision/types';
const p=(x:number,deviceId='iphone',y=500000,confidence=.92):DartPoint=>({x,y,deviceId,confidence});
const existing=(x:number)=>{
 const tip=p(x);
 return {x,y:tip.y,confidence:tip.confidence,observations:[tip]};
};
describe('DartLine same-dart projection jitter',()=>{
  it('does not rescore a stationary dart when it stays within the physical tip repeat radius',()=>{
    const result=filterKnownTips([p(503000)],[existing(500000)]);
    expect(result.survivors).toEqual([]);
  });
  it('preserves an independently observed second dart near one previously recorded',()=>{
    const tips=[p(500700),p(511800)];
    const result=filterKnownTips(tips,[existing(500000)]);
    expect(result.survivors.map(x=>x.x)).toEqual([511800]);
  });
  it('preserves two distinct close darts in one inferred frame',()=>{
    const fresh=clusterNewTips([p(510000),p(515000)]);
    expect(fresh).toHaveLength(2);
  });
  it('still fuses cross-camera reports of a single tip',()=>{
    const fresh=clusterNewTips([p(510000,'one'),p(513000,'two')]);
    expect(fresh).toHaveLength(1);
    expect(fresh[0].cameraCount).toBe(2);
  });
  it('won\'t suppress a real new dart outside the stability radius',()=>{
    const r=filterKnownTips([p(515000)],[existing(500000)]);
    expect(r.survivors).toHaveLength(1);
  });
});
