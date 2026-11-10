// Persistência local: o background enviado fica salvo no navegador (IndexedDB),
// funcionando em Windows, macOS, Android e iOS.
const Store = (() => {
  const DB = 'autostory', OS = 'kv';
  let dbp;
  const db = () =>
    (dbp ||= new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(OS);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }));
  const tx = async (mode, fn) => {
    const d = await db();
    return new Promise((resolve, reject) => {
      const t = d.transaction(OS, mode);
      const r = fn(t.objectStore(OS));
      t.oncomplete = () => resolve(r?.result);
      t.onerror = () => reject(t.error);
    });
  };
  const ls = {
    get(k, def = null) { try { const v = localStorage.getItem('autostory:' + k); return v === null ? def : JSON.parse(v); } catch { return def; } },
    set(k, v) { try { localStorage.setItem('autostory:' + k, JSON.stringify(v)); } catch {} },
    del(k) { try { localStorage.removeItem('autostory:' + k); } catch {} },
  };
  return {
    getBlob: (k) => tx('readonly', (s) => s.get(k)).catch(() => null),
    setBlob: (k, v) => tx('readwrite', (s) => s.put(v, k)),
    delBlob: (k) => tx('readwrite', (s) => s.delete(k)),
    ...ls,
  };
})();
