/** DartLine's motion detector is intentionally idle between physical throws.
 * A lack of model inferences does not imply a stalled camera. Use the media
 * scanner's actual frame analysis rate and the scorer iframe heartbeat. */
export interface CameraHealth {
  cameraActive:boolean;
  scoring:boolean;
  scanning:boolean;
  motionFps:number;
  lastHealthAt:number;
  armedSince:number;
  error:string|null;
}
export function cameraHealthLabel(report:CameraHealth|null,now:number):string {
  if (!report) return 'Connecting camera';
  if (!report.cameraActive) return 'Camera off';
  if (report.error) return 'AI error · open camera';
  if (!report.scoring) return 'Camera not assigned';
  if (!report.scanning) return 'Auto scan off';
  if (now-report.lastHealthAt>9000) return 'Camera link paused';
  if (report.motionFps>=0.5) return 'Watching for dart';
  if (now-report.armedSince<12000) return 'Starting camera scan';
  return 'Camera feed paused';
}
