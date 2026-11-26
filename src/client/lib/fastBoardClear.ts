/**
 * v4.2: independent, safely paced takeout verification.
 *
 * Waiting for a *new* motion detector trigger made gentle retrieval wait up
 * to 20 seconds (or fail completely). Instead we use actual board-located AI
 * frames. The server still requires TWO separate, timed empty reports.
 *
 * A correctly recognised occupied board is required before any empty signal.
 * Without observed retrieval motion, require two empty frames BEFORE the
 * first server report. One-frame disappearance never submits a visit.
 */
export const FAST_CLEAR_TICK_MS = 450;
export const FAST_CLEAR_ARM_GRACE_MS = 700;
export const FAST_CLEAR_FRAME_SPACING_MS = 550;
export const FAST_CLEAR_SERVER_SPACING_MS = 800;

export type ClearFrame = 'occupied' | 'empty' | 'unlocated' | 'skipped';
export type ClearAction = 'send-empty' | 'send-occupied' | null;

export class FastBoardClear {
  private active = false;
  private generation = 0;
  private busyToken: number | null = null;
  private armedAt = 0;
  private lastCompletedAt = 0;
  private lastEmptySentAt = 0;
  private seenOccupied = false;
  private sawRetrievalMotion = false;
  private consecutiveEmpty = 0;
  private emptySent = 0;

  reset(): void {
    this.active = false;
    this.generation++;
    this.busyToken = null;
    this.armedAt = 0;
    this.lastCompletedAt = 0;
    this.lastEmptySentAt = 0;
    this.seenOccupied = false;
    this.sawRetrievalMotion = false;
    this.consecutiveEmpty = 0;
    this.emptySent = 0;
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

  claim(now: number, cameraReady: boolean): number | null {
    if (!this.active || !cameraReady || !Number.isFinite(now) ||
        now - this.armedAt < FAST_CLEAR_ARM_GRACE_MS ||
        this.busyToken !== null || this.emptySent >= 2 ||
        (this.lastCompletedAt && now - this.lastCompletedAt < FAST_CLEAR_FRAME_SPACING_MS)) {
      return null;
    }
    this.busyToken = this.generation;
    return this.generation;
  }

  finish(token: number, now: number, frame: ClearFrame): ClearAction {
    if (!this.active || this.busyToken !== token || token !== this.generation) return null;
    this.busyToken = null;
    if (frame === 'skipped') return null;
    if (!Number.isFinite(now)) return null;
    if (this.lastCompletedAt && now - this.lastCompletedAt < FAST_CLEAR_FRAME_SPACING_MS) return null;
    this.lastCompletedAt = now;

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
    // With no reliable hand-motion event, first establish TWO independent
    // empty frames before counting either as a server confirmation.
    // A genuine retrieval motion permits one fewer proof frame.
    const minimum = this.sawRetrievalMotion ? 1 : 2;
    if (this.consecutiveEmpty < minimum || this.emptySent >= 2) return null;
    if (this.emptySent > 0 && now - this.lastEmptySentAt < FAST_CLEAR_SERVER_SPACING_MS) return null;

    this.emptySent++;
    this.lastEmptySentAt = now;
    return 'send-empty';
  }

  get isArmed(): boolean { return this.active; }
  get hasSeenDarts(): boolean { return this.seenOccupied; }
  get emptyReportsSent(): number { return this.emptySent; }
}
