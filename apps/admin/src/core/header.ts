/**
 * Top-bar header wiring. Owns the Cmd+K command palette and the new
 * "Ask Maya" button, both of which open overlays that float over the
 * current page (the command palette is global; Maya is the operations
 * chat drawer).
 */
import { initCommandPalette } from './cmdK';
import { openAdminAgent } from '../features/agent';

export function initHeader(): void {
  initCommandPalette();
  document.getElementById('btn-open-admin-agent')?.addEventListener('click', () => openAdminAgent());
}
