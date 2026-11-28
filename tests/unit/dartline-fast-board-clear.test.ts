import { describe, expect, it } from 'vitest';
import { FastBoardClear, FAST_CLEAR_ARM_GRACE_MS, FAST_CLEAR_SERVER_SPACING_MS } from '../../src/client/lib/fastBoardClear';
import { VerifiedBoardClear } from '../../src/server/scoring/verifiedBoardClear';

function ready() {
  const gate = new FastBoardClear();
  gate.arm(true,1000,true);
  return gate;
}
function scan(gate:FastBoardClear,when:number,kind:'occupied'|'empty'|'unlocated'|'skipped') {
  const token=gate.claim(when,true);
  expect(token).not.toBeNull();
  return gate.finish(token!,when+20,kind);
}
describe('fast independent dart-removal verifier',()=>{
  it('never reports empty before having observed a dart-filled board',()=>{
    const gate=new FastBoardClear();
    gate.arm(true,1000,false);
    expect(scan(gate,2000,'empty')).toBeNull();
    expect(scan(gate,2800,'empty')).toBeNull();
    expect(scan(gate,3600,'empty')).toBeNull();
    expect(gate.emptyReportsSent).toBe(0);
  });
  it('cannot submit based only on repeated AI misses when darts remain',()=>{
    const gate=ready();
    expect(scan(gate,2000,'empty')).toBeNull();
    expect(scan(gate,2800,'empty')).toBeNull();
    expect(scan(gate,3700,'empty')).toBeNull();
    expect(gate.emptyReportsSent).toBe(0);
  });
  it('uses genuine detector OR independent visual retrieval motion to confirm two empty scans',()=>{
    const gate=ready();
    gate.noteRetrievalMotion();
    expect(scan(gate,2000,'empty')).toBe('send-empty');
    expect(scan(gate,2900,'empty')).toBe('send-empty');
  });
  it('retries a lost two-empty submission pair without additional hand motion',()=>{
    const gate=ready();
    gate.noteRetrievalMotion();
    expect(scan(gate,2000,'empty')).toBe('send-empty');
    expect(scan(gate,2900,'empty')).toBe('send-empty');
    // Previously the gate NEVER retried after sending exactly two.
    expect(gate.claim(3900,true)).toBeNull();
    expect(scan(gate,5700,'empty')).toBe('send-empty');
    expect(scan(gate,6600,'empty')).toBe('send-empty');
    expect(gate.retriesUsed).toBe(1);
  });
  it('limits repeated empty-report pairs and will not flood the server forever',()=>{
    const gate=ready();
    gate.noteRetrievalMotion();
    for(const offset of [0,3800,7600]){
      expect(scan(gate,2000+offset,'empty')).toBe('send-empty');
      expect(scan(gate,2900+offset,'empty')).toBe('send-empty');
    }
    expect(gate.claim(15000,true)).toBeNull();
    expect(gate.retriesUsed).toBe(2);
  });
  it('will not retry a pair if a new visit begins before the delayed scan',()=>{
    const gate=ready();
    gate.noteRetrievalMotion();
    scan(gate,2000,'empty');
    scan(gate,2900,'empty');
    gate.arm(false,3500);
    gate.arm(true,4500,false);
    expect(scan(gate,5400,'empty')).toBeNull();
    expect(gate.retriesUsed).toBe(0);
  });
  it('a confirmed empty-board photograph overrules brief phantom model tips',()=>{
    const gate=ready();
    gate.noteVisualClear(1550); // positive occupied evidence was already seen
    expect(gate.hasStrongPhotoClear).toBe(true);
    // The model falsely predicts one point on the empty board, but these
    // are independent board-located AI frames after physical clear proof.
    expect(scan(gate,2000,'occupied')).toBe('send-empty');
    expect(scan(gate,2900,'occupied')).toBe('send-empty');
    expect(gate.emptyReportsSent).toBe(2);
  });
  it('never uses an expired or unqualified photo as an empty-board override',()=>{
    const unqualified=new FastBoardClear();
    unqualified.arm(true,1000,false);
    unqualified.noteVisualClear(1500);
    expect(unqualified.hasStrongPhotoClear).toBe(false);
    const gate=ready();
    gate.noteVisualClear(1550);
    expect(scan(gate,7600,'occupied')).toBeNull();
    expect(gate.emptyReportsSent).toBe(0);
  });
  it('photo proof never survives an actual visit reset',()=>{
    const gate=ready();
    gate.noteVisualClear(1500);
    gate.arm(false,1650);
    gate.arm(true,2000,true);
    expect(gate.hasStrongPhotoClear).toBe(false);
    expect(scan(gate,3000,'occupied')).toBeNull();
  });
  it('occupied evidence cancels a suspected takeout and resets the server',()=>{
    const gate=ready();
    gate.noteRetrievalMotion();
    const server=new VerifiedBoardClear();
    expect(scan(gate,2000,'empty')).toBe('send-empty');
    expect(server.observe(true,3,2020)).toBe(false);
    expect(scan(gate,2800,'occupied')).toBe('send-occupied');
    expect(server.observe(false,3,2820)).toBe(false);
    expect(scan(gate,3700,'empty')).toBe('send-empty');
    expect(server.observe(true,3,3720)).toBe(false);
    expect(scan(gate,4600,'empty')).toBe('send-empty');
    expect(server.observe(true,3,4620)).toBe(true);
  });
  it('unlocated and busy frames never count as an empty board',()=>{
    const gate=ready();
    gate.noteRetrievalMotion();
    expect(scan(gate,2000,'unlocated')).toBeNull();
    expect(scan(gate,2800,'skipped')).toBeNull();
    expect(scan(gate,3600,'empty')).toBe('send-empty');
    expect(scan(gate,4400,'occupied')).toBe('send-occupied');
    expect(scan(gate,5300,'empty')).toBe('send-empty');
  });
  it('recovers from an unresolved iPhone inference without a toggle',()=>{
    const gate=ready();
    gate.noteRetrievalMotion();
    const old=gate.claim(2000,true)!;
    expect(gate.claim(8300,true)).toBeNull();
    const restarted=gate.claim(8601,true);
    expect(restarted).not.toBeNull();
    expect(restarted).not.toBe(old);
    // Late completion of the old camera callback MUST NOT count as empty.
    expect(gate.finish(old,8660,'empty')).toBeNull();
    expect(gate.finish(restarted!,8690,'empty')).toBe('send-empty');
    const second=gate.claim(9600,true)!;
    expect(gate.finish(second,9670,'empty')).toBe('send-empty');
  });
  it('a competing inference is retried and never consumes a confirmation',()=>{
    const gate=ready();
    const token=gate.claim(2000,true)!;
    expect(gate.claim(2100,true)).toBeNull();
    expect(gate.finish(token,2100,'skipped')).toBeNull();
    const next=gate.claim(2150,true);
    expect(next).not.toBeNull();
    expect(gate.finish(next!,2200,'empty')).toBeNull();
  });
  it('disarming invalidates an in-flight request before the next player turn',()=>{
    const gate=ready();
    const token=gate.claim(2000,true)!;
    gate.arm(false,2100);
    gate.arm(true,3000,false);
    expect(gate.finish(token,3200,'empty')).toBeNull();
    expect(gate.emptyReportsSent).toBe(0);
  });
  it('does not shortcut grace and independently spaced real frames',()=>{
    const gate=ready();
    expect(gate.claim(1000+FAST_CLEAR_ARM_GRACE_MS-1,true)).toBeNull();
    expect(FAST_CLEAR_SERVER_SPACING_MS).toBeGreaterThanOrEqual(750);
    const token=gate.claim(1800,true)!;
    expect(gate.finish(token,1850,'empty')).toBeNull();
    expect(gate.claim(2000,true)).toBeNull();
    expect(gate.claim(2420,true)).not.toBeNull();
  });
});

describe('fresh occupied image supersedes previous photo proof',()=>{
 it('does not submit using an earlier clear image once a fresh occupied photo arrives',()=>{
   const gate=new FastBoardClear();
   gate.arm(true,1000,true);
   gate.noteVisualClear(1800);
   expect(gate.finish(gate.claim(2000,true)!,2000,'occupied')).toBe('send-empty');
   gate.invalidatePhotoClear();
   expect(gate.finish(gate.claim(2900,true)!,2900,'occupied')).toBe('send-occupied');
   expect(gate.emptyReportsSent).toBe(0);
 });
});
