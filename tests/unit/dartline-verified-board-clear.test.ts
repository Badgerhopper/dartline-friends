import { describe, it, expect } from 'vitest';
import {VerifiedBoardClear, CLEAR_BOARD_CONFIRMATION_MS, CLEAR_BOARD_MAX_GAP_MS} from '../../src/server/scoring/verifiedBoardClear';

describe('DartLine opt-in verified board-clear auto-submit',()=>{
  it('never submits empty or incomplete visits',()=>{
    const g=new VerifiedBoardClear();
    for (const n of [0,1,2]) {
      expect(g.observe(true,n,1000)).toBe(false);
      expect(g.observe(true,n,2200)).toBe(false);
    }
  });
  it('requires two separately timed clear-board scans',()=>{
    const g=new VerifiedBoardClear();
    expect(g.observe(true,3,1000)).toBe(false);
    expect(g.observe(true,3,1500)).toBe(false);
    expect(g.observe(true,3,1000+CLEAR_BOARD_CONFIRMATION_MS)).toBe(true);
  });
  it('a visible dart between clear scans cancels pending submission',()=>{
    const g=new VerifiedBoardClear();
    expect(g.observe(true,3,1000)).toBe(false);
    expect(g.observe(false,3,1200)).toBe(false);
    expect(g.observe(true,3,2400)).toBe(false);
    expect(g.observe(true,3,3200)).toBe(true);
  });
  it('cannot use stale or out-of-order camera readings',()=>{
    const g=new VerifiedBoardClear();
    g.observe(true,3,1000);
    expect(g.observe(true,3,900)).toBe(false);
    expect(g.observe(true,3,1001)).toBe(false);
  });
  it('a very old empty report never combines with a new empty photo',()=>{
    const g=new VerifiedBoardClear();
    expect(g.observe(true,3,1000)).toBe(false);
    expect(g.observe(true,3,1000+CLEAR_BOARD_MAX_GAP_MS+1)).toBe(false);
    expect(g.confirmations).toBe(1);
    expect(g.observe(true,3,1000+CLEAR_BOARD_MAX_GAP_MS+1+CLEAR_BOARD_CONFIRMATION_MS)).toBe(true);
  });
  it('repeated stale reports cannot keep an old partial confirmation alive',()=>{
    const g=new VerifiedBoardClear();
    for(let i=0;i<5;i++){
      expect(g.observe(true,3,1000+i*(CLEAR_BOARD_MAX_GAP_MS+100))).toBe(false);
      expect(g.confirmations).toBe(1);
    }
  });
  it('resets on player turn or preference change',()=>{
    const g=new VerifiedBoardClear();
    g.observe(true,3,1000);
    g.reset();
    expect(g.observe(true,3,2000)).toBe(false);
  });
});
