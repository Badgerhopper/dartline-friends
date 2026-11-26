import {describe,it,expect} from 'vitest';
import { MotionRescueGate } from '../../src/client/lib/motionRescueGate';

describe('One backup inference per physical dart movement',()=>{
  it('never scans an idle stationary board',()=>{
    const scan=new MotionRescueGate();
    scan.observe('idle',1000);
    for(let t=1200;t<20000;t+=1200) expect(scan.claim(t,true)).toBe(null);
  });
  it('waits for the impact to settle before scanning once',()=>{
    const scan=new MotionRescueGate();
    scan.observe('pending',1000);
    expect(scan.claim(1800,true)).toBe(null);
    scan.observe('triggered',1900);
    const token=scan.claim(2000,true);
    expect(token).not.toBe(null);
    expect(scan.claim(2200,true)).toBe(null);
    scan.finish(token!,2500>0);
    expect(scan.claim(3200,true)).toBe(null);
  });
  it('retries busy AI calls but never counts skipped calls',()=>{
    const scan=new MotionRescueGate();
    scan.observe('pending',1000);
    scan.observe('idle',1700);
    const old=scan.claim(2200,true);
    expect(old).not.toBe(null);
    scan.finish(old!,false);
    const next=scan.claim(2400,true);
    expect(next).toBe(old);
    scan.finish(next!,true);
    expect(scan.claim(2700,true)).toBe(null);
  });
  it('grants one fresh scan for the next separate dart, but not duplicate pending reports',()=>{
    const scan=new MotionRescueGate();
    scan.observe('pending',1000);
    scan.observe('pendingLarge',1300);
    scan.observe('triggered',2000);
    const a=scan.claim(2100,true)!;
    scan.finish(a,true);
    expect(scan.claim(5000,true)).toBe(null);
    scan.observe('pending',5200);
    scan.observe('idle',5400);
    const b=scan.claim(6200,true)!;
    expect(b).not.toBe(a);
  });
  it('never scans when hidden or a different player has the turn',()=>{
    const scan=new MotionRescueGate();
    scan.observe('pending',1000);
    scan.observe('triggered',1900);
    expect(scan.claim(2000,false)).toBe(null);
    expect(scan.claim(2000,true)).not.toBe(null);
  });
});
