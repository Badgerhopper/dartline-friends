import {describe,it,expect} from 'vitest';
import {BOARD_CENTER,BOARD_MAX} from '../../src/shared/boardGeometry';
import {boardImpactRegion,PHYSICAL_BOARD_EDGE,PHYSICAL_DOUBLE_EDGE,
 strongNewPhysicalMiss} from '../../src/client/lib/physicalBoardImpact';
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
