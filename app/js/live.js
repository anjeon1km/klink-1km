// 실시간 정보 (인터넷 연결이 있을 때):
//  · 날씨·미세먼지·일몰 — Open-Meteo (키 불필요, 10분마다)
//  · 따릉이 대여 가능 대수 — GitHub Actions가 15분마다 서울 열린데이터광장에서 받아 둔 live/bike.json
// 연결이 끊기면 마지막으로 받은 값을 받은 시각과 함께 씁니다.
import { prefs } from './state.js';

const LAT = 37.5945, LON = 127.0556; // 회기역–경희대 시범구간 중심
const WX_URL = `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}&current=temperature_2m,precipitation,rain,snowfall,weather_code,wind_speed_10m&daily=sunrise,sunset&forecast_days=1&timezone=Asia%2FSeoul`;
const AQ_URL = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${LAT}&longitude=${LON}&current=pm10,pm2_5&timezone=Asia%2FSeoul`;
const BIKE_URL = 'live/bike.json';
const EVERY_MS = 10 * 60 * 1000;

export const live = { weather: null, daily: null, air: null, bike: null, weatherAt: null, bikeAt: null, online: navigator.onLine };
const listeners = new Set();
export const onLive = fn => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = () => listeners.forEach(fn => { try { fn(live); } catch (e) { console.error(e); } });

// WMO 날씨 코드 → 한글
export function weatherLabel(c) {
  if (c == null) return '';
  if (c === 0) return '맑음';
  if (c <= 2) return '구름 조금';
  if (c === 3) return '흐림';
  if (c === 45 || c === 48) return '안개';
  if (c >= 51 && c <= 57) return '이슬비';
  if (c >= 61 && c <= 67) return '비';
  if (c >= 71 && c <= 77) return '눈';
  if (c >= 80 && c <= 82) return '소나기';
  if (c === 85 || c === 86) return '눈 소나기';
  if (c >= 95) return '뇌우';
  return '';
}
// 길 상태: 비(미끄러움) · 눈 · 빙판 · 강풍 → PM 권장 속도 한 단계 낮춤(slow), 눈·빙판이면 PM 비권장(noPm)
export function conditions(w = live.weather) {
  if (!w) return null;
  const c = w.weather_code;
  const snow = w.snowfall > 0 || (c >= 71 && c <= 77) || c === 85 || c === 86;
  const wet = !snow && (w.precipitation > 0 || w.rain > 0 || (c >= 51 && c <= 67) || (c >= 80 && c <= 82) || c >= 95);
  const ice = w.temperature_2m <= 1 && (wet || snow);
  const windy = w.wind_speed_10m >= 30;
  const why = ice ? '빙판 위험' : snow ? '눈' : wet ? '비 · 노면 미끄러움' : windy ? `강풍 ${Math.round(w.wind_speed_10m)} km/h` : '';
  return { wet, snow, ice, windy, slow: wet || snow || ice || windy, noPm: snow || ice, why };
}
// 미세먼지 등급 (환경부 기준, PM10·PM2.5 중 나쁜 쪽)
export function airGrade(a = live.air) {
  if (!a) return null;
  const g10 = a.pm10 <= 30 ? 0 : a.pm10 <= 80 ? 1 : a.pm10 <= 150 ? 2 : 3;
  const g25 = a.pm2_5 <= 15 ? 0 : a.pm2_5 <= 35 ? 1 : a.pm2_5 <= 75 ? 2 : 3;
  const g = Math.max(g10, g25);
  return { level: g, name: ['좋음', '보통', '나쁨', '매우 나쁨'][g], pm10: Math.round(a.pm10), pm25: Math.round(a.pm2_5) };
}
// 따릉이: 지점 근처(반경 m) 대여소의 실시간 대수
export function bikesNear(lat, lon, r = 200) {
  if (!live.bike) return [];
  const kx = 111320 * Math.cos(lat * Math.PI / 180), ky = 110950;
  return live.bike.stations.map(s => ({ ...s, d: Math.hypot((s.lon - lon) * kx, (s.lat - lat) * ky) })).filter(s => s.d <= r).sort((a, b) => a.d - b.d);
}
export const agoText = iso => { if (!iso) return ''; const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000); return m < 1 ? '방금' : m < 60 ? `${m}분 전` : `${Math.floor(m / 60)}시간 전`; };

async function getJson(url, opts) { const r = await fetch(url, opts); if (!r.ok) throw new Error(r.status + ' ' + url); return r.json(); }

export async function refreshLive() {
  live.online = navigator.onLine;
  const [wx, aq, bike] = await Promise.allSettled([getJson(WX_URL), getJson(AQ_URL), getJson(BIKE_URL, { cache: 'no-store' })]);
  const now = new Date().toISOString();
  if (wx.status === 'fulfilled') { live.weather = wx.value.current; live.daily = wx.value.daily; live.weatherAt = now; }
  if (aq.status === 'fulfilled') live.air = aq.value.current;
  // 따릉이 파일은 2시간보다 오래되면 쓰지 않음 (자동 갱신이 멈춘 경우)
  if (bike.status === 'fulfilled' && bike.value?.stations && Date.now() - new Date(bike.value.at).getTime() < 2 * 3600 * 1000) { live.bike = bike.value; live.bikeAt = bike.value.at; }
  prefs.set('liveCache', { weather: live.weather, daily: live.daily, air: live.air, weatherAt: live.weatherAt });
  emit();
  return live;
}

let timer = null;
export function startLive() {
  if (timer) return;
  const c = prefs.get('liveCache', null); // 지난번 값 먼저 (오프라인에서도 보이게)
  if (c?.weather) Object.assign(live, c);
  emit();
  refreshLive().catch(e => console.warn('실시간 정보', e));
  timer = setInterval(() => { if (!document.hidden) refreshLive().catch(() => {}); }, EVERY_MS);
  window.addEventListener('online', () => refreshLive().catch(() => {}));
  window.addEventListener('offline', () => { live.online = false; emit(); });
}
export function stopLive() { clearInterval(timer); timer = null; }
