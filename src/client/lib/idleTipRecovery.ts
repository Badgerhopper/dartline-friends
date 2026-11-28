import type { BoardTip } from '../../shared/vision/types';
import { boardImpactRegion } from './physicalBoardImpact';

/**
 * Recover a missed throw even when motion gating saw no impact. Background
 * camera frames are NOT scored directly: tips must recur at nearly the same
 * position in independent completed model inferences.
 *
 * Normal impact-triggered scoring and the server's one-to-one duplicate guard
 * remain authoritative. This is a conservative second chance, not a license
 * to score every pixel the model calls a tip.
 */
export const IDLE_RECOVERY_INTERVAL_MS = 2200;
export const IDLE_RECOVERY_MIN_SEPARATION_MS = 550;
export const IDLE_RECOVERY_MAX_GAP_MS = 7500;
export const IDLE_RECOVERY_MATCH_RADIUS = 14500; // 6.54mm board plane
export const IDLE_RECOVERY_MIN_CONFIDENCE = 0.50;
export const IDLE_RECOVERY_STRONG_CONFIDENCE = 0.80;
export const IDLE_RECOVERY_OUTER_MISS_CONFIDENCE = 0.50;

type Candidate = {
  observations: BoardTip[];
  count: number;
  lastSeen: number;
  emitted: boolean;
  missedFrames: number;
  intermittent: boolean;
};

function valid(tip: BoardTip): boolean {
  return Number.isFinite(tip.x) && Number.isFinite(tip.y) &&
    Number.isFinite(tip.confidence) &&
    tip.x >= 0 && tip.x <= 1_000_000 &&
    tip.y >= 0 && tip.y <= 1_000_000 &&
    tip.confidence >= IDLE_RECOVERY_MIN_CONFIDENCE &&
    // Scan to the physical rim, not beyond. Low-confidence outer-ring
    // candidates still require three independent completed inferences.
    boardImpactRegion(tip.x,tip.y)!=='outside' &&
    (boardImpactRegion(tip.x,tip.y)!=='miss' ||
       tip.confidence >= IDLE_RECOVERY_OUTER_MISS_CONFIDENCE);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[index] : (sorted[index - 1] + sorted[index]) / 2;
}

function representative(candidate: Candidate): BoardTip {
  const window = candidate.observations.slice(-3);
  return {
    x: Math.round(median(window.map((o) => o.x))),
    y: Math.round(median(window.map((o) => o.y))),
    confidence: Math.max(...window.map((o) => o.confidence)),
  };
}

/**
 * A high-confidence tip needs two different completed scans; a weak, rescued
 * tip needs at least three. The scan interval is independent of motion events.
 * Each tracked candidate may be published once until a genuine empty scan or
 * a long gap removes it.
 */
export class IdleTipRecovery {
  private candidates: Candidate[] = [];
  private lastScanAt = 0;
  private lastRetryAt = 0;

  reset(): void {
    this.candidates = [];
    this.lastScanAt = 0;
    this.lastRetryAt = 0;
  }

  /** An emitted candidate is not necessarily an accepted score. Scene
   * arbitration, a busy socket or stale count can reject its first report.
   * Retry only currently visible, independently confirmed tips, not a
   * historical unmatched candidate; the shared scene gate and server
   * count guard still decide whether this observation is a new dart. */
  retryConfirmed(now:number):BoardTip[] {
    if(!Number.isFinite(now)||now-this.lastScanAt>100||
       now-this.lastRetryAt<1100)return [];
    const confirmed=this.candidates.filter(c=>c.emitted&&c.missedFrames===0);
    if(!confirmed.length)return [];
    this.lastRetryAt=now;
    return confirmed.map(representative);
  }

