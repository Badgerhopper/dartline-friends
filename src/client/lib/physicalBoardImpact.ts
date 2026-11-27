import {BOARD_CENTER,BOARD_MAX,boardRadii} from '../../shared/boardGeometry';
import type {TemporalGuess} from './temporalDartEvidence';
import {scoreFromBoardCoords} from '../../shared/scoring';
import type {BoardTip} from '../../shared/vision/types';

/** Geometry must follow the PHYSICAL face of the dartboard.
 * A projected point beyond that rim is not a miss to score automatically:
 * it may be a stored dart, a dart in the wall, a hand or a false keypoint.
 */
const RADII=boardRadii(BOARD_MAX);
export const PHYSICAL_BOARD_EDGE=RADII.boardOuter; // 225 mm
export const PHYSICAL_DOUBLE_EDGE=RADII.doubleOuter; // 170 mm
export type BoardImpactRegion='score'|'miss'|'outside';

export function boardImpactRegion(x:number,y:number):BoardImpactRegion {
  if(!Number.isFinite(x)||!Number.isFinite(y))return 'outside';
  // The mapped physical board is a circle, not the 451-mm bounding square.
  const radius=Math.hypot(x-BOARD_CENTER,y-BOARD_CENTER);
  if(radius>PHYSICAL_BOARD_EDGE)return 'outside';
  return radius>PHYSICAL_DOUBLE_EDGE?'miss':'score';
}

/** Independently observed, newly arrived shaft on the wooden/numeral surround.
 * The temporal detector already required a settled BEFORE/AFTER difference,
 * lengthwise PCA elongation and a recognizable asymmetric dart shaft.
 * This second gate rules out full-frame lighting, broad hand silhouettes and
 * uncertain/occluded tips. The score MUST be zero and in the board annulus.
 */
export function strongNewPhysicalMiss(
  x:number,y:number,guess:Pick<TemporalGuess,
   'confidence'|'length'|'area'|'obscured'|'changeFraction'>):boolean {
  return boardImpactRegion(x,y)==='miss'
    && Number.isFinite(guess.confidence)
    && guess.confidence>=0.68 && !guess.obscured
    && Number.isFinite(guess.length) && guess.length>=24
    && Number.isFinite(guess.area) && guess.area>=24
    && Number.isFinite(guess.changeFraction)
    && guess.changeFraction>=0.00015
    && guess.changeFraction<0.045;
}

/** null means every observed 'tip' was OFF the physical board. Do not send
 * [] to the scoring server in that case: [] is an entirely different signal
 * meaning an independently verified EMPTY BOARD and could end a visit.
 * A genuinely empty model prediction stays [] so existing takeout control
 * can make its own separate safety decision.
 */
export function physicalBoardTipBatch(tips:readonly BoardTip[]):BoardTip[]|null {
  if(!tips.length)return [];
  const accepted=tips.filter(t=>boardImpactRegion(t.x,t.y)!=='outside');
  return accepted.length ? accepted : null;
}

/** Project the actual physical board into the existing square camera image.
 * Used only for visual clearance: people moving beside the board cannot
 * invalidate a genuinely empty board. Pixel centers, lens correction and
 * the scoring homography all use the same coordinate convention.
 */
export function physicalBoardMask(
  project:(x:number,y:number)=>readonly number[]|null,
  size=256
):Uint8Array {
  const mask=new Uint8Array(size*size);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const p=project((x+.5)/size,(y+.5)/size);
    // Include a small margin for shafts/flights that project just outside
    // the board. This ROI is for removal only, never for scoring off-board tips.
    if(p&&Math.hypot(p[0]-BOARD_CENTER,p[1]-BOARD_CENTER)<=PHYSICAL_BOARD_EDGE+BOARD_MAX*.04)
      mask[y*size+x]=1;
  }
  return mask;
}

/** An invisible point has an interval, not a magical exact coordinate.
 * Auto-score only if a dense sampling of that interval and lateral fitting
 * uncertainty stays in the same scoring bed AND within the repeat guard.
 * Ambiguous double/triple wires and long occlusions remain manual estimates.
 */
