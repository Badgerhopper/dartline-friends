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
function difference(a:TemporalFrame,b:TemporalFrame):number {
  if(a.width!==b.width||a.height!==b.height||
     a.data.length!==b.data.length)return 1;
  const n=a.width*a.height;
  const rs:number[]=[],gs:number[]=[],bs:number[]=[];
  // Exposure shifts and some white-balance changes affect the entire image.
  // Subtract them independently, without erasing same-brightness colored darts.
  for(let i=0;i<n;i+=37) {
    const k=i*4;
    rs.push(b.data[k]-a.data[k]);
    gs.push(b.data[k+1]-a.data[k+1]);
    bs.push(b.data[k+2]-a.data[k+2]);
  }
  const ro=median(rs),go=median(gs),bo=median(bs);
  let changed=0,total=0;
  for(let i=0;i<n;i+=SAMPLE_STEP){
    const k=i*4;
    const d=Math.max(
      Math.abs(b.data[k]-a.data[k]-ro),
      Math.abs(b.data[k+1]-a.data[k+1]-go),
      Math.abs(b.data[k+2]-a.data[k+2]-bo));
    if(d>PIXEL_CHANGE)changed++;
    total++;
  }
  return total?changed/total:1;
}
export class VisualBoardReturn {
  private empty:TemporalFrame|null=null;
  private prior:TemporalFrame|null=null;
  private occupied=false;
  private quietSince=0;
  private confirmed=false;
  reset():void {
    this.empty=null;this.prior=null;this.occupied=false;
    this.quietSince=0;this.confirmed=false;
  }
  observe(frame:TemporalFrame,recordedDarts:number,now:number):boolean {
    if(this.confirmed||!Number.isFinite(now)||now<=0 ||
       frame.width!==256||frame.height!==256)return false;
    if(recordedDarts===0){
      // Capture only a stable board at the beginning of THIS visit.
      if(this.prior && difference(this.prior,frame) <= 0.0007){
        this.empty=frame;
      }
      this.prior=frame;
      this.occupied=false;
      this.quietSince=0;
      return false;
    }
    if(!this.empty)return false;
    const changed=difference(this.empty,frame);
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
  get hasEmptyReference():boolean{return this.empty!==null;}
  get hasSeenPhysicalDarts():boolean{return this.occupied;}
}
