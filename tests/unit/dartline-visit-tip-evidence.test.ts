import { describe, expect, it } from 'vitest';
import { VisitTipEvidence } from '../../src/client/lib/visitTipEvidence';

describe('per-visit evidence for dart-removal arming', () => {
  it('persists positive recognized tips if the latest frame is blind at the third dart', () => {
    const e=new VisitTipEvidence();
    e.updateVisit('match:leg1:visit1',true);
    e.observePositive(true,1,false);
    e.observePositive(true,0,false);
    expect(e.seenDuringThisVisit).toBe(true);
  });
  it('clears evidence for every subsequent visit, even with same player', () => {
    const e=new VisitTipEvidence();
    for(let i=0;i<4;i++) {
      e.updateVisit('match:leg1:visit'+i,true);
      expect(e.seenDuringThisVisit).toBe(false);
      e.observePositive(true,1,false);
      expect(e.seenDuringThisVisit).toBe(true);
    }
  });
  it('does not count observations outside server-assigned turns or during takeout', () => {
    const e=new VisitTipEvidence();
    e.updateVisit('match:visit1',true);
    e.observePositive(false,2,false);
    e.observePositive(true,3,true);
    expect(e.seenDuringThisVisit).toBe(false);
  });
  it('disarms evidence when a remote player owns the next turn', () => {
    const e=new VisitTipEvidence();
    e.updateVisit('match:visit1',true);
    e.observePositive(true,1,false);
    e.updateVisit('match:visit2',false);
    expect(e.seenDuringThisVisit).toBe(false);
    e.updateVisit('match:visit3',true);
    expect(e.seenDuringThisVisit).toBe(false);
  });
  it('refuses a frame with no tips and handles first context event safely', () => {
    const e=new VisitTipEvidence();
    e.observePositive(true,0,false);
    e.updateVisit('match:visit1',true);
    expect(e.seenDuringThisVisit).toBe(false);
  });
});
