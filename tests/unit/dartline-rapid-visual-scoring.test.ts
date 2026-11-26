import {describe,expect,it} from 'vitest';
import {boardImageChangedFraction,sameTipSet,VisualScoringDeduper,
  RapidVisualRecovery,VISUAL_DUPLICATE_RETRY_MS} from '../../src/client/lib/rapidVisualScoring';
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
   const a=board(95),b=board(122);shaft(a);shaft(b);
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
   expect(scan.shouldProbe(1540,true)).toBe(false);
   expect(scan.shouldProbe(1560,true)).toBe(true);
   scan.finished(1600,true);
   expect(scan.pendingFastProbes).toBe(1);
   expect(scan.shouldProbe(2000,true)).toBe(false);
   expect(scan.shouldProbe(2150,true)).toBe(true);
   scan.finished(2200,true);
   expect(scan.pendingFastProbes).toBe(0);
   expect(scan.shouldProbe(2700,true)).toBe(false);
   expect(scan.shouldProbe(3150,true)).toBe(true);
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
