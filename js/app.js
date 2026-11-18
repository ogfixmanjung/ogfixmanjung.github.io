/* Aplikasi staff: terima device, senarai job, kemaskini status, serah semula. */
(function () {
  const { STATUS, DEFAULT_TERMS, esc, badge, money, fmtDate, renderReceipt, customerLink } = window.R;
  const app = document.getElementById('app');
  const CLOUD = DB.mode === 'cloud';

  const ACCESSORIES = ['Kad SIM', 'Memory Card', 'Casing / Cover', 'Charger', 'Kabel', 'Kotak', 'Tempered Glass', 'Pen / Stylus'];
  const CONDITIONS = [
    'Skrin retak',
    'Skrin calar',
    'Belakang retak',
    'Badan calar',
    'Badan kemek / bengkok',
    'Kamera retak',
    'Butang rosak',
    'Pernah terkena air',
    'Pernah dibuka / dibaiki',
    'Tidak boleh hidup',
    'Keadaan baik',
  ];
  const PAY_METHODS = ['Tunai', 'Online Transfer', 'DuitNow QR', 'Kad Debit/Kredit', 'E-Wallet'];
  const DEFAULT_SETTINGS = { name: 'OGFIX', phone: '', address: '', prefix: 'OGF', warrantyDays: 30, terms: DEFAULT_TERMS };

  let settings = Object.assign({}, DEFAULT_SETTINGS);
  let ready = false;
  let currentView = '';
  let listRefresh = null;

  /* ---------------- util ---------------- */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function toast(msg) {
    let t = $('#toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'toast';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast._h);
    toast._h = setTimeout(() => t.classList.remove('show'), 2800);
  }

  function errMsg(err) {
    return DB.friendlyError ? DB.friendlyError(err) : (err && err.message) || String(err);
  }

  function savedToast(result, msg) {
    toast(result === 'pending' ? msg + ' (offline – akan sync bila ada internet)' : msg);
  }

  function num(v) {
    if (v === '' || v == null) return '';
    const n = Number(v);
    return isNaN(n) ? '' : n;
  }

  function waPhone(p) {
    let d = String(p || '').replace(/\D/g, '');
    if (d.startsWith('0')) d = '6' + d;
    else if (d.startsWith('1')) d = '60' + d;
    return d;
  }

  function me() {
    return CLOUD ? DB.userName() : '';
  }

  /* ---------- log perubahan ---------- */
  function actor() {
    return CLOUD ? DB.userEmail() : localStorageGet('lastStaff') || '';
  }

  function addLog(job, action, changes) {
    job.log = (job.log || []).concat([
      { at: new Date().toISOString(), by: actor(), action, changes: changes || [] },
    ]);
  }

  const LOG_FIELDS = [
    ['Nama pelanggan', (j) => j.customer && j.customer.name],
    ['No. telefon', (j) => j.customer && j.customer.phone],
    ['Jenama', (j) => j.device && j.device.brand],
    ['Model', (j) => j.device && j.device.model],
    ['Warna', (j) => j.device && j.device.color],
    ['IMEI', (j) => j.device && j.device.imei],
    ['Passcode', (j) => j.device && j.device.passcode, 'secret'],
    ['Aksesori', (j) => (j.accessories || []).join(', ')],
    ['Aksesori lain', (j) => j.accessoriesOther],
    ['Keadaan', (j) => (j.condition || []).join(', ')],
    ['Catatan keadaan', (j) => j.conditionNote],
    ['Masalah', (j) => j.problem],
    ['Anggaran harga', (j) => j.estimate, 'money'],
    ['Deposit', (j) => j.deposit, 'money'],
    ['Anggaran siap', (j) => j.eta],
    ['Staff terima', (j) => j.staff],
    ['Nota', (j) => j.notes],
  ];

  function fmtVal(v, type) {
    if (v === '' || v == null) return '(kosong)';
    if (type === 'money') return money(v);
    return String(v);
  }

  function diffJob(oldJob, newJob) {
    const out = [];
    LOG_FIELDS.forEach(([label, get, type]) => {
      const a = get(oldJob);
      const b = get(newJob);
      const sa = a == null ? '' : String(a);
      const sb = b == null ? '' : String(b);
      if (sa === sb) return;
      if (type === 'secret') out.push({ f: label, from: sa ? '***' : '(kosong)', to: sb ? '*** (diubah)' : '(dipadam)' });
      else out.push({ f: label, from: fmtVal(a, type), to: fmtVal(b, type) });
    });
    return out;
  }

  const LOG_ACTIONS = {
    cipta: 'Device diterima',
    edit: 'Maklumat diubah',
    status: 'Status ditukar',
    serahan: 'Serahan semula',
    pindah: 'Dipindah ke cloud',
    pulih: 'Dipulihkan dari backup',
    resit: 'Link resit dijana',
  };

  function renderLog(job) {
    const log = (job.log || []).slice().reverse();
    const body = log.length
      ? log
          .map(
            (e) => `<li>
          <div><strong>${esc(LOG_ACTIONS[e.action] || e.action)}</strong> <span class="muted small">· ${esc(e.by || '-')} · ${fmtDate(e.at)}</span></div>
          ${
            e.changes && e.changes.length
              ? `<ul class="log-changes">${e.changes
                  .map((c) => `<li>${esc(c.f)}: ${c.from !== '' && c.from != null ? `<s>${esc(c.from)}</s> → ` : ''}${esc(c.to)}</li>`)
                  .join('')}</ul>`
              : ''
          }
        </li>`
          )
          .join('')
      : '<li class="muted small">Tiada log. Rekod ini dicipta sebelum log perubahan diaktifkan.</li>';
    return `<details class="card log-card"><summary><h3>Log Perubahan (${log.length})</h3></summary><ul class="log">${body}</ul>
      <p class="small muted">Log tidak boleh dipadam atau diubah oleh staff.</p></details>`;
  }

  /* Simpan job + (mod cloud) salinan resit pelanggan untuk link pendek */
  function saveJob(job, photos) {
    if (!CLOUD) return DB.putJob(job, photos);
    if (!job.receiptToken) job.receiptToken = R.newReceiptToken();
    return DB.putJob(job, photos, R.publicPayload(job, settings));
  }

  function canEditSettings() {
    return !CLOUD || DB.isOwner();
  }

  async function nextId() {
    const prefix = (settings.prefix || 'OGF').toUpperCase();
    const now = new Date();
    const ymd =
      String(now.getFullYear()).slice(2) +
      String(now.getMonth() + 1).padStart(2, '0') +
      String(now.getDate()).padStart(2, '0');
    return DB.nextId(`${prefix}-${ymd}-`);
  }

  function resizeImage(file, maxSide = 1024, quality = 0.6) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = reject;
      reader.onload = () => {
        const img = new Image();
        img.onerror = reject;
        img.onload = () => {
          const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
          const cv = document.createElement('canvas');
          cv.width = Math.round(img.width * scale);
          cv.height = Math.round(img.height * scale);
          cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
          resolve(cv.toDataURL('image/jpeg', quality));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  /* Pad tandatangan (jari / mouse) */
  function signaturePad(canvas) {
    const ctx = canvas.getContext('2d');
    let drawing = false;
    let empty = true;
    let last = null;

    function setup() {
      const ratio = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      canvas.width = w * ratio;
      canvas.height = h * ratio;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, w, h);
      ctx.lineWidth = 2.2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#111';
      empty = true;
    }
    function pos(e) {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }
    canvas.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      canvas.setPointerCapture(e.pointerId);
      drawing = true;
      last = pos(e);
      ctx.beginPath();
      ctx.arc(last.x, last.y, 1.1, 0, Math.PI * 2);
      ctx.fillStyle = '#111';
      ctx.fill();
      empty = false;
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!drawing) return;
      const p = pos(e);
      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      last = p;
    });
    const end = () => (drawing = false);
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    setup();
    return {
      clear: setup,
      isEmpty: () => empty,
      toDataURL: () => canvas.toDataURL('image/png'),
    };
  }

  /* ---------------- router ---------------- */
  async function route() {
    if (window.ReceiptExport) ReceiptExport.close();
    if (!ready) return;
    const hash = location.hash.replace(/^#\/?/, '');
    const [path, query] = hash.split('?');
    const parts = path.split('/').filter(Boolean);
    $$('.nav a').forEach((a) => a.classList.toggle('active', a.getAttribute('href') === '#/' + (parts[0] || '')));
    window.scrollTo(0, 0);
    currentView = parts[0] || 'list';
    try {
      if (!parts.length) return await viewList();
      if (parts[0] === 'baru') return await viewForm();
      if (parts[0] === 'edit' && parts[1]) return await viewForm(decodeURIComponent(parts[1]));
      if (parts[0] === 'job' && parts[1]) return await viewJob(decodeURIComponent(parts[1]), new URLSearchParams(query));
      if (parts[0] === 'ambil' && parts[1]) return await viewPickup(decodeURIComponent(parts[1]));
      if (parts[0] === 'tetapan') return await viewSettings();
      app.innerHTML = '<p>Halaman tidak dijumpai.</p>';
    } catch (err) {
      console.error(err);
      app.innerHTML = `<div class="card"><h2>Ralat</h2><p>${esc(errMsg(err))}</p></div>`;
    }
  }

  /* ---------------- login (mod cloud) ---------------- */
  function setLoggedIn(on) {
    document.body.classList.toggle('logged-out', !on);
  }

  function viewLogin(message) {
    ready = false;
    setLoggedIn(false);
    app.innerHTML = `
      <form id="loginForm" class="card form login">
        ${OGFIX_LOGO('login-logo')}
        <h2>Log Masuk Staff</h2>
        <p class="muted small">Log masuk untuk akses rekod device kedai.</p>
        <label>Email<input name="email" type="email" autocomplete="username" required></label>
        <label>Password<input name="pw" type="password" autocomplete="current-password" required minlength="6"></label>
        <div class="form-error" id="loginMsg" ${message ? '' : 'hidden'}>${esc(message || '')}</div>
        <button class="btn primary block" type="submit">Log Masuk</button>
        <div class="login-links">
          <button type="button" class="linkbtn" id="btnRegister">Staff baru? Daftar akaun</button>
          <button type="button" class="linkbtn" id="btnReset">Lupa password</button>
        </div>
      </form>`;
    const f = $('#loginForm');
    const msg = (t, ok) => {
      const b = $('#loginMsg');
      b.hidden = false;
      b.classList.toggle('ok', !!ok);
      b.textContent = t;
    };
    const vals = () => ({ email: f.email.value.trim(), pw: f.pw.value });
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const { email, pw } = vals();
      if (!email || !pw) return msg('Sila isi email dan password.');
      try {
        f.querySelector('[type=submit]').disabled = true;
        await DB.signIn(email, pw);
      } catch (err) {
        msg(errMsg(err));
      } finally {
        f.querySelector('[type=submit]').disabled = false;
      }
    });
    $('#btnRegister').addEventListener('click', async () => {
      const { email, pw } = vals();
      if (!email || pw.length < 6) return msg('Isi email dan password (minimum 6 aksara), kemudian tekan "Daftar akaun" semula.');
      try {
        await DB.register(email, pw);
      } catch (err) {
        msg(errMsg(err));
      }
    });
    $('#btnReset').addEventListener('click', async () => {
      const { email } = vals();
      if (!email) return msg('Isi email dahulu, kemudian tekan "Lupa password".');
      try {
        await DB.resetPassword(email);
        msg('Email untuk tukar password telah dihantar ke ' + email + '. Semak inbox / spam.', true);
      } catch (err) {
        msg(errMsg(err));
      }
    });
  }

  function viewPending() {
    ready = false;
    setLoggedIn(false);
    const u = DB.currentUser();
    app.innerHTML = `
      <div class="card form login">
        ${OGFIX_LOGO('login-logo')}
        <h2>Menunggu Kelulusan</h2>
        <p>Akaun <strong>${esc(u && u.email)}</strong> telah didaftarkan tetapi belum diluluskan.</p>
        <p>Minta owner kedai buka <strong>Tetapan → Staff</strong> dan tambah email ini. Kemudian tekan <em>Semak Semula</em>.</p>
        <div class="btn-col">
          <button class="btn primary" id="btnRecheck">Semak Semula</button>
          <button class="btn" id="btnOut">Log Keluar</button>
        </div>
      </div>`;
    $('#btnRecheck').addEventListener('click', () => enterSession(u));
    $('#btnOut').addEventListener('click', () => DB.signOut());
  }

  function viewVerify() {
    ready = false;
    setLoggedIn(false);
    const u = DB.currentUser();
    app.innerHTML = `
      <div class="card form login">
        ${OGFIX_LOGO('login-logo')}
        <h2>Sahkan Email Anda</h2>
        <p>Email pengesahan telah dihantar ke <strong>${esc(u && u.email)}</strong>.</p>
        <ol class="steps">
          <li>Buka email tersebut (semak juga folder <strong>Spam</strong>).</li>
          <li>Klik link pengesahan dalam email.</li>
          <li>Kembali ke sini dan tekan <em>Saya Dah Sahkan</em>.</li>
        </ol>
        <div class="form-error" id="verifyMsg" hidden></div>
        <div class="btn-col">
          <button class="btn primary" id="btnVerified">Saya Dah Sahkan</button>
          <button class="btn" id="btnResend">Hantar Semula Email</button>
          <button class="btn" id="btnOut">Log Keluar</button>
        </div>
      </div>`;
    const msg = (t, ok) => {
      const b = $('#verifyMsg');
      b.hidden = false;
      b.classList.toggle('ok', !!ok);
      b.textContent = t;
    };
    $('#btnVerified').addEventListener('click', async () => {
      try {
        if (await DB.refreshUser()) return enterSession(DB.currentUser());
        msg('Email belum disahkan. Klik link dalam email dahulu, kemudian cuba lagi.');
      } catch (err) {
        msg(errMsg(err));
      }
    });
    $('#btnResend').addEventListener('click', async () => {
      try {
        await DB.sendVerification();
        msg('Email pengesahan dihantar semula. Semak inbox / spam.', true);
      } catch (err) {
        msg(errMsg(err));
      }
    });
    $('#btnOut').addEventListener('click', () => DB.signOut());
  }

  async function enterSession(u) {
    ready = false;
    if (!u) return viewLogin();
    app.innerHTML = '<p class="muted">Memuatkan data…</p>';
    try {
      const role = await DB.startSession();
      if (role === 'pending') return DB.isVerified() ? viewPending() : viewVerify();
      await loadSettings();
      setLoggedIn(true);
      ready = true;
      route();
    } catch (err) {
      console.error(err);
      app.innerHTML = `<div class="card login"><h2>Tidak dapat sambung</h2><p>${esc(errMsg(err))}</p>
        <div class="btn-col"><button class="btn primary" id="btnRetry">Cuba Lagi</button><button class="btn" id="btnOut">Log Keluar</button></div></div>`;
      $('#btnRetry').addEventListener('click', () => enterSession(u));
      $('#btnOut').addEventListener('click', () => DB.signOut());
    }
  }

  /* ---------------- senarai ---------------- */
  let listFilter = { q: '', status: 'aktif' };

  async function viewList() {
    app.innerHTML = `
      <div class="stats" id="stats"></div>
      <div class="toolbar">
        <input type="search" id="q" placeholder="Cari no. resit, nama, telefon, IMEI, model…" value="${esc(listFilter.q)}">
        <select id="f"></select>
      </div>
      <div id="list"><div class="empty">Memuatkan…</div></div>`;

    const needFull = () =>
      CLOUD && !DB.isFullLoaded() && (listFilter.q.trim() !== '' || listFilter.status !== 'aktif');

    const refresh = async () => {
      const full = needFull();
      if (full) $('#list').innerHTML = '<div class="empty">Memuatkan semua rekod…</div>';
      const jobs = await DB.allJobs({ full });
      if (currentView !== 'list' || !$('#list')) return;
      draw(jobs);
    };
    listRefresh = refresh;

    const draw = (jobs) => {
      const counts = {};
      jobs.forEach((j) => (counts[j.status] = (counts[j.status] || 0) + 1));
      const isActive = (j) => j.status !== 'diambil';
      const active = jobs.filter(isActive).length;
      const today = new Date().toDateString();

      $('#stats').innerHTML = `
        <div class="stat"><span>${active}</span>Device dalam kedai</div>
        <div class="stat"><span>${counts.siap || 0}</span>Siap, belum ambil</div>
        <div class="stat"><span>${counts.menunggu_part || 0}</span>Menunggu part</div>
        <div class="stat"><span>${jobs.filter((j) => new Date(j.createdAt).toDateString() === today).length}</span>Diterima hari ini</div>`;

      const partial = CLOUD && !DB.isFullLoaded();
      const filters = [
        { key: 'aktif', label: `Aktif (${active})` },
        { key: 'semua', label: partial ? 'Semua rekod' : `Semua (${jobs.length})` },
      ].concat(STATUS.map((s) => ({ key: s.key, label: s.label + (partial && !isActive({ status: s.key }) ? '' : ` (${counts[s.key] || 0})`) })));
      $('#f').innerHTML = filters
        .map((f) => `<option value="${f.key}" ${listFilter.status === f.key ? 'selected' : ''}>${esc(f.label)}</option>`)
        .join('');

      const q = listFilter.q.trim().toLowerCase();
      const qDigits = q.replace(/\D/g, '');
      const out = jobs.filter((j) => {
        if (listFilter.status === 'aktif' && !isActive(j)) return false;
        if (!['aktif', 'semua'].includes(listFilter.status) && j.status !== listFilter.status) return false;
        if (!q) return true;
        const hay = [j.id, j.customer.name, j.customer.phone, j.device.brand, j.device.model, j.device.imei, j.problem]
          .join(' ')
          .toLowerCase();
        return hay.includes(q) || (qDigits.length >= 3 && hay.replace(/\D/g, '').includes(qDigits));
      });
      $('#list').innerHTML = out.length
        ? out
            .map(
              (j) => `<a class="job" href="#/job/${encodeURIComponent(j.id)}">
              <div class="job-top"><strong>${esc(j.id)}</strong>${badge(j.status)}</div>
              <div class="job-dev">${esc([j.device.brand, j.device.model].filter(Boolean).join(' '))}</div>
              <div class="muted small">${esc(j.customer.name)} · ${esc(j.customer.phone)}</div>
              <div class="small job-prob">${esc(j.problem)}</div>
              <div class="muted small">Diterima ${fmtDate(j.createdAt)}${j.eta ? ' · Anggaran siap ' + fmtDate(j.eta, false) : ''}</div>
            </a>`
            )
            .join('')
        : `<div class="empty">${
            jobs.length || q || listFilter.status !== 'aktif'
              ? 'Tiada rekod yang sepadan.'
              : 'Belum ada device dalam kedai.<br><a class="btn primary" href="#/baru">+ Terima Device</a>'
          }</div>`;
    };

    let t;
    $('#q').addEventListener('input', (e) => {
      listFilter.q = e.target.value;
      clearTimeout(t);
      t = setTimeout(refresh, 200);
    });
    $('#f').addEventListener('change', (e) => {
      listFilter.status = e.target.value;
      refresh();
    });
    await refresh();
  }

  /* ---------------- borang terima / edit ---------------- */
  async function viewForm(editId) {
    const job = editId ? await DB.getJob(editId) : null;
    if (editId && !job) throw new Error('Rekod tidak dijumpai: ' + editId);
    const j = job || { customer: {}, device: {}, accessories: [], condition: [] };
    let photos = job ? (await DB.getPhotos(job)).slice() : [];
    const origPhotoCount = photos.length;
    let photosChanged = false;

    const checks = (name, options, selected) =>
      options
        .map(
          (o) =>
            `<label class="check"><input type="checkbox" name="${name}" value="${esc(o)}" ${
              (selected || []).includes(o) ? 'checked' : ''
            }><span>${esc(o)}</span></label>`
        )
        .join('');

    app.innerHTML = `
      <form id="form" class="card form" novalidate>
        <h2>${job ? 'Edit ' + esc(job.id) : 'Terima Device Baru'}</h2>

        <fieldset><legend>Maklumat Pelanggan</legend>
          <div class="grid2">
            <label>Nama pelanggan *<input name="name" required value="${esc(j.customer.name)}" autocomplete="off"></label>
            <label>No. telefon (WhatsApp) *<input name="phone" type="tel" required inputmode="tel" placeholder="012-3456789" value="${esc(j.customer.phone)}"></label>
          </div>
        </fieldset>

        <fieldset><legend>Maklumat Device</legend>
          <div class="grid2">
            <label>Jenama *<input name="brand" required list="brands" value="${esc(j.device.brand)}" placeholder="cth: Apple, Samsung"></label>
            <label>Model *<input name="model" required value="${esc(j.device.model)}" placeholder="cth: iPhone 13 Pro"></label>
            <label>Warna<input name="color" value="${esc(j.device.color)}"></label>
            <label>IMEI / Serial No.<input name="imei" value="${esc(j.device.imei)}" inputmode="numeric" placeholder="Dail *#06#"></label>
          </div>
          <label>Passcode / Pattern (untuk ujian)<input name="passcode" value="${esc(j.device.passcode)}" autocomplete="off" placeholder="Tidak akan dipapar pada resit customer"></label>
          <datalist id="brands">${['Apple', 'Samsung', 'Xiaomi', 'Redmi', 'Oppo', 'Vivo', 'Realme', 'Huawei', 'Honor', 'Infinix', 'Poco', 'OnePlus', 'Google', 'Nokia']
            .map((b) => `<option value="${b}">`)
            .join('')}</datalist>
        </fieldset>

        <fieldset><legend>Aksesori Diterima Bersama</legend>
          <div class="checks">${checks('acc', ACCESSORIES, j.accessories)}</div>
          <label>Lain-lain<input name="accOther" value="${esc(j.accessoriesOther)}"></label>
        </fieldset>

        <fieldset><legend>Keadaan Fizikal Semasa Diterima</legend>
          <div class="checks">${checks('cond', CONDITIONS, j.condition)}</div>
          <label>Catatan keadaan<textarea name="condNote" rows="2">${esc(j.conditionNote)}</textarea></label>
          <label>Gambar device (pilihan)
            <input type="file" id="photoInput" accept="image/*" capture="environment" multiple>
          </label>
          <div class="photos" id="photoPreview"></div>
        </fieldset>

        <fieldset><legend>Masalah & Kos</legend>
          <label>Masalah / kerosakan yang dilaporkan *<textarea name="problem" rows="3" required>${esc(j.problem)}</textarea></label>
          <div class="grid3">
            <label>Anggaran harga (RM)<input name="estimate" type="number" step="0.01" min="0" inputmode="decimal" value="${esc(j.estimate)}"></label>
            <label>Deposit (RM)<input name="deposit" type="number" step="0.01" min="0" inputmode="decimal" value="${esc(j.deposit)}"></label>
            <label>Anggaran siap<input name="eta" type="date" value="${esc(j.eta)}"></label>
          </div>
          <div class="grid2">
            <label>Diterima oleh (staff)<input name="staff" value="${esc(j.staff || localStorageGet('lastStaff') || me())}"></label>
          </div>
          <label>Nota dalaman / tambahan<textarea name="notes" rows="2">${esc(j.notes)}</textarea></label>
        </fieldset>

        ${
          job
            ? ''
            : `<fieldset><legend>Pengesahan Pelanggan</legend>
          <details class="terms-box"><summary>Baca Terma & Syarat</summary><ol>${String(settings.terms || '')
            .split('\n')
            .filter((t) => t.trim())
            .map((t) => `<li>${esc(t)}</li>`)
            .join('')}</ol></details>
          <label class="check"><input type="checkbox" name="agree" required><span>Pelanggan telah membaca dan bersetuju dengan terma & syarat.</span></label>
          <div class="sig-wrap">
            <div class="sig-label">Tandatangan pelanggan *</div>
            <canvas id="sig" class="sig-pad"></canvas>
            <button type="button" class="btn small" id="sigClear">Padam tandatangan</button>
          </div>
        </fieldset>`
        }

        <div class="form-error" id="formError" hidden></div>
        <div class="actions">
          <a class="btn" href="${job ? '#/job/' + encodeURIComponent(job.id) : '#/'}">Batal</a>
          <button class="btn primary" type="submit">${job ? 'Simpan Perubahan' : 'Simpan & Jana Resit'}</button>
        </div>
      </form>`;

    const pad = job ? null : signaturePad($('#sig'));
    if (pad) $('#sigClear').addEventListener('click', () => pad.clear());

    const drawPhotos = () => {
      $('#photoPreview').innerHTML = photos
        .map((p, i) => `<div class="ph"><img src="${p}" alt=""><button type="button" data-i="${i}" title="Buang">✕</button></div>`)
        .join('');
    };
    $('#photoPreview').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-i]');
      if (!b) return;
      photos.splice(Number(b.dataset.i), 1);
      photosChanged = true;
      drawPhotos();
    });
    $('#photoInput').addEventListener('change', async (e) => {
      for (const f of Array.from(e.target.files || [])) {
        try {
          photos.push(await resizeImage(f));
          photosChanged = true;
        } catch (err) {
          toast('Gagal baca gambar');
        }
      }
      e.target.value = '';
      drawPhotos();
    });
    drawPhotos();

    $('#form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target;
      const fd = new FormData(f);
      const errors = [];
      if (!fd.get('name').trim()) errors.push('Nama pelanggan');
      if (fd.get('phone').replace(/\D/g, '').length < 9) errors.push('No. telefon yang sah');
      if (!fd.get('brand').trim()) errors.push('Jenama');
      if (!fd.get('model').trim()) errors.push('Model');
      if (!fd.get('problem').trim()) errors.push('Masalah dilaporkan');
      if (!job) {
        if (!fd.get('agree')) errors.push('Persetujuan terma & syarat');
        if (pad.isEmpty()) errors.push('Tandatangan pelanggan');
      }
      const errBox = $('#formError');
      if (errors.length) {
        errBox.hidden = false;
        errBox.innerHTML = '<strong>Sila lengkapkan:</strong> ' + errors.map(esc).join(', ');
        errBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
      errBox.hidden = true;
      const btn = f.querySelector('[type=submit]');
      btn.disabled = true;
      btn.textContent = 'Menyimpan…';

      const now = new Date().toISOString();
      const data = Object.assign({}, job || {}, {
        customer: { name: fd.get('name').trim(), phone: fd.get('phone').trim() },
        device: {
          brand: fd.get('brand').trim(),
          model: fd.get('model').trim(),
          color: fd.get('color').trim(),
          imei: fd.get('imei').trim(),
          passcode: fd.get('passcode').trim(),
        },
        accessories: fd.getAll('acc'),
        accessoriesOther: fd.get('accOther').trim(),
        condition: fd.getAll('cond'),
        conditionNote: fd.get('condNote').trim(),
        problem: fd.get('problem').trim(),
        estimate: num(fd.get('estimate')),
        deposit: num(fd.get('deposit')),
        eta: fd.get('eta'),
        staff: fd.get('staff').trim(),
        notes: fd.get('notes').trim(),
        updatedAt: now,
      });
      delete data.photos;
      localStorageSet('lastStaff', data.staff);

      if (job) {
        const changes = diffJob(job, data);
        if (photosChanged) changes.push({ f: 'Gambar', from: String(origPhotoCount), to: String(photos.length) });
        if (!changes.length) {
          toast('Tiada perubahan');
          location.hash = '#/job/' + encodeURIComponent(job.id);
          return;
        }
        addLog(data, 'edit', changes);
      }

      if (!job) {
        data.id = await nextId();
        data.createdAt = now;
        data.status = 'diterima';
        data.history = [{ status: 'diterima', at: now, note: 'Device diterima di kaunter', by: me() || data.staff }];
        data.signIn = pad.toDataURL();
        data.agreed = true;
        data.pickup = null;
        addLog(data, 'cipta', photos.length ? [{ f: 'Gambar', from: '', to: String(photos.length) }] : []);
      }
      let result;
      try {
        result = await saveJob(data, !job || photosChanged ? photos : undefined);
      } catch (err) {
        btn.disabled = false;
        btn.textContent = job ? 'Simpan Perubahan' : 'Simpan & Jana Resit';
        errBox.hidden = false;
        errBox.textContent = 'Gagal simpan: ' + errMsg(err) + ' Cuba kurangkan bilangan gambar.';
        return;
      }
      location.hash = '#/job/' + encodeURIComponent(data.id) + (job ? '' : '?baru=1');
      savedToast(result, job ? 'Perubahan disimpan' : 'Device diterima – resit dijana');
    });
  }

  /* ---------------- butiran job ---------------- */
  async function viewJob(id, params) {
    const job = await DB.getJob(id);
    if (!job) throw new Error('Rekod tidak dijumpai: ' + id);
    const closed = job.status === 'diambil';
    if (CLOUD && !job.receiptToken) {
      // Rekod lama: jana link resit pendek sekali sahaja
      addLog(job, 'resit');
      await saveJob(job);
    }
    const link = customerLink(job, settings);

    app.innerHTML = `
      ${
        params && params.get('baru')
          ? `<div class="notice">✅ Device telah direkodkan. Hantar resit digital kepada pelanggan melalui WhatsApp sekarang.</div>`
          : ''
      }
      <div class="job-layout">
        <div class="side">
          <div class="card">
            <h3>Hantar Resit ke Pelanggan</h3>
            <div class="btn-col">
              <button class="btn wa" id="btnWa">📲 Hantar via WhatsApp</button>
              <button class="btn" id="btnCopy">🔗 Salin link resit</button>
              <a class="btn" href="${esc(link)}" target="_blank" rel="noopener">👁 Lihat paparan pelanggan</a>
              <button class="btn" id="btnSave">💾 Simpan resit (Gambar / PDF)</button>
              <button class="btn desktop-only" id="btnPrint">🖨 Cetak</button>
            </div>
            <p class="small muted">${CLOUD ? 'Pelanggan sentiasa nampak status terkini melalui link yang sama.' : 'Link resit mengandungi status terkini. Hantar semula selepas kemaskini status.'}</p>
          </div>

          ${
            closed
              ? ''
              : `<div class="card">
            <h3>Kemaskini Status</h3>
            <form id="stForm">
              <select name="status">${STATUS.filter((s) => s.key !== 'diambil')
                .map((s) => `<option value="${s.key}" ${s.key === job.status ? 'selected' : ''}>${esc(s.label)}</option>`)
                .join('')}</select>
              <textarea name="note" rows="2" placeholder="Nota (cth: Part skrin dah order, ETA 3 hari)"></textarea>
              <label class="check"><input type="checkbox" name="notify" checked><span>Maklumkan pelanggan via WhatsApp</span></label>
              <button class="btn primary" type="submit">Kemaskini</button>
            </form>
          </div>
          <div class="card">
            <h3>Pelanggan Ambil Device</h3>
            <a class="btn primary block" href="#/ambil/${encodeURIComponent(job.id)}">✔ Rekod Serahan Semula</a>
          </div>`
          }

          <div class="card">
            <h3>Lain-lain</h3>
            <div class="btn-col">
              <a class="btn" href="#/edit/${encodeURIComponent(job.id)}">✏ Edit maklumat</a>
              <button class="btn danger" id="btnDel">🗑 Padam rekod</button>
            </div>
          </div>
        </div>
        <div class="main"><div id="receiptBox">${renderReceipt(job, settings)}</div>${renderLog(job)}</div>
      </div>`;

    // Gambar dimuat berasingan (mod cloud) supaya halaman cepat dibuka
    if (Number(job.photoCount || 0) > 0 && !job.photos) {
      DB.getPhotos(job)
        .then((photos) => {
          if (currentView === 'job' && $('#receiptBox')) {
            $('#receiptBox').innerHTML = renderReceipt(Object.assign({}, job, { photos }), settings);
          }
        })
        .catch(() => {});
    }

    const sendWa = (text) => {
      window.open(`https://wa.me/${waPhone(job.customer.phone)}?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
    };
    const dev = [job.device.brand, job.device.model].filter(Boolean).join(' ');

    $('#btnWa').addEventListener('click', () => {
      sendWa(
        `Salam ${job.customer.name},\n\nTerima kasih kerana memilih ${settings.name}. Device anda telah kami terima.\n\n` +
          `No. Resit: *${job.id}*\nDevice: ${dev}\nMasalah: ${job.problem}\n` +
          (job.estimate !== '' && job.estimate != null ? `Anggaran: ${money(job.estimate)}\n` : '') +
          (job.deposit ? `Deposit: ${money(job.deposit)}\n` : '') +
          `Status: ${R.statusInfo(job.status).label}\n\n` +
          `Resit digital & status pembaikan:\n${link}\n\nSila simpan mesej ini sebagai bukti penghantaran device.`
      );
    });
    $('#btnCopy').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(link);
        toast('Link resit disalin');
      } catch (e) {
        prompt('Salin link ini:', link);
      }
    });
    $('#btnPrint').addEventListener('click', () => window.print());
    $('#btnSave').addEventListener('click', () => {
      // Jana dari versi pelanggan (tanpa passcode, gambar & tandatangan)
      const pub = R.publicPayload(job, settings);
      const box = document.createElement('div');
      box.className = 'export-stage';
      box.innerHTML = renderReceipt(pub.job, pub.shop, { isPublic: true });
      document.body.appendChild(box);
      ReceiptExport.open(box.querySelector('.receipt'), 'Resit-' + job.id).finally(() => box.remove());
    });
    $('#btnDel').addEventListener('click', async () => {
      if (!confirm(`Padam rekod ${job.id}? Tindakan ini tidak boleh diundur.`)) return;
      try {
        await DB.deleteJob(job.id);
      } catch (err) {
        alert('Gagal padam: ' + errMsg(err) + (CLOUD ? '\nHanya owner boleh padam rekod.' : ''));
        return;
      }
      toast('Rekod dipadam');
      location.hash = '#/';
    });

    const stForm = $('#stForm');
    if (stForm) {
      stForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(stForm);
        const status = fd.get('status');
        const note = fd.get('note').trim();
        if (status === job.status && !note) {
          toast('Tiada perubahan');
          return;
        }
        const now = new Date().toISOString();
        const changes = [];
        if (status !== job.status) changes.push({ f: 'Status', from: R.statusInfo(job.status).label, to: R.statusInfo(status).label });
        if (note) changes.push({ f: 'Nota', from: '', to: note });
        addLog(job, 'status', changes);
        job.status = status;
        job.updatedAt = now;
        job.history = (job.history || []).concat([{ status, at: now, note, by: me() }]);
        let result;
        try {
          result = await saveJob(job);
        } catch (err) {
          alert('Gagal simpan: ' + errMsg(err));
          return;
        }
        if (fd.get('notify')) {
          const msg =
            `Salam ${job.customer.name},\n\nKemaskini untuk device anda (${dev}), No. Resit *${job.id}*:\n\n` +
            `Status: *${R.statusInfo(status).label}*\n` +
            (note ? `Nota: ${note}\n` : '') +
            (status === 'siap' ? `\nDevice anda sudah siap dan boleh diambil. Sila tunjukkan resit digital semasa mengambil.\n` : '') +
            `\nResit & status terkini:\n${customerLink(job, settings)}\n\n- ${settings.name}`;
          sendWa(msg);
        }
        savedToast(result, 'Status dikemaskini');
        route();
      });
    }
  }

  /* ---------------- serahan semula ---------------- */
  async function viewPickup(id) {
    const job = await DB.getJob(id);
    if (!job) throw new Error('Rekod tidak dijumpai: ' + id);
    const final = job.estimate !== '' && job.estimate != null ? job.estimate : '';
    const toPay = final !== '' ? Math.max(0, Number(final) - Number(job.deposit || 0)) : '';

    app.innerHTML = `
      <form id="pkForm" class="card form" novalidate>
        <h2>Serahan Semula – ${esc(job.id)}</h2>
        <p class="muted">${esc(job.customer.name)} · ${esc([job.device.brand, job.device.model].join(' '))}</p>
        <div class="notice small">Semak resit / mesej WhatsApp pelanggan dan pastikan no. resit <strong>${esc(job.id)}</strong> sepadan sebelum serahkan device.</div>
        <div class="grid3">
          <label>Harga akhir (RM)<input name="finalPrice" type="number" step="0.01" min="0" inputmode="decimal" value="${esc(final)}"></label>
          <label>Deposit (RM)<input type="number" value="${esc(job.deposit || 0)}" disabled></label>
          <label>Dibayar sekarang (RM)<input name="paid" type="number" step="0.01" min="0" inputmode="decimal" value="${esc(toPay)}"></label>
        </div>
        <div class="grid3">
          <label>Cara bayaran<select name="method">${PAY_METHODS.map((m) => `<option>${m}</option>`).join('')}</select></label>
          <label>Waranti (hari)<input name="warrantyDays" type="number" min="0" step="1" value="${esc(settings.warrantyDays || '')}"></label>
          <label>Diambil oleh<input name="by" value="${esc(job.customer.name)}"></label>
        </div>
        <label>Nota (kerja yang dibuat, part ditukar, dll)<textarea name="note" rows="2"></textarea></label>
        <label class="check"><input type="checkbox" name="checked" required><span>Pelanggan telah memeriksa device dan berpuas hati.</span></label>
        <div class="sig-wrap">
          <div class="sig-label">Tandatangan pengambil *</div>
          <canvas id="sig" class="sig-pad"></canvas>
          <button type="button" class="btn small" id="sigClear">Padam tandatangan</button>
        </div>
        <div class="form-error" id="formError" hidden></div>
        <div class="actions">
          <a class="btn" href="#/job/${encodeURIComponent(job.id)}">Batal</a>
          <button class="btn primary" type="submit">Sahkan Serahan</button>
        </div>
      </form>`;

    const finalInput = $('[name=finalPrice]');
    finalInput.addEventListener('input', () => {
      const v = num(finalInput.value);
      if (v !== '') $('[name=paid]').value = Math.max(0, v - Number(job.deposit || 0)).toFixed(2);
    });

    const pad = signaturePad($('#sig'));
    $('#sigClear').addEventListener('click', () => pad.clear());

    $('#pkForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const errors = [];
      if (!fd.get('checked')) errors.push('Pengesahan pelanggan');
      if (pad.isEmpty()) errors.push('Tandatangan');
      const b = $('#formError');
      if (errors.length) {
        b.hidden = false;
        b.innerHTML = '<strong>Sila lengkapkan:</strong> ' + errors.join(', ');
        return;
      }
      const now = new Date().toISOString();
      job.pickup = {
        at: now,
        finalPrice: num(fd.get('finalPrice')),
        paid: num(fd.get('paid')),
        method: fd.get('method'),
        warrantyDays: num(fd.get('warrantyDays')),
        by: fd.get('by').trim(),
        note: fd.get('note').trim(),
        signOut: pad.toDataURL(),
        staff: me(),
      };
      const changes = [
        { f: 'Harga akhir', from: '', to: fmtVal(job.pickup.finalPrice, 'money') },
        { f: 'Dibayar', from: '', to: fmtVal(job.pickup.paid, 'money') + ' (' + job.pickup.method + ')' },
      ];
      if (job.pickup.warrantyDays) changes.push({ f: 'Waranti', from: '', to: job.pickup.warrantyDays + ' hari' });
      if (job.device && job.device.passcode) {
        // Passcode tidak diperlukan lagi selepas device diserahkan – padam untuk privasi pelanggan
        job.device = Object.assign({}, job.device, { passcode: '' });
        changes.push({ f: 'Passcode', from: '***', to: '(dipadam automatik)' });
      }
      addLog(job, 'serahan', changes);
      job.status = 'diambil';
      job.updatedAt = now;
      job.history = (job.history || []).concat([{ status: 'diambil', at: now, note: job.pickup.note, by: me() }]);
      let result;
      try {
        result = await saveJob(job);
      } catch (err) {
        b.hidden = false;
        b.textContent = 'Gagal simpan: ' + errMsg(err);
        return;
      }
      savedToast(result, 'Serahan direkodkan');
      location.hash = '#/job/' + encodeURIComponent(job.id);
    });
  }

  /* ---------------- tetapan & backup ---------------- */
  async function viewSettings() {
    const editable = canEditSettings();
    let localCount = 0;
    if (CLOUD) {
      try {
        localCount = (await LocalDB.allJobs()).length;
      } catch (e) {}
    }
    let usage = '';
    if (!CLOUD && navigator.storage && navigator.storage.estimate) {
      const est = await navigator.storage.estimate();
      usage = `${(est.usage / 1048576).toFixed(1)} MB digunakan`;
    }
    const u = CLOUD ? DB.currentUser() : null;

    app.innerHTML = `
      ${
        CLOUD
          ? `<div class="card">
        <h2>Akaun</h2>
        <p>Log masuk sebagai <strong>${esc(u && u.email)}</strong> (${DB.isOwner() ? 'Owner' : 'Staff'})</p>
        <button class="btn" id="btnLogout">Log Keluar</button>
      </div>`
          : ''
      }

      ${
        CLOUD && DB.isOwner()
          ? `<div class="card">
        <h2>Staff</h2>
        <p class="small muted">Cara tambah staff: (1) staff buka app ini, tekan <em>"Daftar akaun"</em> guna email mereka dan <strong>klik link pengesahan</strong> yang dihantar ke email tersebut, (2) owner tambah email yang sama di bawah. Tambah email hanya selepas staff sendiri mengesahkan mereka telah mendaftar. Staff boleh terima device, kemaskini status dan rekod serahan. Hanya owner boleh padam rekod dan ubah tetapan kedai.</p>
        <ul class="staff-list" id="staffList"></ul>
        <form id="staffForm" class="inline-form">
          <input name="email" type="email" placeholder="email staff" required>
          <button class="btn primary" type="submit">Tambah</button>
        </form>
      </div>`
          : ''
      }

      <form id="setForm" class="card form">
        <h2>Tetapan Kedai</h2>
        ${editable ? '' : '<p class="small muted">Hanya owner boleh ubah tetapan kedai.</p>'}
        <fieldset ${editable ? '' : 'disabled'} class="plain">
          <div class="grid2">
            <label>Nama kedai<input name="name" value="${esc(settings.name)}"></label>
            <label>No. telefon kedai<input name="phone" value="${esc(settings.phone)}"></label>
          </div>
          <label>Alamat<textarea name="address" rows="2">${esc(settings.address)}</textarea></label>
          <div class="grid2">
            <label>Prefix no. resit<input name="prefix" value="${esc(settings.prefix)}" maxlength="6"></label>
            <label>Waranti lalai (hari)<input name="warrantyDays" type="number" min="0" value="${esc(settings.warrantyDays)}"></label>
          </div>
          <label>Terma & syarat (satu baris = satu syarat)<textarea name="terms" rows="8">${esc(settings.terms)}</textarea></label>
          <div class="actions"><button class="btn primary" type="submit">Simpan Tetapan</button></div>
        </fieldset>
      </form>

      ${
        CLOUD && localCount && DB.isOwner()
          ? `<div class="card">
        <h2>Pindah Data Lama ke Cloud</h2>
        <p>Peranti ini ada <strong>${localCount}</strong> rekod yang disimpan sebelum sistem cloud diaktifkan. Pindahkan ke cloud supaya semua staff boleh lihat. Rekod yang sudah ada di cloud akan dilangkau.</p>
        <button class="btn primary" id="btnMigrate">⬆ Pindah ${localCount} rekod ke cloud</button>
      </div>`
          : ''
      }

      <div class="card">
        <h2>Backup Data</h2>
        <p class="small muted">Versi app: ${APP_VERSION}</p>
        <p>${
          CLOUD
            ? 'Data disimpan dalam cloud (Firebase) secara automatik dan boleh diakses dari semua peranti staff. Backup di bawah adalah salinan tambahan (pilihan).'
            : `Semua rekod disimpan dalam browser peranti ini${usage ? ' (' + usage + ')' : ''}. <strong>Buat backup secara berkala</strong> dan simpan fail di Google Drive / WhatsApp sendiri.`
        }</p>
        <div class="btn-row">
          <button class="btn primary" id="btnExport">⬇ Muat turun backup</button>
          ${editable ? '<label class="btn">⬆ Pulihkan dari backup<input type="file" id="importFile" accept="application/json,.json" hidden></label>' : ''}
          <button class="btn" id="btnCsv">📊 Eksport CSV (Excel)</button>
        </div>
      </div>`;

    if (CLOUD) $('#btnLogout').addEventListener('click', () => DB.signOut());

    if ($('#staffForm')) {
      const drawStaff = () => {
        const list = DB.getStaff();
        $('#staffList').innerHTML = list.length
          ? list.map((e) => `<li><span>${esc(e)}</span><button class="btn small danger" data-email="${esc(e)}">Buang</button></li>`).join('')
          : '<li class="muted small">Belum ada staff ditambah.</li>';
      };
      drawStaff();
      $('#staffList').addEventListener('click', async (e) => {
        const b = e.target.closest('button[data-email]');
        if (!b || !confirm(`Buang akses ${b.dataset.email}?`)) return;
        try {
          await DB.saveStaff(DB.getStaff().filter((x) => x !== b.dataset.email));
          drawStaff();
          toast('Akses staff dibuang');
        } catch (err) {
          alert(errMsg(err));
        }
      });
      $('#staffForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = e.target.email.value.trim().toLowerCase();
        if (!email) return;
        try {
          await DB.saveStaff(DB.getStaff().concat([email]));
          e.target.reset();
          drawStaff();
          toast('Staff ditambah');
        } catch (err) {
          alert(errMsg(err));
        }
      });
    }

    $('#setForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!editable) return;
      const fd = new FormData(e.target);
      const next = {
        name: fd.get('name').trim() || 'OGFIX',
        phone: fd.get('phone').trim(),
        address: fd.get('address').trim(),
        prefix: (fd.get('prefix').trim() || 'OGF').toUpperCase().replace(/[^A-Z0-9]/g, '') || 'OGF',
        warrantyDays: num(fd.get('warrantyDays')),
        terms: fd.get('terms').trim(),
      };
      try {
        await DB.saveSettings(next);
      } catch (err) {
        alert('Gagal simpan: ' + errMsg(err));
        return;
      }
      settings = next;
      applyShopName();
      toast('Tetapan disimpan');
    });

    if ($('#btnMigrate')) {
      $('#btnMigrate').addEventListener('click', async (e) => {
        const btn = e.target;
        btn.disabled = true;
        const local = await LocalDB.allJobs();
        let done = 0;
        let skipped = 0;
        for (const j of local) {
          btn.textContent = `Memindah… ${done + skipped}/${local.length}`;
          try {
            if (await DB.getJob(j.id)) {
              skipped++;
              continue;
            }
            const photos = j.photos || [];
            const copy = Object.assign({}, j);
            delete copy.photos;
            addLog(copy, 'pindah');
            await saveJob(copy, photos);
            done++;
          } catch (err) {
            alert(`Gagal pindah ${j.id}: ${errMsg(err)}`);
            break;
          }
        }
        btn.textContent = `Selesai: ${done} dipindah, ${skipped} dilangkau`;
        toast('Data lama dipindah ke cloud');
      });
    }

    const download = (name, content, type) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([content], { type }));
      a.download = name;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        URL.revokeObjectURL(a.href);
        a.remove();
      }, 1000);
    };
    const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');

    $('#btnExport').addEventListener('click', async (e) => {
      const btn = e.target;
      btn.disabled = true;
      btn.textContent = 'Menyediakan…';
      try {
        const all = await DB.allJobs({ full: true });
        const jobs = [];
        for (const j of all) jobs.push(Object.assign({}, j, { photos: await DB.getPhotos(j) }));
        download(
          `ogfix-backup-${stamp()}.json`,
          JSON.stringify({ app: 'ogfix-terima-device', version: 1, exportedAt: new Date().toISOString(), settings, jobs }),
          'application/json'
        );
        localStorageSet('lastBackup', new Date().toISOString());
        toast('Backup dimuat turun');
      } catch (err) {
        alert('Gagal backup: ' + errMsg(err));
      } finally {
        btn.disabled = false;
        btn.textContent = '⬇ Muat turun backup';
      }
    });

    $('#btnCsv').addEventListener('click', async () => {
      const all = await DB.allJobs({ full: true });
      const cols = [
        ['No Resit', (j) => j.id],
        ['Tarikh Terima', (j) => j.createdAt],
        ['Status', (j) => R.statusInfo(j.status).label],
        ['Nama', (j) => j.customer.name],
        ['Telefon', (j) => j.customer.phone],
        ['Jenama', (j) => j.device.brand],
        ['Model', (j) => j.device.model],
        ['IMEI', (j) => j.device.imei],
        ['Masalah', (j) => j.problem],
        ['Anggaran', (j) => j.estimate],
        ['Deposit', (j) => j.deposit],
        ['Harga Akhir', (j) => (j.pickup ? j.pickup.finalPrice : '')],
        ['Tarikh Ambil', (j) => (j.pickup ? j.pickup.at : '')],
        ['Staff', (j) => j.staff],
      ];
      const cell = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
      const csv =
        '﻿' +
        [cols.map((c) => cell(c[0])).join(',')]
          .concat(all.map((j) => cols.map((c) => cell(c[1](j))).join(',')))
          .join('\r\n');
      download(`ogfix-rekod-${stamp()}.csv`, csv, 'text/csv');
    });

    if ($('#importFile')) {
      $('#importFile').addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try {
          const data = JSON.parse(await file.text());
          if (!data || !Array.isArray(data.jobs)) throw new Error('Fail bukan backup yang sah');
          if (
            !confirm(
              `Pulihkan ${data.jobs.length} rekod dari backup?\nRekod dengan no. resit yang sama akan ditulis semula. Rekod lain dikekalkan.`
            )
          )
            return;
          for (const j of data.jobs) {
            if (!j || !j.id) continue;
            const photos = j.photos || [];
            const copy = Object.assign({}, j);
            delete copy.photos;
            addLog(copy, 'pulih');
            await saveJob(copy, photos);
          }
          if (data.settings && confirm('Pulihkan juga tetapan kedai dari backup?')) {
            settings = Object.assign({}, settings, data.settings);
            await DB.saveSettings(settings);
            applyShopName();
          }
          toast('Backup dipulihkan');
          route();
        } catch (err) {
          alert('Gagal pulihkan: ' + errMsg(err));
        } finally {
          e.target.value = '';
        }
      });
    }
  }

  function localStorageGet(k) {
    try {
      return localStorage.getItem('ogfix.' + k) || '';
    } catch (e) {
      return '';
    }
  }
  function localStorageSet(k, v) {
    try {
      localStorage.setItem('ogfix.' + k, v);
    } catch (e) {}
  }

  function applyShopName() {
    $$('.shop-name').forEach((el) => (el.textContent = settings.name));
    document.title = settings.name + ' – Terima Device';
  }

  async function loadSettings() {
    const s = await DB.getSettings();
    settings = Object.assign({}, DEFAULT_SETTINGS, s || {});
    if (!s && canEditSettings()) {
      try {
        await DB.saveSettings(settings);
      } catch (e) {}
    }
    applyShopName();
  }

  /* ---------------- start ---------------- */
  /* ---------- semakan versi: pastikan semua telefon guna versi terbaru ----------
     Bila kemaskini app: naikkan APP_VERSION, version.json dan ?v= dalam index.html/resit.html */
  const APP_VERSION = '9';

  async function latestVersion() {
    try {
      const r = await fetch('version.json?t=' + Date.now(), { cache: 'no-store' });
      if (!r.ok) return null;
      return String((await r.json()).v);
    } catch (e) {
      return null;
    }
  }

  function reloadToVersion(v) {
    const u = new URL(location.href);
    u.searchParams.set('v', v); // URL baru = elak halaman lama dari cache browser
    location.replace(u.toString());
  }

  async function checkUpdate(onStart) {
    const v = await latestVersion();
    if (!v || v === APP_VERSION) return false;
    let tried = '';
    try {
      tried = sessionStorage.getItem('ogfix.reloadFor') || '';
      sessionStorage.setItem('ogfix.reloadFor', v);
    } catch (e) {}
    if (onStart && tried === v) return false; // elak muat semula berulang
    if (onStart || ['list', 'job'].includes(currentView)) {
      reloadToVersion(v);
      return true;
    }
    if (!$('#updateBar')) {
      const bar = document.createElement('div');
      bar.id = 'updateBar';
      bar.innerHTML = 'Versi baru app tersedia. <button class="btn small">Kemaskini</button>';
      bar.querySelector('button').addEventListener('click', () => reloadToVersion(v));
      document.body.appendChild(bar);
    }
    return true;
  }

  async function init() {
    if (await checkUpdate(true)) return;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') checkUpdate(false);
    });
    window.addEventListener('hashchange', route);
    try {
      await DB.init(window.FIREBASE_CONFIG);
    } catch (err) {
      app.innerHTML = `<div class="card login"><h2>Tidak dapat dimuatkan</h2><p>${esc(errMsg(err))}</p>
        <button class="btn primary" onclick="location.reload()">Cuba Lagi</button></div>`;
      return;
    }
    if (!CLOUD) {
      await loadSettings();
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
      ready = true;
      setLoggedIn(true);
      return route();
    }
    DB.onChange(() => {
      if (ready && currentView === 'list' && listRefresh) listRefresh();
    });
    DB.onAuth((u) => enterSession(u));
  }

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  init();
})();
