/**
 * Re-enable the proven higher-detail board model without changing v4
 * conservative dart-tip recognition.
 *
 * v3.2 downgraded already-working iPhones from 1280 to 960. Undo that even if
 * the browser no longer advertises GPU support. For a fresh iPhone, make the
 * same GPU-guarded first-time choice that the older working v5 build made.
 * Do not override a deliberate 960 selection made after the original v5 choice.
 */
export function shouldRecoverBoardDetail(
  model: string,
  userAgent: string,
  previouslyAutoSelectedDetail: string | null,
  downgradeWasApplied: string | null,
  recoveryWasApplied: string | null,
  webGpuAvailable: boolean,
): boolean {
  if (model !== 's_960' || !/iPhone/i.test(userAgent)
    || recoveryWasApplied === 'done') return false;
  const undoForcedDowngrade =
    previouslyAutoSelectedDetail === 'done' && downgradeWasApplied === 'done';
  const sameOriginalFirstTimeChoice =
    previouslyAutoSelectedDetail !== 'done' && webGpuAvailable;
  return undoForcedDowngrade || sameOriginalFirstTimeChoice;
}
