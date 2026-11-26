import { describe, expect, it } from 'vitest';
import { shouldRecoverBoardDetail } from '../../src/client/lib/classicModel';

const recover = (
  model='s_960', ua='Mozilla/5.0 (iPhone)', previous='done',
  downgrade='done', recovery=null as string|null, gpu=true,
) => shouldRecoverBoardDetail(model, ua, previous, downgrade, recovery, gpu);

describe('Restore iPhone board localization after the v3.2 regression', () => {
  it('undoes the exact v3.2 high-detail downgrade on an affected iPhone', () => {
    expect(recover()).toBe(true);
  });
  it('never alters the model for other phones, manually chosen models, or older setups', () => {
    expect(recover('s_1280')).toBe(false);
    expect(recover('s_960', 'Android')).toBe(false);
    expect(recover('s_960', 'iPhone', null)).toBe(false);
    expect(recover('s_960', 'iPhone', 'done', null)).toBe(false);
    expect(recover('s_960', 'iPhone', 'done', 'done', 'done')).toBe(false);
    expect(recover('s_960', 'iPhone', 'done', 'done', null, false)).toBe(false);
  });
});
