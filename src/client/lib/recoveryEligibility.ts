/** Background recovery is a fallback for missed impact detection, NOT a second
 * scorer assignment protocol. The real scoring assignment is supplied by the
 * scorer's WebSocket. An optional mobile HUD message may narrow that scope,
 * but missing/delayed HUD messaging must never disable camera recognition. */
export type VisitHint={key:string;active:boolean;dartsRecorded:number};

export interface RecoveryScope {
  scoring:boolean;
  cameraActive:boolean;
  view:string;
  takeoutMonitorArmed:boolean;
  hint:VisitHint;
}

export function shouldRecoverSilentHits(scope:RecoveryScope):boolean {
  if(!scope.scoring || !scope.cameraActive || scope.view !== 'scoring' ||
     scope.takeoutMonitorArmed) return false;
  const hint=scope.hint;
  // Missing context is not a prohibition: the server owns authorization.
  if(!hint.key) return true;
  // An explicit remote turn or full visit is a definite prohibition.
  return hint.active && hint.dartsRecorded < 3;
}
