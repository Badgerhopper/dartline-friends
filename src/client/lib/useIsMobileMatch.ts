import { useEffect, useState } from 'react';
const QUERY = '(max-width: 700px)';
function matchesPhone(): boolean {
  if (typeof window === 'undefined') return false;
  // iPhone Safari can request a desktop viewport, but a mounted phone should
  // never fall back to the tall desktop match grid.
  if (/iPhone|iPod|Android.*Mobile/i.test(navigator.userAgent)) return true;
  if (typeof window.matchMedia !== 'function') return window.innerWidth <= 700;
  return window.matchMedia(QUERY).matches;
}
/** Mount a single match layout, instead of measuring a hidden desktop grid. */
export function useIsMobileMatch(): boolean {
  const [isMobile, setMobile] = useState(matchesPhone);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia(QUERY);
    const changed = () => setMobile(matchesPhone());
    changed();
    query.addEventListener('change', changed);
    return () => query.removeEventListener('change', changed);
  }, []);
  return isMobile;
}
