import {describe,expect,it} from 'vitest';
import {PhotoTakeoutConfirm,PHOTO_CLEAR_CONFIRM_SPACING_MS,
 PHOTO_CLEAR_RETRY_MS} from '../../src/client/lib/photoTakeoutConfirm';
import {VerifiedBoardClear} from '../../src/server/scoring/verifiedBoardClear';
describe('AI-independent physical photographic dart removal',()=>{
 it('accepts two independently checked cleared images and submits exactly once',()=>{
   const gate=new PhotoTakeoutConfirm(),server=new VerifiedBoardClear();
   expect(gate.claim('round1',1000,false,true)).toBe(false);
   expect(gate.claim('round1',1500,true,true)).toBe(true);
   expect(server.observe(true,3,1500)).toBe(false);
   expect(gate.claim('round1',1800,true,true)).toBe(false);
   expect(gate.claim('round1',1500+PHOTO_CLEAR_CONFIRM_SPACING_MS,true,true)).toBe(true);
   expect(server.observe(true,3,1500+PHOTO_CLEAR_CONFIRM_SPACING_MS)).toBe(true);
   expect(gate.pairsSent).toBe(1);
 });
 it('never declares clear without a located camera or matching fresh photo',()=>{
   const gate=new PhotoTakeoutConfirm();
   expect(gate.claim('round1',1500,true,false)).toBe(false);
   expect(gate.claim('round1',1700,false,true)).toBe(false);
   expect(gate.claim('',2200,true,true)).toBe(false);
   expect(gate.reportsSent).toBe(0);
 });
 it('does not reuse the same image or timestamp for two confirmations',()=>{
   const gate=new PhotoTakeoutConfirm();
   expect(gate.claim('v',1500,true,true)).toBe(true);
   for(const t of [1500,1800,2000,2399]){
     expect(gate.claim('v',t,true,true)).toBe(false);
   }
   expect(gate.claim('v',2400,true,true)).toBe(true);
 });
 it('holds when an occupied photo interrupts the clear sequence',()=>{
   const gate=new PhotoTakeoutConfirm();
   gate.claim('v',1000,true,true);
   expect(gate.claim('v',2100,false,true)).toBe(false);
   expect(gate.claim('v',2300,true,true)).toBe(true);
 });
 it('retries dropped reports with new photos and a strict upper bound',()=>{
   const gate=new PhotoTakeoutConfirm();
   for(let pair=0;pair<4;pair++){
     const start=1000+pair*(PHOTO_CLEAR_CONFIRM_SPACING_MS+PHOTO_CLEAR_RETRY_MS+50);
     expect(gate.claim('v',start,true,true)).toBe(true);
     expect(gate.claim('v',start+PHOTO_CLEAR_CONFIRM_SPACING_MS,true,true)).toBe(true);
   }
   expect(gate.claim('v',30000,true,true)).toBe(false);
   expect(gate.pairsSent).toBe(4);
 });
 it('resets on visit change and cannot reuse old proof',()=>{
   const gate=new PhotoTakeoutConfirm();
   expect(gate.claim('old',1000,true,true)).toBe(true);
   expect(gate.claim('new',1150,false,true)).toBe(false);
   expect(gate.reportsSent).toBe(0);
   expect(gate.claim('new',1250,true,true)).toBe(true);
   gate.reset();
   expect(gate.pairsSent).toBe(0);
 });
});
