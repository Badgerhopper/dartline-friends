import { describe, expect, it } from 'vitest';
import { matchKnownCameraTips, SAME_CAMERA_REPEAT_RADIUS } from '../../src/server/scoring/repeatGuard';
import { filterKnownTips, clusterNewTips } from '../../src/server/scoring/cluster';
import { DartTracker } from '../../src/server/scoring/tracker';
import type { DartPoint } from '../../src/shared/vision/types';

const point = (x:number,deviceId='phone',y=500000,confidence=.9):DartPoint=>
  ({x,y,confidence,deviceId});
const known = (x:number,deviceId='phone') => ({
  x,y:500000,confidence:.95,observations:[point(x,deviceId)]
});

describe('DartLine cross-scan repeat protection', () => {
  it('suppresses a real previously recorded tip that jitters beyond old 1.7mm filter', () => {
    const matched = matchKnownCameraTips([point(507000)],[known(500000)]);
    expect(matched.has(0)).toBe(true);
    const filtered = filterKnownTips([point(507000)],[known(500000)]);
    expect(filtered.survivors).toEqual([]);
  });
  it('does not create a second score from consecutive scans of the same physical dart', () => {
    const first = filterKnownTips([point(500000)],[]);
    expect(first.survivors).toHaveLength(1);
    const tracked = [known(500000)];
    for (const x of [502000,507000,511000,499000]) {
      expect(filterKnownTips([point(x)],tracked).survivors).toHaveLength(0);
    }
  });
  it('preserves two close physical darts when both tips are visible', () => {
    const filtered=filterKnownTips([point(500700),point(505700)],[known(500000)]);
    expect(filtered.survivors.map(t=>t.x)).toEqual([505700]);
  });
  it('still counts a clearly new dart even if the old dart disappears from the frame', () => {
    const x=500000+SAME_CAMERA_REPEAT_RADIUS+2500;
    expect(filterKnownTips([point(x)],[known(500000)]).survivors).toHaveLength(1);
  });
  it('does not let one known dart swallow two simultaneous close tips', () => {
    const matched=matchKnownCameraTips([point(500500),point(503000)], [known(500000)]);
    expect(matched.size).toBe(1);
  });
  it('does not cross-attach independent board cameras as repeated sightings', () => {
    expect(matchKnownCameraTips([point(503000,'remote')],[known(500000)]).size).toBe(0);
    expect(filterKnownTips([point(503000,'remote')],[known(500000)]).survivors).toHaveLength(0);
  });
  it('preserves two distinct same-camera tip keypoints inside one window', () => {
    // The custom single-camera rule must not merge a second real dart solely
    // because its tip is close to the first. Exact duplicates are removed
    // earlier in image-space keypoint deduplication.
    expect(clusterNewTips([point(500000),point(501000)])).toHaveLength(2);
  });
});

describe('Full DartTracker duplicate score regression', () => {
  it('one dart remains one score when its projected tip shifts between frames', () => {
    const tracker = new DartTracker();
    const first = tracker.ingest([{deviceId:'phone',tips:[{
      x:560000,y:500000,confidence:.93
    }]}]);
    expect(first).toHaveLength(1);
    const sameDart = tracker.ingest([{deviceId:'phone',tips:[{
      x:568500,y:500000,confidence:.90
    }]}]);
    expect(sameDart).toHaveLength(0);
    expect(tracker.count).toBe(1);
  });

  it('a genuinely second, close dart remains countable when both tips appear', () => {
    const tracker = new DartTracker();
    expect(tracker.ingest([{deviceId:'phone',tips:[{
      x:560000,y:500000,confidence:.96
    }]}])).toHaveLength(1);
    const second = tracker.ingest([{deviceId:'phone',tips:[
      {x:560500,y:500000,confidence:.97},
      {x:566000,y:500000,confidence:.89},
    ]}]);
    expect(second).toHaveLength(1);
    expect(tracker.count).toBe(2);
  });
});
