import { useLayoutEffect, useState } from 'react';

export const APP_HEADER_STICKY_SELECTOR = 'header[data-tour-id="navigation"]';
export const APP_HEADER_STICKY_TOP_FALLBACK_PX = 64;

/** Measured height of the sticky app header — use as `top` for viewport-sticky list chrome. */
export function useAppHeaderStickyTop(): number {
  const [topPx, setTopPx] = useState(APP_HEADER_STICKY_TOP_FALLBACK_PX);

  useLayoutEffect(() => {
    const header = document.querySelector(APP_HEADER_STICKY_SELECTOR);
    if (!header) return;

    const sync = () => {
      setTopPx(Math.ceil(header.getBoundingClientRect().height));
    };

    sync();
    const resizeObserver = new ResizeObserver(sync);
    resizeObserver.observe(header);
    window.addEventListener('resize', sync);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', sync);
    };
  }, []);

  return topPx;
}
