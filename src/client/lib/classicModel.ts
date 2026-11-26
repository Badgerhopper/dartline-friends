/**
 * Undo only the forced 1280 -> 960 downgrade introduced by DartLine v3.2.
 * Keep the conservative v4 tip detector; board localization needs the
 * higher-resolution model previously chosen on this same iPhone.
 */
export function shouldRecoverBoardDetail(
  model: string,
  userAgent: string,
  previouslyAutoSelectedDetail: string | null,
  downgradeWasApplied: string | null,
  recoveryWasApplied: string | null,
  webGpuAvailable: boolean,
): boolean {
  return model === 's_960'
    && /iPhone/i.test(userAgent)
    && webGpuAvailable
    && previouslyAutoSelectedDetail === 'done'
    && downgradeWasApplied === 'done'
    && recoveryWasApplied !== 'done';
}
