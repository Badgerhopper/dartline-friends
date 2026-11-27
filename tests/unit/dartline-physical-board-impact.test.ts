import {describe,it,expect} from 'vitest';
import {BOARD_CENTER,BOARD_MAX} from '../../src/shared/boardGeometry';
import {boardImpactRegion,PHYSICAL_BOARD_EDGE,PHYSICAL_DOUBLE_EDGE,
 strongNewPhysicalMiss,physicalBoardTipBatch} from '../../src/client/lib/physicalBoardImpact';
const at=(r:number)=>[BOARD_CENTER+r,BOARD_CENTER] as const;
const guess={confidence:0.77,length:37,area:43,
 obscured:false,changeFraction:0.003};
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
