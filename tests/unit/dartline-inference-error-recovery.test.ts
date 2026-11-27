import {describe,expect,it} from 'vitest';
import {InferenceErrorRecovery} from '../../src/client/lib/inferenceErrorRecovery';
describe('AI runner self-recovery without camera or scoring session restart',()=>{
 it('ignores a single transient error and clears it after one successful frame',()=>{
   const r=new InferenceErrorRecovery();
   expect(r.failed()).toBe(false);
   r.succeeded();
   expect(r.consecutiveFailures).toBe(0);
   expect(r.failed()).toBe(false);
 });
 it('recompiles at most once after three consecutive failures',()=>{
   const r=new InferenceErrorRecovery();
   expect(r.failed()).toBe(false);
   expect(r.failed()).toBe(false);
   expect(r.failed()).toBe(true);
   for(let i=0;i<10;i++)expect(r.failed()).toBe(false);
   r.succeeded();
   expect(r.failed()).toBe(false);
   expect(r.failed()).toBe(false);
   expect(r.failed()).toBe(false);
 });
 it('allows a fresh bounded attempt after the camera is really switched',()=>{
   const r=new InferenceErrorRecovery();
   r.failed();r.failed();expect(r.failed()).toBe(true);
   r.reset();
   r.failed();r.failed();expect(r.failed()).toBe(true);
 });
});
