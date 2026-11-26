import {describe,expect,it} from 'vitest';
import {mayPublishScorerTips} from '../../src/client/lib/takeoutPublication';
import {VerifiedBoardClear} from '../../src/server/scoring/verifiedBoardClear';
describe('takeout owns the ONLY scorer reports after three darts',()=>{
  it('allows regular tips and empty normal frames before takeout',()=>{
    expect(mayPublishScorerTips({takeoutExclusive:false,explicitlyVerified:false})).toBe(true);
  });
  it('blocks phantom tips and other routine inference while takeout checks',()=>{
    expect(mayPublishScorerTips({takeoutExclusive:true,explicitlyVerified:false})).toBe(false);
  });
  it('lets the dedicated verifier publish empty and occupied frames',()=>{
    expect(mayPublishScorerTips({takeoutExclusive:true,explicitlyVerified:true})).toBe(true);
  });
  it('keeps the first server empty confirmation intact across competing AI scans',()=>{
    const server=new VerifiedBoardClear();
    expect(server.observe(true,3,1000)).toBe(false);
    // The scoring model hallucinates a tip in the interval, which BEFORE
    // v5.1 was sent over WebSocket and reset server confirmations to zero.
    const ordinary=mayPublishScorerTips({takeoutExclusive:true,explicitlyVerified:false});
    expect(ordinary).toBe(false);
    if(ordinary) server.observe(false,3,1300);
    const checked=mayPublishScorerTips({takeoutExclusive:true,explicitlyVerified:true});
    expect(checked).toBe(true);
    expect(server.observe(true,3,1850)).toBe(true);
  });
  it('a true occupied result from the dedicated verifier still cancels false clearance',()=>{
    const server=new VerifiedBoardClear();
    expect(server.observe(true,3,1000)).toBe(false);
    expect(mayPublishScorerTips({takeoutExclusive:true,explicitlyVerified:true})).toBe(true);
    expect(server.observe(false,3,1200)).toBe(false);
    expect(server.observe(true,3,2200)).toBe(false);
    expect(server.observe(true,3,3200)).toBe(true);
  });
  it('after takeout turns off, normal scoring resumes for the next player',()=>{
    const state={takeoutExclusive:true,explicitlyVerified:false};
    expect(mayPublishScorerTips(state)).toBe(false);
    state.takeoutExclusive=false;
    expect(mayPublishScorerTips(state)).toBe(true);
  });
});
