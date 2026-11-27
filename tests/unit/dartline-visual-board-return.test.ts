import {describe,expect,it} from 'vitest';
import {VisualBoardReturn} from '../../src/client/lib/visualBoardReturn';
import type {TemporalFrame} from '../../src/client/lib/temporalDartEvidence';
const SIZE=256;
function frame(value=100):TemporalFrame {
 const data=new Uint8Array(SIZE*SIZE*4);
 for(let i=0;i<SIZE*SIZE;i++){data[i*4]=value;data[i*4+1]=value;data[i*4+2]=value;data[i*4+3]=255;}
 return {width:SIZE,height:SIZE,data};
}
function addDart(s:TemporalFrame):TemporalFrame {
 const out={width:s.width,height:s.height,data:s.data.slice()};
 for(let y=50;y<174;y++)for(let x=100;x<103;x++){
  const k=(y*SIZE+x)*4;
  out.data[k]=210;out.data[k+1]=200;out.data[k+2]=190;
 }
 return out;
}
describe('physical empty-board return evidence does not depend on AI or hand motion',()=>{
 it('confirms real takeout after 3 recorded darts and 650ms stable clear',()=>{
   const gate=new VisualBoardReturn(),empty=frame(),full=addDart(empty);
   expect(gate.observe(empty,0,1000)).toBe(false);
   gate.observe(empty,0,1300);
   expect(gate.hasEmptyReference).toBe(true);
   gate.observe(full,1,1700);
   expect(gate.hasSeenPhysicalDarts).toBe(true);
   expect(gate.observe(full,3,2000)).toBe(false);
   expect(gate.observe(empty,3,2400)).toBe(false);
   expect(gate.observe(empty,3,2800)).toBe(false);
   expect(gate.observe(empty,3,3130)).toBe(true);
   expect(gate.observe(empty,3,3500)).toBe(false);
 });
 it('never overwrites the first empty reference while the first score is delayed',()=>{
   const gate=new VisualBoardReturn(),empty=frame(),full=addDart(empty);
   gate.observe(empty,0,1000);
   gate.observe(empty,0,1250);
   expect(gate.hasEmptyReference).toBe(true);
   // Physical dart arrives, but the WebSocket scoreboard still says 0.
   for(const t of [1500,1750,2000,2250,2500])
     gate.observe(full,0,t);
   gate.observe(full,1,2750);
   expect(gate.hasSeenPhysicalDarts).toBe(true);
   gate.observe(full,3,3000);
   gate.observe(empty,3,3400);
   expect(gate.observe(empty,3,4100)).toBe(true);
 });
 it('photo proof is valid only while the CURRENT frame matches the original clear board',()=>{
   const verifier=new VisualBoardReturn(),clear=frame(),darts=addDart(clear),hand=frame(200);
   verifier.observe(clear,0,1000);verifier.observe(clear,0,1300);
   verifier.observe(darts,1,1600);verifier.observe(darts,3,1900);
   verifier.observe(clear,3,2500);verifier.observe(clear,3,3300);
   expect(verifier.matchesCurrentEmpty(clear,3)).toBe(true);
   expect(verifier.matchesCurrentEmpty(darts,3)).toBe(false);
   expect(verifier.matchesCurrentEmpty(hand,3)).toBe(false);
   expect(verifier.matchesCurrentEmpty(clear,2)).toBe(false);
   verifier.reset();
   expect(verifier.matchesCurrentEmpty(clear,3)).toBe(false);
 });
 it('tolerates sparse isolated sensor noise on a genuinely cleared board',()=>{
   const gate=new VisualBoardReturn(),empty=frame(),full=addDart(empty);
   const noisy=frame();
   for(let y=8;y<248;y+=20)for(let x=8;x<248;x+=20){
     const k=(y*SIZE+x)*4;
     noisy.data[k]=170;noisy.data[k+1]=170;noisy.data[k+2]=170;
   }
   gate.observe(empty,0,1000);gate.observe(empty,0,1300);
   gate.observe(full,2,1600);gate.observe(full,3,1900);
   gate.observe(noisy,3,2400);
   expect(gate.observe(noisy,3,3150)).toBe(true);
   expect(gate.matchesCurrentEmpty(noisy,3)).toBe(true);
 });
 it('rejects a thin retained dart even when it changes fewer than 43 pixels',()=>{
   const gate=new VisualBoardReturn(),empty=frame(),full=addDart(empty),thin=frame();
   for(let y=70;y<90;y++){
     const k=(y*SIZE+105)*4;
     thin.data[k]=220;thin.data[k+1]=210;thin.data[k+2]=200;
   }
   gate.observe(empty,0,1000);gate.observe(empty,0,1300);
   gate.observe(full,2,1600);gate.observe(full,3,1900);
   gate.observe(thin,3,2400);
   expect(gate.observe(thin,3,3150)).toBe(false);
   expect(gate.matchesCurrentEmpty(thin,3)).toBe(false);
 });
 it('ignores moving background outside the calibrated physical board region',()=>{
   const gate=new VisualBoardReturn(),empty=frame(),full=addDart(empty),background=frame();
   const roi=new Uint8Array(SIZE*SIZE);
   for(let y=20;y<235;y++)for(let x=20;x<235;x++)roi[y*SIZE+x]=1;
   for(let y=0;y<256;y++)for(let x=0;x<16;x++){
     const k=(y*SIZE+x)*4;
     background.data[k]=220;background.data[k+1]=210;background.data[k+2]=200;
   }
   gate.setRegion(roi);
   gate.observe(empty,0,1000);gate.observe(empty,0,1300);
   gate.observe(full,2,1600);gate.observe(full,3,1900);
   gate.observe(background,3,2400);
   expect(gate.observe(background,3,3150)).toBe(true);
   expect(gate.matchesCurrentEmpty(background,3)).toBe(true);
 });
 it('requires a new stable clear after an intervening occupied frame',()=>{
   const gate=new VisualBoardReturn(),empty=frame(),full=addDart(empty);
   gate.observe(empty,0,1000);gate.observe(empty,0,1300);
   gate.observe(full,3,1800);gate.observe(empty,3,2400);
   expect(gate.observe(empty,3,3150)).toBe(true);
   gate.observe(full,3,3400);
   expect(gate.matchesCurrentEmpty(empty,3)).toBe(false);
   expect(gate.observe(empty,3,3600)).toBe(false);
   expect(gate.observe(empty,3,4300)).toBe(true);
 });
 it('retains a verified empty reference for a fast next visit, but not after a camera reset',()=>{
   const gate=new VisualBoardReturn(),empty=frame(),full=addDart(empty);
   gate.observe(empty,0,1000);gate.observe(empty,0,1300);
   gate.observe(full,3,1800);gate.observe(empty,3,2400);
   expect(gate.observe(empty,3,3150)).toBe(true);
   gate.startNextVisit();
   expect(gate.hasEmptyReference).toBe(true);
   gate.observe(full,0,3400);gate.observe(full,1,3700);
   gate.observe(full,3,4000);gate.observe(empty,3,4600);
   expect(gate.observe(empty,3,5300)).toBe(true);
   gate.reset();
   expect(gate.hasEmptyReference).toBe(false);
 });
 it('will not submit merely because the model predicted an empty board',()=>{
   const gate=new VisualBoardReturn(),empty=frame();
   gate.observe(empty,0,1000);gate.observe(empty,0,1300);
   for(const time of [1600,2000,2400,2900,3400])
     expect(gate.observe(empty,3,time)).toBe(false);
 });
 it('will not consider an obscuring hand to be a clear board',()=>{
   const gate=new VisualBoardReturn(),empty=frame(),full=addDart(empty),hand=frame(200);
   gate.observe(empty,0,1000);gate.observe(empty,0,1200);
   gate.observe(full,2,1500);
   gate.observe(hand,3,1900);
   gate.observe(hand,3,2600);
   expect(gate.observe(hand,3,3300)).toBe(false);
 });
 it('does not declare the third dart itself a takeout',()=>{
   const gate=new VisualBoardReturn(),empty=frame(),full=addDart(empty);
   gate.observe(empty,0,1000);gate.observe(empty,0,1300);
   gate.observe(full,2,1700);
   for(const time of [2000,2500,3000])
     expect(gate.observe(full,3,time)).toBe(false);
 });
 it('does not carry a previous player\'s reference across the turn',()=>{
   const gate=new VisualBoardReturn(),empty=frame(),full=addDart(empty);
   gate.observe(empty,0,1000);gate.observe(empty,0,1300);
   gate.observe(full,2,1600);
   gate.reset();
   expect(gate.hasEmptyReference).toBe(false);
   for(const time of [2000,2400,2800,3400])
     expect(gate.observe(empty,3,time)).toBe(false);
 });
 it('preserves the empty reference after a preceding manual submission',()=>{
   const gate=new VisualBoardReturn(),empty=frame(),full=addDart(empty);
   gate.observe(empty,0,1000);gate.observe(empty,0,1200);
   gate.observe(full,3,1800);gate.startNextVisit();
   gate.observe(full,0,2300);gate.observe(full,3,2600);
   gate.observe(empty,3,3000);
   expect(gate.observe(empty,3,3700)).toBe(true);
 });
 it('tolerates scattered small compression clusters',()=>{
   const gate=new VisualBoardReturn(),empty=frame(),full=addDart(empty),noise=frame();
   for(let y=8;y<248;y+=16)for(let x=8;x<248;x+=16){
     for(let i=0;i<2;i++)noise.data[(y*SIZE+x+i)*4]=170;
   }
   gate.observe(empty,0,1000);gate.observe(empty,0,1300);
   gate.observe(full,3,1800);gate.observe(noise,3,2400);
   expect(gate.observe(noise,3,3150)).toBe(true);
 });
 it('bootstraps reference from two distinct located empty scans when raw frame matching never settles',()=>{
   const gate=new VisualBoardReturn(),clear=frame(),slightlyDifferent=frame();
   for(let y=50;y<70;y++)for(let x=100;x<110;x++)slightlyDifferent.data[(y*SIZE+x)*4]=150;
   gate.observe(clear,0,1000,true);
   gate.observe(slightlyDifferent,0,1300,true);
   expect(gate.hasEmptyReference).toBe(false);
   expect(gate.observeLocatedEmpty(clear,true,1400)).toBe(false);
   expect(gate.observeLocatedEmpty(slightlyDifferent,true,1750)).toBe(true);
   expect(gate.hasEmptyReference).toBe(true);
   gate.observe(addDart(slightlyDifferent),3,2200,true);
   gate.observe(slightlyDifferent,3,2700,true);
   expect(gate.observe(slightlyDifferent,3,3400,true)).toBe(true);
 });
 it('allows explicit empty calibration only before scoring and retains it across turns',()=>{
   const gate=new VisualBoardReturn(),clear=frame(),full=addDart(clear);
   expect(gate.confirmUserEmpty(full,3)).toBe(false);
   expect(gate.hasEmptyReference).toBe(false);
   expect(gate.confirmUserEmpty(clear,0)).toBe(true);
   gate.observe(full,3,1000,true);
   expect(gate.observe(full,3,1800,true)).toBe(false);
   gate.observe(clear,3,2200,true);
   expect(gate.observe(clear,3,2900,true)).toBe(true);
   gate.startNextVisit();
   expect(gate.hasEmptyReference).toBe(true);
 });
 it('rejects an intervening positive or unlocated model scan before acquiring the reference',()=>{
   const gate=new VisualBoardReturn(),clear=frame();
   gate.observeLocatedEmpty(clear,true,1000);
   gate.observeLocatedEmpty(null,false,1300);
   expect(gate.observeLocatedEmpty(clear,true,1600)).toBe(false);
   expect(gate.observeLocatedEmpty(clear,true,1700)).toBe(false);
   expect(gate.observeLocatedEmpty(clear,true,2000)).toBe(true);
 });
 it('recognizes a colored dart with unchanged mean brightness and detects its removal',()=>{
   const gate=new VisualBoardReturn(),empty=frame(),full=frame();
   for(let y=40;y<180;y++)for(let x=100;x<104;x++){
     const k=(y*SIZE+x)*4;
     full.data[k]=200;full.data[k+1]=50;full.data[k+2]=50;
   }
   gate.observe(empty,0,1000);
   gate.observe(empty,0,1300);
   gate.observe(full,2,1700);
   expect(gate.hasSeenPhysicalDarts).toBe(true);
   gate.observe(full,3,1900);
   gate.observe(empty,3,2300);
   expect(gate.observe(empty,3,3100)).toBe(true);
 });
 it('ignores global brightness variation while still requiring physical dart evidence',()=>{
   const gate=new VisualBoardReturn(),empty=frame(),lit=frame(125);
   gate.observe(empty,0,1000);
   gate.observe(lit,0,1300);
   expect(gate.hasEmptyReference).toBe(true);
   expect(gate.observe(lit,3,2000)).toBe(false);
 });
});