export function scoreHiddenTip(
  guess:TemporalGuess,project:(x:number,y:number)=>readonly number[]|null
):{x:number;y:number;label:string}|null {
  const range=guess.hiddenRange,axis=guess.axis;
  if(!range||!axis||guess.confidence<.67||guess.length<20)return null;
  const mid=project(guess.x,guess.y);
  if(!mid||boardImpactRegion(mid[0],mid[1])==='outside')return null;
  const x=Math.round(mid[0]),y=Math.round(mid[1]);
  const label=scoreFromBoardCoords(x,y).label;
  const steps=Math.max(4,Math.ceil(512*Math.hypot(range.endX-range.startX,range.endY-range.startY)));
  if(steps>64)return null;
  for(let i=0;i<=steps;i++)for(const lateral of [-1.5,-.75,0,.75,1.5]){
    const t=i/steps;
    const px=range.startX+(range.endX-range.startX)*t-axis.y*lateral/256;
    const py=range.startY+(range.endY-range.startY)*t+axis.x*lateral/256;
    const p=project(px,py);
    if(!p||boardImpactRegion(p[0],p[1])==='outside'||
      Math.hypot(p[0]-x,p[1]-y)>24000||
      scoreFromBoardCoords(Math.round(p[0]),Math.round(p[1])).label!==label)return null;
  }
  return {x,y,label};
}

/** Model-independent physical hit. A known newly arrived shaft can be
 * scored even when the network supplies no tip. Ring boundaries remain
 * editable estimates; the physical rim is a hard limit. */
export function scorePhysicalDart(guess:TemporalGuess,
  project:(x:number,y:number)=>readonly number[]|null):{x:number;y:number;label:string}|null {
  const hidden=scoreHiddenTip(guess,project);
  if(hidden)return hidden;
  if(guess.confidence<.67||guess.length<20||guess.area<20||
     guess.changeFraction<=0||guess.changeFraction>.045||!guess.axis||guess.axis.ratio<1.35)return null;
  const p=project(guess.x,guess.y);
  if(!p||boardImpactRegion(p[0],p[1])==='outside')return null;
  // The player explicitly wants the best estimate rather than a missing
  // slot. For hidden tips the midpoint of the inferred occlusion interval
  // is an estimate, never a claim of exact position. For a visible front
  // end use that endpoint, including just outside the double wire.
  const x=Math.round(p[0]),y=Math.round(p[1]);
  return {x,y,label:scoreFromBoardCoords(x,y).label};
}

/** Outer-ring model predictions are especially vulnerable to a flight
 * being mistaken for a tip. Never score a new zero from one inference.
 * Keep valid interior hits in the batch; do not convert rejected tips to
 * an empty-board vote. Distinct completed inference objects are mandatory.
 */
export class OuterMissConfirmation {
  private visit='';
  private token:unknown=null;
  private lastAt=0;
  private prior:{tip:BoardTip;hits:number}[]=[];
  reset():void {this.visit='';this.token=null;this.lastAt=0;this.prior=[];}
  filter(tips:BoardTip[],visit:string,frame:unknown,now:number):BoardTip[]|null {
    if(visit!==this.visit){this.reset();this.visit=visit;}
    const misses=tips.filter(t=>boardImpactRegion(t.x,t.y)==='miss'&&!t.estimate);
    if(frame && frame!==this.token && (!this.lastAt||now-this.lastAt>=250)){
      const old=now-this.lastAt<=4500?this.prior:[];
      const used=new Set<number>();
      this.prior=misses.map(t=>{
        let best=-1,dist=15000;
        for(let i=0;i<old.length;i++){
          const d=Math.hypot(t.x-old[i].tip.x,t.y-old[i].tip.y);
          if(!used.has(i)&&d<dist){best=i;dist=d;}
        }
        if(best>=0)used.add(best);
        return {tip:t,hits:best>=0?old[best].hits+1:1};
      });
      this.token=frame;this.lastAt=now;
    }
    if(!tips.length)return [];
    const accepted=tips.filter(t=>t.estimate||boardImpactRegion(t.x,t.y)!=='miss'||
      this.prior.some(p=>p.hits>=(t.confidence>=.85?2:3)&&
        Math.hypot(t.x-p.tip.x,t.y-p.tip.y)<15000));
    return accepted.length?accepted:null;
  }
}
