import { describe, expect, it } from 'vitest';
import { StableTipRescue, mergeRescuedTips, RELAXED_TIP_THRESHOLD } from '../../src/client/lib/tipRescue';
import type { BoardTip } from '../../src/shared/vision/types';
const t = (x:number,y=500000,confidence=.57):BoardTip=>({x,y,confidence});

describe('DartLine low-confidence dart-tip recovery', () => {
 it('keeps the original strict model and only recovers a stable second observation', () => {
   const gate = new StableTipRescue();
   expect(RELAXED_TIP_THRESHOLD).toBeLessThan(.8);
   expect(gate.observe([t(510000)], 1000)).toEqual([]);
   expect(gate.observe([t(511500)], 2300)).toEqual([t(511500)]);
 });
 it('rejects one-off false positives and candidates outside the scoring surface', () => {
   const gate=new StableTipRescue();
   expect(gate.observe([t(530000)],0)).toEqual([]);
   expect(gate.observe([],1250)).toEqual([]);
   expect(gate.observe([t(530000)],2500)).toEqual([]);
   expect(gate.observe([t(990000)],3800)).toEqual([]);
   expect(gate.observe([t(990000)],5000)).toEqual([]);
 });
 it('requires repeated spatial agreement rather than two unrelated false tips', () => {
   const gate=new StableTipRescue();
   gate.observe([t(510000)],0);
   expect(gate.observe([t(580000)],1200)).toEqual([]);
   expect(gate.observe([t(580700)],2500)).toEqual([t(580700)]);
 });
 it('resets a lost camera session and an intermittent prediction', () => {
   const gate=new StableTipRescue();
   gate.observe([t(505000)],0);
   gate.reset();
   expect(gate.observe([t(505000)],900)).toEqual([]);
   expect(gate.observe([t(505000)],8000)).toEqual([]);
 });
 it('does not promote predictions below the rescue threshold', () => {
   const gate=new StableTipRescue();
   expect(gate.observe([t(500000,500000,.32)],0)).toEqual([]);
   expect(gate.observe([t(500000,500000,.32)],1100)).toEqual([]);
 });
 it('does not duplicate strict high-confidence darts', () => {
   expect(mergeRescuedTips([t(520000,500000,.9)],[t(522000)])).toHaveLength(1);
   expect(mergeRescuedTips([t(520000,500000,.9)],[t(560000)])).toHaveLength(2);
 });
});
