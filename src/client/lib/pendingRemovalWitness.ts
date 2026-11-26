import type {FastBoardClear} from './fastBoardClear';

/** A video-frame callback can witness removal before React commits the new
 * 3-dart armed state. Preserve evidence briefly, never across a new visit.
 * This is a handshake bridge, not a new scoring or submission rule.
 */
export const REMOVAL_WITNESS_LIFETIME_MS=4200;
export class PendingRemovalWitness {
  private handAt=0;
  private photoAt=0;
  reset():void {this.handAt=0;this.photoAt=0;}
  sawHand(now:number):void {if(Number.isFinite(now)&&now>0)this.handAt=now;}
  sawPhotoClear(now:number):void {if(Number.isFinite(now)&&now>0)this.photoAt=now;}
  replay(gate:FastBoardClear,now:number):void {
    if(!Number.isFinite(now)||now<=0||!gate.isArmed)return;
    const recent=(stamp:number)=>stamp>0&&now>=stamp
      &&now-stamp<=REMOVAL_WITNESS_LIFETIME_MS;
    if(recent(this.handAt))gate.noteRetrievalMotion();
    if(recent(this.photoAt))gate.noteVisualClear(this.photoAt);
  }
}