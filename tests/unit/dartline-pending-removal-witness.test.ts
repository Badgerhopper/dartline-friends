import {describe,it,expect} from 'vitest';
import {PendingRemovalWitness,REMOVAL_WITNESS_LIFETIME_MS} from '../../src/client/lib/pendingRemovalWitness';
import {FastBoardClear} from '../../src/client/lib/fastBoardClear';
describe('physical proof survives asynchronous 3-dart arming without leaking into another visit',()=>{
 it('replays genuine hand motion witnessed before gate was armed',()=>{
   const b=new PendingRemovalWitness(),gate=new FastBoardClear();
   b.sawHand(1500);
   b.replay(gate,1600);
   expect(gate.hasRetrievalWitness).toBe(false);
   gate.arm(true,1750,true);
   b.replay(gate,1800);
   expect(gate.hasRetrievalWitness).toBe(true);
 });
 it('replays verified empty-photo proof, including phantom-model override',()=>{
   const b=new PendingRemovalWitness(),gate=new FastBoardClear();
   b.sawPhotoClear(2000);
   gate.arm(true,2100,true);
   b.replay(gate,2200);
   expect(gate.hasStrongPhotoClear).toBe(true);
   const a=gate.claim(3000,true)!;
   expect(gate.finish(a,3030,'occupied')).toBe('send-empty');
 });
 it('never replays a stale photo, a stale hand, or evidence from a previous visit',()=>{
   const b=new PendingRemovalWitness(),gate=new FastBoardClear();
   b.sawHand(1000);b.sawPhotoClear(1000);
   gate.arm(true,2000,true);
   b.replay(gate,1000+REMOVAL_WITNESS_LIFETIME_MS+100);
   expect(gate.hasRetrievalWitness).toBe(false);
   expect(gate.hasStrongPhotoClear).toBe(false);
   b.sawHand(7000);b.sawPhotoClear(7100);
   b.reset();gate.arm(false,7300);gate.arm(true,7500,true);
   b.replay(gate,7600);
   expect(gate.hasRetrievalWitness).toBe(false);
 });
});
