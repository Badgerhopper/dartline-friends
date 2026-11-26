/** During takeout, ONLY the dedicated board-clear verifier may publish
 * tips or empty reports. The old guard blocked unverified empties but allowed
 * random motion-triggered positive AI tips to reset the server's first of two
 * verified empty confirmations. A manual OFF/ON toggle appeared to fix it
 * because it reset the server's partial state.
 */
export interface TakeoutPublication {
  takeoutExclusive:boolean;
  explicitlyVerified:boolean;
}
export function mayPublishScorerTips(event:TakeoutPublication):boolean {
  return !event.takeoutExclusive || event.explicitlyVerified;
}
