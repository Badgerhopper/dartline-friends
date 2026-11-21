/** Extra scans after missed dart-sized movement; never change normal takeout. */
export const ASSIST_INTERVAL_MS = 2600;
export interface AssistState {
  scoring: boolean;
  cameraActive: boolean;
  motionArmed: boolean;
  cameraView: string;
  visibility: string;
}
export function shouldScanStationaryBoard(s: AssistState): boolean {
  return s.scoring && s.cameraActive && s.motionArmed
    && s.cameraView === 'scoring' && s.visibility === 'visible';
}
