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
