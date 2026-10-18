// App-wide state with a tiny pub/sub. Components read `state` and subscribe to change keys.
import { isNightHour } from './core/params.js';

const listeners = new Map();
export const state = {
  mode: 'citizen',          // 'citizen' | 'policy'
  tab: { citizen: 'route', policy: 'vuln' },
  minutes: 8 * 60 + 40,     // 시연 시각 (분)
  nightAuto: true,
  nightForce: false,
  trip: null,               // { from, to, result, choice }
  ride: null,               // active ride simulation
  selectedCell: null,
  selectedHub: null,
  layers: { grades: true, hubs: true, transit: true, taas: true, crossings: false, cctv: false, lights: false, contours: true, reports: true, grid: false },
  gridMetric: 'ptvi',
};

export const hour = () => Math.floor(state.minutes / 60) % 24;
export const isNight = () => state.nightForce || (state.nightAuto && isNightHour(hour()));

export function on(key, fn) { if (!listeners.has(key)) listeners.set(key, new Set()); listeners.get(key).add(fn); return () => listeners.get(key).delete(fn); }
export function emit(key, payload) { (listeners.get(key) || []).forEach(fn => { try { fn(payload); } catch (e) { console.error(e); } }); }
export function set(patch, key = 'state') { Object.assign(state, patch); emit(key, patch); }

// per-viewer conveniences (remembered tab/time) — never required
export const prefs = {
  get(k, d) { try { const v = localStorage.getItem('klink.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('klink.' + k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};
