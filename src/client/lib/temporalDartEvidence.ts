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
export const TEMPORAL_POLL_MS=160;
const MIN_COMPONENT=16;
const MAX_CHANGE_FRACTION=0.115;
const MIN_LENGTH=17;
const MAX_WIDTH=24;
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
  /** Unit direction from the flight toward the narrow front end. */
  axis?:{x:number;y:number;ratio:number};
  hiddenRange?:{startX:number;startY:number;endX:number;endY:number};
  recordedBefore?:number;
}
function median(values:number[]):number {
  if(!values.length)return 0;
  values.sort((a,b)=>a-b);
  return values[values.length>>1];
}
/** Distinguish new colored flights from similar-luminance board segments,
 * compensate auto-exposure separately in RGB, and reject broad cast shadows.
 */
function delta(before:TemporalFrame,after:TemporalFrame) {
  const a=before.data,b=after.data,n=before.width*before.height;
  const rs:number[]=[],gs:number[]=[],bs:number[]=[];
  for(let i=0;i<n;i+=29){
    const k=i*4;rs.push(b[k]-a[k]);
    gs.push(b[k+1]-a[k+1]);bs.push(b[k+2]-a[k+2]);
  }
  const ro=median(rs),go=median(gs),bo=median(bs);
  const noise:number[]=[];
  for(let i=0;i<n;i+=43){
    const k=i*4;
    noise.push(Math.max(
      Math.abs(b[k]-a[k]-ro),
      Math.abs(b[k+1]-a[k+1]-go),
      Math.abs(b[k+2]-a[k+2]-bo)));
  }
  const threshold=Math.max(14,median(noise)*3+7);
  const bin=new Uint8Array(n);
  let changed=0;
  for(let i=0;i<n;i++){
    const k=i*4;
    const oldR=a[k],oldG=a[k+1],oldB=a[k+2];
    const newR=b[k]-ro,newG=b[k+1]-go,newB=b[k+2]-bo;
    const difference=Math.max(
      Math.abs(newR-oldR),Math.abs(newG-oldG),Math.abs(newB-oldB));
    if(difference<=threshold)continue;
    // A broad common darkening with little hue shift is a cast shadow,
    // not a newly arrived shaft. Keep changes that actually alter color.
    const oldSum=oldR+oldG+oldB,newSum=newR+newG+newB;
    if(oldSum>120 && newR<oldR && newG<oldG && newB<oldB){
      const kShadow=newSum/oldSum;
      // Narrow dark steel shafts are often achromatic too. Preserve their
      // pixels; reject broad shadows by connected shape instead.
      if(kShadow>0.90 && kShadow<1){
        const hueError=Math.max(
          Math.abs(newR-oldR*kShadow),
          Math.abs(newG-oldG*kShadow),
          Math.abs(newB-oldB*kShadow));
        if(hueError<14)continue;
      }
    }
    bin[i]=1;changed++;
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
  return {x:px/w,y:py/h,confidence,length,area:n,changeFraction,obscured:ratio<1.5,
    axis:{x:nearTip?-ux:ux,y:nearTip?-uy:uy,ratio}};
}
/** Reject global motion and hands, prefer thin elongated new darts. */
export function detectTemporalDart(before:TemporalFrame,after:TemporalFrame,
  accept?:(x:number,y:number)=>boolean):TemporalGuess|null {
  if(before.width!==after.width||before.height!==after.height ||
     before.data.length!==before.width*before.height*4 ||
     after.data.length!==after.width*after.height*4)return null;
  return detectFromDelta(before,delta(before,after),accept);
}
function detectFromDelta(before:TemporalFrame,d:ReturnType<typeof delta>,
  accept?:(x:number,y:number)=>boolean):TemporalGuess|null {
  if(d.fraction>MAX_CHANGE_FRACTION||d.fraction<0.00015)return null;
  const parts=components(d.bin,before.width,before.height);
  let best:TemporalGuess|null=null;
  for(const part of parts){
    const candidate=fitShape(part,before.width,before.height,d.fraction);
    if(!candidate || (accept && !accept(candidate.x,candidate.y)))continue;
    if(!best || candidate.area*candidate.confidence > best.area*best.confidence)
      best=candidate;
  }
  return best;
}
/** Extend the shaft ONLY into a region already occupied before this throw.
 * A broad flight identifies direction; the previous empty board distinguishes
 * an existing dart from the printed wires. Do not guess an arbitrary length.
 * The entire hidden interval remains available for uncertainty-aware scoring.
 */
export function extrapolateOccludedTip(guess:TemporalGuess,before:TemporalFrame,
  empty:TemporalFrame|null):TemporalGuess {
  const axis=guess.axis;
  if(!empty||!axis||axis.ratio<1.35||guess.length<17||guess.confidence<.60||
     empty.width!==before.width||empty.height!==before.height||
     empty.data.length!==before.data.length)return guess;
  const w=before.width,h=before.height;
  const foreground=delta(empty,before);
  if(foreground.fraction>.115)return guess;
  const x=guess.x*w,y=guess.y*h;
  const occupied=(d:number)=>{
    for(let lateral=-1;lateral<=1;lateral++){
      const xx=Math.round(x+axis.x*d-axis.y*lateral);
      const yy=Math.round(y+axis.y*d+axis.x*lateral);
      if(xx>=0&&xx<w&&yy>=0&&yy<h&&foreground.bin[yy*w+xx])return true;
    }
    return false;
  };
  let first=-1,last=-1;
  for(let d=0;d<=24;d++){
    if(occupied(d)){if(first<0)first=d;last=d;}
    else if(first>=0&&d-last>=2)break;
    else if(first<0&&d>=5)break;
  }
  if(first<0||first>5||last-first<1||last>=23)return guess;
  const end=last+2;
  const endX=(x+axis.x*end)/w,endY=(y+axis.y*end)/h;
  if(endX<=0||endX>=1||endY<=0||endY>=1)return guess;
  return {...guess,x:(guess.x+endX)/2,y:(guess.y+endY)/2,obscured:true,
    hiddenRange:{startX:guess.x,startY:guess.y,endX,endY}};
}
export class TemporalDartTracker {
  private baseline:TemporalFrame|null=null;
  private prior:TemporalFrame|null=null;
  private quiet=0;
  private lastDecision=0;
  private baselineCount=0;
  reset():void {this.baseline=null;this.prior=null;this.quiet=0;this.lastDecision=0;this.baselineCount=0;}
  observe(frame:TemporalFrame,now:number,
    accept?:(x:number,y:number)=>boolean,recordedDarts=0,empty:TemporalFrame|null=null):TemporalGuess|null {
    if(!Number.isFinite(now)||now<=0)return null;
    if(!this.baseline){this.baseline=frame;this.prior=frame;this.baselineCount=recordedDarts;return null;}
    if(!this.prior){this.prior=frame;return null;}
    if(this.prior.width!==frame.width||this.prior.height!==frame.height||
       frame.data.length!==frame.width*frame.height*4){this.reset();return null;}
    const moving=delta(this.prior,frame);
    const motion=moving.fraction;
    // Compression noise and minor flicker are often scattered across the
    // board. A coherent moving component, not ten arbitrary pixels, is
    // what should prevent a settled throw from being evaluated.
    const coherentMotion=motion>0.008 || (motion>0.00015 &&
      components(moving.bin,frame.width,frame.height).some(p=>p.length>=16));
    // Even a narrow new shaft changes much less than 1% of 256px pixels.
    // 1.2% incorrectly marked the actual arrival as a quiet frame.
    this.quiet=coherentMotion?0:this.quiet+1;
    this.prior=frame;
    if(this.quiet<2||now-this.lastDecision<500)return null;
    if(this.baseline.width!==frame.width||this.baseline.height!==frame.height||
       frame.data.length!==frame.width*frame.height*4){this.reset();return null;}
    // Reuse the baseline difference for shape extraction rather than doing
    // a second full RGB comparison on the same pair. A short exposed shaft
    // may change fewer than 46 pixels when a nearby dart hides the rest.
    const change=delta(this.baseline,frame);
    const diff=change.fraction;
    if(diff<0.00025){this.baselineCount=recordedDarts;return null;}
    // A hand covering much of the board is not a throw, and must not
    // become a new baseline. Wait until the hand exits.
    if(diff>MAX_CHANGE_FRACTION)return null;
    const raw=detectFromDelta(this.baseline,change,accept);
    const guess=raw?{...extrapolateOccludedTip(raw,this.baseline,empty),recordedBefore:this.baselineCount}:null;
    // A missed segmentation is NOT a new baseline. Keep the original
    // pre-impact photo so subsequent settled frames can recover a weak shaft.
    if(!guess){
      if(recordedDarts!==this.baselineCount){this.baseline=frame;this.baselineCount=recordedDarts;}
      return null;
    }
    this.lastDecision=now;
    this.baseline=frame;
    this.baselineCount=recordedDarts;
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
