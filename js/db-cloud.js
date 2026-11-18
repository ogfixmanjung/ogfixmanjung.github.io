/* Mod cloud: data disimpan dalam Firebase (Firestore) dan dikongsi semua staff. */
(function () {
  const SDK = '10.14.1';
  const SDK_FILES = ['firebase-app-compat.js', 'firebase-auth-compat.js', 'firebase-firestore-compat.js'];
  const RECENT_DAYS = 60;

  let auth, fs;
  let user = null;
  let staffDoc = null;
  const maps = { active: new Map(), recent: new Map(), full: new Map() };
  let fullLoaded = false;
  let listenersReady = null;
  let unsubs = [];
  const changeCbs = [];

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('Gagal muat ' + src + '. Semak sambungan internet.'));
      document.head.appendChild(s);
    });
  }

  /* Tunggu server, tapi jangan tersekat bila offline (data tetap disimpan & akan sync). */
  function settle(promise, ms = 5000) {
    return Promise.race([
      promise.then(() => 'saved'),
      new Promise((resolve) => setTimeout(() => resolve('pending'), ms)),
    ]);
  }

  function friendlyError(err) {
    const code = (err && err.code) || '';
    const map = {
      'auth/invalid-email': 'Format email tidak sah.',
      'auth/user-not-found': 'Email atau password salah.',
      'auth/wrong-password': 'Email atau password salah.',
      'auth/invalid-credential': 'Email atau password salah.',
      'auth/invalid-login-credentials': 'Email atau password salah.',
      'auth/email-already-in-use': 'Email ini sudah didaftarkan. Sila log masuk.',
      'auth/weak-password': 'Password terlalu lemah (minimum 6 aksara).',
      'auth/too-many-requests': 'Terlalu banyak cubaan. Cuba lagi sebentar.',
      'auth/network-request-failed': 'Tiada sambungan internet.',
      'permission-denied': 'Akaun anda tiada kebenaran untuk tindakan ini.',
      'unavailable': 'Tiada sambungan internet.',
    };
    return map[code] || (err && err.message) || String(err);
  }

  function emit() {
    changeCbs.forEach((cb) => {
      try {
        cb();
      } catch (e) {
        console.error(e);
      }
    });
  }

  function fromDoc(doc) {
    const d = doc.data();
    d.id = doc.id;
    return d;
  }

  function stopListeners() {
    unsubs.forEach((u) => u());
    unsubs = [];
    maps.active.clear();
    maps.recent.clear();
    maps.full.clear();
    fullLoaded = false;
    listenersReady = null;
  }

  function startListeners() {
    if (listenersReady) return listenersReady;
    const cutoff = new Date(Date.now() - RECENT_DAYS * 864e5).toISOString();
    const queries = {
      active: fs.collection('jobs').where('active', '==', true),
      recent: fs.collection('jobs').where('updatedAt', '>=', cutoff),
    };
    listenersReady = Promise.all(
      Object.keys(queries).map(
        (key) =>
          new Promise((resolve) => {
            let first = true;
            const unsub = queries[key].onSnapshot(
              (snap) => {
                snap.docChanges().forEach((ch) => {
                  if (ch.type === 'removed') maps[key].delete(ch.doc.id);
                  else maps[key].set(ch.doc.id, fromDoc(ch.doc));
                });
                if (first) {
                  first = false;
                  resolve();
                } else emit();
              },
              (err) => {
                console.error('listener', key, err);
                resolve();
              }
            );
            unsubs.push(unsub);
          })
      )
    );
    return listenersReady;
  }

  function merged() {
    const out = new Map();
    ['full', 'recent', 'active'].forEach((k) =>
      maps[k].forEach((job, id) => {
        const cur = out.get(id);
        if (!cur || (job.updatedAt || '') >= (cur.updatedAt || '')) out.set(id, job);
      })
    );
    return Array.from(out.values()).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  const CloudDB = {
    mode: 'cloud',
    friendlyError,

    async init(config) {
      for (const f of SDK_FILES) await loadScript(`https://www.gstatic.com/firebasejs/${SDK}/${f}`);
      firebase.initializeApp(config);
      auth = firebase.auth();
      fs = firebase.firestore();
      if (String(config.projectId || '').startsWith('demo-')) {
        // Untuk ujian dengan Firebase Emulator sahaja
        auth.useEmulator('http://127.0.0.1:9099', { disableWarnings: true });
        fs.useEmulator('127.0.0.1', 8080);
      }
      try {
        await fs.enablePersistence({ synchronizeTabs: true });
      } catch (e) {
        /* browser tidak sokong offline cache – tetap berfungsi online */
      }
    },

    /* ---- akaun ---- */
    onAuth(cb) {
      auth.onAuthStateChanged((u) => {
        user = u;
        if (!u) stopListeners();
        cb(u);
      });
    },
    currentUser: () => user,
    userName() {
      if (!user) return '';
      return user.displayName || (user.email || '').split('@')[0];
    },
    signIn: (email, pw) => auth.signInWithEmailAndPassword(email.trim(), pw),
    register: (email, pw) => auth.createUserWithEmailAndPassword(email.trim(), pw),
    resetPassword: (email) => auth.sendPasswordResetEmail(email.trim()),
    signOut: () => auth.signOut(),

    /* Semak sama ada akaun ini owner / staff yang diluluskan.
       Pulang 'owner' | 'staff' | 'pending'. */
    async startSession() {
      const ref = fs.collection('config').doc('staff');
      const email = (user.email || '').toLowerCase();
      let snap;
      try {
        snap = await ref.get();
      } catch (e) {
        if (e.code === 'permission-denied') return 'pending';
        throw e;
      }
      if (!snap.exists) {
        // Kali pertama: hanya owner (ditetapkan dalam Firestore Rules) boleh cipta senarai staff.
        try {
          await ref.set({ owner: email, emails: [] });
          staffDoc = { owner: email, emails: [] };
        } catch (e) {
          if (e.code === 'permission-denied') return 'pending';
          throw e;
        }
      } else {
        staffDoc = snap.data();
      }
      await startListeners();
      return staffDoc.owner === email ? 'owner' : 'staff';
    },
    isOwner: () => !!(user && staffDoc && staffDoc.owner === (user.email || '').toLowerCase()),
    getStaff: () => (staffDoc ? (staffDoc.emails || []).slice() : []),
    async saveStaff(emails) {
      const clean = Array.from(new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean)));
      await fs.collection('config').doc('staff').update({ emails: clean });
      staffDoc.emails = clean;
    },

    /* ---- job ---- */
    async allJobs(opts = {}) {
      await startListeners();
      if (opts.full && !fullLoaded) {
        const snap = await fs.collection('jobs').get();
        snap.forEach((doc) => maps.full.set(doc.id, fromDoc(doc)));
        fullLoaded = true;
      }
      return merged();
    },
    isFullLoaded: () => fullLoaded,

    async getJob(id) {
      const hit = merged().find((j) => j.id === id);
      if (hit) return Object.assign({}, hit);
      const doc = await fs.collection('jobs').doc(id).get();
      return doc.exists ? fromDoc(doc) : null;
    },

    /* photos: array dataURL (jika undefined, gambar sedia ada tidak diubah) */
    async putJob(job, photos) {
      const data = Object.assign({}, job);
      delete data.photos;
      data.active = !['diambil', 'batal'].includes(data.status);
      const batch = fs.batch();
      if (photos !== undefined) {
        const old = Number(job.photoCount || 0);
        photos.forEach((p, i) =>
          batch.set(fs.collection('photos').doc(`${job.id}__${i}`), { jobId: job.id, i, data: p })
        );
        for (let i = photos.length; i < old; i++) batch.delete(fs.collection('photos').doc(`${job.id}__${i}`));
        data.photoCount = photos.length;
      }
      batch.set(fs.collection('jobs').doc(job.id), JSON.parse(JSON.stringify(data)));
      maps.full.set(job.id, data);
      return settle(batch.commit());
    },

    async deleteJob(id) {
      const job = await CloudDB.getJob(id);
      const batch = fs.batch();
      for (let i = 0; i < Number((job && job.photoCount) || 0); i++)
        batch.delete(fs.collection('photos').doc(`${id}__${i}`));
      batch.delete(fs.collection('jobs').doc(id));
      await batch.commit();
      maps.full.delete(id);
    },

    async getPhotos(job) {
      if (job.photos) return job.photos;
      const n = Number(job.photoCount || 0);
      const out = [];
      for (let i = 0; i < n; i++) {
        const doc = await fs.collection('photos').doc(`${job.id}__${i}`).get();
        if (doc.exists) out.push(doc.data().data);
      }
      return out;
    },

    /* No. resit unik walaupun beberapa staff terima device serentak. */
    async nextId(head) {
      const counter = fs.collection('counters').doc(head);
      const run = fs.runTransaction(async (t) => {
        const c = await t.get(counter);
        let n = c.exists ? c.data().n : 0;
        for (let k = 0; k < 50; k++) {
          n++;
          const id = head + String(n).padStart(3, '0');
          const j = await t.get(fs.collection('jobs').doc(id));
          if (!j.exists) {
            t.set(counter, { n });
            return id;
          }
        }
        throw new Error('Tidak dapat jana no. resit');
      });
      const timeout = new Promise((resolve) => setTimeout(() => resolve(null), 6000));
      const id = await Promise.race([run.catch(() => null), timeout]);
      if (id) return id;
      // Offline: guna masa sebagai no. unik
      const d = new Date();
      return head + 'T' + [d.getHours(), d.getMinutes(), d.getSeconds()].map((x) => String(x).padStart(2, '0')).join('');
    },

    /* ---- tetapan ---- */
    async getSettings() {
      const doc = await fs.collection('config').doc('shop').get();
      return doc.exists ? doc.data() : null;
    },
    async saveSettings(value) {
      await fs.collection('config').doc('shop').set(JSON.parse(JSON.stringify(value)));
    },

    onChange(cb) {
      changeCbs.push(cb);
    },
  };

  window.CloudDB = CloudDB;
})();
