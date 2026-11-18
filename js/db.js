/* Simpanan data dalam IndexedDB (dalam browser peranti ini). */
(function () {
  const DB_NAME = 'ogfix-terima-device';
  const DB_VERSION = 1;
  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('jobs')) {
          const s = db.createObjectStore('jobs', { keyPath: 'id' });
          s.createIndex('createdAt', 'createdAt');
        }
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  function tx(store, mode, fn) {
    return open().then(
      (db) =>
        new Promise((resolve, reject) => {
          const t = db.transaction(store, mode);
          const s = t.objectStore(store);
          let result;
          Promise.resolve(fn(s)).then((r) => (result = r));
          t.oncomplete = () => resolve(result);
          t.onerror = () => reject(t.error);
          t.onabort = () => reject(t.error);
        })
    );
  }

  function reqP(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  window.DB = {
    allJobs() {
      return tx('jobs', 'readonly', (s) => reqP(s.getAll())).then((list) =>
        (list || []).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      );
    },
    getJob(id) {
      return tx('jobs', 'readonly', (s) => reqP(s.get(id)));
    },
    putJob(job) {
      return tx('jobs', 'readwrite', (s) => reqP(s.put(job)));
    },
    deleteJob(id) {
      return tx('jobs', 'readwrite', (s) => reqP(s.delete(id)));
    },
    clearJobs() {
      return tx('jobs', 'readwrite', (s) => reqP(s.clear()));
    },
    getSettings() {
      return tx('settings', 'readonly', (s) => reqP(s.get('shop'))).then((r) => (r ? r.value : null));
    },
    saveSettings(value) {
      return tx('settings', 'readwrite', (s) => reqP(s.put({ key: 'shop', value })));
    },
  };
})();
