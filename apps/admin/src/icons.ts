/**
 * Small inline-SVG icon set for admin nav/chrome, replacing raw emoji.
 * 18x18, 24-unit viewBox, stroke=currentColor — matches the hand-written chevron/hamburger
 * SVGs already used in index.html/main.ts. No icon library dependency.
 */

function icon(paths: string): string {
  return `<svg class="nav-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}

export const icons = {
  dashboard: icon('<rect x="3" y="3" width="7" height="9" rx="1.5"></rect><rect x="14" y="3" width="7" height="5" rx="1.5"></rect><rect x="14" y="12" width="7" height="9" rx="1.5"></rect><rect x="3" y="16" width="7" height="5" rx="1.5"></rect>'),
  tag: icon('<path d="M12 2h6a2 2 0 0 1 2 2v6a2 2 0 0 1-.59 1.41l-8 8a2 2 0 0 1-2.82 0l-6-6a2 2 0 0 1 0-2.82l8-8A2 2 0 0 1 12 2Z"></path><circle cx="15.5" cy="8.5" r="1.25"></circle>'),
  percent: icon('<circle cx="6.5" cy="6.5" r="2.5"></circle><circle cx="17.5" cy="17.5" r="2.5"></circle><line x1="19" y1="5" x2="5" y2="19"></line>'),
  box: icon('<path d="M21 8v8a1 1 0 0 1-.5.87l-8 4.62a1 1 0 0 1-1 0l-8-4.62A1 1 0 0 1 3 16V8"></path><path d="M3 8l9-5 9 5-9 5-9-5Z"></path><line x1="12" y1="13" x2="12" y2="21.5"></line>'),
  leaf: icon('<path d="M20 4C10 4 4 10 4 18v2h2c8 0 14-6 14-16Z"></path><path d="M6 18c4-4 8-8 14-14"></path>'),
  gauge: icon('<circle cx="12" cy="13" r="8"></circle><path d="M12 13l4-4"></path><path d="M9 5.5 8 3"></path><path d="M15 5.5 16 3"></path>'),
  factory: icon('<path d="M3 21V11l5 3v-3l5 3v-3l6 3.5V21Z"></path><path d="M3 21h18"></path><path d="M8 17v.01"></path><path d="M13 17v.01"></path>'),
  dollar: icon('<line x1="12" y1="2" x2="12" y2="22"></line><path d="M17 6H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>'),
  flame: icon('<path d="M12 2s5 5 5 10a5 5 0 0 1-10 0c0-1.5.7-2.6 1.5-3.6.3 1 1 1.6 1.5 1.6.7 0 1-1 .5-2.3C9.7 6 12 4 12 2Z"></path>'),
  ticket: icon('<path d="M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4Z"></path><line x1="10" y1="6" x2="10" y2="18" stroke-dasharray="2 2"></line>'),
  refresh: icon('<path d="M3 12a9 9 0 0 1 15.5-6.3L21 8"></path><path d="M21 3v5h-5"></path><path d="M21 12a9 9 0 0 1-15.5 6.3L3 16"></path><path d="M3 21v-5h5"></path>'),
  star: icon('<path d="M12 2.5l2.9 6 6.6.7-4.9 4.5 1.3 6.5L12 16.9l-5.9 3.3 1.3-6.5-4.9-4.5 6.6-.7Z"></path>'),
  megaphone: icon('<path d="M3 10v4a1 1 0 0 0 1 1h2l5 4v-14l-5 4H4a1 1 0 0 0-1 1Z"></path><path d="M16 8a5 5 0 0 1 0 8"></path><path d="M19 5a9 9 0 0 1 0 14"></path>'),
  send: icon('<path d="M22 2 11 13"></path><path d="M22 2 15 22l-4-9-9-4 20-7Z"></path>'),
  sparkle: icon('<path d="M11 2l1.8 5.4L18 9l-5.2 1.6L11 16l-1.8-5.4L4 9l5.2-1.6Z"></path><path d="M19 15l.9 2.6L22.5 18.5l-2.6.9L19 22l-.9-2.6-2.6-.9 2.6-.9Z"></path>'),
  truck: icon('<rect x="1" y="6" width="13" height="11"></rect><path d="M14 10h4l4 4v3h-8Z"></path><circle cx="6" cy="19" r="1.7"></circle><circle cx="16.5" cy="19" r="1.7"></circle>'),
  rocket: icon('<path d="M12 2c3.5 1 6 5 6 9-1 .5-2.2.8-3.5.8L12 22l-2.5-10.2C8.2 11.8 7 11.5 6 11c0-4 2.5-8 6-9Z"></path><circle cx="12" cy="9" r="1.6"></circle><path d="M8.5 15 6 17.5"></path><path d="M15.5 15 18 17.5"></path>'),
  home: icon('<path d="M4 11 12 4l8 7"></path><path d="M6 10v9a1 1 0 0 0 1 1h4v-6h2v6h4a1 1 0 0 0 1-1v-9"></path>'),
  layers: icon('<path d="M12 3 2 8l10 5 10-5-10-5Z"></path><path d="M2 12l10 5 10-5"></path><path d="M2 16l10 5 10-5"></path>'),
  calendar: icon('<rect x="3" y="5" width="18" height="16" rx="2"></rect><path d="M16 3v4"></path><path d="M8 3v4"></path><path d="M3 10h18"></path>'),
  bank: icon('<path d="M3 10 12 4l9 6"></path><path d="M5 10v9"></path><path d="M9 10v9"></path><path d="M15 10v9"></path><path d="M19 10v9"></path><path d="M3 21h18"></path>'),
  trending: icon('<path d="M3 17 10 10l4 4 7-7"></path><path d="M15 6h6v6"></path>'),
  target: icon('<circle cx="12" cy="12" r="8.5"></circle><circle cx="12" cy="12" r="4.5"></circle><circle cx="12" cy="12" r="0.8" fill="currentColor"></circle>'),
  calculator: icon('<rect x="4" y="2.5" width="16" height="19" rx="2"></rect><line x1="7" y1="6.5" x2="17" y2="6.5"></line><line x1="7" y1="11" x2="7" y2="11.01"></line><line x1="12" y1="11" x2="12" y2="11.01"></line><line x1="17" y1="11" x2="17" y2="11.01"></line><line x1="7" y1="15" x2="7" y2="15.01"></line><line x1="12" y1="15" x2="12" y2="15.01"></line><line x1="17" y1="15" x2="17" y2="18.5"></line><line x1="7" y1="18.5" x2="7" y2="18.51"></line><line x1="12" y1="18.5" x2="12" y2="18.51"></line>'),
  folder: icon('<path d="M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1Z"></path>'),

  // New for v2 redesign: command palette, toasts, KPI cards, empty states
  search: icon('<circle cx="11" cy="11" r="7"></circle><line x1="20" y1="20" x2="16.65" y2="16.65"></line>'),
  check: icon('<polyline points="20 6 9 17 4 12"></polyline>'),
  x: icon('<line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>'),
  inbox: icon('<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"></polyline><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11Z"></path>'),
  trendingUp: icon('<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"></polyline><polyline points="17 6 23 6 23 12"></polyline>'),
  trendingDown: icon('<polyline points="23 18 13.5 8.5 8.5 13.5 1 6"></polyline><polyline points="17 18 23 18 23 12"></polyline>'),
  plus: icon('<line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line>'),
  info: icon('<circle cx="12" cy="12" r="9"></circle><line x1="12" y1="11" x2="12" y2="16"></line><circle cx="12" cy="8" r="0.8" fill="currentColor"></circle>'),
  warning: icon('<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"></path><line x1="12" y1="9" x2="12" y2="13"></line><circle cx="12" cy="17" r="0.6" fill="currentColor"></circle>'),
  errorIcon: icon('<circle cx="12" cy="12" r="9"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line>'),
};

export type IconName = keyof typeof icons;
