import {describe,it,expect} from 'vitest';
import {BOARD_CENTER,BOARD_MAX} from '../../src/shared/boardGeometry';
import {boardImpactRegion,PHYSICAL_BOARD_EDGE,PHYSICAL_DOUBLE_EDGE,
 strongNewPhysicalMiss,physicalBoardTipBatch,scoreHiddenTip,physicalBoardMask,scorePhysicalDart,OuterMissConfirmation} from '../../src/client/lib/physicalBoardImpact';
const at=(r:number)=>[BOARD_CENTER+r,BOARD_CENTER] as const;
const guess={confidence:0.77,length:37,area:43,
 obscured:false,changeFraction:0.003};
describe('shaft extrapolation uncertainty',()=>{
 const hidden={x:.5,y:.65,confidence:.88,length:40,area:80,changeFraction:.003,
   obscured:true,axis:{x:0,y:1,ratio:2},hiddenRange:{startX:.5,startY:.646,endX:.5,endY:.654}};
 const project=(x:number,y:number)=>[x*1000000,y*1000000];
 it('automatically accepts only a bounded hidden interval inside one scoring bed',()=>{
   expect(scoreHiddenTip(hidden,project)?.label).toBe('S20');
 });
 it('rejects an interval that crosses a triple wire, a sector wire or the physical rim',()=>{
   const crossing={...hidden,y:.731,hiddenRange:{startX:.5,startY:.724,endX:.5,endY:.738}};
   expect(scoreHiddenTip(crossing,project)).toBeNull();
   expect(scoreHiddenTip(hidden,()=>[999999,999999])).toBeNull();
 });
 it('does not mistake an unbounded or weak shape for a confident estimate',()=>{
   expect(scoreHiddenTip({...hidden,confidence:.60},project)).toBeNull();
   expect(scoreHiddenTip({...hidden,hiddenRange:undefined},project)).toBeNull();
   expect(scoreHiddenTip({...hidden,hiddenRange:{startX:.5,startY:.60,endX:.5,endY:.70}},project)).toBeNull();
 });
 it('maps the board region rather than assuming the image square is the board',()=>{
   const mask=physicalBoardMask(project,16);
   expect(mask[0]).toBe(0);
   expect(mask[8*16+8]).toBe(1);
   expect(mask[15*16+15]).toBe(0);
 });
});
describe('physical fallback when the neural network returns no tip',()=>{
 const project=(x:number,y:number)=>[x*1000000,y*1000000];
 const shaft={x:.5,y:.66,confidence:.79,length:30,area:80,changeFraction:.003,
   obscured:false,axis:{x:0,y:1,ratio:2}};
 it('scores a visible unrecognized dart including the first of a turn',()=>{
   expect(scorePhysicalDart(shaft,project)?.label).toBe('S20');
 });
 it('scores a new physical dart barely beyond the double ring',()=>{
   expect(scorePhysicalDart({...shaft,y:.879},project)?.label).toBe('miss');
 });
 it('never promotes a spare on the wall',()=>{
   expect(scorePhysicalDart({...shaft,x:.97,y:.9},project)).toBeNull();
 });
 it('gives an editable best estimate for a physically witnessed occlusion',()=>{
   const g={...shaft,obscured:true,y:.73,hiddenRange:{startX:.5,startY:.70,endX:.5,endY:.76}};
   expect(scorePhysicalDart(g,project)).not.toBeNull();
 });
});
describe('raw outer MISS confirmation',()=>{
 const miss={x:900000,y:500000,confidence:.92};
 const hit={x:760000,y:550000,confidence:.93};
 it('never scores a transient false miss or turns it into an empty report',()=>{
   const gate=new OuterMissConfirmation(),first={};
   expect(gate.filter([miss],'visit',first,1000)).toBeNull();
   expect(gate.filter([miss],'visit',first,1400)).toBeNull();
   expect(gate.filter([hit],'visit',{},1600)).toEqual([hit]);
 });
 it('allows a repeatedly detected real outer-ring hit and retains ordinary hits',()=>{
   const gate=new OuterMissConfirmation();
   expect(gate.filter([hit,miss],'visit',{},1000)).toEqual([hit]);
   expect(gate.filter([hit,miss],'visit',{},1400)).toEqual([hit,miss]);
   expect(gate.filter([miss],'next',{},1800)).toBeNull();
 });
});
describe('circular physical-board-only automatic miss zone',()=>{
 it('uses the double wire to physical edge, never a square crop or wall',()=>{
   expect(boardImpactRegion(...at(PHYSICAL_DOUBLE_EDGE-1))).toBe('score');
   expect(boardImpactRegion(...at(PHYSICAL_DOUBLE_EDGE))).toBe('score');
   expect(boardImpactRegion(...at(PHYSICAL_DOUBLE_EDGE+1))).toBe('miss');
   expect(boardImpactRegion(...at(PHYSICAL_DOUBLE_EDGE+3000))).toBe('miss');
   expect(boardImpactRegion(...at(PHYSICAL_BOARD_EDGE-1))).toBe('miss');
   expect(boardImpactRegion(...at(PHYSICAL_BOARD_EDGE))).toBe('miss');
   expect(boardImpactRegion(...at(PHYSICAL_BOARD_EDGE+1))).toBe('outside');
 });
 it('excludes stored wall darts even inside the square camera crop',()=>{
   const nearCorner=[BOARD_MAX-200,BOARD_MAX-200] as const;
   expect(nearCorner.every(v=>v<=BOARD_MAX)).toBe(true);
   expect(boardImpactRegion(...nearCorner)).toBe('outside');
   expect(strongNewPhysicalMiss(...nearCorner,guess)).toBe(false);
   expect(boardImpactRegion(-100,500000)).toBe('outside');
   expect(boardImpactRegion(Infinity,500000)).toBe('outside');
 });
 it('an off-board tip never becomes a fake empty board report',()=>{
   const wall={x:999900,y:500000,confidence:0.99};
   const board={x:800000,y:500000,confidence:0.86};
   expect(physicalBoardTipBatch([])).toEqual([]);
   expect(physicalBoardTipBatch([wall])).toBeNull();
   expect(physicalBoardTipBatch([wall,board])).toEqual([board]);
   expect(physicalBoardTipBatch([board])).toEqual([board]);
 });
 it('requires a newly arrived physical shaft and rejects hands / lighting',()=>{
   const p=at(PHYSICAL_DOUBLE_EDGE+18000);
   expect(strongNewPhysicalMiss(...p,guess)).toBe(true);
   expect(strongNewPhysicalMiss(...p,{...guess,obscured:true})).toBe(false);
   expect(strongNewPhysicalMiss(...p,{...guess,length:16})).toBe(false);
   expect(strongNewPhysicalMiss(...p,{...guess,area:12})).toBe(false);
   expect(strongNewPhysicalMiss(...p,{...guess,confidence:.55})).toBe(false);
   expect(strongNewPhysicalMiss(...p,{...guess,changeFraction:.12})).toBe(false);
   expect(strongNewPhysicalMiss(...p,{...guess,changeFraction:0})).toBe(false);
 });
});
