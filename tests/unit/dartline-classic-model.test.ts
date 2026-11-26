import { describe, expect, it } from 'vitest';
import { shouldRecoverBoardDetail } from '../../src/client/lib/classicModel';

const recover = (
  model='s_960', ua='Mozilla/5.0 (iPhone)', previous='done',
  downgrade='done', recovery=null as string|null, gpu=true,
) => shouldRecoverBoardDetail(model, ua, previous, downgrade, recovery, gpu);

describe('Restore board localization after the v3.2 resolution regression', () => {
  it('undoes the exact v3.2 downgrade even if a PWA stops exposing GPU', () => {
    expect(recover()).toBe(true);
    expect(recover('s_960', 'iPhone', 'done', 'done', null, false)).toBe(true);
  });
  it('makes the original first-time high-detail choice only with GPU support', () => {
    expect(recover('s_960', 'iPhone', null, null, null, true)).toBe(true);
    expect(recover('s_960', 'iPhone', null, null, null, false)).toBe(false);
  });
  it('respects manual model settings and other devices', () => {
    expect(recover('s_1280')).toBe(false);
    expect(recover('s_960', 'Android')).toBe(false);
    expect(recover('s_960', 'iPhone', 'done', null)).toBe(false);
    expect(recover('s_960', 'iPhone', 'done', 'done', 'done')).toBe(false);
  });
});
