import { describe, expect, it } from 'vitest';
import { RemovalMonitor, REMOVAL_MAX_COMPLETED_SCANS } from '../../src/client/lib/removalMonitor';

describe('DartLine opt-in removal monitor', () => {
  it('does not treat a still-pending third throw as removal', () => {
    const gate = new RemovalMonitor();
    gate.update(true, 'pending', 1000);
    gate.update(true, 'pendingLarge', 1100);
    expect(gate.claim(5000,true,true)).toBe(null);
    gate.update(true, 'idle', 1500);
    expect(gate.claim(5000,true,true)).toBe(null);
    gate.update(true, 'pending', 6000);
    expect(gate.claim(6500,true,true)).toBe(null);
    gate.update(true, 'idle', 6600);
    expect(gate.claim(6900,true,true)).not.toBe(null);
  });
  it('waits until movement settles and is enabled only while a turn is armed', () => {
    const gate = new RemovalMonitor();
    gate.update(true,'idle',1000);
    gate.update(true,'pending',2000);
    expect(gate.claim(3000,true,true)).toBe(null);
    gate.update(true,'idle',3100);
    expect(gate.claim(3100,false,true)).toBe(null);
    expect(gate.claim(3100,true,false)).toBe(null);
    const token = gate.claim(3100,true,true);
    expect(token).not.toBe(null);
    expect(gate.claim(4200,true,true)).toBe(null);
    gate.complete(token!,4600,true);
    expect(gate.claim(5000,true,true)).toBe(null);
    expect(gate.claim(5550,true,true)).not.toBe(null);
  });
  it('retries an AI request ignored because a different inference was busy', () => {
    const gate = new RemovalMonitor();
    gate.update(true,'idle',1000);
    gate.update(true,'pending',2000);
    gate.update(true,'idle',2500);
    const first = gate.claim(3000,true,true);
    expect(first).not.toBe(null);
    gate.complete(first!,3100,false);
    expect(gate.completed).toBe(0);
    expect(gate.claim(3350,true,true)).not.toBe(null);
  });
  it('requires genuinely completed frames and bounds the work to six scans', () => {
    const gate = new RemovalMonitor();
    gate.update(true,'idle',1000);
    gate.update(true,'pending',2000);
    gate.update(true,'idle',2500);
    for (let i=0; i<REMOVAL_MAX_COMPLETED_SCANS; i++) {
      const at=3100+i*1000;
      const token=gate.claim(at,true,true);
      expect(token).not.toBe(null);
      gate.complete(token!,at+50,true);
    }
    expect(gate.claim(10000,true,true)).toBe(null);
    gate.update(false,'idle',10500);
    expect(gate.claim(11000,true,true)).toBe(null);
  });
  it('invalidates a pending result after a new retrieval movement', () => {
    const gate = new RemovalMonitor();
    gate.update(true,'idle',1000);
    gate.update(true,'pending',2000);
    gate.update(true,'idle',2500);
    const old=gate.claim(3000,true,true);
    gate.update(true,'pending',3200);
    gate.update(true,'idle',3500);
    gate.complete(old!,4000,true);
    expect(gate.completed).toBe(0);
    expect(gate.claim(4200,true,true)).not.toBe(null);
  });
});
