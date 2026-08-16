/** Tailwind `md` — phones and small portrait devices (matches MobileUnoptimizedBanner). */
export const MOBILE_VIEWPORT_QUERY = '(max-width: 767px)';

export function isMobileViewport(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia(MOBILE_VIEWPORT_QUERY).matches;
}
