import {describe,expect,it} from 'vitest';
import {PhotoTakeoutConfirm,PHOTO_CLEAR_CONFIRM_SPACING_MS,
 PHOTO_CLEAR_RETRY_MS,PHOTO_CLEAR_INTERRUPTED_WAIT_MS,PHOTO_CLEAR_MAX_PAIRS} from '../../src/client/lib/photoTakeoutConfirm';
import {VerifiedBoardClear} from '../../src/server/scoring/verifiedBoardClear';

describe('release-blocking physical takeout state machine',()=>{
  it('requires two independently decoded, consecutive EMPTY photos before server submits',()=>{
    const gate=new PhotoTakeoutConfirm(),server=new VerifiedBoardClear();
    expect(gate.claim('r1',1100,false,true,1)).toBe(false);
    expect(gate.claim('r1',1500,true,true,2)).toBe(true);
    expect(server.observe(true,3,1500)).toBe(false);
    expect(gate.claim('r1',1800,true,true,3)).toBe(false);
    expect(gate.claim('r1',2400,true,true,4)).toBe(true);
    expect(server.observe(true,3,2400)).toBe(true);
    expect(gate.pairsSent).toBe(1);
  });

  it('never trusts a frozen Safari video frame despite elapsed wall-clock time',()=>{
    const gate=new PhotoTakeoutConfirm();
    expect(gate.claim('v',1500,true,true,12)).toBe(true);
    for(const time of [2400,5000,9200,20000])
      expect(gate.claim('v',time,true,true,12)).toBe(false);
    expect(gate.pairsSent).toBe(0);
    expect(gate.claim('v',20500,true,true,13)).toBe(true);
    expect(gate.pairsSent).toBe(1);
  });

  it('an occupied/occluded photo between votes invalidates the partial pair',()=>{
    const gate=new PhotoTakeoutConfirm(),server=new VerifiedBoardClear();
    expect(gate.claim('v',1500,true,true,1)).toBe(true);
    expect(server.observe(true,3,1500)).toBe(false);
    expect(gate.claim('v',2000,false,true,2)).toBe(false);
    // The first empty vote is STILL on the server. Do not combine it with
    // the beginning of a new photo sequence after an interruption.
    expect(gate.waitingForSecond).toBe(false);
    expect(gate.claim('v',2700,true,true,3)).toBe(false);
    expect(gate.pairsSent).toBe(0);
    const restartAt=1500+PHOTO_CLEAR_INTERRUPTED_WAIT_MS;
    expect(gate.claim('v',restartAt,true,true,4)).toBe(true);
    // The server discards the first vote because it has aged out.
    expect(server.observe(true,3,restartAt)).toBe(false);
    expect(gate.claim('v',restartAt+PHOTO_CLEAR_CONFIRM_SPACING_MS,true,true,5)).toBe(true);
    expect(server.observe(true,3,restartAt+PHOTO_CLEAR_CONFIRM_SPACING_MS)).toBe(true);
    expect(gate.pairsSent).toBe(1);
  });

  it('an unlocated camera or unknown decoded frame resets partial proof',()=>{
    const gate=new PhotoTakeoutConfirm();
    expect(gate.claim('v',1500,true,true,1)).toBe(true);
    expect(gate.claim('v',2400,true,false,2)).toBe(false);
    expect(gate.waitingForSecond).toBe(false);
    expect(gate.claim('v',3400,true,true,3)).toBe(false);
    expect(gate.claim('v',4300,true,true,null)).toBe(false);
    expect(gate.claim('v',6200,true,true,4)).toBe(true);
    expect(gate.claim('v',7100,true,true,5)).toBe(true);
    expect(gate.pairsSent).toBe(1);
  });

  it('duplicates or reverse frame IDs are rejected',()=>{
    const gate=new PhotoTakeoutConfirm();
    expect(gate.claim('v',1500,true,true,10)).toBe(true);
    expect(gate.claim('v',2500,true,true,10)).toBe(false);
    expect(gate.claim('v',2600,true,true,9)).toBe(false);
    expect(gate.claim('v',2600,true,true,11)).toBe(true);
  });

  it('retries lost server acknowledgements four times, then yields to AI fallback',()=>{
    const gate=new PhotoTakeoutConfirm();
    for(let pair=0;pair<PHOTO_CLEAR_MAX_PAIRS;pair++){
      const at=1000+pair*(PHOTO_CLEAR_CONFIRM_SPACING_MS+PHOTO_CLEAR_RETRY_MS+50);
      expect(gate.claim('v',at,true,true,2*pair+1)).toBe(true);
      expect(gate.claim('v',at+PHOTO_CLEAR_CONFIRM_SPACING_MS,true,true,2*pair+2)).toBe(true);
    }
    expect(gate.hasBudget).toBe(false);
    expect(gate.claim('v',30000,true,true,20)).toBe(false);
  });

  it('stale server vote cannot be combined with a different interrupted photo sequence',()=>{
    const gate=new PhotoTakeoutConfirm(),server=new VerifiedBoardClear();
    expect(gate.claim('r',1000,true,true,1)).toBe(true);
    expect(server.observe(true,3,1000)).toBe(false);
    gate.invalidate('r',1200);
    for(const t of [1950,3000,4500,5600]){
      expect(gate.claim('r',t,true,true,t)).toBe(false);
    }
    const fresh=1000+PHOTO_CLEAR_INTERRUPTED_WAIT_MS;
    expect(gate.claim('r',fresh,true,true,5700)).toBe(true);
    expect(server.observe(true,3,fresh)).toBe(false);
    expect(server.confirmations).toBe(1);
    expect(gate.claim('r',fresh+900,true,true,6600)).toBe(true);
    expect(server.observe(true,3,fresh+900)).toBe(true);
  });

  it('resets all cached proof on actual visit ownership change',()=>{
    const gate=new PhotoTakeoutConfirm();
    expect(gate.claim('old',1500,true,true,20)).toBe(true);
    expect(gate.claim('new',1800,false,true,21)).toBe(false);
    expect(gate.claim('new',2800,true,true,22)).toBe(true);
    expect(gate.pairsSent).toBe(0);
    gate.reset();
    expect(gate.claim('new',4000,true,true,23)).toBe(true);
  });

  it('never counts unknown or malformed frame identifiers',()=>{
    const gate=new PhotoTakeoutConfirm();
    for(const id of [null,0,-1,NaN,Infinity,1.5]){
      expect(gate.claim('v',1500,true,true,id)).toBe(false);
    }
    expect(gate.reportsSent).toBe(0);
  });
});
