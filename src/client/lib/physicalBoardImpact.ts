import {BOARD_CENTER,BOARD_MAX,boardRadii} from '../../shared/boardGeometry';
import type {TemporalGuess} from './temporalDartEvidence';
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
