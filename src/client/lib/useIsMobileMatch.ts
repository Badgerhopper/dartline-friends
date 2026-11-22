import { useEffect, useState } from 'react';
const QUERY = '(max-width: 700px)';
function matchesPhone(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    && window.matchMedia(QUERY).matches;
}
/** Mount a single match layout, instead of measuring a hidden desktop grid. */
export function useIsMobileMatch(): boolean {
  const [isMobile, setMobile] = useState(matchesPhone);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia(QUERY);
    const changed = () => setMobile(query.matches);
    changed();
    query.addEventListener('change', changed);
    return () => query.removeEventListener('change', changed);
  }, []);
  return isMobile;
}
