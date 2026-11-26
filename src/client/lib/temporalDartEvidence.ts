/** Temporal camera evidence from two settled, on-device frames.
 *
 * A static neural network cannot tell a newly arrived, occluded shaft from an
 * older one. Comparing the camera's previous settled image to the new one is
 * independent evidence. This is an ORIGINAL small image-difference detector;
 * no other project's code or models are bundled. It only proposes an
 * approximate tip when the physical point is not fully visible.
 *
 * Images remain inside the scoring iframe. No recording, telemetry, upload,
 * server-side CV, or extra network requests are performed.
 */
export const TEMPORAL_SIZE=256;
export const TEMPORAL_POLL_MS=240;
const MIN_COMPONENT=16;
const MAX_CHANGE_FRACTION=0.115;
const MIN_LENGTH=17;
const MAX_WIDTH=24;
const THRESHOLD=24;
export interface TemporalFrame {
  width:number;
  height:number;
  data:Uint8Array;
}
export interface TemporalGuess {
  x:number; y:number; // normalized CENTER-SQUARE image coordinate
  confidence:number; // shape quality, not calibrated model probability
  length:number; area:number; changeFraction:number;
  obscured:boolean;
}
function luma(frame:TemporalFrame):Float32Array {
  const out=new Float32Array(frame.width*frame.height);
  for(let i=0,j=0;i<out.length;i++,j+=4)
    out[i]=frame.data[j]*0.299+frame.data[j+1]*0.587+frame.data[j+2]*0.114;
  return out;
}
function median(values:number[]):number {
  if(!values.length)return 0;
  values.sort((a,b)=>a-b);
  return values[values.length>>1];
}
function delta(before:TemporalFrame,after:TemporalFrame) {
  const a=luma(before),b=luma(after),n=a.length;
  const samples:number[]=[];
  for(let i=0;i<n;i+=31) samples.push(b[i]-a[i]);
  const global=median(samples);
  const bin=new Uint8Array(n);
  let changed=0;
  for(let i=0;i<n;i++){
    // Remove whole-frame auto-exposure shifts but retain small structures.
    const difference=Math.abs(b[i]-a[i]-global);
    if(difference>THRESHOLD){bin[i]=1;changed++;}
  }
  return {bin,fraction:changed/n};
}
function components(mask:Uint8Array,w:number,h:number):number[][] {
  const seen=new Uint8Array(mask.length),stack:number[]=[],out:number[][]=[];
  for(let index=0;index<mask.length;index++){
    if(!mask[index]||seen[index])continue;
    const pts:number[]=[];stack.push(index);seen[index]=1;
    while(stack.length){
      const p=stack.pop()!;
      pts.push(p);
      const x=p%w,y=Math.floor(p/w);
      for(let dy=-1;dy<=1;dy++){
        for(let dx=-1;dx<=1;dx++){
          if(dx===0&&dy===0)continue;
          const xx=x+dx,yy=y+dy;
          if(xx<0||xx>=w||yy<0||yy>=h)continue;
          const at=yy*w+xx;
          if(mask[at]&&!seen[at]){seen[at]=1;stack.push(at);}
        }
      }
    }
    if(pts.length>=MIN_COMPONENT)out.push(pts);
  }
  return out;
}
function fitShape(pts:number[],w:number,h:number,changeFraction:number):TemporalGuess|null {
  const n=pts.length;
  if(n<MIN_COMPONENT)return null;
  let cx=0,cy=0;
  for(const p of pts){cx+=p%w;cy+=Math.floor(p/w);}
  cx/=n;cy/=n;
  let xx=0,yy=0,xy=0;
  for(const p of pts){
    const dx=p%w-cx,dy=Math.floor(p/w)-cy;
    xx+=dx*dx;yy+=dy*dy;xy+=dx*dy;
  }
  xx/=n;yy/=n;xy/=n;
  const theta=0.5*Math.atan2(2*xy,xx-yy);
  const ux=Math.cos(theta),uy=Math.sin(theta);
  const trace=xx+yy,disc=Math.sqrt(Math.max(0,(xx-yy)**2+4*xy*xy));
  const major=(trace+disc)/2,minor=Math.max(0.25,(trace-disc)/2);
  const elongation=major/minor;
  if(elongation<3.1)return null;
  let near=Infinity,far=-Infinity,minPerp=Infinity,maxPerp=-Infinity;
  const proj:number[]=[],perp:number[]=[];
  for(const p of pts){
    const dx=p%w-cx,dy=Math.floor(p/w)-cy;
    const along=dx*ux+dy*uy,across=-dx*uy+dy*ux;
    proj.push(along);perp.push(across);
    if(along<near)near=along;
    if(along>far)far=along;
    if(across<minPerp)minPerp=across;
    if(across>maxPerp)maxPerp=across;
  }
  const length=far-near,width=maxPerp-minPerp;
  if(length<MIN_LENGTH||width>MAX_WIDTH||width>length/2.0)return null;
  const band=Math.max(3,length*0.17);
  let nearCount=0,farCount=0,nearSum=0,farSum=0;
  for(let i=0;i<proj.length;i++){
    if(proj[i]<near+band){nearCount++;nearSum+=perp[i];}
    if(proj[i]>far-band){farCount++;farSum+=perp[i];}
  }
  if(!nearCount||!farCount)return null;
  // Usually the flight is broader than the shaft. Select the thinner tail
  // of the changed silhouette as the point. If ambiguous, mark tentative.
  const nearTip=nearCount<=farCount;
  const ratio=Math.max(nearCount,farCount)/Math.max(1,Math.min(nearCount,farCount));
  const t=nearTip?near:far;
  const other=nearTip?nearSum/nearCount:farSum/farCount;
  const px=cx+t*ux-other*uy;
  const py=cy+t*uy+other*ux;
  if(px<1||px>=w-1||py<1||py>=h-1)return null;
  const confidence=Math.min(0.94,
    0.28 +Math.min(0.31,Math.log2(elongation)*0.095)
    +Math.min(0.23,Math.log2(ratio)*0.17)
    +Math.min(0.12,length/500));
  return {x:px/w,y:py/h,confidence,length,area:n,changeFraction,obscured:ratio<1.5};
}
/** Reject global motion and hands, prefer thin elongated new darts. */
export function detectTemporalDart(before:TemporalFrame,after:TemporalFrame):TemporalGuess|null {
  if(before.width!==after.width||before.height!==after.height ||
     before.data.length!==before.width*before.height*4 ||
     after.data.length!==after.width*after.height*4)return null;
  const d=delta(before,after);
  if(d.fraction>MAX_CHANGE_FRACTION||d.fraction<0.00015)return null;
  const parts=components(d.bin,before.width,before.height);
  let best:TemporalGuess|null=null;
  for(const part of parts){
    const candidate=fitShape(part,before.width,before.height,d.fraction);
    if(!candidate)continue;
    if(!best || candidate.area*candidate.confidence > best.area*best.confidence)
      best=candidate;
  }
  return best;
}
function fractionChanged(a:TemporalFrame,b:TemporalFrame):number {
  if(a.width!==b.width||a.height!==b.height)return 1;
  return delta(a,b).fraction;
}
export class TemporalDartTracker {
  private baseline:TemporalFrame|null=null;
  private prior:TemporalFrame|null=null;
  private quiet=0;
  private lastDecision=0;
  reset():void {this.baseline=null;this.prior=null;this.quiet=0;this.lastDecision=0;}
  observe(frame:TemporalFrame,now:number):TemporalGuess|null {
    if(!Number.isFinite(now)||now<=0)return null;
    if(!this.baseline){this.baseline=frame;this.prior=frame;return null;}
    if(!this.prior){this.prior=frame;return null;}
    const motion=fractionChanged(this.prior,frame);
    // Even a narrow new shaft changes much less than 1% of 256px pixels.
    // 1.2% incorrectly marked the actual arrival as a quiet frame.
    this.quiet=motion<0.00045?this.quiet+1:0;
    this.prior=frame;
    if(this.quiet<2||now-this.lastDecision<500)return null;
    const diff=fractionChanged(this.baseline,frame);
    if(diff<0.0007)return null;
    // A hand covering much of the board is not a throw, and must not
    // become a new baseline. Wait until the hand exits.
    if(diff>MAX_CHANGE_FRACTION)return null;
    const guess=detectTemporalDart(this.baseline,frame);
    this.lastDecision=now;
    // Advance only on a stable after-frame; each physical change is proposed
    // once. The server never scores the raw suggestion automatically.
    this.baseline=frame;
    return guess;
  }
}
export function readTemporalCamera(
  video:HTMLVideoElement|null, canvas:HTMLCanvasElement
):TemporalFrame|null {
  if(!video||video.readyState<2||!video.videoWidth||!video.videoHeight)return null;
  if(canvas.width!==TEMPORAL_SIZE)canvas.width=TEMPORAL_SIZE;
  if(canvas.height!==TEMPORAL_SIZE)canvas.height=TEMPORAL_SIZE;
  const ctx=canvas.getContext('2d',{willReadFrequently:true});
  if(!ctx)return null;
  try{
    const side=Math.min(video.videoWidth,video.videoHeight);
    ctx.drawImage(video,(video.videoWidth-side)/2,
      (video.videoHeight-side)/2,side,side,0,0,TEMPORAL_SIZE,TEMPORAL_SIZE);
    return {width:TEMPORAL_SIZE,height:TEMPORAL_SIZE,
      data:new Uint8Array(ctx.getImageData(0,0,TEMPORAL_SIZE,TEMPORAL_SIZE).data)};
  }catch{return null;}
}
