// Storage adapter for reports (위험 제보), rides (환승 판정 기록), feedback (팀 피드백).
// Published as a claude.ai artifact, the page gets the shared `db` capability, so teammates see each other's
// entries. Anywhere else (local server, GitHub Pages) it falls back to this browser's localStorage.

const COLLS = ['reports', 'rides', 'feedback'];
const subs = new Map(COLLS.map(c => [c, new Set()]));
const cache = new Map(COLLS.map(c => [c, []]));
const unsubs = new Map();
let db = null, user = null, me = null, readOnly = false;
const hooks = new Set();

export const store = {
  get shared() { return !!db && !readOnly; },
  get mode() { return db ? (readOnly ? 'shared-readonly' : 'shared') : 'local'; },
  onMode(fn) { hooks.add(fn); },
  me: () => me,

  async init() {
    COLLS.forEach(c => { cache.set(c, readLocal(c)); });
    const cl = window.claude;
    if (!cl || typeof cl.use !== 'function') return;
    try {
      const [d, u] = await Promise.all([cl.use('db'), cl.use('user')]);
      user = u; me = u ? await u.id() : null;
      if (!d) return;
      db = d;
      if (u) { const can = await u.can('data.write'); if (can === false) readOnly = true; }
      COLLS.forEach(c => subscribeShared(c));
      hooks.forEach(fn => fn(store.mode));
    } catch (e) { console.warn('shared store unavailable', e); db = null; }
  },

  subscribe(coll, fn) {
    subs.get(coll).add(fn); fn(cache.get(coll));
    return () => subs.get(coll).delete(fn);
  },
  list: coll => cache.get(coll),

  async add(coll, data) {
    const doc = { ...data, at: new Date().toISOString() };
    if (db && !readOnly) {
      try { if (me) doc.by = me; const ref = await db.collection(coll).add(doc); return ref.id; }
      catch (e) {
        if (e?.code === 'invalid_argument') readOnly = true;
        console.warn('shared write failed, saving locally', e);
      }
    }
    const id = 'l' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const arr = [{ id, ...doc, local: true }, ...readLocal(coll)].slice(0, 300);
    writeLocal(coll, arr);
    if (!db) { cache.set(coll, arr); notify(coll); }
    else { cache.set(coll, [{ id, ...doc, local: true }, ...cache.get(coll)]); notify(coll); }
    return id;
  },

  async remove(coll, id) {
    const item = cache.get(coll).find(x => x.id === id);
    if (item && !item.local && db && !readOnly) { try { await db.collection(coll).doc(id).delete(); return; } catch (e) { console.warn(e); } }
    writeLocal(coll, readLocal(coll).filter(x => x.id !== id));
    cache.set(coll, cache.get(coll).filter(x => x.id !== id)); notify(coll);
  },

  // display names for author ids (resolved at render time, never stored)
  async names(ids) {
    if (!user || !ids.length) return {};
    try { const ps = await user.profiles([...new Set(ids)]); return Object.fromEntries(Object.entries(ps).map(([k, p]) => [k, p.isMe ? '나' : (p.name || '팀원')])); }
    catch { return {}; }
  },
};

function subscribeShared(coll) {
  unsubs.get(coll)?.();
  const q = db.collection(coll).orderBy('at', 'desc').limit(300);
  unsubs.set(coll, q.onSnapshot(snap => {
    const shared = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const locals = readLocal(coll).filter(x => !shared.some(s => s.at === x.at && s.by === me));
    cache.set(coll, [...locals, ...shared].sort((a, b) => (b.at || '').localeCompare(a.at || '')));
    notify(coll);
  }, err => { console.warn('subscription ended', coll, err); }));
}
function notify(coll) { subs.get(coll).forEach(fn => { try { fn(cache.get(coll)); } catch (e) { console.error(e); } }); }
function readLocal(coll) { try { return JSON.parse(localStorage.getItem('klink.data.' + coll) || '[]'); } catch { return []; } }
function writeLocal(coll, arr) { try { localStorage.setItem('klink.data.' + coll, JSON.stringify(arr)); } catch { /* full or blocked */ } }
