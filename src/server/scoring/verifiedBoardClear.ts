/** A false empty recognition must never advance a remote match.
 * Two independently completed, board-located empty scans separated in time,
 * after exactly three registered darts, are required when opt-in is enabled. */
export const CLEAR_BOARD_CONFIRMATION_MS = 750;
export class VerifiedBoardClear {
  private firstEmptyAt: number | null = null;
  private confirmed = 0;
  reset(): void {
    this.firstEmptyAt = null;
    this.confirmed = 0;
  }
  observe(clearAndVisible: boolean, filled: number, now: number): boolean {
    if (!clearAndVisible || filled !== 3 || !Number.isFinite(now)) {
      this.reset();
      return false;
    }
    if (this.firstEmptyAt === null || now < this.firstEmptyAt) {
      this.firstEmptyAt = now;
      this.confirmed = 1;
      return false;
    }
    this.confirmed++;
    return this.confirmed >= 2 && now - this.firstEmptyAt >= CLEAR_BOARD_CONFIRMATION_MS;
  }
}
