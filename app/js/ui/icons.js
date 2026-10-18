// Simple line icons (24×24, currentColor) — trusted static markup used with h(..., { html }).
const s = d => `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
export const ICON = {
  scooter: s('<circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M6 18h9l2-11h3"/><path d="M15 7h-3"/>'),
  walk: s('<circle cx="13" cy="4.5" r="1.8"/><path d="M11 21l2-6 3 2v4"/><path d="M8 12l3-4 3 1 2 3"/><path d="M13 15l-1-6"/>'),
  wheelchair: s('<circle cx="10" cy="4.5" r="1.8"/><path d="M10 7v6h6l2 5"/><path d="M10 10h5"/><path d="M8 11.5a5 5 0 1 0 6.5 6.5"/>'),
  cane: s('<circle cx="11" cy="4.5" r="1.8"/><path d="M11 7l-1 6 2 3v5"/><path d="M10 13l-2 8"/><path d="M12 9l3 3"/><path d="M15 12l4 9"/>'),
  slope: s('<path d="M3 19h18"/><path d="M3 19l18-9"/><path d="M8 19v-2.5"/><path d="M13 19v-5"/>'),
  bus: s('<rect x="4" y="4" width="16" height="13" rx="2.5"/><path d="M4 11h16"/><circle cx="8" cy="20" r="1.3"/><circle cx="16" cy="20" r="1.3"/><path d="M8 17v1.7M16 17v1.7"/>'),
  taxi: s('<path d="M4 16v-4l2-5h12l2 5v4z"/><circle cx="7.5" cy="16.5" r="1.5"/><circle cx="16.5" cy="16.5" r="1.5"/><path d="M10 5h4"/>'),
  speaker: s('<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16.5 8.5a5 5 0 0 1 0 7"/><path d="M19 6a8.5 8.5 0 0 1 0 12"/>'),
  pin: s('<path d="M12 21s-6-5.5-6-11a6 6 0 0 1 12 0c0 5.5-6 11-6 11z"/><circle cx="12" cy="10" r="2.2"/>'),
  play: s('<path d="M7 5l12 7-12 7z"/>'),
  pause: s('<path d="M8 5v14M16 5v14"/>'),
  prev: s('<path d="M15 6l-6 6 6 6"/>'),
  next: s('<path d="M9 6l6 6-6 6"/>'),
  repeat: s('<path d="M4 12a8 8 0 0 1 14-5l2 2"/><path d="M20 4v5h-5"/>'),
};
