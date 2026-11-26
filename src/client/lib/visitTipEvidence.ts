/**
 * Keep physical positive-tip evidence within exactly one live scoring visit.
 *
 * The old takeout verifier sampled ONLY the last inference when the third
 * score arrived. If that one frame missed tips, auto-submit could never arm.
 * A model-positive tip observed earlier in the same visit is better evidence,
 * but evidence from a previous player or visit must never carry over.
 */
export class VisitTipEvidence {
  private visitKey = '';
  private observed = false;

  updateVisit(key: string, active: boolean): void {
    if (!active || (key && key !== this.visitKey)) {
      this.observed = false;
    }
    this.visitKey = active ? key : '';
  }

  observePositive(assigned: boolean, tipCount: number, verifyingRemoval: boolean): void {
    if (assigned && !verifyingRemoval && Number.isInteger(tipCount) && tipCount > 0) {
      this.observed = true;
    }
  }

  get seenDuringThisVisit(): boolean {
    return this.observed;
  }
}
