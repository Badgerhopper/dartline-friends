import { describe, expect, it } from 'vitest';
import { shouldRestoreClassicModel } from '../../src/client/lib/classicModel';

describe('DartLine v4 model rollback', () => {
  it('restores a previously auto-upgraded iPhone to 960 detail', () => {
    expect(shouldRestoreClassicModel('s_1280', 'Mozilla/5.0 (iPhone)', 'done', null)).toBe(true);
  });
  it('does not repeat the rollback after a user picks a different model', () => {
    expect(shouldRestoreClassicModel('s_1280', 'iPhone', 'done', 'done')).toBe(false);
  });
  it('respects non-iPhone devices and devices never exposed to auto-upgrade', () => {
    expect(shouldRestoreClassicModel('s_1280', 'Android', 'done', null)).toBe(false);
    expect(shouldRestoreClassicModel('s_1280', 'iPhone', null, null)).toBe(false);
    expect(shouldRestoreClassicModel('s_960', 'iPhone', 'done', null)).toBe(false);
  });
});
