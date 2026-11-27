import type { BoardTip } from '../../shared/vision/types';
import type { TemporalFrame } from './temporalDartEvidence';

/**
 * The original server matches known physical tips one-to-one. This is a
 * complementary IMAGE guard for redundant model reports in the same VISIT:
 * no new pixels + the same mapped tips = nothing new to tell the server.
 *
 * We compare the full (locally cropped) board image, not only a tip coordinate.
 * A new dart a few millimeters from the old one changes pixels, so the pair
 * continues to the server's one-to-one matcher. Images never leave the phone.
 */
export const VISUAL_DUPLICATE_MAX_CHANGED=0.0007;
export const VISUAL_DUPLICATE_RETRY_MS=2400;
export const VISUAL_DUPLICATE_TIP_RADIUS=14500;
export const RAPID_RECOVERY_POLL_MS=125;
export const RAPID_RECOVERY_FAST_GAP_MS=800; // match IdleTipRecovery's independent-sample gate
export const RAPID_RECOVERY_NORMAL_GAP_MS=950;
export const RAPID_RECOVERY_HINT_LIFETIME_MS=3800;

function median(data:number[]):number {
  data.sort((a,b)=>a-b);
  return data[data.length>>1]??0;
}

export function boardImageChangedFraction(a:TemporalFrame,b:TemporalFrame):number {
  if(a.width!==b.width || a.height!==b.height ||
    a.data.length!==b.data.length || a.data.length!==a.width*a.height*4) return 1;
  const total=a.width*a.height, r:number[]=[],g:number[]=[],bl:number[]=[];
  const A=a.data,B=b.data;
  for(let i=0;i<total;i+=37){
    const k=4*i;
    r.push(B[k]-A[k]);g.push(B[k+1]-A[k+1]);bl.push(B[k+2]-A[k+2]);
  }
  const dr=median(r),dg=median(g),db=median(bl);
  let changed=0;
  for(let i=0;i<total;i++){
    const k=4*i;
    if(Math.max(
      Math.abs(B[k]-A[k]-dr),
      Math.abs(B[k+1]-A[k+1]-dg),
      Math.abs(B[k+2]-A[k+2]-db)
    )>26)changed++;
  }
  return changed/total;
}

/** Exact one-to-one positional matching with jitter tolerance. This must
 * never replace the server's matchKnownCameraTips: it only decides whether
 * an identical FULL batch can skip a redundant client report. */
export function sameTipSet(a:readonly BoardTip[],b:readonly BoardTip[]):boolean {
  if(a.length!==b.length)return false;
  const taken=new Set<number>();
  for(const tip of a){
    if(!Number.isFinite(tip.x)||!Number.isFinite(tip.y))return false;
    let bestIndex=-1,bestDistance=VISUAL_DUPLICATE_TIP_RADIUS;
    for(let j=0;j<b.length;j++){
      if(taken.has(j))continue;
      const other=b[j];
      const d=Math.hypot(tip.x-other.x,tip.y-other.y);
      if(d<bestDistance){bestDistance=d;bestIndex=j;}
    }
    if(bestIndex<0)return false;
    taken.add(bestIndex);
  }
  return true;
}

export class VisualScoringDeduper {
  private key='';
  private lastFrame:TemporalFrame|null=null;
  private lastTips:BoardTip[]=[];
  private lastPublishedAt=0;
  reset():void {
    this.key='';this.lastFrame=null;this.lastTips=[];this.lastPublishedAt=0;
  }
  /**
   * Empty is deliberately never filtered. Takeout, board reassignment, and
   * multi-camera emptiness must still see their verification frames.
   * Without a fresh camera image or valid visit identity, the safe fallback
   * is the existing server-side repeat guard, not blind suppression.
   */
  shouldForward(key:string,tips:readonly BoardTip[],
    frame:TemporalFrame|null,now:number):boolean {
    if(key!==this.key){this.reset();this.key=key;}
    if(!tips.length||!frame||!key||!Number.isFinite(now)||now<=0)return true;
    const unchanged=this.lastFrame!==null &&
      sameTipSet(tips,this.lastTips) &&
      boardImageChangedFraction(this.lastFrame,frame)<=VISUAL_DUPLICATE_MAX_CHANGED;
    if(unchanged && now-this.lastPublishedAt<VISUAL_DUPLICATE_RETRY_MS)
      return false;
    this.lastFrame=frame;
    this.lastTips=tips.map(t=>({...t}));
    this.lastPublishedAt=now;
    return true;
  }
}

/** New settled dart-shaped pixels get two early confirmatory model scans.
 * The existing 2-strong / 3-weak independent-inference requirements are
 * unchanged. On an idle board, we retain the existing 950ms cadence.
 * Busy/stale inference is not consumed as positive evidence.
 */
export class RapidVisualRecovery {
  private lastCompleted=0;
  private fastRemaining=0;
  private lastHint=0;
  reset():void {
    this.lastCompleted=0;this.fastRemaining=0;this.lastHint=0;
  }
  newPhysicalDart(now:number):void {
    if(!Number.isFinite(now)||now<=0)return;
    if(this.lastHint && now-this.lastHint<400)return;
    this.lastHint=now;this.fastRemaining=2;
  }
  shouldProbe(now:number,eligible:boolean):boolean {
    if(!eligible||!Number.isFinite(now)||now<=0)return false;
    if(this.fastRemaining>0 && now-this.lastHint>RAPID_RECOVERY_HINT_LIFETIME_MS)
      this.fastRemaining=0;
    const gap=this.fastRemaining>0
      ? RAPID_RECOVERY_FAST_GAP_MS:RAPID_RECOVERY_NORMAL_GAP_MS;
    return !this.lastCompleted || now-this.lastCompleted>=gap;
  }
  finished(now:number,completed:boolean):void {
    if(!completed||!Number.isFinite(now)||now<=0)return;
    this.lastCompleted=now;
    if(this.fastRemaining>0)this.fastRemaining--;
  }
  get pendingFastProbes():number{return this.fastRemaining;}
}
