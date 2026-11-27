/** A bounded self-recovery policy for a LiteRT model runner that keeps
 * throwing, without restarting the iPhone camera, losing pairing, or entering
 * an endless reload loop. A single temporary GPU/video hiccup does nothing.
 */
export const RECOVERY_FAILURES_BEFORE_REBUILD=3;
export class InferenceErrorRecovery {
  private failures=0;
  private rebuildAttempted=false;
  reset():void{this.failures=0;this.rebuildAttempted=false;}
  succeeded():void{this.failures=0;}
  failed():boolean{
    this.failures++;
    if(this.failures>=RECOVERY_FAILURES_BEFORE_REBUILD && !this.rebuildAttempted){
      this.rebuildAttempted=true;
      return true;
    }
    return false;
  }
  get consecutiveFailures():number{return this.failures;}
}
