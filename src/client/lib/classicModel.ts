/** One-time rollback of the iPhone high-detail default introduced by v5.
 * A previous device preference may persist across deployments on Render. */
export function shouldRestoreClassicModel(
  model: string,
  userAgent: string,
  priorAutoChoice: string | null,
  rollbackComplete: string | null,
): boolean {
  return rollbackComplete !== 'done' &&
    priorAutoChoice === 'done' &&
    model === 's_1280' &&
    /iPhone/i.test(userAgent);
}
