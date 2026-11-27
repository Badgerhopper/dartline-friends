import {describe,expect,it} from 'vitest';
import {detectTemporalDart,TemporalDartTracker,type TemporalFrame} from '../../src/client/lib/temporalDartEvidence';
const W=256,H=256;
function blank(value=90):TemporalFrame {
  const data=new Uint8Array(W*H*4);
  for(let i=0;i<W*H;i++){data[4*i]=value;data[4*i+1]=value;data[4*i+2]=value;data[4*i+3]=255;}
  return {width:W,height:H,data};
}
function dot(frame:TemporalFrame,x:number,y:number,r:number,v=238) {
  for(let yy=Math.max(0,y-r);yy<=Math.min(H-1,y+r);yy++)
    for(let xx=Math.max(0,x-r);xx<=Math.min(W-1,x+r);xx++) {
      const k=4*(yy*W+xx);
      frame.data[k]=v;frame.data[k+1]=v;frame.data[k+2]=v;
    }
}
function dart(frame:TemporalFrame,tipX:number,tipY:number,behind=false) {
  // Thin shaft with a wider flight opposite the entry point.
  for(let x=tipX;x<=tipX+65;x++) {
    if(behind && x<tipX+12)continue; // tip obscured by older dart
    dot(frame,x,tipY+Math.round((x-tipX)*0.13),1);
  }
  for(let x=tipX+54;x<=tipX+70;x++)
    dot(frame,x,tipY+Math.round((x-tipX)*0.13),5);
}
function covers(frame:TemporalFrame,x0:number,y0:number,x1:number,y1:number) {
  for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
    const k=4*(y*W+x);frame.data[k]=160;frame.data[k+1]=120;frame.data[k+2]=90;
  }
}
describe('on-phone temporal shaft detector, independent of neural network',()=>{
 it('finds a newly arrived shaft with correct approximate tip and no model keypoint',()=>{
   const a=blank(),b=blank();dart(b,58,90);
   const guess=detectTemporalDart(a,b);
   expect(guess).not.toBeNull();
   expect(guess!.length).toBeGreaterThan(40);
   expect(guess!.area).toBeGreaterThan(25);
   expect(guess!.x*W).toBeGreaterThan(43);
   expect(guess!.x*W).toBeLessThan(81);
   expect(guess!.y*H).toBeGreaterThan(80);
   expect(guess!.y*H).toBeLessThan(110);
 });
 it('makes a tentative estimate when the point is hidden but a new shaft is visible',()=>{
   const a=blank(),b=blank();dart(b,58,90,true);
   const guess=detectTemporalDart(a,b);
   expect(guess).not.toBeNull();
   expect(guess!.x*W).toBeGreaterThan(58);
   expect(guess!.x*W).toBeLessThan(93);
 });
 it('recognizes a vivid shaft whose color changes but luminance stays nearly identical',()=>{
   const a=blank(95),b=blank(95);dart(b,58,90);
   for(let i=0;i<W*H;i++){
     const k=4*i;
     if(b.data[k]===238){b.data[k]=200;b.data[k+1]=50;b.data[k+2]=50;}
   }
   expect(detectTemporalDart(a,b)).not.toBeNull();
 });
 it('rejects large uniform cast shadows while still keeping colored dart shape',()=>{
   const a=blank(100),b=blank(100);
   for(let y=60;y<200;y++)for(let x=30;x<60;x++){
     const k=4*(y*W+x);
     b.data[k]=80;b.data[k+1]=80;b.data[k+2]=80;
   }
   expect(detectTemporalDart(a,b)).toBeNull();
 });
 it('detects the new shaft despite harmless per-pixel sensor noise',()=>{
   const a=blank(100),b=blank(100);dart(b,58,90);
   for(let i=0;i<W*H;i++){
     const k=4*i,jitter=((i*37)%13)-6;
     for(let c=0;c<3;c++)b.data[k+c]=Math.max(0,Math.min(255,b.data[k+c]+jitter));
   }
   expect(detectTemporalDart(a,b)).not.toBeNull();
 });
 it('does not mistake a stationary empty board or uniform auto-exposure change for a dart',()=>{
   expect(detectTemporalDart(blank(),blank())).toBeNull();
   expect(detectTemporalDart(blank(90),blank(121))).toBeNull();
 });
 it('does not call a large hand covering the board a dart',()=>{
   const a=blank(),b=blank();covers(b,35,40,180,185);
   expect(detectTemporalDart(a,b)).toBeNull();
 });
 it('returns one proposal only after the new scene settles, not every frame',()=>{
   const tracker=new TemporalDartTracker();const a=blank(),b=blank();dart(b,70,100);
   expect(tracker.observe(a,1000)).toBeNull();
   expect(tracker.observe(b,1230)).toBeNull();
   expect(tracker.observe(b,1470)).toBeNull();
   expect(tracker.observe(b,1710)).not.toBeNull();
   for(const now of [1950,2190,2430,2670])
      expect(tracker.observe(b,now)).toBeNull();
 });
 it('recovers an exposed 22-pixel shaft previously discarded as insignificant',()=>{
   const tracker=new TemporalDartTracker(),a=blank(),b=blank();
   for(let x=80;x<102;x++)dot(b,x,105,0);
   expect(tracker.observe(a,1000)).toBeNull();
   expect(tracker.observe(b,1240)).toBeNull();
   expect(tracker.observe(b,1480)).toBeNull();
   const recovered=tracker.observe(b,1720);
   expect(recovered).not.toBeNull();
   expect(recovered!.obscured).toBe(true);
   expect(tracker.observe(b,1960)).toBeNull();
 });
 it('tracks a second dart partially overlapping an earlier shaft',()=>{
   const tracker=new TemporalDartTracker();const a=blank(),b=blank();
   dart(b,62,90);tracker.observe(a,1000);tracker.observe(b,1240);
   tracker.observe(b,1480);expect(tracker.observe(b,1720)).not.toBeNull();
   const c={width:W,height:H,data:b.data.slice()};
   dart(c,78,120,true);
   tracker.observe(c,2200);tracker.observe(c,2450);
   expect(tracker.observe(c,2700)).not.toBeNull();
 });
 it('ignores an off-board moving shaft even if it is visually bigger',()=>{
   const a=blank(),b=blank();
   // Two newly moved objects: only the right one is on the mapped board.
   dart(b,33,71);dart(b,148,145);
   const found=detectTemporalDart(a,b,(x)=>x>.5);
   expect(found).not.toBeNull();
   expect(found!.x).toBeGreaterThan(.5);
   expect(detectTemporalDart(a,b,(_x,y)=>y<.05)).toBeNull();
 });
 it('filters a wall dart while preserving the next genuine board dart',()=>{
   const tracker=new TemporalDartTracker();
   const a=blank(),b=blank();dart(b,33,71);dart(b,148,145);
   tracker.observe(a,1000, x=>x>.5);
   tracker.observe(b,1250,x=>x>.5);
   tracker.observe(b,1500,x=>x>.5);
   const found=tracker.observe(b,1750,x=>x>.5);
   expect(found).not.toBeNull();
   expect(found!.x).toBeGreaterThan(.5);
 });
 it('rejects an invalid frame and never accesses out-of-range pixels',()=>{
   expect(detectTemporalDart(blank(),{width:30,height:30,data:new Uint8Array(25)})).toBeNull();
 });
});
