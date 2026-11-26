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
