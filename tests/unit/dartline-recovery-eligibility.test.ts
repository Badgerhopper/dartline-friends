import {describe,it,expect} from 'vitest';
import {shouldRecoverSilentHits,type VisitHint} from '../../src/client/lib/recoveryEligibility';
const unknown:VisitHint={key:'',active:false,dartsRecorded:0};
const scope=(hint:VisitHint=unknown,extra:Record<string,unknown>={})=>({
  scoring:true,cameraActive:true,view:'scoring',takeoutMonitorArmed:false,hint,...extra,
});
describe('silent-hit recovery fallback must not depend on HUD event timing',()=>{
  it('runs when the scoring server assigns the camera even without a mobile HUD hint',()=>{
    expect(shouldRecoverSilentHits(scope())).toBe(true);
  });
  it('does not run when the actual scorer assignment is absent',()=>{
    expect(shouldRecoverSilentHits(scope(unknown,{scoring:false}))).toBe(false);
  });
  it('never scans an explicit opponent turn or completed visit',()=>{
    expect(shouldRecoverSilentHits(scope({key:'match:opponent',active:false,dartsRecorded:0}))).toBe(false);
    expect(shouldRecoverSilentHits(scope({key:'match:local',active:true,dartsRecorded:3}))).toBe(false);
  });
  it('runs for assigned incomplete visit with known HUD context',()=>{
    expect(shouldRecoverSilentHits(scope({key:'match:local',active:true,dartsRecorded:1}))).toBe(true);
  });
  it('never competes with removal or runs an unassigned camera',()=>{
    expect(shouldRecoverSilentHits(scope(unknown,{takeoutMonitorArmed:true}))).toBe(false);
    expect(shouldRecoverSilentHits(scope(unknown,{cameraActive:false}))).toBe(false);
    expect(shouldRecoverSilentHits(scope(unknown,{view:'calibration'}))).toBe(false);
  });
});
