import {describe,expect,it} from 'vitest';
import {mayPublishScorerTips} from '../../src/client/lib/takeoutPublication';
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
  it('after takeout turns off, normal scoring resumes for the next player',()=>{
    const state={takeoutExclusive:true,explicitlyVerified:false};
    expect(mayPublishScorerTips(state)).toBe(false);
    state.takeoutExclusive=false;
    expect(mayPublishScorerTips(state)).toBe(true);
  });
});
