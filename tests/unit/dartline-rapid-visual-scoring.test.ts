import {describe,expect,it} from 'vitest';
import {boardImageChangedFraction,sameTipSet,VisualScoringDeduper,
  RapidVisualRecovery,ScoringSceneGate,VISUAL_DUPLICATE_RETRY_MS} from '../../src/client/lib/rapidVisualScoring';
import {IdleTipRecovery, IDLE_RECOVERY_MIN_SEPARATION_MS} from '../../src/client/lib/idleTipRecovery';
import type {TemporalFrame} from '../../src/client/lib/temporalDartEvidence';
import type {BoardTip} from '../../src/shared/vision/types';
const W=256;
const tip=(x:number,y=500000):BoardTip=>({x,y,confidence:.93});
function board(value=95):TemporalFrame {
 const data=new Uint8Array(W*W*4);
 for(let i=0;i<W*W;i++){
   data[i*4]=value;data[i*4+1]=value;data[i*4+2]=value;data[i*4+3]=255;
 }
 return {width:W,height:W,data};
}
function shaft(frame:TemporalFrame,x=60,y=90):void{
 for(let i=0;i<75;i++)for(let j=-1;j<=1;j++){
   const k=4*((y+j)*W+x+i);
   frame.data[k]=230;frame.data[k+1]=180;frame.data[k+2]=65;
 }
}
describe('visual comparison prevents redundant scoring but preserves close real darts',()=>{
 it('one physical tip with jitter and identical pixels is not repeatedly sent',()=>{
   const gate=new VisualScoringDeduper(),image=board();
   shaft(image);
   expect(gate.shouldForward('visit-a',[tip(500000)],image,1000)).toBe(true);
   for(const [x,time] of [[501800,1200],[506100,1600],[498100,2100]]){
     expect(gate.shouldForward('visit-a',[tip(x)],image,time)).toBe(false);
   }
   expect(gate.shouldForward('visit-a',[tip(501100)],image,1100+VISUAL_DUPLICATE_RETRY_MS)).toBe(true);
 });
 it('new shaft beside old dart is NOT dropped just because points nearly coincide',()=>{
   const gate=new VisualScoringDeduper(),a=board(),b=board();
   shaft(a,60,90);shaft(b,60,90);shaft(b,66,115);
   expect(gate.shouldForward('visit-a',[tip(500000)],a,1000)).toBe(true);
   expect(boardImageChangedFraction(a,b)).toBeGreaterThan(.0007);
   expect(gate.shouldForward('visit-a',[tip(502000)],b,1200)).toBe(true);
 });
 it('two visible close tips are preserved even if one was already scored',()=>{
   const gate=new VisualScoringDeduper(),a=board(),b=board();
   shaft(a);shaft(b);shaft(b,80,120);
   expect(gate.shouldForward('visit-a',[tip(500000)],a,1000)).toBe(true);
   expect(gate.shouldForward('visit-a',[tip(500700),tip(503000)],b,1350)).toBe(true);
   expect(sameTipSet([tip(500700),tip(503000)],[tip(500000)])).toBe(false);
 });
 it('correctly matches unordered tips one-to-one and never collapses two to one',()=>{
   expect(sameTipSet([tip(500100),tip(504000)],[tip(503900),tip(500000)])).toBe(true);
   expect(sameTipSet([tip(500100),tip(504000)],[tip(500000)])).toBe(false);
 });
 it('resets when a new player or visit is assigned',()=>{
   const gate=new VisualScoringDeduper(),image=board();shaft(image);
   expect(gate.shouldForward('visit-a',[tip(500000)],image,1000)).toBe(true);
   expect(gate.shouldForward('visit-a',[tip(500000)],image,1200)).toBe(false);
   expect(gate.shouldForward('visit-b',[tip(500000)],image,1250)).toBe(true);
 });
 it('never delays empty-board verification or blocks unknown camera samples',()=>{
   const gate=new VisualScoringDeduper(),frame=board();
   expect(gate.shouldForward('visit-a',[tip(500000)],frame,1000)).toBe(true);
   expect(gate.shouldForward('visit-a',[],frame,1200)).toBe(true);
   expect(gate.shouldForward('visit-a',[tip(500000)],null,1250)).toBe(true);
   expect(gate.shouldForward('',[tip(500000)],frame,1300)).toBe(true);
 });
 it('tolerates global brightness changes without creating fictitious novelty',()=>{
   const a=board(95);shaft(a);
   // True exposure compensation: every pixel, INCLUDING the dart, is
   // brightened by the camera's automatic gain. No new object appeared.
   const b={width:a.width,height:a.height,data:a.data.slice()};
   for(let i=0;i<W*W;i++)for(let c=0;c<3;c++) {
     const k=i*4+c;
     b.data[k]=Math.min(255,a.data[k]+27);
   }
   expect(boardImageChangedFraction(a,b)).toBeLessThan(.0007);
   const gate=new VisualScoringDeduper();
   expect(gate.shouldForward('visit',[tip(500000)],a,1000)).toBe(true);
   expect(gate.shouldForward('visit',[tip(501000)],b,1200)).toBe(false);
 });
});
describe('rapid inference priority for a truly newly settled dart',()=>{
 it('schedules two separated AI confirmations without ever counting a model prediction itself',()=>{
   const scan=new RapidVisualRecovery();
   scan.finished(1000,true);
   expect(scan.shouldProbe(1300,true)).toBe(false);
   scan.newPhysicalDart(1360);
   expect(scan.shouldProbe(1549,true)).toBe(false);
   expect(scan.shouldProbe(1550,true)).toBe(true);
   scan.finished(1600,true);
   expect(scan.pendingFastProbes).toBe(1);
   expect(scan.shouldProbe(2149,true)).toBe(false);
   expect(scan.shouldProbe(2150,true)).toBe(true);
   scan.finished(2200,true);
   expect(scan.pendingFastProbes).toBe(0);
   expect(scan.shouldProbe(3149,true)).toBe(false);
   expect(scan.shouldProbe(3150,true)).toBe(true);
 });
 it('the next rapid model sample is actually accepted by the scoring confirmation gate',()=>{
   const scan=new RapidVisualRecovery(),gate=new IdleTipRecovery();
   scan.newPhysicalDart(1000);
   expect(gate.observe([tip(550000)],1000)).toEqual([]);
   scan.finished(1000,true);
   const next=1000+IDLE_RECOVERY_MIN_SEPARATION_MS;
   expect(scan.shouldProbe(next-1,true)).toBe(false);
   expect(scan.shouldProbe(next,true)).toBe(true);
   expect(gate.observe([tip(550300)],next)).toHaveLength(1);
 });
 it('an uncertain shaft keeps the fast path for three independent confirmations',()=>{
   const scan=new RapidVisualRecovery();
   scan.newPhysicalDart(1000,true);
   expect(scan.pendingFastProbes).toBe(3);
   scan.finished(1000,true);
   expect(scan.shouldProbe(1550,true)).toBe(true);
   scan.finished(1550,true);
   expect(scan.shouldProbe(2100,true)).toBe(true);
   scan.finished(2100,true);
   expect(scan.pendingFastProbes).toBe(0);
 });
 it('busy inference never consumes a priority check',()=>{
   const scan=new RapidVisualRecovery();
   scan.newPhysicalDart(1200);
   expect(scan.shouldProbe(1250,true)).toBe(true);
   scan.finished(1300,false);
   expect(scan.pendingFastProbes).toBe(2);
   expect(scan.shouldProbe(1370,true)).toBe(true);
 });
 it('does not increase scan rate on an unchanged empty board',()=>{
   const scan=new RapidVisualRecovery();
   scan.finished(1000,true);
   expect(scan.shouldProbe(1400,true)).toBe(false);
   expect(scan.shouldProbe(1949,true)).toBe(false);
   expect(scan.shouldProbe(1950,true)).toBe(true);
 });
 it('does not scan during remote turns or removal verification',()=>{
   const scan=new RapidVisualRecovery();
   scan.newPhysicalDart(1000);
   expect(scan.shouldProbe(1100,false)).toBe(false);
   scan.reset();
   expect(scan.pendingFastProbes).toBe(0);
 });
});

