/** DartLine same-phone scorer preferences. Never store pairing secrets here. */
const KEY = 'dartline_phone_camera_enabled_v1';

export function loadPhoneCameraEnabled(): boolean {
  try { return window.localStorage.getItem(KEY) === '1'; }
  catch { return false; }
}
export function savePhoneCameraEnabled(enabled: boolean): void {
  try {
    if (enabled) window.localStorage.setItem(KEY, '1');
    else window.localStorage.removeItem(KEY);
  } catch { /* private browsing still works for this session */ }
}
/** The scorer URL is always same-origin; pairing codes are six server-minted characters. */
export function scorerPath(code: string): string {
  if (!code) return '/scorer';
  if (!/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/.test(code)) throw new Error('Invalid scorer pairing code');
  return '/scorer?code=' + encodeURIComponent(code);
}
