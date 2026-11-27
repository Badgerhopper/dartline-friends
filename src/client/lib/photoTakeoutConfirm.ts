/** Physical, video-frame-confirmed two-image takeout handshake.
 *
 * A model's predicted empty result must NOT be enough. The caller must
 * independently prove: current owned visit, exactly 3 scored darts, empty
 * reference taken before throw, visually occupied in between, and a freshly
 * captured photo currently equal to that empty reference.
 *
 * Count ONLY different decoded video-frame IDs. A stalled Safari camera can
 * make repeated canvas reads of the SAME old photograph; those must never be
 * treated as two confirmations. Any invalid/non-empty photo between votes
 * invalidates the incomplete pair. Retry has a strict cap; after the cap the
 * legacy AI verifier can take over.
 */
export const PHOTO_CLEAR_CONFIRM_SPACING_MS=900;
export const PHOTO_CLEAR_RETRY_MS=3200;
// Two independent image pairs are enough to tolerate a transient lost send;
// do not starve the heavier AI fallback for many seconds when the server
// cannot acknowledge the photographic path.
export const PHOTO_CLEAR_MAX_PAIRS=2;
// This exceeds the server's longest permitted gap between empty votes.
// After an interrupted pair, we must not let an OLD first server vote
// combine with the first vote of a newly started pair.
export const PHOTO_CLEAR_INTERRUPTED_WAIT_MS=4700;
// The two confirmed empty photos must belong to the same continuous
// camera-clearance event, not minutes apart after Safari resumed.
export const PHOTO_CLEAR_PAIR_MAX_GAP_MS=2500;

export class PhotoTakeoutConfirm {
  private visit='';
  private sent=0;
  private lastSentAt=0;
  private lastFrameId=0;
  private totalPairs=0;
  private blockedUntil=0;

  reset():void{
    this.visit='';this.sent=0;this.lastSentAt=0;
    this.lastFrameId=0;this.totalPairs=0;
    this.blockedUntil=0;
  }

  /** A nonempty, obstructed, or no-longer-located frame cancels the first
   * partial empty vote. Never stitch independent false clears together.
   */
  invalidate(visit:string,now:number):void{
    if(visit!==this.visit){this.reset();this.visit=visit;return;}
    // No server reset was sent with the invalid photo, so the server may
    // still be holding our FIRST empty vote. Wait for it to expire before
    // sending the first vote of another sequence. This is conservative
    // but prevents false submission via a stale cross-sequence pair.
    if(this.sent===1 && Number.isFinite(now) && now>0){
      this.blockedUntil=Math.max(this.blockedUntil,
        this.lastSentAt+PHOTO_CLEAR_INTERRUPTED_WAIT_MS);
    }
    this.sent=0;
  }

  claim(visit:string,now:number,
        verifiedEmpty:boolean,boardLocated:boolean,
        decodedFrameId:number|null):boolean{
    if(!visit||!Number.isFinite(now)||now<=0)return false;
    if(this.visit!==visit){this.reset();this.visit=visit;}
    if(!verifiedEmpty||!boardLocated||
       decodedFrameId===null||!Number.isSafeInteger(decodedFrameId)||
       decodedFrameId<=0){
      this.invalidate(visit,now);
      return false;
    }
    if(this.totalPairs>=PHOTO_CLEAR_MAX_PAIRS)return false;
    // If the camera stopped between the two votes, this is no longer
    // one continuous photo-clearance event. Let the server's old first vote
    // expire before starting over, exactly as for a visible obstruction.
    if(this.sent===1 && now-this.lastSentAt>PHOTO_CLEAR_PAIR_MAX_GAP_MS)
      this.invalidate(visit,now);
    if(now<this.blockedUntil)return false;
    // Even a 900ms timer cannot make one frozen video frame independent.
    if(decodedFrameId<=this.lastFrameId)return false;
    if(this.sent===2){
      if(now-this.lastSentAt<PHOTO_CLEAR_RETRY_MS)return false;
      this.sent=0;
    }
    if(this.lastSentAt && now-this.lastSentAt<PHOTO_CLEAR_CONFIRM_SPACING_MS)
      return false;
    this.lastFrameId=decodedFrameId;
    this.lastSentAt=now;
    this.sent++;
    if(this.sent===2)this.totalPairs++;
    return true;
  }

  get reportsSent():number{return this.totalPairs*2+this.sent%2;}
  get pairsSent():number{return this.totalPairs;}
  get hasBudget():boolean{return this.totalPairs<PHOTO_CLEAR_MAX_PAIRS;}
  get waitingForSecond():boolean{return this.sent===1;}
}