describe('one physical scene checkpoint shared by normal and estimated scoring',()=>{
 it('cannot rescore a stationary dart even when the model switches to another sector',()=>{
   const gate=new ScoringSceneGate(),empty=board(),a=board();shaft(a);
   gate.prime('v',empty);
   expect(gate.allow('v',0,[tip(500000)],a,1000)).toBe(true);
   expect(gate.allow('v',0,[tip(630000)],a,1350)).toBe(false);
   gate.acknowledge('v',1);
   expect(gate.allow('v',1,[tip(630000)],a,4000)).toBe(false);
   expect(gate.allow('v',1,[tip(500000),tip(630000)],a,5000)).toBe(false);
 });
 it('accepts a new close shaft and a distinct third dart without reusing the first scene',()=>{
   const gate=new ScoringSceneGate(),a=board(),b=board(),c=board();
   shaft(a);shaft(b);shaft(b,66,115);shaft(c);shaft(c,66,115);shaft(c,80,160);
   expect(gate.allow('v',0,[tip(500000)],a,1000)).toBe(true);
   gate.acknowledge('v',1);
   expect(gate.allow('v',1,[tip(500000),tip(502000)],b,1500)).toBe(true);
   gate.acknowledge('v',2);
   expect(gate.allow('v',2,[tip(702000)],c,2200)).toBe(true);
   gate.acknowledge('v',3);
   expect(gate.allow('v',3,[tip(702000)],c,3300)).toBe(false);
   expect(gate.allow('next',0,[tip(500000)],a,4000)).toBe(true);
 });
 it('does not allow two interpretations of one pending arrival to race',()=>{
   const gate=new ScoringSceneGate(),a=board();shaft(a);
   expect(gate.allow('v',0,[tip(500000)],a,1000)).toBe(true);
   expect(gate.allow('v',0,[tip(530000)],a,1700)).toBe(false);
   gate.acknowledge('v',1);
   expect(gate.allow('v',1,[tip(530000)],a,4000)).toBe(false);
 });
});
