/** A one-time choice of the high-detail model for recent iPhone cameras. */
export function shouldUpgradeDetailModel(
  current: string,
  userAgent: string,
  webGpuAvailable: boolean,
  alreadyDecided: boolean,
): boolean {
  return !alreadyDecided
    && current === 's_960'
    && /iPhone/i.test(userAgent)
    && webGpuAvailable;
}
