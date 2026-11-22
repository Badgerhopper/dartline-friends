import { describe, it, expect } from 'vitest';
import { correctedDart } from '../../src/client/lib/manualCorrection';
describe('DartLine mobile correction uses canonical board scoring',()=>{
 it('places a T20 in the middle of triple 20',()=>{const d=correctedDart('20','triple');expect(d.score).toMatchObject({label:'T20',points:60});});
 it('places a double 16 for a checkout correction',()=>{expect(correctedDart('16','double').score).toMatchObject({label:'D16',points:32});});
 it('places a single 5 correctly',()=>{expect(correctedDart('5','single').score).toMatchObject({label:'S5',points:5});});
 it('handles bull and bullseye',()=>{expect(correctedDart('BULL','single').score.points).toBe(25);expect(correctedDart('BULL','double').score.points).toBe(50);});
 it('rejects made-up segments and triple bull',()=>{expect(()=>correctedDart('21','triple')).toThrow();expect(()=>correctedDart('BULL','triple')).toThrow();});
});
