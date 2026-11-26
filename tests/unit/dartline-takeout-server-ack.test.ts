import { describe, expect, it } from 'vitest';
import { ScoringSession } from '../../src/server/scoring/session';
import { VerifiedBoardClear } from '../../src/server/scoring/verifiedBoardClear';

function session() {
  return new ScoringSession({
    getMatch: () => null,
    ownerPlayerIds: [],
    commit: () => {},
    scorerLabel: () => 'iPhone',
    scorerId: () => 'test-phone',
  });
}
function verifier(s:ScoringSession):VerifiedBoardClear {
  return (s as unknown as {verifiedClear:VerifiedBoardClear}).verifiedClear;
}
describe('server acknowledged verified takeout across repeated game rounds',()=>{
  it('reasserting the SAME enable mode does not reset one accepted empty confirmation',()=>{
    const s=session();
    s.setVerifiedTakeout(true);
    expect(s.verifiedTakeoutStatus.enabled).toBe(true);
    expect(verifier(s).observe(true,3,1000)).toBe(false);
    expect(s.verifiedTakeoutStatus.confirmations).toBe(1);
    // Happens on every 5-second HUD heartbeat and after socket reconnection.
    s.setVerifiedTakeout(true);
    expect(s.verifiedTakeoutStatus.confirmations).toBe(1);
    expect(verifier(s).observe(true,3,1800)).toBe(true);
  });
  it('changing from true to false resets and disables confirmed board-clearing',()=>{
    const s=session();
    s.setVerifiedTakeout(true);
    verifier(s).observe(true,3,1000);
    s.setVerifiedTakeout(false);
    expect(s.verifiedTakeoutStatus.enabled).toBe(false);
    expect(s.verifiedTakeoutStatus.confirmations).toBe(0);
  });
  it('OFF to OFF is harmless and ON to ON is harmless after switching',()=>{
    const s=session();
    s.setVerifiedTakeout(false);
    s.setVerifiedTakeout(false);
    expect(s.verifiedTakeoutStatus.enabled).toBe(false);
    s.setVerifiedTakeout(true);
    verifier(s).observe(true,3,3000);
    s.setVerifiedTakeout(true);
    expect(s.verifiedTakeoutStatus.confirmations).toBe(1);
  });
  it('server provides live camera participation count instead of a misleading UI toggle',()=>{
    const s=session();
    s.setVerifiedTakeout(true);
    expect(s.verifiedTakeoutStatus.cameraCount).toBe(0);
    s.setCameraActive('iphone',true);
    expect(s.verifiedTakeoutStatus.cameraCount).toBe(1);
    s.setCameraActive('iphone',false);
    expect(s.verifiedTakeoutStatus.cameraCount).toBe(0);
  });
});
