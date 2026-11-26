/**
 * Opt-in dart takeout only. This never changes normal motion-triggered
 * recognition, tip filtering, thresholds or the scoring tracker.
 *
 * First wait for motion from the final scored throw to settle. Only a later
 * distinct movement may begin removal verification. A full inference that
 * was skipped because the model was busy does not consume the scan budget.
 */
export const REMOVAL_SETTLE_MS = 850;
export const REMOVAL_SCAN_SPACING_MS = 850;
export const REMOVAL_PROBE_WINDOW_MS = 20000;
export const REMOVAL_MAX_COMPLETED_SCANS = 6;

export class RemovalMonitor {
  private armed = false;
  private ready = false;
  private lastDot = '';
  private movementAt = 0;
  private lastScanFinishedAt = 0;
  private inFlight = false;
  private flightGeneration: number | null = null;
  private completedScans = 0;
  private generation = 0;

  reset(): void {
    this.armed = false;
    this.ready = false;
    this.lastDot = '';
    this.movementAt = 0;
    this.lastScanFinishedAt = 0;
    this.inFlight = false;
    this.flightGeneration = null;
    this.completedScans = 0;
    this.generation++;
  }

  update(enabled: boolean, dot: string, now: number): void {
    if (!enabled) {
      if (this.armed) this.reset();
      return;
    }
    if (!this.armed) {
      this.armed = true;
      // Do not classify a still-in-progress third-dart impact as retrieval.
      this.ready = dot === 'idle' || dot === 'triggered';
      this.lastDot = dot;
      return;
    }
    if (!this.ready && (dot === 'idle' || dot === 'triggered')) this.ready = true;

    const pending = dot === 'pending' || dot === 'pendingLarge';
    const wasPending = this.lastDot === 'pending' || this.lastDot === 'pendingLarge';
    if (this.ready && pending && !wasPending && Number.isFinite(now) && now > 0) {
      this.movementAt = now;
      this.lastScanFinishedAt = 0;
      this.completedScans = 0;
      this.generation++;
    }
    this.lastDot = dot;
  }

  claim(now: number, visible: boolean, cameraReady: boolean): number | null {
    if (!this.armed || !this.ready || !visible || !cameraReady ||
        !Number.isFinite(now) || this.movementAt <= 0 ||
        now - this.movementAt < REMOVAL_SETTLE_MS ||
        now - this.movementAt > REMOVAL_PROBE_WINDOW_MS ||
        this.lastDot === 'pending' || this.lastDot === 'pendingLarge' ||
        this.inFlight || this.completedScans >= REMOVAL_MAX_COMPLETED_SCANS ||
        (this.lastScanFinishedAt > 0 &&
         now - this.lastScanFinishedAt < REMOVAL_SCAN_SPACING_MS)) return null;
    this.inFlight = true;
    this.flightGeneration = this.generation;
    return this.generation;
  }

  complete(generation: number, now: number, completedFrame: boolean): void {
    // A completed request must never release a newer in-flight request.
    if (this.flightGeneration !== generation) return;
    this.inFlight = false;
    this.flightGeneration = null;
    if (!this.armed || this.generation !== generation) return;
    if (completedFrame) {
      this.completedScans++;
      this.lastScanFinishedAt = now;
    }
    // Busy/no-frame attempts are retried. They do not consume a verification
    // and never manufacture an empty board report.
  }

  get completed(): number { return this.completedScans; }
  get checkingRemoval(): boolean { return this.movementAt > 0; }
}
