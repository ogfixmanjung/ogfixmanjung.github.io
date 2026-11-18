/* Aplikasi staff: terima device, senarai job, kemaskini status, serah semula. */
(function () {
  const { STATUS, DEFAULT_TERMS, esc, badge, money, fmtDate, renderReceipt, customerLink } = window.R;
  const app = document.getElementById('app');

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

  let settings = null;

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
    toast._h = setTimeout(() => t.classList.remove('show'), 2600);
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

  async function nextId() {
    const prefix = (settings.prefix || 'OGF').toUpperCase();
    const now = new Date();
    const ymd =
      String(now.getFullYear()).slice(2) +
      String(now.getMonth() + 1).padStart(2, '0') +
      String(now.getDate()).padStart(2, '0');
    const head = `${prefix}-${ymd}-`;
    const jobs = await DB.allJobs();
    let max = 0;
    jobs.forEach((j) => {
      if (j.id.startsWith(head)) max = Math.max(max, parseInt(j.id.slice(head.length), 10) || 0);
    });
    return head + String(max + 1).padStart(3, '0');
  }

  function resizeImage(file, maxSide = 1280, quality = 0.7) {
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
    const hash = location.hash.replace(/^#\/?/, '');
    const [path, query] = hash.split('?');
    const parts = path.split('/').filter(Boolean);
    $$('.nav a').forEach((a) => a.classList.toggle('active', a.getAttribute('href') === '#/' + (parts[0] || '')));
    window.scrollTo(0, 0);
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
      app.innerHTML = `<div class="card"><h2>Ralat</h2><p>${esc(err.message || err)}</p></div>`;
    }
  }

  /* ---------------- senarai ---------------- */
  let listFilter = { q: '', status: 'aktif' };

  async function viewList() {
    const jobs = await DB.allJobs();
    const counts = {};
    jobs.forEach((j) => (counts[j.status] = (counts[j.status] || 0) + 1));
    const active = jobs.filter((j) => !['diambil', 'batal'].includes(j.status)).length;

    const filters = [
      { key: 'aktif', label: `Aktif (${active})` },
      { key: 'semua', label: `Semua (${jobs.length})` },
    ].concat(STATUS.map((s) => ({ key: s.key, label: `${s.label} (${counts[s.key] || 0})` })));

    app.innerHTML = `
      <div class="stats">
        <div class="stat"><span>${active}</span>Device dalam kedai</div>
        <div class="stat"><span>${counts.siap || 0}</span>Siap, belum ambil</div>
        <div class="stat"><span>${counts.menunggu_part || 0}</span>Menunggu part</div>
        <div class="stat"><span>${jobs.filter((j) => new Date(j.createdAt).toDateString() === new Date().toDateString()).length}</span>Diterima hari ini</div>
      </div>
      <div class="toolbar">
        <input type="search" id="q" placeholder="Cari no. resit, nama, telefon, IMEI, model…" value="${esc(listFilter.q)}">
        <select id="f">${filters
          .map((f) => `<option value="${f.key}" ${listFilter.status === f.key ? 'selected' : ''}>${esc(f.label)}</option>`)
          .join('')}</select>
      </div>
      <div id="list"></div>`;

    const draw = () => {
      const q = listFilter.q.trim().toLowerCase();
      const out = jobs.filter((j) => {
        if (listFilter.status === 'aktif' && ['diambil', 'batal'].includes(j.status)) return false;
        if (!['aktif', 'semua'].includes(listFilter.status) && j.status !== listFilter.status) return false;
        if (!q) return true;
        const hay = [j.id, j.customer.name, j.customer.phone, j.device.brand, j.device.model, j.device.imei, j.problem]
          .join(' ')
          .toLowerCase();
        return hay.includes(q) || hay.replace(/\D/g, '').includes(q.replace(/\D/g, '') || '§');
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
            jobs.length ? 'Tiada rekod yang sepadan.' : 'Belum ada device diterima.<br><a class="btn primary" href="#/baru">+ Terima Device Pertama</a>'
          }</div>`;
    };
    $('#q').addEventListener('input', (e) => {
      listFilter.q = e.target.value;
      draw();
    });
    $('#f').addEventListener('change', (e) => {
      listFilter.status = e.target.value;
      draw();
    });
    draw();
  }

  /* ---------------- borang terima / edit ---------------- */
  async function viewForm(editId) {
    const job = editId ? await DB.getJob(editId) : null;
    if (editId && !job) throw new Error('Rekod tidak dijumpai: ' + editId);
    const j = job || { customer: {}, device: {}, accessories: [], condition: [], photos: [] };
    let photos = (j.photos || []).slice();

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
            <label>Diterima oleh (staff)<input name="staff" value="${esc(j.staff || localStorageGet('lastStaff'))}"></label>
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
      drawPhotos();
    });
    $('#photoInput').addEventListener('change', async (e) => {
      for (const f of Array.from(e.target.files || [])) {
        try {
          photos.push(await resizeImage(f));
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
        photos,
        problem: fd.get('problem').trim(),
        estimate: num(fd.get('estimate')),
        deposit: num(fd.get('deposit')),
        eta: fd.get('eta'),
        staff: fd.get('staff').trim(),
        notes: fd.get('notes').trim(),
        updatedAt: now,
      });
      localStorageSet('lastStaff', data.staff);

      if (!job) {
        data.id = await nextId();
        data.createdAt = now;
        data.status = 'diterima';
        data.history = [{ status: 'diterima', at: now, note: 'Device diterima di kaunter' }];
        data.signIn = pad.toDataURL();
        data.agreed = true;
        data.pickup = null;
      }
      try {
        await DB.putJob(data);
      } catch (err) {
        errBox.hidden = false;
        errBox.textContent = 'Gagal simpan: ' + (err.message || err) + '. Cuba kurangkan bilangan gambar.';
        return;
      }
      location.hash = '#/job/' + encodeURIComponent(data.id) + (job ? '' : '?baru=1');
      toast(job ? 'Perubahan disimpan' : 'Device diterima – resit dijana');
    });
  }

  /* ---------------- butiran job ---------------- */
  async function viewJob(id, params) {
    const job = await DB.getJob(id);
    if (!job) throw new Error('Rekod tidak dijumpai: ' + id);
    const closed = ['diambil', 'batal'].includes(job.status);
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
              <button class="btn" id="btnPrint">🖨 Cetak / Simpan PDF</button>
            </div>
            <p class="small muted">Link resit mengandungi status terkini. Hantar semula selepas kemaskini status.</p>
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
        <div class="main">${renderReceipt(job, settings)}</div>
      </div>`;

    const sendWa = (text) => {
      window.open(`https://wa.me/${waPhone(job.customer.phone)}?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
    };
    const dev = [job.device.brand, job.device.model].filter(Boolean).join(' ');

    $('#btnWa').addEventListener('click', () => {
      sendWa(
        `Salam ${job.customer.name},\n\nTerima kasih kerana memilih ${settings.name}. Device anda telah kami terima.\n\n` +
          `No. Resit: *${job.id}*\nDevice: ${dev}\nMasalah: ${job.problem}\n` +
          (job.estimate !== '' ? `Anggaran: ${money(job.estimate)}\n` : '') +
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
    $('#btnDel').addEventListener('click', async () => {
      if (!confirm(`Padam rekod ${job.id}? Tindakan ini tidak boleh diundur.`)) return;
      await DB.deleteJob(job.id);
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
        job.status = status;
        job.updatedAt = now;
        job.history = (job.history || []).concat([{ status, at: now, note }]);
        await DB.putJob(job);
        if (fd.get('notify')) {
          const msg =
            `Salam ${job.customer.name},\n\nKemaskini untuk device anda (${dev}), No. Resit *${job.id}*:\n\n` +
            `Status: *${R.statusInfo(status).label}*\n` +
            (note ? `Nota: ${note}\n` : '') +
            (status === 'siap' ? `\nDevice anda sudah siap dan boleh diambil. Sila tunjukkan resit digital semasa mengambil.\n` : '') +
            `\nResit & status terkini:\n${customerLink(job, settings)}\n\n- ${settings.name}`;
          sendWa(msg);
        }
        toast('Status dikemaskini');
        route();
      });
    }
  }

  /* ---------------- serahan semula ---------------- */
  async function viewPickup(id) {
    const job = await DB.getJob(id);
    if (!job) throw new Error('Rekod tidak dijumpai: ' + id);
    const final = job.estimate !== '' ? job.estimate : '';
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
      if (errors.length) {
        const b = $('#formError');
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
      };
      job.status = 'diambil';
      job.updatedAt = now;
      job.history = (job.history || []).concat([{ status: 'diambil', at: now, note: job.pickup.note }]);
      await DB.putJob(job);
      toast('Serahan direkodkan');
      location.hash = '#/job/' + encodeURIComponent(job.id);
    });
  }

  /* ---------------- tetapan & backup ---------------- */
  async function viewSettings() {
    const jobs = await DB.allJobs();
    let usage = '';
    if (navigator.storage && navigator.storage.estimate) {
      const est = await navigator.storage.estimate();
      usage = `${(est.usage / 1048576).toFixed(1)} MB digunakan daripada ~${(est.quota / 1048576).toFixed(0)} MB`;
    }

    app.innerHTML = `
      <form id="setForm" class="card form">
        <h2>Tetapan Kedai</h2>
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
      </form>

      <div class="card">
        <h2>Backup Data</h2>
        <p>Semua rekod disimpan dalam browser peranti ini (${jobs.length} rekod${usage ? ', ' + usage : ''}).
        <strong>Buat backup secara berkala</strong> dan simpan fail di Google Drive / WhatsApp sendiri, supaya data tidak hilang jika telefon rosak atau browser dikosongkan.</p>
        <div class="btn-row">
          <button class="btn primary" id="btnExport">⬇ Muat turun backup</button>
          <label class="btn">⬆ Pulihkan dari backup<input type="file" id="importFile" accept="application/json,.json" hidden></label>
          <button class="btn" id="btnCsv">📊 Eksport CSV (Excel)</button>
        </div>
      </div>`;

    $('#setForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      settings = {
        name: fd.get('name').trim() || 'OGFIX',
        phone: fd.get('phone').trim(),
        address: fd.get('address').trim(),
        prefix: (fd.get('prefix').trim() || 'OGF').toUpperCase().replace(/[^A-Z0-9]/g, ''),
        warrantyDays: num(fd.get('warrantyDays')),
        terms: fd.get('terms').trim(),
      };
      await DB.saveSettings(settings);
      applyShopName();
      toast('Tetapan disimpan');
    });

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

    $('#btnExport').addEventListener('click', async () => {
      const all = await DB.allJobs();
      download(
        `ogfix-backup-${stamp()}.json`,
        JSON.stringify({ app: 'ogfix-terima-device', version: 1, exportedAt: new Date().toISOString(), settings, jobs: all }),
        'application/json'
      );
      localStorageSet('lastBackup', new Date().toISOString());
      toast('Backup dimuat turun');
    });

    $('#btnCsv').addEventListener('click', async () => {
      const all = await DB.allJobs();
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
        for (const j of data.jobs) if (j && j.id) await DB.putJob(j);
        if (data.settings && confirm('Pulihkan juga tetapan kedai dari backup?')) {
          settings = Object.assign({}, settings, data.settings);
          await DB.saveSettings(settings);
          applyShopName();
        }
        toast('Backup dipulihkan');
        route();
      } catch (err) {
        alert('Gagal pulihkan: ' + (err.message || err));
      } finally {
        e.target.value = '';
      }
    });
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

  /* ---------------- start ---------------- */
  async function init() {
    settings = await DB.getSettings();
    if (!settings) {
      settings = { name: 'OGFIX', phone: '', address: '', prefix: 'OGF', warrantyDays: 30, terms: DEFAULT_TERMS };
      await DB.saveSettings(settings);
    }
    applyShopName();
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    window.addEventListener('hashchange', route);
    route();
  }

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  init();
})();
