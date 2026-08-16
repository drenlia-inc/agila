import { useEffect, useState } from 'react';
import { isMobileViewport, MOBILE_VIEWPORT_QUERY } from '../utils/mobileViewport';

/** Reactive match for phone-sized viewports (`max-width: 767px`). */
export function useIsMobileViewport(): boolean {
  const [mobile, setMobile] = useState(() => isMobileViewport());

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia(MOBILE_VIEWPORT_QUERY);
    const sync = () => setMobile(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  return mobile;
}
