/**
 * Top-bar header wiring. Today this is just a passthrough for the Cmd+K
 * keyboard listener (which lives in core/cmdK.ts), but keeping initHeader()
 * gives us a clear place to add scroll-driven header effects later
 * (e.g. compact the bar on scroll, show a "modified" indicator, etc.).
 */
import { initCommandPalette } from './cmdK';

export function initHeader(): void {
  initCommandPalette();
}
