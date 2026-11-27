import { detectTemporalDart, type TemporalFrame } from './temporalDartEvidence';

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
  if(changed/total>0.025 || !changed)return changed/total;
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
  // Reject an actual connected shape, not a sum of dozens of disjoint
  // two-pixel compression artifacts. Preserve thin retained shafts.
  if(coherent>=12){
    const seen=new Uint8Array(n),stack:number[]=[];
    for(let i=0;i<n;i++){
      if(!mask[i]||seen[i])continue;
      seen[i]=1;stack.push(i);let count=0;
      while(stack.length){
        const p=stack.pop()!;count++;
        if(count>=12)return Math.max(changed/total,BOARD_RETURN_MIN_CHANGED);
        const x=p%w,y=Math.floor(p/w);
        for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
          const xx=x+dx,yy=y+dy;
          if(xx<0||xx>=w||yy<0||yy>=h)continue;
          const j=yy*w+xx;if(mask[j]&&!seen[j]){seen[j]=1;stack.push(j);}
        }
      }
    }
  }
  return 0;
}
export class VisualBoardReturn {
  private roi:Uint8Array|null=null;
  private empty:TemporalFrame|null=null;
  private prior:TemporalFrame|null=null;
  private occupied=false;
  private quietSince=0;
  private confirmed=false;
  private lastComparison=1;
  private emptyScanAt=0;
  private emptyScan:TemporalFrame|null=null;
  // Keep an actually observed occupied image independently of whether
  // initial empty calibration succeeded. Two located zero-tip scans must
  // corroborate a stable changed scene before it can witness retrieval.
  private occupiedPhoto:TemporalFrame|null=null;
  private removalCandidate:TemporalFrame|null=null;
  private removalCandidateAt=0;
  private verifiedReturn:TemporalFrame|null=null;
  private votedEmpty:TemporalFrame|null=null;
  reset():void {
    this.roi=null;this.empty=null;this.prior=null;this.occupied=false;
    this.quietSince=0;this.confirmed=false;this.lastComparison=1;this.emptyScanAt=0;this.emptyScan=null;
    this.occupiedPhoto=null;this.removalCandidate=null;this.removalCandidateAt=0;
    this.verifiedReturn=null;this.votedEmpty=null;
  }
  startNextVisit():void {
    // Keep a genuinely verified empty reference on the same camera.
    // This prevents a fast first throw on the next turn poisoning the baseline.
    // Preserve the initial reference even when the player manually
    // submitted the preceding turn. It is the same fixed physical board;
    // a failed auto-submit must not poison the reference for every later turn.
    // A physically witnessed, model-confirmed takeout may have completed
    // the very first round before initial calibration was possible.
    // Promote its image only at the authoritative visit boundary.
    if(!this.empty&&this.votedEmpty)this.empty=this.votedEmpty;
    this.occupiedPhoto=null;this.removalCandidate=null;this.removalCandidateAt=0;
    this.verifiedReturn=null;this.votedEmpty=null;
    if(!this.empty){this.prior=null;this.occupied=false;this.quietSince=0;
      this.confirmed=false;this.emptyScanAt=0;this.emptyScan=null;return;}
    this.prior=null;this.occupied=false;this.quietSince=0;this.confirmed=false;
    this.emptyScanAt=0;this.emptyScan=null;
  }
  setRegion(mask:Uint8Array):void {
    // Freeze the first validated board region. A moving camera cannot keep
    // redefining the area used for the empty-board comparison.
    if(!this.roi && mask.length===256*256 && mask.reduce((a,b)=>a+(b?1:0),0)>=4096)
      this.roi=mask.slice();
  }
  /** Two independent board-located model scans with no relaxed on-board
   * tips can bootstrap the reference even when camera noise prevents two
   * adjacent raw frames from matching. Only used before the first score.
   * A positive/unlocated scan cancels the pending reference. */
  /** Explicit confirmation by the player with an actually empty board.
   * Caller validates the owned zero-dart visit, camera pose and frame age.
   * This never submits a turn and never treats a scored dart as empty. */
  confirmUserEmpty(frame:TemporalFrame,recordedDarts:number):boolean {
    if(recordedDarts!==0||frame.width!==256||frame.height!==256||
       frame.data.length!==256*256*4)return false;
    this.empty=frame;this.prior=frame;
    this.occupied=false;this.confirmed=false;this.quietSince=0;
    this.emptyScan=null;this.emptyScanAt=0;this.lastComparison=0;
    return true;
  }
  observeLocatedEmpty(frame:TemporalFrame|null,empty:boolean,now:number):boolean {
    if(this.empty)return true;
    if(!empty||!frame||frame.width!==256||frame.height!==256||
       frame.data.length!==256*256*4||!Number.isFinite(now)||now<=0){
      this.emptyScan=null;this.emptyScanAt=0;return false;
    }
    if(this.emptyScan && now-this.emptyScanAt>=250 &&
       now-this.emptyScanAt<=5000 &&
       difference(this.emptyScan,frame,this.roi)<=0.008){
      this.empty=frame;this.emptyScan=null;this.emptyScanAt=0;return true;
    }
    if(!this.emptyScan||now-this.emptyScanAt>=250){
      this.emptyScan=frame;this.emptyScanAt=now;
    }
    return false;
  }
  /** Independent model snapshots, rather than a hand crossing a particular
   * motion grid. Occupied evidence is retained across arming at dart three.
   * A stationary blind model cannot pass the changed-scene requirement. */
  observeRemovalScan(frame:TemporalFrame|null,kind:'occupied'|'empty'|'unlocated',
    count:number,now:number):boolean {
    if(kind==='unlocated'||!frame||frame.width!==256||frame.height!==256||
       frame.data.length!==256*256*4||!Number.isFinite(now)||count<1||count>3){
      this.removalCandidate=null;this.removalCandidateAt=0;this.verifiedReturn=null;this.votedEmpty=null;
      return false;
    }
    if(kind==='occupied'){
      this.occupiedPhoto=frame;this.removalCandidate=null;
      this.removalCandidateAt=0;this.verifiedReturn=null;this.votedEmpty=null;
      return false;
    }
    if(count!==3||!this.occupiedPhoto)return false;
    const changed=difference(this.occupiedPhoto,frame,this.roi);
    // A moved/covered camera or an unchanged occupied board is not removal.
    if(changed<BOARD_RETURN_MIN_CHANGED||changed>=0.14){
      this.removalCandidate=null;this.removalCandidateAt=0;this.verifiedReturn=null;return false;
    }
    // Require disappearance of a previously visible elongated object,
    // not just a change in lighting or a hand passing through.
    if(!detectTemporalDart(frame,this.occupiedPhoto)){
      this.removalCandidate=null;this.removalCandidateAt=0;this.verifiedReturn=null;return false;
    }
    if(this.removalCandidate && now-this.removalCandidateAt>=250 &&
       now-this.removalCandidateAt<=3000 &&
       difference(this.removalCandidate,frame,this.roi)<=0.008){
      this.verifiedReturn=frame;
      return true;
    }
    this.removalCandidate=frame;this.removalCandidateAt=now;return false;
  }
  /** Called only AFTER the second independent verified model report.
   * Both the existing retrieval witness and the new disappearance witness
   * can establish the first reference. Never refresh an existing reference
   * based on model emptiness alone. */
  rememberVotedEmpty(frame:TemporalFrame|null):void {
    if(!this.empty&&frame&&frame.width===256&&frame.height===256&&
       frame.data.length===256*256*4)this.votedEmpty=this.verifiedReturn??frame;
  }
  /** A located empty model frame followed by a distinct, stable decoded
   * video frame is enough for initial calibration, without waiting for
   * another expensive inference. Not an auto-submit proof by itself. */
  finishInitialReference(frame:TemporalFrame,now:number):boolean {
    if(this.empty||!this.emptyScan||now-this.emptyScanAt<300||
       now-this.emptyScanAt>1800||frame.width!==256||frame.height!==256)return false;
    if(difference(this.emptyScan,frame,this.roi)>BOARD_RETURN_MAX_EMPTY_CHANGED)return false;
    this.empty=frame;this.emptyScan=null;this.emptyScanAt=0;return true;
  }
  observe(frame:TemporalFrame,recordedDarts:number,now:number,requireLocatedReference=false):boolean {
    if(!Number.isFinite(now)||now<=0 ||
       frame.width!==256||frame.height!==256)return false;
    if(recordedDarts===0){
      // Capture only a stable board at the beginning of THIS visit.
      // Capture the first stable EMPTY appearance and then FREEZE it for
      // this visit. The first dart can physically arrive before its score
      // reaches the HUD; repeatedly overwriting the reference while
      // recordedDarts===0 would silently make a dart-filled board "empty".
      if(!this.empty && this.prior && difference(this.prior,frame,this.roi) <= 0.0007 && !requireLocatedReference){
        this.empty=frame;
      }
      this.prior=frame;
      this.occupied=false;
      this.quietSince=0;
      return false;
    }
    if(!this.empty)return false;
    const changed=difference(this.empty,frame,this.roi);
    this.lastComparison=changed;
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
      this.confirmed=true;return true;
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
  get changedFraction():number{return this.lastComparison;}
  get emptyReference():TemporalFrame|null{return this.empty;}
  get regionMask():Uint8Array|null{return this.roi;}
  get hasRegion():boolean{return this.roi!==null;}
  get hasEmptyReference():boolean{return this.empty!==null;}
  get hasSeenPhysicalDarts():boolean{return this.occupied;}
}
