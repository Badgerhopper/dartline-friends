import { describe, expect, it } from 'vitest';
import { ASSIST_INTERVAL_MS, shouldScanStationaryBoard, type AssistState } from '../../src/client/lib/scanAssist';
const ready: AssistState = { scoring: true, cameraActive: true, motionArmed: true, cameraView: 'scoring', visibility: 'visible' };
describe('DartLine backup recognition eligibility', () => {
  it('scans the stationary board when a player is actively throwing', () => {
    expect(shouldScanStationaryBoard(ready)).toBe(true);
    expect(ASSIST_INTERVAL_MS).toBeGreaterThanOrEqual(2000);
  });
  it('never scans when not assigned to an active match', () => {
    expect(shouldScanStationaryBoard({ ...ready, scoring: false })).toBe(false);
  });
  it('never scans if the camera or automatic motion scan is off', () => {
    expect(shouldScanStationaryBoard({ ...ready, cameraActive: false })).toBe(false);
    expect(shouldScanStationaryBoard({ ...ready, motionArmed: false })).toBe(false);
  });
  it('never scans in a hidden frame or during calibration', () => {
    expect(shouldScanStationaryBoard({ ...ready, visibility: 'hidden' })).toBe(false);
    expect(shouldScanStationaryBoard({ ...ready, cameraView: 'calibration' })).toBe(false);
    expect(shouldScanStationaryBoard({ ...ready, cameraView: 'onboarding' })).toBe(false);
  });
});
