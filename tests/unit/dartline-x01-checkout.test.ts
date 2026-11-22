import {describe, it, expect} from 'vitest';
import {checkoutSuggestions, CHECKOUT_SHOTS} from '../../src/client/lib/x01Checkout';
const finish=(remaining:number,dartsAvailable=3,doubleOut=true)=>
  checkoutSuggestions({remaining,dartsAvailable,doubleOut});
describe('DartLine X01 legal checkout routes',()=>{
  it('finishes 170 and 167 using triples and bull',()=>{
    expect(finish(170)[0]?.darts).toEqual(['T20','T20','DB']);
    expect(finish(167)[0]?.darts).toEqual(['T20','T19','DB']);
  });
  it('does not invent 3-dart bogey or impossible finishes',()=>{
    for(const n of [169,168,166,165,163,162,159,171]) expect(finish(n)).toEqual([]);
  });
  it('has natural one-dart double outs and bull',()=>{
    expect(finish(40,1)[0]?.darts).toEqual(['D20']);
    expect(finish(32,1)[0]?.darts).toEqual(['D16']);
    expect(finish(50,1)[0]?.darts).toEqual(['DB']);
    expect(finish(1,3)).toEqual([]);
  });
  it('finds a legal two-dart checkout for 100',()=>{
    expect(finish(100,2)[0]?.darts).toEqual(['T20','D20']);
    expect(finish(120,2)).toEqual([]);
  });
  it('respects darts left after throws and straight out',()=>{
    expect(finish(170,2)).toEqual([]);
    expect(finish(60,1,false)[0]?.darts).toEqual(['T20']);
    expect(finish(60,1,true)).toEqual([]);
  });
  it('every suggested route sums to the actual remaining score and ends legally',()=>{
    const map=new Map(CHECKOUT_SHOTS.map(s=>[s.label,s]));
    for (const score of [2,3,4,16,32,40,50,61,70,81,100,107,121,141,156,160,164,167,170]) {
      for(const route of finish(score)) {
        expect(route.darts.length).toBeLessThanOrEqual(3);
        expect(route.darts.reduce((n,s)=>n+(map.get(s)?.points??0),0)).toBe(score);
        expect(route.darts.at(-1)).toMatch(/^(D\d+|DB)$/);
      }
    }
  });
  it('rejects invalid inputs',()=>{
    expect(finish(NaN)).toEqual([]);expect(finish(0)).toEqual([]);
    expect(finish(170,0)).toEqual([]);
  });
});
