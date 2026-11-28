/**
 * v4.2: independent, safely paced takeout verification.
 *
 * Waiting for a *new* motion detector trigger made gentle retrieval wait up
 * to 20 seconds (or fail completely). Instead we use actual board-located AI
 * frames. The server still requires TWO separate, timed empty reports.
 *
 * A correctly recognised occupied board AND a retrieval witness (real
 * detector motion or a separate low-resolution scene change) are required.
 * An AI that repeatedly misses stationary darts must NEVER submit a turn.
 */
export const FAST_CLEAR_TICK_MS = 450;
export const FAST_CLEAR_ARM_GRACE_MS = 700;
export const FAST_CLEAR_FRAME_SPACING_MS = 550;
export const FAST_CLEAR_SERVER_SPACING_MS = 800;
export const FAST_CLEAR_RETRY_MS = 2700;
export const FAST_CLEAR_MAX_PAIRS = 3;
export const FAST_CLEAR_INFERENCE_STALL_MS = 6500;
export const FAST_CLEAR_PHOTO_PROOF_MS = 5000;

export type ClearFrame = 'occupied' | 'empty' | 'unlocated' | 'skipped';
export type ClearAction = 'send-empty' | 'send-occupied' | null;

export class FastBoardClear {
  private active = false;
  private generation = 0;
  private busyToken: number | null = null;
  private busySince = 0;
  private armedAt = 0;
  private lastCompletedAt = 0;
  private lastEmptySentAt = 0;
  private seenOccupied = false;
  private sawRetrievalMotion = false;
  private consecutiveEmpty = 0;
  private emptySent = 0;
  private completedPairs = 0;
  private photoClearUntil = 0;

  reset(): void {
    this.active = false;
    this.generation++;
    this.busyToken = null;
    this.busySince = 0;
    this.armedAt = 0;
    this.lastCompletedAt = 0;
    this.lastEmptySentAt = 0;
    this.seenOccupied = false;
    this.sawRetrievalMotion = false;
    this.consecutiveEmpty = 0;
    this.emptySent = 0;
    this.completedPairs = 0;
    this.photoClearUntil = 0;
  }

  arm(enabled: boolean, now: number, seenOccupied = false): void {
    if (!enabled) {
      if (this.active) this.reset();
      return;
    }
    if (!this.active) {
      this.reset();
      this.active = true;
      this.armedAt = now;
    }
    if (seenOccupied) this.seenOccupied = true;
  }

  noteRetrievalMotion(): void {
    if (this.active) this.sawRetrievalMotion = true;
  }

  /** Stronger than a generic hand-motion event. The independently matched
   * pre-throw EMPTY photo first had to become visibly OCCUPIED, then remain
   * visually EMPTY for >=650ms. This can veto a phantom model tip for a
   * short verification window only; camera geometry must still be located
   * in two fresh scans. Never call from an unverified inference. */
  noteVisualClear(now:number):void {
    if(!this.active || !this.seenOccupied || !Number.isFinite(now))return;
    this.sawRetrievalMotion=true;
    this.photoClearUntil=now+FAST_CLEAR_PHOTO_PROOF_MS;
  }

  claim(now: number, cameraReady: boolean): number | null {
    // iOS can suspend an iframe while a model inference promise is pending.
    // Never let one abandoned promise deadlock takeout until a user toggles
    // the setting. Invalidate the old token before allowing another attempt.
    if (this.busyToken !== null && Number.isFinite(now) &&
        now - this.busySince > FAST_CLEAR_INFERENCE_STALL_MS) {
      this.generation++;
      this.busyToken=null;
      this.busySince=0;
    }
    if (!this.active || !cameraReady || !Number.isFinite(now) ||
        now - this.armedAt < FAST_CLEAR_ARM_GRACE_MS ||
        this.busyToken !== null || this.completedPairs >= FAST_CLEAR_MAX_PAIRS ||
        (this.lastCompletedAt && now - this.lastCompletedAt < FAST_CLEAR_FRAME_SPACING_MS)) {
      return null;
    }
    // A pair of server empty reports can be dropped during a turn transition
    // or by a temporary camera-roster mismatch. The old code then stopped
    // scanning permanently. Recheck after a bounded cooldown, but never
    // invent an empty report or relax physical retrieval evidence.
    if (this.emptySent >= 2) {
      if (now - this.lastEmptySentAt < FAST_CLEAR_RETRY_MS) return null;
      this.emptySent = 0;
      this.lastEmptySentAt = 0;
      this.consecutiveEmpty = 0;
    }
    this.busyToken = this.generation;
    this.busySince = now;
    return this.generation;
  }

  finish(token: number, now: number, frame: ClearFrame): ClearAction {
    if (!this.active || this.busyToken !== token || token !== this.generation) return null;
    this.busyToken = null;
    this.busySince = 0;
    if (frame === 'skipped') return null;
    if (!Number.isFinite(now)) return null;
    if (this.lastCompletedAt && now - this.lastCompletedAt < FAST_CLEAR_FRAME_SPACING_MS) return null;
    this.lastCompletedAt = now;

    // A real photo sequence showing darts PRESENT then the same board EMPTY
    // is more reliable than the neural network hallucinating a stationary
    // point on an empty sisal/wire patch. This override expires quickly.
    if(frame==='occupied' && this.photoClearUntil>now) frame='empty';

    if (frame === 'occupied') {
      this.seenOccupied = true;
      this.consecutiveEmpty = 0;
      if (this.emptySent) {
        this.emptySent = 0;
        this.lastEmptySentAt = 0;
        // Reset any pending empty-board vote on the SERVER too. This report
        // uses a real, newly observed positive tip, never a fabricated one.
        return 'send-occupied';
      }
      return null;
    }
    if (frame === 'unlocated') {
      // Board occlusion is not an empty board. Reset locally and do not send.
      this.consecutiveEmpty = 0;
      return null;
    }
    if (!this.seenOccupied) return null;

    this.consecutiveEmpty++;
    // A blind model can return [] for every frame while real darts remain.
    // A physical retrieval witness is mandatory, independently of the AI.
    // The server still requires two board-located and timed empty reports.
    if (!this.sawRetrievalMotion || this.emptySent >= 2) return null;
    if (this.emptySent > 0 && now - this.lastEmptySentAt < FAST_CLEAR_SERVER_SPACING_MS) return null;

    this.emptySent++;
    this.lastEmptySentAt = now;
    if (this.emptySent === 2) this.completedPairs++;
    return 'send-empty';
  }

  /** A fresh occupied frame supersedes any previous empty-photo proof. */
  invalidatePhotoClear():void {this.photoClearUntil=0;}

  get isArmed(): boolean { return this.active; }
  get hasSeenDarts(): boolean { return this.seenOccupied; }
  get emptyReportsSent(): number { return this.emptySent; }
  get retriesUsed(): number { return Math.max(0,this.completedPairs-1); }
  get hasRetrievalWitness(): boolean { return this.sawRetrievalMotion; }
  get hasStrongPhotoClear(): boolean { return this.photoClearUntil>0; }
}
