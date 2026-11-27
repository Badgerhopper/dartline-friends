/** A clear, settled photograph is sufficient physical evidence to verify
 * retrieval after three server-recorded darts. The existing model verifier
 * remains available when the photograph cannot be matched.
 *
 * This class NEVER scores or submits a dart. It authorizes only empty reports
 * after the caller verifies: active assigned match, exactly three darts,
 * same-visit EMPTY reference, previously OCCUPIED image and a stable physical
 * return to the empty image. The server still owns turn submission.
 */
export const PHOTO_CLEAR_CONFIRM_SPACING_MS=900;
export const PHOTO_CLEAR_RETRY_MS=3200;
export const PHOTO_CLEAR_MAX_PAIRS=4;
export class PhotoTakeoutConfirm {
  private visit='';
  private sent=0;
  private lastSentAt=0;
  private totalPairs=0;
  reset():void {
    this.visit='';this.sent=0;this.lastSentAt=0;this.totalPairs=0;
  }
  /**
   * verifiedEmpty must describe the CURRENT image, not a cached model frame.
   * boardLocated requires a real homography from the active camera session.
   * The caller publishes [] only when this returns true.
   */
  claim(visit:string,now:number,
        verifiedEmpty:boolean,boardLocated:boolean):boolean {
    if(!visit||!Number.isFinite(now)||now<=0 || !boardLocated)return false;
    if(this.visit!==visit){this.reset();this.visit=visit;}
    if(!verifiedEmpty)return false;
    if(this.totalPairs>=PHOTO_CLEAR_MAX_PAIRS)return false;
    if(this.sent===2){
      if(now-this.lastSentAt<PHOTO_CLEAR_RETRY_MS)return false;
      this.sent=0;
    }
    if(this.lastSentAt && now-this.lastSentAt<PHOTO_CLEAR_CONFIRM_SPACING_MS)
      return false;
    this.lastSentAt=now;
    this.sent++;
    if(this.sent===2)this.totalPairs++;
    return true;
  }
  get reportsSent():number{return this.totalPairs*2+this.sent%2;}
  get pairsSent():number{return this.totalPairs;}
}
