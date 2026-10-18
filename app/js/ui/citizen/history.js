// 시민 앱 · 내 기록: 월별 환승 횟수, 받은 혜택, 안전 환승 비율, (대체 수단을 답한 이동만) 탄소 감축 추정.
import { h, clear, fmtDate, fmtN } from '../dom.js';
import { store } from '../../store.js';
import { LEVEL } from '../../core/transfer.js';
import { PARAMS } from '../../core/params.js';

export function renderHistory(app, body) {
  const { data } = app;
  let rides = [];
  function draw() {
    clear(body);
    const me = store.me();
    const mine = rides.filter(r => r.local || !me || r.by === me);
    const trips = mine.filter(r => r.level);
    const repl = new Map(mine.filter(r => r.kind === 'replace').map(r => [r.ref, r]));
    const ym = new Date().toISOString().slice(0, 7);
    const ok = trips.filter(r => ['basic', 'safe', 'night'].includes(r.level) && (r.at || '').startsWith(ym));
    const safe = ok.filter(r => r.level !== 'basic');
    const won = ok.reduce((a, r) => a + (r.won || 0), 0), mil = ok.reduce((a, r) => a + (r.mileage || 0), 0);
    const ef = PARAMS.carbon.ef;
    let co2 = 0, answered = 0;
    for (const t of trips) { const r = repl.get(t.id); if (!r) continue; answered++; co2 += r.km * ((r.replaced === 'car' ? ef.car : r.replaced === 'transit' ? ef.bus : 0) - ef.pmNow); }
    body.append(h('div.card', null,
      h('h3', null, '이번 달 기록'),
      h('div.stat-row', null,
        h('div.stat', null, h('small', null, '환승 인정'), h('b', null, `${ok.length}회`)),
        h('div.stat', null, h('small', null, '안전 환승 비율'), h('b', null, ok.length ? `${Math.round(safe.length / ok.length * 100)}%` : '—')),
        h('div.stat', null, h('small', null, '받은 혜택'), h('b', null, `${fmtN(won)}원`), h('small', null, `마일리지 ${fmtN(mil)}M`)),
        h('div.stat', null, h('small', null, '탄소 (답한 이동만)'), h('b', null, answered ? `${co2 >= 0 ? '−' : '+'}${fmtN(Math.abs(co2))} g` : '—'), h('small', null, answered ? `${answered}건 기준` : '대체 수단 응답 없음'))),
      h('small.muted', null, `탄소는 PM 수명주기 배출(${ef.pmNow} g/km)을 빼고 계산합니다. 걸어갔을 이동을 PM으로 바꾸면 배출이 늘어납니다.`)));
    body.append(h('div.card', null, h('h3', null, '최근 이동'),
      trips.length ? h('ul.list', null, trips.slice(0, 30).map(t => h('li', { style: { display: 'grid', gridTemplateColumns: '1fr auto', gap: '2px 8px', paddingBottom: '6px', borderBottom: '1px dashed var(--line)' } },
        h('b', null, `${data.hubById.get(t.from)?.name || '출발지'} → ${data.hubById.get(t.to)?.name || '도착지'}`),
        h('span.pill' + (t.level === 'none' ? '' : '.accent'), null, (t.nightBenefit ? '야간 ' : '') + (LEVEL[t.level]?.short || t.level)),
        h('small.muted', null, `${fmtDate(t.at)} · ${t.km} km${t.night ? ' · 야간' : ''}${repl.get(t.id) ? ' · 대체수단 응답' : ''}`),
        h('small.num', null, t.won ? `${fmtN(t.won)}원` : t.mileage ? `${t.mileage}M` : '')))) : h('p.empty', null, '주행 탭에서 반납까지 마치면 기록이 쌓입니다.')));
    body.append(h('small.muted', null, '개인정보 원칙: 주행 경로는 판정에 필요한 동안만 쓰고, 기록에는 지나간 구간 번호만 남깁니다. 위치 공유는 별도 동의로 분리합니다.'));
  }
  const unsub = store.subscribe('rides', l => { rides = l; draw(); });
  return { refresh: draw, dispose: unsub };
}
