/**
 * One positive-only backup AI scan per physical dart-sized motion.
 * Continuous blind inference on a stationary board previously hallucinated
 * misses and promoted an unchanged dart into duplicate scores.
 */
export const MOTION_SCAN_SETTLE_MS = 850;
export const MOTION_SCAN_WINDOW_MS = 6000;
export class MotionRescueGate {
  private lastDot = 'idle';
  private motionAt = 0;
  private generation = 0;
  private inFlight: number | null = null;
  private completed = 0;

  observe(dot: string, now: number): void {
    const pending = dot === 'pending' || dot === 'pendingLarge';
    const previouslyPending = this.lastDot === 'pending' || this.lastDot === 'pendingLarge';
    this.lastDot = dot;
    if (pending && !previouslyPending && Number.isFinite(now) && now > 0) {
      this.generation++;
      this.motionAt = now;
      // In-flight work for a past throw cannot block a new throw.
      this.inFlight = null;
    }
  }

  claim(now: number, enabled: boolean): number | null {
    if (!enabled || !Number.isFinite(now) || !this.motionAt ||
        now - this.motionAt < MOTION_SCAN_SETTLE_MS ||
        now - this.motionAt > MOTION_SCAN_WINDOW_MS ||
        this.lastDot === 'pending' || this.lastDot === 'pendingLarge' ||
        this.completed === this.generation ||
        this.inFlight !== null) return null;
    this.inFlight = this.generation;
    return this.generation;
  }

  finish(token: number, frameCompleted: boolean): void {
    if (this.inFlight !== token) return;
    this.inFlight = null;
    if (frameCompleted && this.generation === token) this.completed = token;
  }
}
