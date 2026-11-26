/** Camera status is advisory. Idle motion inference is normal and a delayed
 * iframe timer is not evidence that the video/camera link has stopped.
 * Never tear down the scoring iframe from a heartbeat timeout. */
export interface CameraHealth {
  cameraActive:boolean;
  scoring:boolean;
  scanning:boolean;
  motionFps:number;
  lastHealthAt:number;
  armedSince:number;
  error:string|null;
}
export const CAMERA_STATUS_DELAY_MS = 15000;

export function cameraHealthLabel(report:CameraHealth|null,now:number):string {
  if (!report) return 'Connecting camera';
  if (!report.cameraActive) return 'Camera off';
  if (report.error) return 'AI error · open camera';
  if (!report.scoring) return 'Camera not assigned';
  if (!report.scanning) return 'Auto scan off';
  // A slow 1280px inference on mobile can postpone the React heartbeat.
  // Do not claim the camera link failed when only the status is stale.
  if (Number.isFinite(now) && now - report.lastHealthAt > CAMERA_STATUS_DELAY_MS) {
    return 'Camera update delayed';
  }
  if (report.motionFps>=0.5) return 'Watching for dart';
  if (now-report.armedSince<12000) return 'Starting camera scan';
  return 'Camera feed waiting';
}