  observe(tips: readonly BoardTip[], now: number): BoardTip[] {
    if (!Number.isFinite(now) || now <= 0) return [];
    // Never count two callbacks or stale frames as independent evidence.
    if (this.lastScanAt && now - this.lastScanAt < IDLE_RECOVERY_MIN_SEPARATION_MS) return [];
    this.lastScanAt = now;

    const eligible = tips.filter(valid);
    const prior = this.candidates.filter(c =>
      now >= c.lastSeen && now - c.lastSeen <= IDLE_RECOVERY_MAX_GAP_MS
    );
    if (!eligible.length) {
      // The model may miss a genuine physical tip in one inference. Keep
      // its evidence for ONE gap, but do not promote a single glitch.
      // Two consecutive board-located empty reports clear all candidates.
      this.candidates = prior.filter(c => c.missedFrames < 1).map(c => ({
        ...c, missedFrames:c.missedFrames + 1, intermittent:true,
      }));
      return [];
    }
    const next: Candidate[] = [];
    const usedPrior = new Set<number>();
    const sorted = [...eligible].sort((a, b) => b.confidence - a.confidence);

    // Assign the whole batch before updating tracks. A high-confidence
    // tip between two existing darts can otherwise steal the only match
    // available to its neighbor. Maximize matched identities first, then
    // minimize total displacement. Normally there are at most three tips.
    const distances=sorted.map(tip=>prior.map(c=>{
      const p=representative(c);
      return Math.hypot(tip.x-p.x,tip.y-p.y);
    }));
    let assignment:number[]=[];
    if(sorted.length<=6 && prior.length<=6){
      let bestCount=-1,bestCost=Infinity;
      const used=new Set<number>();
      const walk=(i:number,count:number,cost:number,path:number[])=>{
        if(i===sorted.length){
          if(count>bestCount || (count===bestCount && cost<bestCost)){
            bestCount=count;bestCost=cost;assignment=path.slice();
          }
          return;
        }
        for(let j=0;j<prior.length;j++){
          if(used.has(j)||distances[i][j]>=IDLE_RECOVERY_MATCH_RADIUS)continue;
          used.add(j);path.push(j);
          walk(i+1,count+1,cost+distances[i][j],path);
          path.pop();used.delete(j);
        }
        path.push(-1);walk(i+1,count,cost,path);path.pop();
      };
      walk(0,0,0,[]);
    } else {
      // Bound work on pathological model output; retain conservative nearest
      // matching rather than exponential search on the phone.
      const used=new Set<number>();
      assignment=distances.map(row=>{
        let nearest=-1,best=IDLE_RECOVERY_MATCH_RADIUS;
        for(let j=0;j<row.length;j++){
          if(!used.has(j)&&row[j]<best){nearest=j;best=row[j];}
        }
        if(nearest>=0)used.add(nearest);
        return nearest;
      });
    }
    for (let i=0;i<sorted.length;i++) {
      const tip=sorted[i],nearest=assignment[i];
      if (nearest >= 0) usedPrior.add(nearest);
      const previous = nearest >= 0 ? prior[nearest] : null;
      next.push({
        observations: [...(previous?.observations ?? []).slice(-2), tip],
        count: (previous?.count ?? 0) + 1,
        lastSeen: now,
        emitted: previous?.emitted ?? false,
        missedFrames: 0,
        intermittent: Boolean(previous?.intermittent || previous?.missedFrames),
      });
    }
    // Maintain one missing-frame witness, particularly when a newly
    // arriving dart obscures the earlier physical tip from this camera.
    for (let i=0;i<prior.length;i++) {
      if (!usedPrior.has(i) && prior[i].missedFrames < 1) {
        next.push({...prior[i],missedFrames:prior[i].missedFrames+1,
          intermittent:true});
      }
    }

    let newlyConfirmed = false;
    for (const candidate of next) {
      if (candidate.emitted) continue;
      const strongest = Math.max(...candidate.observations.map(o => o.confidence));
      const required = strongest >= IDLE_RECOVERY_STRONG_CONFIDENCE && !candidate.intermittent ? 2 : 3;
      if (candidate.count < required) continue;
      candidate.emitted = true;
      newlyConfirmed = true;
    }
    this.candidates = next;
    // Critical server contract: publish existing confirmed witnesses alongside
    // a newly visible close dart. The server matches the known tip to itself
    // before adding the close newcomer. Sending only the newcomer would make
    // it look like positional jitter of the old dart and suppress the hit.
    // No new confirmation means NO network report from background scanning.
    return newlyConfirmed ? next.filter(c => c.emitted).map(representative) : [];
  }
}
