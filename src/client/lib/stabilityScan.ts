/** Never run relaxed stationary recognition against a scene with no recent throw.
 * A static model can hallucinate weak dart tips indefinitely. */
export const THROW_RESCUE_WINDOW_MS=2200;
export function recentlyThrew(now:number, lastMotion:number): boolean {
  return Number.isFinite(now) && lastMotion>0 && now>=lastMotion
    && now-lastMotion<=THROW_RESCUE_WINDOW_MS;
}
/** Full, empty-capable inference is reserved for actual retrieval movement
 * after a complete, opted-in three-dart visit. */
export const TAKEOUT_SETTLE_MS=700;
export const TAKEOUT_MONITOR_MS=8500;
export function shouldProbeTakeout(now:number, movementAt:number,
  armed:boolean, dot:string):boolean {
  if (!armed || movementAt<=0 || !Number.isFinite(now) || now<movementAt) return false;
  const elapsed=now-movementAt;
  return elapsed>=TAKEOUT_SETTLE_MS && elapsed<=TAKEOUT_MONITOR_MS
    && dot!=='pending' && dot!=='pendingLarge';
}
