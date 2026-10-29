// 내 위치 (휴대폰 GPS): 출발지로 쓰기, 지도에 표시, 음성 안내가 실제 위치를 따라가기.
// 위치는 이 기기 안에서만 쓰고 저장하거나 어디로도 보내지 않습니다.
const listeners = new Set();
export const geo = { pos: null, watching: false, error: null };
export const onGeo = fn => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = () => listeners.forEach(fn => { try { fn(geo); } catch (e) { console.error(e); } });

const toPos = p => ({ lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy, at: p.timestamp });
export const geoSupported = () => 'geolocation' in navigator && window.isSecureContext !== false;

export function geoErrorText(err) {
  if (!geoSupported()) return '이 주소에서는 위치를 쓸 수 없어요. 공개 주소(https)나 설치한 앱에서 열어 주세요.';
  if (err?.code === 1) return '위치 권한이 꺼져 있어요. 브라우저나 휴대폰 설정에서 이 사이트의 위치 접근을 허용해 주세요.';
  if (err?.code === 2) return '위치를 찾지 못했어요. GPS를 켜고 하늘이 보이는 곳에서 다시 시도해 주세요.';
  if (err?.code === 3) return '위치를 찾는 데 시간이 너무 오래 걸려요. 잠시 뒤 다시 시도해 주세요.';
  return '위치를 가져오지 못했어요.';
}

export function locateOnce({ timeout = 12000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!geoSupported()) { reject({ code: 0 }); return; }
    navigator.geolocation.getCurrentPosition(p => { geo.pos = toPos(p); geo.error = null; emit(); resolve(geo.pos); },
      e => { geo.error = e; emit(); reject(e); }, { enableHighAccuracy: true, timeout, maximumAge: 10000 });
  });
}

let watchId = null;
export function startWatch() {
  if (watchId != null || !geoSupported()) return;
  geo.watching = true;
  watchId = navigator.geolocation.watchPosition(p => { geo.pos = toPos(p); geo.error = null; emit(); },
    e => { geo.error = e; emit(); }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 3000 });
  emit();
}
export function stopWatch() {
  if (watchId != null) navigator.geolocation.clearWatch(watchId);
  watchId = null; geo.watching = false; emit();
}

// 동대문구(지도 데이터 범위) 안인지: 바깥이면 가장 가까운 경계까지 거리(m)
export function distanceOutside(bounds, lat, lon) {
  const kx = 111320 * Math.cos(lat * Math.PI / 180), ky = 110950;
  const dx = lon < bounds.w ? (bounds.w - lon) * kx : lon > bounds.e ? (lon - bounds.e) * kx : 0;
  const dy = lat < bounds.s ? (bounds.s - lat) * ky : lat > bounds.n ? (lat - bounds.n) * ky : 0;
  return Math.hypot(dx, dy);
}
