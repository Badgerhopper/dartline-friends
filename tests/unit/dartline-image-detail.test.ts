import { describe, expect, it } from 'vitest';
import { shouldUpgradeDetailModel } from '../../src/client/lib/imageDetail';

describe('DartLine iPhone high-detail default', () => {
  it('upgrades iPhone with GPU once for more dart pixels', () => {
    expect(shouldUpgradeDetailModel('s_960', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)', true, false)).toBe(true);
  });
  it('never overrides a user-selected 1280 model or a later 960 preference', () => {
    expect(shouldUpgradeDetailModel('s_1280', 'iPhone', true, false)).toBe(false);
    expect(shouldUpgradeDetailModel('s_960', 'iPhone', true, true)).toBe(false);
  });
  it('leaves CPU-only or non-phone devices on the faster model', () => {
    expect(shouldUpgradeDetailModel('s_960', 'iPhone', false, false)).toBe(false);
    expect(shouldUpgradeDetailModel('s_960', 'Windows Chrome', true, false)).toBe(false);
  });
});
