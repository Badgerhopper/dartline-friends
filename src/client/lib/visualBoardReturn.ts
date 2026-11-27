import type { TemporalFrame } from './temporalDartEvidence';

/** Independent, local physical evidence that the dartboard returned to its
 * pre-throw appearance. Does not depend on AI seeing the dart tip or on a
 * hand crossing a 48px motion grid. This NEVER submits or scores anything:
 * the existing server still demands two separate empty, board-located scans.
 */
export const BOARD_RETURN_MIN_CHANGED=0.0012;
export const BOARD_RETURN_MAX_EMPTY_CHANGED=0.00065;
export const BOARD_RETURN_MIN_HOLD_MS=650;
const PIXEL_CHANGE=26;
const SAMPLE_STEP=1; // exactly 256x256 for reliable thin flight evidence

function median(a:number[]):number {
  a.sort((x,y)=>x-y);
  return a[a.length>>1]||0;
}
function difference(a:TemporalFrame,b:TemporalFrame,roi:Uint8Array|null=null):number {
  if(a.width!==b.width||a.height!==b.height||
     a.data.length!==b.data.length)return 1;
  const n=a.width*a.height;
  const rs:number[]=[],gs:number[]=[],bs:number[]=[];
  // Exposure shifts and some white-balance changes affect the entire image.
  // Subtract them independently, without erasing same-brightness colored darts.
  for(let i=0;i<n;i+=37) {
    if(roi&&!roi[i])continue;
    const k=i*4;
    rs.push(b.data[k]-a.data[k]);
    gs.push(b.data[k+1]-a.data[k+1]);
    bs.push(b.data[k+2]-a.data[k+2]);
  }
  const ro=median(rs),go=median(gs),bo=median(bs);
  // Uniformly occluded camera frames, overexposure or a covered lens
  // cannot be treated as the original empty board. The same subtraction
  // that makes modest auto-exposure changes harmless otherwise erases
  // the evidence of a FULL-frame obstruction.
  if(Math.max(Math.abs(ro),Math.abs(go),Math.abs(bo))>45) return 1;
  let changed=0,total=0;
  const mask=new Uint8Array(n);
  for(let i=0;i<n;i+=SAMPLE_STEP){
    if(roi&&!roi[i])continue;
    const k=i*4;
    const d=Math.max(
      Math.abs(b.data[k]-a.data[k]-ro),
      Math.abs(b.data[k+1]-a.data[k+1]-go),
      Math.abs(b.data[k+2]-a.data[k+2]-bo));
    if(d>PIXEL_CHANGE){changed++;mask[i]=1;}
    total++;
  }
  if(!total)return 1;
  // A real camera has scattered compression/sensor speckles. The old
  // comparison rejected an otherwise identical 256px board after only
  // 43 noisy pixels. Ignore isolated speckles ONLY in a low-change scene;
  // preserve connected changes (including thin shafts) as occupied evidence.
  if(changed/total>0.003 || !changed)return changed/total;
  let coherent=0;
  const w=a.width,h=a.height;
  for(let i=0;i<n;i++){
    if(!mask[i])continue;
    const x=i%w,y=Math.floor(i/w);
    let neighbor=false;
    for(let dy=-1;dy<=1&&!neighbor;dy++)for(let dx=-1;dx<=1;dx++){
      if(!dx&&!dy)continue;
      const xx=x+dx,yy=y+dy;
      if(xx>=0&&xx<w&&yy>=0&&yy<h&&mask[yy*w+xx]){neighbor=true;break;}
    }
    if(neighbor)coherent++;
  }
  // Even a partly hidden dart can leave fewer than 43 changed pixels.
  // A coherent set of >=12 is not safe empty-board proof.
  if(coherent>=12)return Math.max(changed/total,BOARD_RETURN_MIN_CHANGED);
  return coherent/total;
}
export class VisualBoardReturn {
  private roi:Uint8Array|null=null;
  private empty:TemporalFrame|null=null;
  private prior:TemporalFrame|null=null;
  private occupied=false;
  private quietSince=0;
  private confirmed=false;
  private trustedEmpty=false;
  reset():void {
    this.roi=null;this.empty=null;this.prior=null;this.occupied=false;
    this.quietSince=0;this.confirmed=false;this.trustedEmpty=false;
  }
  startNextVisit():void {
    // Keep a genuinely verified empty reference on the same camera.
    // This prevents a fast first throw on the next turn poisoning the baseline.
    if(!this.trustedEmpty){this.reset();return;}
    this.prior=null;this.occupied=false;this.quietSince=0;this.confirmed=false;
  }
  setRegion(mask:Uint8Array):void {
    // Freeze the first validated board region. A moving camera cannot keep
    // redefining the area used for the empty-board comparison.
    if(!this.roi && mask.length===256*256 && mask.reduce((a,b)=>a+(b?1:0),0)>=4096)
      this.roi=mask.slice();
  }
  observe(frame:TemporalFrame,recordedDarts:number,now:number):boolean {
    if(!Number.isFinite(now)||now<=0 ||
       frame.width!==256||frame.height!==256)return false;
    if(recordedDarts===0){
      // Capture only a stable board at the beginning of THIS visit.
      // Capture the first stable EMPTY appearance and then FREEZE it for
      // this visit. The first dart can physically arrive before its score
      // reaches the HUD; repeatedly overwriting the reference while
      // recordedDarts===0 would silently make a dart-filled board "empty".
      if(!this.empty && this.prior && difference(this.prior,frame,this.roi) <= 0.0007){
        this.empty=frame;
      }
      this.prior=frame;
      this.occupied=false;
      this.quietSince=0;
      return false;
    }
    if(!this.empty)return false;
    const changed=difference(this.empty,frame,this.roi);
    if(this.confirmed){
      if(changed<=BOARD_RETURN_MAX_EMPTY_CHANGED && recordedDarts===3)return false;
      // A new obstruction invalidates the hold. The next genuinely clear
      // sequence must settle again instead of reusing an old clear event.
      this.confirmed=false;this.quietSince=0;
    }
    if(recordedDarts<3){
      if(changed>=BOARD_RETURN_MIN_CHANGED && changed<0.14)
        this.occupied=true;
      return false;
    }
    if(changed>=BOARD_RETURN_MIN_CHANGED && changed<0.14)
      this.occupied=true;
    if(!this.occupied || changed>BOARD_RETURN_MAX_EMPTY_CHANGED){
      this.quietSince=0;
      return false;
    }
    // A single blank, blurred or exposure-shifted frame cannot end a turn.
    if(this.quietSince===0){this.quietSince=now;return false;}
    if(now-this.quietSince>=BOARD_RETURN_MIN_HOLD_MS){
      this.confirmed=true;this.trustedEmpty=true;return true;
    }
    return false;
  }
  /** Strong proof is tied to THIS photo, not just a prior confirmed event.
   * A moved camera, new dart or hand in the frame cannot reuse old proof. */
  matchesCurrentEmpty(frame:TemporalFrame,recordedDarts:number):boolean {
    return recordedDarts===3 && this.confirmed && this.occupied &&
      this.empty!==null && frame.width===256 && frame.height===256 &&
      difference(this.empty,frame,this.roi)<=BOARD_RETURN_MAX_EMPTY_CHANGED;
  }
  get emptyReference():TemporalFrame|null{return this.empty;}
  get hasRegion():boolean{return this.roi!==null;}
  get hasEmptyReference():boolean{return this.empty!==null;}
  get hasSeenPhysicalDarts():boolean{return this.occupied;}
}
