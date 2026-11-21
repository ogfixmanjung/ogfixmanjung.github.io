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
    'Terkena air laut',
    'Phone restart-restart',
    'Pernah dibuka / dibaiki',
    'Tidak boleh hidup',
    'Keadaan baik',
  ];
  const PAY_METHODS = ['Tunai', 'Online Transfer', 'DuitNow QR', 'Kad Debit/Kredit', 'E-Wallet'];
  const DEFAULT_SETTINGS = {
    name: 'OGFIX',
    phone: '',
    address: '',
    prefix: 'OGF',
    warrantyDays: 30,
    warrantyOptions: 'Tiada waranti = 0\n2 minggu = 14\n1 bulan = 30\n2 bulan = 60\n3 bulan = 90',
    remindDays: 3,
    pics: ['Acap', 'Azim', 'Hakim', 'Haziq', 'Iqbal'],
    slogan: 'Your device lifesaver',
    reviewLink: '',
    greeting: 'Assalamualaikum / Salam Sejahtera',
    siapMsg:
      '{salam} {nama},\n\n{device} anda sudah SIAP dibaiki dan boleh diambil di kedai 😊\n\nNo. Resit: *{resit}*\nKod Ambil: *{kod}*\nBaki bayaran: {harga}\n\nResit digital: {link}\n\nTerima kasih,\n*{kedai}*',
    commissionTarget: 50000,
    commissionRate: 10,
    commissionMode: 'lebihan',
    showTargetToTech: true,
    reviewMsg:
      'Terima kasih kerana memilih {kedai}! 🙏\n\nKalau berpuas hati dengan servis kami, sudi tak luangkan 1 minit untuk beri review di Google? Ia sangat membantu kedai kecil macam kami:\n{link}',
    abandonDays: 30,
    terms: DEFAULT_TERMS,
  };

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
    ['PIC repair', (j) => j.pic],
    ['Status waranti semasa terima', (j) => (j.intakeWarranty ? INTAKE_WARRANTY[j.intakeWarranty] : '')],
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
    peringatan: 'Peringatan dihantar',
    resit: 'Link resit / kod ambil dijana',
    review: 'Review Google diminta',
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

  /* ---------- pelanggan lama & waranti ---------- */
  function normPhone(p) {
    let d = String(p || '').replace(/\D/g, '');
    if (d.startsWith('60')) d = '0' + d.slice(2);
    else if (d.startsWith('1')) d = '0' + d;
    return d;
  }

  function warrantyUntil(job) {
    if (!job.pickup) return null;
    if (job.pickup.warrantyEnd) return new Date(job.pickup.warrantyEnd);
    if (!job.pickup.warrantyDays) return null;
    return new Date(new Date(job.pickup.at).getTime() + Number(job.pickup.warrantyDays) * 864e5);
  }

  function warrantyActive(job) {
    const w = warrantyUntil(job);
    return !!w && w.getTime() >= Date.now();
  }

  function customerJobs(jobs, phone, excludeId) {
    const p = normPhone(phone);
    if (p.length < 9) return [];
    return jobs
      .filter((j) => j.id !== excludeId && normPhone(j.customer && j.customer.phone) === p)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  function historyItem(j, buttons) {
    const w = warrantyUntil(j);
    const wTxt = w ? (warrantyActive(j) ? `<span class="w-ok">🛡 Waranti aktif sehingga ${fmtDate(w.toISOString(), false)}</span>` : `<span class="muted">Waranti tamat ${fmtDate(w.toISOString(), false)}</span>`) : '';
    return `<li>
      <div><a href="#/job/${encodeURIComponent(j.id)}"><strong>${esc(j.id)}</strong></a> · ${esc([j.device.brand, j.device.model].filter(Boolean).join(' '))} ${badge(j.status)}</div>
      <div class="small muted">${fmtDate(j.createdAt, false)} · ${esc(j.problem || '')}${j.pic ? ' · 👤 ' + esc(j.pic) : ''}${j.warrantyOf ? ' · 🛡 claim waranti' : ''}</div>
      ${wTxt ? `<div class="small">${wTxt}</div>` : ''}
      ${buttons || ''}
    </li>`;
  }

  /* ---------- lencana waranti (job yang telah diambil) ---------- */
  function warrantyBadge(j) {
    if (j.status !== 'diambil' || !j.pickup) return '';
    const w = warrantyUntil(j);
    if (!w) return ' <span class="wbadge none">Tiada waranti</span>';
    return warrantyActive(j)
      ? ` <span class="wbadge on">🛡 Waranti aktif · hingga ${fmtDate(w.toISOString(), false)}</span>`
      : ` <span class="wbadge off">Waranti tamat ${fmtDate(w.toISOString(), false)}</span>`;
  }

  const INTAKE_WARRANTY = { tidak: 'Tiada waranti', kedai: 'Waranti kedai', pengeluar: 'Waranti pengeluar / lain' };

  /* ---------- komisen technician (bulanan) ---------- */
  function monthKey(d) {
    d = new Date(d);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  /* Jualan setiap PIC ikut bulan (harga akhir job yang diambil dalam [start, end)) */
  function picMonthlySales(jobs, start, end) {
    const out = {};
    jobs.forEach((j) => {
      if (!j.pic || !j.pickup || !j.pickup.at) return;
      const t = new Date(j.pickup.at).getTime();
      if (t < start.getTime() || t >= end.getTime()) return;
      const m = monthKey(j.pickup.at);
      out[j.pic] = out[j.pic] || {};
      out[j.pic][m] = (out[j.pic][m] || 0) + Number(j.pickup.finalPrice || 0);
    });
    return out;
  }

  function commissionFor(sales) {
    const target = Number(settings.commissionTarget || 0);
    const rate = Number(settings.commissionRate || 0) / 100;
    if (sales < target || !rate) return 0;
    return settings.commissionMode === 'semua' ? sales * rate : (sales - target) * rate;
  }

  function commissionRule() {
    return `${Number(settings.commissionRate || 0)}% ${settings.commissionMode === 'semua' ? 'atas semua jualan' : 'atas jualan melebihi sasaran'} selepas capai sasaran ${money(settings.commissionTarget)} sebulan`;
  }

  /* ---------- pilihan tempoh waranti ---------- */
  function warrantyOpts() {
    const out = String(settings.warrantyOptions || DEFAULT_SETTINGS.warrantyOptions)
      .split('\n')
      .map((l) => l.split('='))
      .filter((x) => x.length === 2 && x[0].trim() && !isNaN(parseInt(x[1], 10)))
      .map(([l, d]) => ({ label: l.trim(), days: parseInt(d, 10) }));
    return out.length ? out : [{ label: 'Tiada waranti', days: 0 }];
  }

  function warrantyText(days, label) {
    days = Number(days || 0);
    if (!days) return 'Tiada waranti';
    return label || `${days} hari`;
  }

  /* Kawalan pilih waranti: select + (Lain-lain) input hari */
  function warrantyField(name, days, cont) {
    const opts = warrantyOpts();
    const d = cont || days === '' || days == null ? null : Number(days);
    const match = d == null ? null : opts.find((o) => o.days === d);
    const custom = d != null && !match;
    return `<select name="${name}Sel" class="w-sel">${cont ? `<option value="cont" selected>${esc(cont.label)}</option>` : ''}${opts
      .map((o) => `<option value="${o.days}" ${match && match.days === o.days ? 'selected' : ''}>${esc(o.label)}</option>`)
      .join('')}<option value="custom" ${custom ? 'selected' : ''}>Lain-lain (taip hari)…</option></select>
      <input name="${name}Custom" class="w-custom" type="number" min="0" step="1" inputmode="numeric" placeholder="Bilangan hari" value="${custom ? esc(d) : ''}" ${custom ? '' : 'hidden'}>`;
  }

  function bindWarrantyField(root, name) {
    const sel = root.querySelector(`[name=${name}Sel]`);
    const inp = root.querySelector(`[name=${name}Custom]`);
    sel.addEventListener('change', () => {
      inp.hidden = sel.value !== 'custom';
      if (!inp.hidden) inp.focus();
    });
  }

  /* Baca nilai: { days, label } atau null jika 'Lain-lain' kosong */
  function readWarranty(fd, name, cont) {
    const v = fd.get(name + 'Sel');
    if (v === 'cont' && cont) return { days: cont.days, label: 'Sambung waranti asal', end: cont.end };
    if (v === 'custom') {
      const d = num(fd.get(name + 'Custom'));
      if (d === '') return null;
      return { days: d, label: d ? `${d} hari` : '' };
    }
    const o = warrantyOpts().find((x) => String(x.days) === v);
    const days = Number(v || 0);
    return { days, label: days ? (o ? o.label : `${days} hari`) : '' };
  }

  /* Sapaan & penutup mesej WhatsApp kepada pelanggan */
  function greet(name) {
    return `${(settings.greeting || DEFAULT_SETTINGS.greeting).trim()} ${name},`;
  }

  function signoff() {
    // Bukan '- Nama' kerana WhatsApp menukar '- ' di awal baris menjadi titik senarai
    return `Terima kasih,\n*${settings.name}*`;
  }

  /* ---------- tukar status pantas & mesej WhatsApp ---------- */
  /* Mesej 'Siap' ikut templat di Tetapan. Baris yang nilainya kosong
     (cth tiada baki bayaran / tiada kod) dibuang secara automatik. */
  function siapMsg(job, note) {
    const dev = [job.device.brand, job.device.model].filter(Boolean).join(' ');
    const est = job.estimate === '' || job.estimate == null ? null : Number(job.estimate);
    const bal = est == null ? 0 : est - Number(job.deposit || 0);
    const vals = {
      salam: (settings.greeting || DEFAULT_SETTINGS.greeting).trim(),
      nama: job.customer.name,
      device: dev,
      resit: job.id,
      kod: job.pickupCode || '',
      harga: bal > 0 ? money(bal) : '',
      link: customerLink(job, settings),
      kedai: settings.name,
      nota: note || '',
    };
    const tpl = String(settings.siapMsg || DEFAULT_SETTINGS.siapMsg);
    let lines = tpl.split('\n').filter((line) => {
      const keys = (line.match(/\{(\w+)\}/g) || []).map((k) => k.slice(1, -1)).filter((k) => k in vals);
      return !keys.length || keys.some((k) => vals[k] !== '');
    });
    let msg = lines.join('\n').replace(/\{(\w+)\}/g, (m, k) => (k in vals ? vals[k] : m));
    msg = msg.replace(/\n{3,}/g, '\n\n');
    if (note && !tpl.includes('{nota}')) {
      // Nota staff diletak selepas ayat utama (perenggan kedua, selepas sapaan)
      const first = msg.indexOf('\n\n');
      const i = first >= 0 ? msg.indexOf('\n\n', first + 2) : -1;
      msg = i >= 0 ? msg.slice(0, i) + `\n\nNota: ${note}` + msg.slice(i) : msg + `\n\nNota: ${note}`;
    }
    return msg;
  }

  function statusWaMsg(job, status, note) {
    if (status === 'siap') return siapMsg(job, note);
    const dev = [job.device.brand, job.device.model].filter(Boolean).join(' ');
    return (
      `${greet(job.customer.name)}\n\nKemaskini untuk device anda (${dev}), No. Resit *${job.id}*:\n\n` +
      `Status: *${R.statusInfo(status).label}*\n` +
      (note ? `Nota: ${note}\n` : '') +
      (status === 'siap' || status === 'batal'
        ? `\nDevice anda sedia untuk diambil. Sila sebut / tunjuk Kod Ambil semasa mengambil.\n${codeLine(job)}`
        : '') +
      `\nResit & status terkini:\n${customerLink(job, settings)}\n\n${signoff()}`
    );
  }

  async function applyStatus(job, status, note) {
    const now = new Date().toISOString();
    addLog(job, 'status', [{ f: 'Status', from: R.statusInfo(job.status).label, to: R.statusInfo(status).label }].concat(note ? [{ f: 'Nota', from: '', to: note }] : []));
    job.status = status;
    job.updatedAt = now;
    job.history = (job.history || []).concat([{ status, at: now, note: note || '', by: me() }]);
    return saveJob(job);
  }

  // Salinan job dari senarai yang sudah dipaparkan: dapat terus tanpa await,
  // supaya WhatsApp boleh dibuka dalam klik itu sendiri (iPhone sekat selepas await).
  function cachedCopy(map, id) {
    const j = map && map.get(id);
    return j ? JSON.parse(JSON.stringify(j)) : null;
  }

  /* ---------- minta review Google ---------- */
  async function askReview(job) {
    let msg = String(settings.reviewMsg || DEFAULT_SETTINGS.reviewMsg)
      .replace(/\{kedai\}/g, settings.name)
      .replace(/\{nama\}/g, job.customer.name)
      .replace(/\{link\}/g, settings.reviewLink);
    if (!/^\s*(assalamualaikum|salam)/i.test(msg)) msg = `${greet(job.customer.name)}\n\n${msg}`;
    window.open(`https://wa.me/${waPhone(job.customer.phone)}?text=${encodeURIComponent(msg)}`, '_blank', 'noopener');
    job.reviewAsked = { at: new Date().toISOString(), by: me() || actor() };
    job.updatedAt = job.reviewAsked.at;
    addLog(job, 'review', [{ f: 'Review Google', from: '', to: 'diminta melalui WhatsApp' }]);
    const res = await saveJob(job);
    savedToast(res, 'Permintaan review dihantar');
  }

  function reviewCard(job) {
    if (job.status !== 'diambil') return '';
    if (!settings.reviewLink)
      return `<div class="card"><h3>⭐ Minta review Google</h3><p class="small muted">${canEditSettings() ? 'Isi <a href="#/tetapan">link Google Review di Tetapan</a> untuk guna fungsi ini.' : 'Owner belum isi link Google Review di Tetapan.'}</p></div>`;
    return `<div class="card review-card"><h3>⭐ Minta review Google</h3>
      <p class="small muted">${job.reviewAsked ? 'Sudah diminta ' + fmtDate(job.reviewAsked.at) : 'Belum diminta'}</p>
      <button class="btn block review-btn" data-review="${esc(job.id)}">📲 ${job.reviewAsked ? 'Minta sekali lagi' : 'Minta review via WhatsApp'}</button></div>`;
  }

  /* ---------- jenama device ---------- */
  const BRANDS = ['Apple', 'Samsung', 'Xiaomi', 'Redmi', 'Poco', 'Oppo', 'Vivo', 'Realme', 'Huawei', 'Honor', 'Infinix', 'Tecno', 'OnePlus', 'Google', 'Nokia', 'Motorola'];

  function brandOptions(cur) {
    const other = cur && !BRANDS.includes(cur);
    return (
      `<option value="">— Pilih jenama —</option>` +
      BRANDS.map((b) => `<option ${b === cur ? 'selected' : ''}>${b}</option>`).join('') +
      `<option value="__other" ${other ? 'selected' : ''}>Lain-lain (taip)…</option>`
    );
  }

  /* ---------- PIC repair (technician) ---------- */
  function picList() {
    return (settings.pics || []).map((x) => String(x).trim()).filter(Boolean);
  }

  function picOptions(selected) {
    const list = picList();
    if (selected && !list.includes(selected)) list.push(selected); // nama lama yang telah dibuang dari tetapan
    return `<option value="">— Belum ditetapkan —</option>` + list.map((n) => `<option ${n === selected ? 'selected' : ''}>${esc(n)}</option>`).join('');
  }

  /* ---------- kod ambil (4 digit) ---------- */
  async function newPickupCode() {
    let used = new Set();
    try {
      used = new Set((await DB.allJobs()).filter((j) => j.status !== 'diambil' && j.pickupCode).map((j) => j.pickupCode));
    } catch (e) {}
    const buf = new Uint32Array(1);
    for (let i = 0; i < 50; i++) {
      crypto.getRandomValues(buf);
      const code = String(1000 + (buf[0] % 9000));
      if (!used.has(code)) return code;
    }
    return String(1000 + (buf[0] % 9000));
  }

  function codeLine(job) {
    return job.pickupCode && job.status !== 'diambil'
      ? `Kod Ambil: *${job.pickupCode}*\n(sebut / tunjuk kod ini semasa mengambil device)\n`
      : '';
  }

  /* ---------- peringatan device belum diambil ---------- */
  const DAY = 864e5;

  function readySince(job) {
    const h = (job.history || []).filter((x) => x.status === job.status).pop();
    return (h && h.at) || job.updatedAt || job.createdAt;
  }

  function daysSince(iso) {
    return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / DAY));
  }

  function needsReminder(job) {
    return ['siap', 'batal'].includes(job.status) && daysSince(readySince(job)) >= Number(settings.remindDays || 3);
  }

  function lastReminder(job) {
    const r = job.reminders || [];
    return r.length ? r[r.length - 1] : null;
  }

  /* Hantar WhatsApp peringatan & rekod dalam job (log). window.open dipanggil dahulu
     supaya tidak disekat oleh browser. */
  async function remindCustomer(job) {
    const dev = [job.device.brand, job.device.model].filter(Boolean).join(' ');
    const days = daysSince(readySince(job));
    const abandon = Number(settings.abandonDays || 30);
    const bal = job.estimate !== '' && job.estimate != null ? Number(job.estimate) - Number(job.deposit || 0) : 0;
    const msg =
      `${greet(job.customer.name)}\n\nPeringatan mesra dari ${settings.name}: device anda (${dev}), No. Resit *${job.id}* ` +
      (job.status === 'batal' ? 'sedia untuk diambil semula' : 'telah siap dibaiki') +
      ` sejak ${fmtDate(readySince(job), false)} (${days} hari).\n\nSila ambil device anda di kedai pada waktu operasi.` +
      (bal > 0 ? ` Anggaran baki bayaran: ${money(bal)}.` : '') +
      `\n\n${codeLine(job)}\nResit digital:\n${customerLink(job, settings)}\n\n` +
      `Mengikut terma kami, device yang tidak dituntut dalam tempoh ${abandon} hari selepas dimaklumkan siap bukan lagi tanggungjawab kedai.\n\n${signoff()}`;
    window.open(`https://wa.me/${waPhone(job.customer.phone)}?text=${encodeURIComponent(msg)}`, '_blank', 'noopener');
    const n = (job.reminders || []).length + 1;
    job.reminders = (job.reminders || []).concat([{ at: new Date().toISOString(), by: me() || actor() }]);
    job.updatedAt = new Date().toISOString();
    addLog(job, 'peringatan', [{ f: 'Peringatan ambil device', from: '', to: `#${n} (${days} hari selepas siap)` }]);
    const res = await saveJob(job);
    savedToast(res, 'Peringatan #' + n + ' direkod');
  }

  function reminderInfo(job) {
    const r = lastReminder(job);
    const n = (job.reminders || []).length;
    return r ? `Diingatkan ${n}× · terakhir ${fmtDate(r.at, false)}` : 'Belum pernah diingatkan';
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

  /* Pad pattern 3x3 – pelanggan lukis dengan jari. seq: titik 1-9 */
  function patternPad(el, initial, onChange) {
    const xy = (n) => [((n - 1) % 3) * 100 + 50, Math.floor((n - 1) / 3) * 100 + 50];
    el.innerHTML = `<svg viewBox="0 0 300 300">
      <polyline class="pp-line" points=""/>
      <line class="pp-live" x1="0" y1="0" x2="0" y2="0" visibility="hidden"/>
      ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<circle class="pp-dot" data-n="${n}" cx="${xy(n)[0]}" cy="${xy(n)[1]}" r="14"/>`).join('')}
    </svg>`;
    const svg = el.querySelector('svg');
    const lineEl = el.querySelector('.pp-line');
    const live = el.querySelector('.pp-live');
    let seq = initial.slice();
    let drawing = false;

    const toSvg = (e) => {
      const r = svg.getBoundingClientRect();
      return [((e.clientX - r.left) / r.width) * 300, ((e.clientY - r.top) / r.height) * 300];
    };
    const render = () => {
      lineEl.setAttribute('points', seq.map((n) => xy(n).join(',')).join(' '));
      el.querySelectorAll('.pp-dot').forEach((c) => {
        const k = seq.indexOf(Number(c.dataset.n));
        c.classList.toggle('on', k >= 0);
        c.classList.toggle('first', k === 0);
      });
    };
    const add = (n) => {
      if (seq.includes(n)) return;
      const last = seq[seq.length - 1];
      if (last) {
        // Lalu atas titik tengah (cth 1→3 melalui 2) – sama seperti Android
        const [r1, c1, r2, c2] = [Math.floor((last - 1) / 3), (last - 1) % 3, Math.floor((n - 1) / 3), (n - 1) % 3];
        if ((r1 + r2) % 2 === 0 && (c1 + c2) % 2 === 0) {
          const mid = ((r1 + r2) / 2) * 3 + (c1 + c2) / 2 + 1;
          if (!seq.includes(mid)) seq.push(mid);
        }
      }
      seq.push(n);
      if (navigator.vibrate) navigator.vibrate(10);
    };
    const hit = (e) => {
      const [x, y] = toSvg(e);
      for (let n = 1; n <= 9; n++) {
        const [cx, cy] = xy(n);
        if ((x - cx) ** 2 + (y - cy) ** 2 < 34 ** 2) add(n);
      }
      const last = seq[seq.length - 1];
      if (last) {
        const [lx, ly] = xy(last);
        live.setAttribute('x1', lx);
        live.setAttribute('y1', ly);
        live.setAttribute('x2', x);
        live.setAttribute('y2', y);
        live.setAttribute('visibility', 'visible');
      }
      render();
    };
    svg.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      svg.setPointerCapture(e.pointerId);
      seq = [];
      drawing = true;
      hit(e);
    });
    svg.addEventListener('pointermove', (e) => drawing && hit(e));
    const end = () => {
      if (!drawing) return;
      drawing = false;
      live.setAttribute('visibility', 'hidden');
      render();
      onChange(seq.slice());
    };
    svg.addEventListener('pointerup', end);
    svg.addEventListener('pointercancel', end);
    render();
    return {
      get: () => seq.slice(),
      clear: () => {
        seq = [];
        render();
        onChange([]);
      },
    };
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
    if (window.PhotoViewer) PhotoViewer.close();
    if (!ready) return;
    const hash = location.hash.replace(/^#\/?/, '');
    const [path, query] = hash.split('?');
    const parts = path.split('/').filter(Boolean);
    $$('.nav a').forEach((a) => a.classList.toggle('active', a.getAttribute('href') === '#/' + (parts[0] || '')));
    window.scrollTo(0, 0);
    currentView = parts[0] || 'list';
    try {
      if (!parts.length) return await viewList();
      if (parts[0] === 'baru') return await viewForm(undefined, new URLSearchParams(query));
      if (parts[0] === 'claim') return await viewClaimSearch();
      if (parts[0] === 'edit' && parts[1]) return await viewForm(decodeURIComponent(parts[1]));
      if (parts[0] === 'job' && parts[1]) return await viewJob(decodeURIComponent(parts[1]), new URLSearchParams(query));
      if (parts[0] === 'ambil' && parts[1]) return await viewPickup(decodeURIComponent(parts[1]));
      if (parts[0] === 'tetapan') return await viewSettings();
      if (parts[0] === 'laporan') return await viewReport();
      if (parts[0] === 'saya') return await viewMine();
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
      document.body.classList.toggle('is-owner', role === 'owner');
      const who = $('#who');
      if (who) {
        who.innerHTML = `<span>${esc(DB.userName())} · ${esc(u.email || '')}</span><button type="button" class="linkbtn" id="whoOut">Log keluar</button>`;
        $('#whoOut').addEventListener('click', () => DB.signOut());
      }
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
  let listFilter = { q: '', status: 'aktif', pic: '' };

  async function viewList() {
    app.innerHTML = `
      <section class="hero">
        <div>
          <div class="eyebrow">Satu device, satu no. resit.</div>
          <h1>Penerimaan &amp; proses repair</h1>
          <p class="muted">Cari pelanggan melalui no. telefon, no. resit atau kod ambil, dan rekod setiap kerja technician dengan jelas.</p>
        </div>
        <div class="hero-actions">
          <a class="btn primary" href="#/baru">＋ Terima device</a>
          <a class="btn claim-btn" href="#/claim">🛡 Claim waranti</a>
          <a class="btn owner-only" href="#/laporan">Laporan</a>
        </div>
      </section>
      <div class="tiles" id="stats"></div>
      <div id="remind"></div>
      <section class="card list-card">
        <div class="list-head"><div><h2>Senarai kerja</h2><div class="small muted" id="listCount"></div></div></div>
        <div class="toolbar">
          <input type="search" id="q" placeholder="Cari telefon, nama, no. resit, kod atau model…" value="${esc(listFilter.q)}">
          <select id="f" aria-label="Status"></select>
          <select id="fp" aria-label="PIC repair"></select>
        </div>
        <div id="list"><div class="empty">Memuatkan…</div></div>
      </section>`;

    const needFull = () =>
      CLOUD && !DB.isFullLoaded() && (listFilter.q.trim() !== '' || listFilter.status !== 'aktif');

    let listMap = new Map();
    const refresh = async () => {
      const full = needFull();
      if (full) $('#list').innerHTML = '<div class="empty">Memuatkan semua rekod…</div>';
      const jobs = await DB.allJobs({ full });
      if (currentView !== 'list' || !$('#list')) return;
      listMap = new Map(jobs.map((j) => [j.id, j]));
      draw(jobs);
    };
    listRefresh = refresh;

    const draw = (jobs) => {
      const counts = {};
      jobs.forEach((j) => (counts[j.status] = (counts[j.status] || 0) + 1));
      const isActive = (j) => j.status !== 'diambil';
      const active = jobs.filter(isActive).length;
      const today = new Date().toDateString();

      const partial = CLOUD && !DB.isFullLoaded();
      const warrantyN = jobs.filter((j) => j.status === 'diambil' && warrantyActive(j)).length;
      const tiles = [{ key: 'aktif', label: 'Dalam kedai', color: '#18201b', n: active }]
        .concat(STATUS.map((s) => ({ key: s.key, label: s.label, color: s.color, n: partial && !isActive({ status: s.key }) ? null : counts[s.key] || 0 })))
        .concat([
          { key: 'waranti', label: '🛡 Waranti aktif', color: '#15803d', n: partial ? null : warrantyN },
          { key: 'semua', label: 'Semua rekod', color: '#94a3b8', n: partial ? null : jobs.length },
        ]);
      $('#stats').innerHTML = tiles
        .map(
          (t) => `<button type="button" class="tile ${listFilter.status === t.key ? 'active' : ''}" data-status="${t.key}" style="border-left-color:${t.color}">
            <span class="tile-label">${esc(t.label)}</span><span class="tile-n">${t.n == null ? '…' : t.n}</span></button>`
        )
        .join('');
      const todayN = jobs.filter((j) => new Date(j.createdAt).toDateString() === today).length;

      const pics = picList();
      jobs.forEach((j) => j.pic && !pics.includes(j.pic) && pics.push(j.pic));
      $('#fp').innerHTML = [['', 'Semua PIC'], ['__none', 'Tiada PIC']]
        .concat(pics.map((n) => [n, n]))
        .map(([v, l]) => `<option value="${esc(v)}" ${listFilter.pic === v ? 'selected' : ''}>${esc(l)}</option>`)
        .join('');
      const filters = [
        { key: 'aktif', label: `Aktif (${active})` },
        { key: 'semua', label: partial ? 'Semua rekod' : `Semua (${jobs.length})` },
        { key: 'waranti', label: partial ? '🛡 Waranti aktif' : `🛡 Waranti aktif (${warrantyN})` },
      ].concat(STATUS.map((s) => ({ key: s.key, label: s.label + (partial && !isActive({ status: s.key }) ? '' : ` (${counts[s.key] || 0})`) })));
      $('#f').innerHTML = filters
        .map((f) => `<option value="${f.key}" ${listFilter.status === f.key ? 'selected' : ''}>${esc(f.label)}</option>`)
        .join('');

      const q = listFilter.q.trim().toLowerCase();
      const qDigits = q.replace(/\D/g, '');
      const out = jobs.filter((j) => {
        if (listFilter.status === 'aktif' && !isActive(j)) return false;
        if (listFilter.status === 'waranti' && !(j.status === 'diambil' && warrantyActive(j))) return false;
        if (!['aktif', 'semua', 'waranti'].includes(listFilter.status) && j.status !== listFilter.status) return false;
        if (listFilter.pic === '__none' && j.pic) return false;
        if (listFilter.pic && listFilter.pic !== '__none' && j.pic !== listFilter.pic) return false;
        if (!q) return true;
        const hay = [j.id, j.customer.name, j.customer.phone, j.device.brand, j.device.model, j.problem, j.pic, j.status !== 'diambil' ? j.pickupCode : '']
          .join(' ')
          .toLowerCase();
        return hay.includes(q) || (qDigits.length >= 3 && hay.replace(/\D/g, '').includes(qDigits));
      });
      // Kad "Belum diambil"
      const late = jobs
        .filter(needsReminder)
        .map((j) => ({ j, d: daysSince(readySince(j)) }))
        .sort((a, b) => b.d - a.d);
      const abandon = Number(settings.abandonDays || 30);
      $('#remind').innerHTML = late.length
        ? `<details class="card remind-card" ${listFilter.remindOpen === false ? '' : 'open'}>
            <summary><h3>⏰ Belum Diambil (${late.length})</h3><span class="small muted">siap ≥ ${esc(settings.remindDays || 3)} hari</span></summary>
            <ul class="remind-list">${late
              .map(
                ({ j, d }) => `<li class="${d >= abandon ? 'overdue' : ''}">
                <a href="#/job/${encodeURIComponent(j.id)}" class="remind-main">
                  <strong>${esc(j.id)}</strong> · ${esc([j.device.brand, j.device.model].filter(Boolean).join(' '))}
                  <div class="small">${esc(j.customer.name)} · <span class="remind-days">${d} hari${d >= abandon ? ' (lebih ' + abandon + ' hari)' : ''}</span></div>
                  <div class="small muted">${reminderInfo(j)}</div>
                </a>
                <button class="btn small wa" data-remind="${esc(j.id)}">📲 Ingatkan</button>
              </li>`
              )
              .join('')}</ul>
          </details>`
        : '';

      // Susunan: device dalam kedai ikut giliran sampai (#1 paling lama di atas);
      // Telah diambil / Semua / Waranti: terbaru di atas.
      const newestFirst = ['diambil', 'semua', 'waranti'].includes(listFilter.status);
      const asc = (a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0);
      out.sort((a, b) => (newestFirst ? -asc(a, b) : asc(a, b)));
      const queue = {};
      jobs
        .filter(isActive)
        .sort(asc)
        .forEach((j, i) => (queue[j.id] = i + 1));

      const daysTxt = (j) => {
        if (j.status === 'diambil') return `<span class="muted">Diambil ${j.pickup ? fmtDate(j.pickup.at, false) : ''}</span>`;
        const d = daysSince(j.createdAt);
        return `<span class="${d >= 7 ? 'days-old' : ''}">${d === 0 ? 'Hari ini' : d + ' hari'}</span>`;
      };

      $('#listCount').textContent = `${out.length} rekod ditemui · ${todayN} diterima hari ini · ${
        newestFirst ? 'terbaru di atas' : 'ikut giliran sampai (paling lama di atas)'
      }`;
      $('#list').innerHTML = out.length
        ? `<div class="jhead" aria-hidden="true"><div>#</div><div>No. resit</div><div>Device</div><div>Pelanggan</div><div>Status</div><div>${
            newestFirst ? 'Tarikh' : 'Dalam kedai'
          }</div><div>PIC</div></div>` +
          out
            .map(
              (j) => `<a class="job jrow" href="#/job/${encodeURIComponent(j.id)}">
              <div class="c-q">${queue[j.id] ? '#' + queue[j.id] : ''}</div>
              <div class="c-id job-top"><strong>${esc(j.id)}</strong>${j.pickupCode && j.status !== 'diambil' ? ` <span class="kod">🔑 ${esc(j.pickupCode)}</span>` : ''}</div>
              <div class="c-dev"><span class="job-dev">${esc([j.device.brand, j.device.model].filter(Boolean).join(' '))}</span>${
                j.status !== 'diambil' && (j.warrantyOf || ['kedai', 'pengeluar'].includes(j.intakeWarranty))
                  ? ` <span class="kod">🛡 ${j.warrantyOf ? 'Claim waranti' : esc(INTAKE_WARRANTY[j.intakeWarranty])}</span>`
                  : ''
              }${warrantyBadge(j)}<div class="small muted clamp1">${esc(j.problem)}</div></div>
              <div class="c-cust">${esc(j.customer.name)}<div class="small muted">${esc(j.customer.phone)}</div></div>
              <div class="c-st">${badge(j.status)}</div>
              <div class="c-days small">${daysTxt(j)}</div>
              <div class="c-pic small">${j.pic ? `<span class="pic">👤 ${esc(j.pic)}</span>` : '<span class="muted">–</span>'}</div>
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
    $('#fp').addEventListener('change', (e) => {
      listFilter.pic = e.target.value;
      refresh();
    });
    $('#stats').addEventListener('click', (e) => {
      const t = e.target.closest('.tile');
      if (!t) return;
      listFilter.status = t.dataset.status;
      refresh();
    });
    $('#remind').addEventListener('toggle', (e) => (listFilter.remindOpen = e.target.open), true);
    $('#remind').addEventListener('click', async (e) => {
      const b = e.target.closest('button[data-remind]');
      if (!b) return;
      e.preventDefault();
      b.disabled = true;
      try {
        const job = cachedCopy(listMap, b.dataset.remind) || (await DB.getJob(b.dataset.remind));
        await remindCustomer(job);
      } catch (err) {
        alert('Gagal rekod peringatan: ' + errMsg(err));
      }
      refresh();
    });
    await refresh();
  }

  /* ---------------- borang terima / edit ---------------- */
  async function viewForm(editId, params) {
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
          <div class="intake-w">
            <div class="sig-label">🛡 Status waranti device semasa diterima *</div>
            <div class="seg">${Object.entries(INTAKE_WARRANTY)
              .map(([k, l]) => `<label><input type="radio" name="intakeWarranty" value="${k}" ${(j.intakeWarranty || (j.warrantyOf ? 'kedai' : '')) === k ? 'checked' : ''}><span>${esc(l)}</span></label>`)
              .join('')}</div>
          </div>
          <div id="warrantyBanner"></div>
          <div id="custHistory"></div>
        </fieldset>

        <fieldset><legend>Maklumat Device</legend>
          <div class="grid2">
            <label>Jenama *<select name="brandSel">${brandOptions(j.device.brand)}</select>
              <input name="brandOther" placeholder="Taip jenama" value="${esc(BRANDS.includes(j.device.brand) ? '' : j.device.brand || '')}" ${j.device.brand && !BRANDS.includes(j.device.brand) ? '' : 'hidden'} class="w-custom">
            </label>
            <label>Model *<input name="model" required value="${esc(j.device.model)}" placeholder="cth: iPhone 13 Pro"></label>
            <label>Warna<input name="color" value="${esc(j.device.color)}"></label>
          </div>
          <div class="pc-block">
            <div class="sig-label">Kunci skrin device (untuk ujian)</div>
            <div class="seg">
              <label><input type="radio" name="pcType" value="none" ${!j.device.passcode ? 'checked' : ''}><span>Tiada</span></label>
              <label><input type="radio" name="pcType" value="pin" ${j.device.passcode && !R.isPattern(j.device.passcode) ? 'checked' : ''}><span>PIN / Kata laluan</span></label>
              <label><input type="radio" name="pcType" value="pattern" ${R.isPattern(j.device.passcode) ? 'checked' : ''}><span>Pattern</span></label>
            </div>
            <div id="pcPin" hidden><input name="passcode" value="${esc(R.isPattern(j.device.passcode) ? '' : j.device.passcode)}" autocomplete="off" placeholder="cth: 123456"></div>
            <div id="pcPattern" hidden>
              <div class="pattern-pad" id="patternPad"></div>
              <div class="pattern-info"><span id="patternText" class="small"></span><button type="button" class="btn small" id="patternClear">Lukis semula</button></div>
            </div>
            <p class="small muted">Tidak dipapar pada resit pelanggan. Dipadam automatik selepas device diambil.</p>
          </div>
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
            <label>PIC repair (technician)<select name="pic">${picOptions(j.pic || '')}</select></label>
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

    // Kunci skrin: Tiada / PIN / Pattern
    // ---- Jenama: senarai pilihan + Lain-lain ----
    const brandSel = $('#form [name=brandSel]');
    const brandOther = $('#form [name=brandOther]');
    brandSel.addEventListener('change', () => {
      brandOther.hidden = brandSel.value !== '__other';
      if (!brandOther.hidden) brandOther.focus();
    });
    function setBrand(v) {
      if (!v) return;
      if (BRANDS.includes(v)) {
        brandSel.value = v;
        brandOther.hidden = true;
      } else {
        brandSel.value = '__other';
        brandOther.value = v;
        brandOther.hidden = false;
      }
    }

    // ---- Pelanggan lama & claim waranti (borang baru sahaja) ----
    let warrantyOf = j.warrantyOf || '';
    let histJobs = [];
    const fillDevice = (src) => {
      setBrand(src.device.brand);
      ['model', 'color'].forEach((k) => {
        const el = $(`#form [name=${k}]`);
        if (el && src.device[k]) el.value = src.device[k];
      });
    };
    const drawBanner = () => {
      const orig = histJobs.find((x) => x.id === warrantyOf);
      $('#warrantyBanner').innerHTML = warrantyOf
        ? `<div class="warranty-banner">🛡 <div><strong>Claim waranti</strong> untuk resit <strong>${esc(warrantyOf)}</strong>${orig && orig.pic ? ` (dibaiki oleh ${esc(orig.pic)})` : ''}</div>${
            job ? '' : '<button type="button" class="btn small" id="cancelClaim">Batal claim</button>'
          }</div>`
        : '';
      if ($('#cancelClaim'))
        $('#cancelClaim').addEventListener('click', () => {
          warrantyOf = '';
          const pr = $('#form [name=problem]');
          pr.value = pr.value.replace(/^Claim waranti \([^)]*\):\s*/, '');
          drawBanner();
          drawHistory();
        });
    };
    const drawHistory = () => {
      if (job || !$('#custHistory')) return; // borang sudah ditutup (cth selepas simpan)
      if (!histJobs.length) {
        $('#custHistory').innerHTML = '';
        return;
      }
      $('#custHistory').innerHTML = `<div class="cust-hist">
        <div class="cust-hist-head">👤 <strong>Pelanggan lama</strong> · ${histJobs.length} repair sebelum ini</div>
        <ul class="hist-list">${histJobs
          .slice(0, 6)
          .map((x) =>
            historyItem(
              x,
              `<div class="hist-btns"><button type="button" class="btn small" data-use="${esc(x.id)}">Guna device ini</button>${
                warrantyActive(x) && x.id !== warrantyOf ? `<button type="button" class="btn small primary" data-claim="${esc(x.id)}">🛡 Claim waranti</button>` : ''
              }</div>`
            )
          )
          .join('')}</ul></div>`;
    };
    if (job && warrantyOf) drawBanner();
    if (!job) {
      let ht;
      const lookup = async () => {
        try {
          const all = await DB.allJobs({ full: CLOUD });
          histJobs = customerJobs(all, $('#form [name=phone]').value);
        } catch (e) {
          histJobs = [];
        }
        const nameEl = $('#form [name=name]');
        if (!nameEl) return;
        if (histJobs.length && !nameEl.value.trim()) nameEl.value = histJobs[0].customer.name;
        drawHistory();
      };
      $('#form [name=phone]').addEventListener('input', () => {
        clearTimeout(ht);
        ht = setTimeout(lookup, 350);
      });
      $('#custHistory').addEventListener('click', (e) => {
        const use = e.target.closest('[data-use]');
        const claim = e.target.closest('[data-claim]');
        const btn = use || claim;
        if (!btn) return;
        const src = histJobs.find((x) => x.id === (use ? use.dataset.use : claim.dataset.claim));
        if (!src) return;
        if (claim) applyClaim(src);
        else {
          fillDevice(src);
          toast('Maklumat device diisi');
        }
      });
      function applyClaim(src) {
        fillDevice(src);
        warrantyOf = src.id;
        const kedai = $('#form [name=intakeWarranty][value=kedai]');
        if (kedai) kedai.checked = true;
        const pr = $('#form [name=problem]');
        if (!/^Claim waranti/.test(pr.value)) pr.value = `Claim waranti (${src.id}): ` + pr.value;
        $('#form [name=estimate]').value = 0;
        $('#form [name=deposit]').value = 0;
        const picSel = $('#form [name=pic]');
        if (picSel && !picSel.value && src.pic) picSel.value = src.pic;
        drawBanner();
        drawHistory();
        toast('Claim waranti untuk ' + src.id);
      }
      // Dibuka dari butang 'Buat claim waranti' / halaman Claim waranti
      const claimId = params && params.get('claim');
      if (claimId) {
        const src = await DB.getJob(claimId).catch(() => null);
        if (src && warrantyActive(src)) {
          $('#form [name=name]').value = src.customer.name;
          $('#form [name=phone]').value = src.customer.phone;
          if (!histJobs.some((x) => x.id === src.id)) histJobs = [src].concat(histJobs);
          applyClaim(src);
          lookup();
        } else if (src) toast(`Waranti ${claimId} telah tamat – terima sebagai repair biasa`);
      }
    }

    const pPad = patternPad($('#patternPad'), R.patternSeq(j.device.passcode), (seq) => showPatternText(seq));
    function showPatternText(seq) {
      $('#patternText').textContent = seq.length
        ? `Pattern: ${seq.join(' → ')}${seq.length < 4 ? ' (minimum 4 titik)' : ''}`
        : 'Minta pelanggan lukis pattern di atas dengan jari';
    }
    showPatternText(pPad.get());
    $('#patternClear').addEventListener('click', () => pPad.clear());
    const showPc = () => {
      const t = ($('#form [name=pcType]:checked') || {}).value || 'none';
      $('#pcPin').hidden = t !== 'pin';
      $('#pcPattern').hidden = t !== 'pattern';
    };
    $$('#form [name=pcType]').forEach((r) => r.addEventListener('change', showPc));
    showPc();

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
      const brandVal = fd.get('brandSel') === '__other' ? (fd.get('brandOther') || '').trim() : fd.get('brandSel') || '';
      if (!brandVal) errors.push('Jenama');
      if (!fd.get('model').trim()) errors.push('Model');
      if (!fd.get('problem').trim()) errors.push('Masalah dilaporkan');
      const pcType = fd.get('pcType') || 'none';
      const patSeq = pPad.get();
      if (pcType === 'pattern' && patSeq.length < 4) errors.push('Pattern (minimum 4 titik)');
      if (!job && !fd.get('intakeWarranty')) errors.push('Status waranti device');
      if (pcType === 'pin' && !fd.get('passcode').trim()) errors.push('PIN / kata laluan');
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
          brand: brandVal,
          model: fd.get('model').trim(),
          color: fd.get('color').trim(),
          imei: (job && job.device && job.device.imei) || '',
          passcode: pcType === 'pin' ? fd.get('passcode').trim() : pcType === 'pattern' ? 'P:' + patSeq.join('-') : '',
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
        pic: fd.get('pic') || '',
        intakeWarranty: fd.get('intakeWarranty') || (job && job.intakeWarranty) || '',
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
        data.pickupCode = await newPickupCode();
        if (warrantyOf) data.warrantyOf = warrantyOf;
        data.intakeWarranty = fd.get('intakeWarranty') || '';
        addLog(
          data,
          'cipta',
          (photos.length ? [{ f: 'Gambar', from: '', to: String(photos.length) }] : []).concat(warrantyOf ? [{ f: 'Claim waranti', from: '', to: warrantyOf }] : [])
        );
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
    const needCode = !job.pickupCode && !closed;
    if ((CLOUD && !job.receiptToken) || needCode) {
      // Rekod lama: jana link resit pendek / kod ambil sekali sahaja
      const backup = { receiptToken: job.receiptToken, pickupCode: job.pickupCode, log: job.log };
      try {
        if (needCode) job.pickupCode = await newPickupCode();
        addLog(job, 'resit', needCode ? [{ f: 'Kod ambil', from: '', to: '(dijana)' }] : []);
        await saveJob(job);
      } catch (err) {
        // Gagal simpan (cth: tiada kebenaran/offline) – papar job seperti biasa tanpa link pendek/kod baru
        console.warn('Gagal jana link/kod untuk rekod lama', err);
        Object.assign(job, backup);
        if (!backup.receiptToken) delete job.receiptToken;
        if (!backup.pickupCode) delete job.pickupCode;
      }
    }
    const link = customerLink(job, settings);

    app.innerHTML = `
      ${
        params && params.get('serah')
          ? `<div class="notice">✔ Serahan direkodkan.${
              settings.reviewLink ? ` Minta pelanggan beri review Google sekarang? <button class="btn small primary review-btn" data-review="${esc(job.id)}">⭐ Minta review</button>` : ''
            }</div>`
          : ''
      }
      ${
        params && params.get('baru')
          ? `<div class="notice">✅ Device telah direkodkan.${
              job.pickupCode
                ? `<div class="notice-code">✍️ Tulis <strong>${esc(job.pickupCode)}</strong> pada sticker / kertas dan lekat pada device.</div>`
                : ''
            }Kemudian hantar resit digital kepada pelanggan melalui WhatsApp.</div>`
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
              <label class="small">👤 PIC repair<select name="pic">${picOptions(job.pic || '')}</select></label>
              <label class="check"><input type="checkbox" name="notify" checked><span>Maklumkan pelanggan via WhatsApp</span></label>
              <button class="btn primary" type="submit">Kemaskini</button>
            </form>
          </div>
          ${
            ['siap', 'batal'].includes(job.status)
              ? `<div class="card ${needsReminder(job) ? 'remind-card' : ''}">
            <h3>Ingatkan Pelanggan Ambil</h3>
            <p class="small">${job.status === 'batal' ? 'Sedia diambil' : 'Siap'} sejak ${fmtDate(readySince(job), false)} (<strong>${daysSince(readySince(job))} hari</strong>)</p>
            <p class="small muted">${reminderInfo(job)}</p>
            <button class="btn wa block" id="btnRemind">📲 Hantar Peringatan</button>
          </div>`
              : ''
          }
          <div class="card">
            <h3>Pelanggan Ambil Device</h3>
            <a class="btn primary block" href="#/ambil/${encodeURIComponent(job.id)}">✔ Rekod Serahan Semula</a>
          </div>`
          }

          ${
            job.status === 'diambil' && job.pickup
              ? `<div class="card"><h3>🛡 Waranti</h3>
            <p class="small">${esc(warrantyText(job.pickup.warrantyDays, job.pickup.warrantyLabel))}${
                  warrantyUntil(job) ? ` · sehingga ${fmtDate(warrantyUntil(job).toISOString(), false)} ${warrantyActive(job) ? '<span class="w-ok">(aktif)</span>' : '<span class="muted">(tamat)</span>'}` : ''
                }</p>
            ${warrantyActive(job) ? `<a class="btn small primary block" href="#/baru?claim=${encodeURIComponent(job.id)}">🛡 Buat claim waranti</a>` : ''}
            <details><summary class="small">Ubah tempoh waranti</summary>
              <form id="wForm" class="w-form">${warrantyField('w', job.pickup.warrantyDays || 0)}<button class="btn small primary" type="submit">Simpan</button></form>
            </details></div>`
              : ''
          }
          ${reviewCard(job)}
          <div id="histBox"></div>
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

    // Ubah tempoh waranti selepas serahan
    if ($('#wForm')) {
      bindWarrantyField($('#wForm'), 'w');
      $('#wForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const war = readWarranty(new FormData(e.target), 'w');
        if (!war) return toast('Isi bilangan hari');
        const before = warrantyText(job.pickup.warrantyDays, job.pickup.warrantyLabel);
        const after = warrantyText(war.days, war.label);
        if (before === after) return toast('Tiada perubahan');
        job.pickup = Object.assign({}, job.pickup, { warrantyDays: war.days || '', warrantyLabel: war.label });
        delete job.pickup.warrantyEnd;
        job.updatedAt = new Date().toISOString();
        addLog(job, 'edit', [{ f: 'Waranti', from: before, to: after }]);
        try {
          savedToast(await saveJob(job), 'Waranti dikemaskini');
        } catch (err) {
          return alert('Gagal simpan: ' + errMsg(err));
        }
        route();
      });
    }

    // Minta review Google
    $$('.review-btn').forEach((b) =>
      b.addEventListener('click', async () => {
        b.disabled = true;
        try {
          await askReview(job);
        } catch (err) {
          alert('Gagal rekod: ' + errMsg(err));
        }
        location.hash = '#/job/' + encodeURIComponent(job.id);
        route();
      })
    );

    // Sejarah pelanggan & claim waranti (dimuat selepas halaman dipapar)
    DB.allJobs({ full: CLOUD })
      .then((all) => {
        if (currentView !== 'job' || !$('#histBox')) return;
        const others = customerJobs(all, job.customer.phone, job.id);
        const claims = all.filter((x) => x.warrantyOf === job.id);
        const orig = job.warrantyOf ? all.find((x) => x.id === job.warrantyOf) : null;
        if (!others.length && !claims.length && !job.warrantyOf) return;
        $('#histBox').innerHTML = `<div class="card">
          ${job.warrantyOf ? `<div class="warranty-banner">🛡 <div>Claim waranti untuk <a href="#/job/${encodeURIComponent(job.warrantyOf)}"><strong>${esc(job.warrantyOf)}</strong></a>${orig && orig.pic ? ` · dibaiki oleh ${esc(orig.pic)}` : ''}</div></div>` : ''}
          ${claims.length ? `<p class="small"><strong>🛡 Claim waranti dibuat:</strong> ${claims.map((c) => `<a href="#/job/${encodeURIComponent(c.id)}">${esc(c.id)}</a>`).join(', ')}</p>` : ''}
          ${others.length ? `<h3>Sejarah pelanggan (${others.length})</h3><ul class="hist-list">${others.slice(0, 8).map((x) => historyItem(x)).join('')}</ul>` : ''}
        </div>`;
      })
      .catch(() => {});

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

    if ($('#btnRemind')) {
      $('#btnRemind').addEventListener('click', async (e) => {
        e.target.disabled = true;
        try {
          await remindCustomer(job);
        } catch (err) {
          alert('Gagal rekod peringatan: ' + errMsg(err));
        }
        route();
      });
    }

    const sendWa = (text) => {
      window.open(`https://wa.me/${waPhone(job.customer.phone)}?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
    };
    const dev = [job.device.brand, job.device.model].filter(Boolean).join(' ');

    $('#btnWa').addEventListener('click', () => {
      // Ikut status: job Siap -> mesej Siap; selain itu -> resit penerimaan
      if (job.status === 'siap') return sendWa(statusWaMsg(job, 'siap', ''));
      sendWa(
        `${greet(job.customer.name)}\n\nTerima kasih kerana memilih ${settings.name}. Device anda telah kami terima.\n\n` +
          `No. Resit: *${job.id}*\nDevice: ${dev}\nMasalah: ${job.problem}\n` +
          (job.estimate !== '' && job.estimate != null ? `Anggaran: ${money(job.estimate)}\n` : '') +
          (job.deposit ? `Deposit: ${money(job.deposit)}\n` : '') +
          `Status: ${R.statusInfo(job.status).label}\n\n` +
          codeLine(job) +
          `\nResit digital & status pembaikan:\n${link}\n\nSila simpan mesej ini sebagai bukti penghantaran device.`
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
        const pic = fd.get('pic') || '';
        const picChanged = pic !== (job.pic || '');
        if (status === job.status && !note && !picChanged) {
          toast('Tiada perubahan');
          return;
        }
        const now = new Date().toISOString();
        const changes = [];
        if (status !== job.status) changes.push({ f: 'Status', from: R.statusInfo(job.status).label, to: R.statusInfo(status).label });
        if (note) changes.push({ f: 'Nota', from: '', to: note });
        if (picChanged) {
          changes.push({ f: 'PIC repair', from: job.pic || '', to: pic || '(tiada)' });
          job.pic = pic;
        }
        const statusOrNote = status !== job.status || !!note;
        addLog(job, statusOrNote ? 'status' : 'edit', changes);
        job.status = status;
        job.updatedAt = now;
        // Tukar lokasi sahaja: tidak masuk timeline pelanggan & tiada WhatsApp
        if (statusOrNote) job.history = (job.history || []).concat([{ status, at: now, note, by: me() }]);
        // Buka WhatsApp SEBELUM simpan: browser (terutama iPhone) menyekat tetingkap
        // yang dibuka selepas proses async, jadi mesej tidak keluar langsung.
        if (statusOrNote && fd.get('notify')) {
          sendWa(statusWaMsg(job, status, note));
        }
        let result;
        try {
          result = await saveJob(job);
        } catch (err) {
          alert('Gagal simpan: ' + errMsg(err));
          return;
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
    // Claim waranti: sambung waranti asal secara automatik (staff tak perlu kira baki)
    let cont = null;
    let contInfo = '';
    if (job.warrantyOf) {
      const orig = await DB.getJob(job.warrantyOf).catch(() => null);
      const end = orig && warrantyUntil(orig);
      if (end && end.getTime() > Date.now()) {
        const left = Math.ceil((end.getTime() - Date.now()) / 864e5);
        cont = { end: end.toISOString(), days: left, label: 'Sambung waranti asal' };
        contInfo = `<span class="small w-ok cont-info">🛡 Sehingga <strong>${fmtDate(end.toISOString(), false)}</strong> (baki ${left} hari) – sama dengan waranti asal ${esc(orig.id)}. Tak perlu ubah.</span>`;
      } else if (orig) {
        contInfo = `<span class="small muted cont-info">Waranti asal ${esc(orig.id)} telah tamat${end ? ' ' + fmtDate(end.toISOString(), false) : ''}.</span>`;
      }
    }
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
          <label>🛡 Waranti${warrantyField('warranty', job.warrantyOf ? 0 : settings.warrantyDays === '' ? 0 : settings.warrantyDays, cont)}${contInfo}</label>
          <label>Diambil oleh<input name="by" value="${esc(job.customer.name)}"></label>
        </div>
        <label>Nota (kerja yang dibuat, part ditukar, dll)<textarea name="note" rows="2"></textarea></label>
        ${
          job.pickupCode
            ? `<div class="code-check">
          <label>🔑 Kod Ambil — minta pelanggan sebut / tunjuk kod pada resit
            <input name="code" class="code-input" inputmode="numeric" maxlength="4" autocomplete="off" placeholder="••••">
          </label>
          <div id="codeStatus" class="code-status" aria-live="polite"></div>
          <label class="check"><input type="checkbox" name="noCode"><span>Pelanggan tiada / lupa kod</span></label>
          <label id="altWrap" hidden>Cara pengesahan lain *<input name="altVerify" placeholder="cth: Semak IC – nama & no. telefon sepadan"></label>
        </div>`
            : ''
        }
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

    const codeInput = $('#pkForm [name=code]');
    if (codeInput) {
      const showCode = () => {
        codeInput.value = codeInput.value.replace(/\D/g, '').slice(0, 4);
        const st = $('#codeStatus');
        if (codeInput.value.length < 4) {
          st.className = 'code-status';
          st.textContent = '';
        } else if (codeInput.value === job.pickupCode) {
          $('#formError').hidden = true;
          st.className = 'code-status good';
          st.textContent = '✔ Kod betul — serahkan device ini';
        } else {
          st.className = 'code-status bad';
          st.textContent = '✖ Kod salah — semak semula resit pelanggan';
        }
      };
      codeInput.addEventListener('input', showCode);
      $('#pkForm [name=noCode]').addEventListener('change', (e) => {
        $('#altWrap').hidden = !e.target.checked;
        codeInput.disabled = e.target.checked;
      });
    }

    bindWarrantyField($('#pkForm'), 'warranty');

    $('#pkForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const errors = [];
      const war = readWarranty(fd, 'warranty', cont);
      if (!war) errors.push('Bilangan hari waranti');
      let verified = '';
      if (job.pickupCode) {
        if (fd.get('noCode')) {
          const alt = (fd.get('altVerify') || '').trim();
          if (!alt) errors.push('Cara pengesahan lain (pelanggan tiada kod)');
          verified = 'Tanpa kod – ' + alt;
        } else if ((fd.get('code') || '') !== job.pickupCode) {
          errors.push('Kod Ambil yang betul');
        } else verified = 'Kod ambil betul';
      }
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
        warrantyDays: war ? war.days || '' : '',
        warrantyLabel: war ? war.label : '',
        warrantyEnd: war && war.end ? war.end : null,
        by: fd.get('by').trim(),
        note: fd.get('note').trim(),
        signOut: pad.toDataURL(),
        staff: me(),
        verified,
      };
      const changes = [
        { f: 'Harga akhir', from: '', to: fmtVal(job.pickup.finalPrice, 'money') },
        { f: 'Dibayar', from: '', to: fmtVal(job.pickup.paid, 'money') + ' (' + job.pickup.method + ')' },
      ];
      changes.push({
        f: 'Waranti',
        from: '',
        to: job.pickup.warrantyEnd
          ? `Sambung waranti asal (sehingga ${fmtDate(job.pickup.warrantyEnd, false)})`
          : warrantyText(job.pickup.warrantyDays, job.pickup.warrantyLabel),
      });
      if (verified) changes.push({ f: 'Pengesahan', from: '', to: verified });
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
      location.hash = '#/job/' + encodeURIComponent(job.id) + '?serah=1';
    });
  }

  /* ---------------- claim waranti: cari job lama ---------------- */
  let claimQ = '';

  async function viewClaimSearch() {
    app.innerHTML = `
      <section class="hero hero-sm">
        <div>
          <div class="eyebrow">Waranti</div>
          <h1>🛡 Claim waranti</h1>
          <p class="muted">Cari customer guna no. telefon, nama atau no. resit lama, kemudian tekan <strong>Claim</strong>.</p>
        </div>
      </section>
      <section class="card">
        <input type="search" id="cq" placeholder="No. telefon, nama atau no. resit lama…" value="${esc(claimQ)}" autocomplete="off">
        <div id="cres"><div class="empty">Memuatkan…</div></div>
      </section>`;
    const all = await DB.allJobs({ full: CLOUD });
    if (currentView !== 'claim' || !$('#cres')) return;
    const done = all.filter((j) => j.status === 'diambil' && j.pickup);
    const draw = () => {
      const q = claimQ.trim().toLowerCase();
      const qd = q.replace(/\D/g, '');
      let list;
      if (!q) {
        list = done.filter(warrantyActive).sort((a, b) => (a.pickup.at < b.pickup.at ? 1 : -1));
      } else {
        list = done
          .filter((j) => {
            const hay = [j.id, j.customer.name, j.customer.phone, j.device.brand, j.device.model].join(' ').toLowerCase();
            return hay.includes(q) || (qd.length >= 3 && (normPhone(j.customer.phone).includes(qd) || hay.replace(/\D/g, '').includes(qd)));
          })
          .sort((a, b) => (warrantyActive(b) - warrantyActive(a)) || (a.pickup.at < b.pickup.at ? 1 : -1));
      }
      $('#cres').innerHTML = `<p class="small muted">${q ? `${list.length} rekod ditemui` : `Semua device yang masih dalam waranti (${list.length})`}</p>` +
        (list.length
          ? `<ul class="hist-list claim-list">${list
              .slice(0, 50)
              .map((j) =>
                historyItem(
                  j,
                  `<div class="hist-btns">${
                    warrantyActive(j)
                      ? `<a class="btn small primary" href="#/baru?claim=${encodeURIComponent(j.id)}">🛡 Claim waranti</a>`
                      : '<span class="small muted">Waranti tamat – terima sebagai repair biasa</span> <a class="btn small" href="#/baru">＋ Terima</a>'
                  }</div>`
                )
              )
              .join('')}</ul>`
          : `<div class="empty">${q ? 'Tiada rekod. Semak ejaan, atau cari guna no. telefon.' : 'Tiada device dalam tempoh waranti.'}</div>`);
    };
    let t;
    $('#cq').addEventListener('input', (e) => {
      claimQ = e.target.value;
      clearTimeout(t);
      t = setTimeout(draw, 200);
    });
    draw();
    $('#cq').focus();
  }

  /* ---------------- kerja saya (technician) ---------------- */
  const QUICK = {
    diterima: [['diperiksa', '🔍 Mula periksa'], ['dibaiki', '🔧 Mula repair'], ['menunggu_part', '⏳ Tunggu part'], ['siap', '✅ Siap']],
    diperiksa: [['dibaiki', '🔧 Mula repair'], ['menunggu_part', '⏳ Tunggu part'], ['siap', '✅ Siap']],
    dibaiki: [['menunggu_part', '⏳ Tunggu part'], ['siap', '✅ Siap']],
    menunggu_part: [['dibaiki', '🔧 Part sampai – repair'], ['siap', '✅ Siap']],
  };

  async function viewMine() {
    const pics = picList();
    let mine = localStorageGet('myPic');
    if (!mine) mine = pics.find((n) => n.toLowerCase() === String(me()).toLowerCase()) || '';

    app.innerHTML = `
      <section class="hero hero-sm">
        <div>
          <div class="eyebrow">Technician</div>
          <h1>Kerja saya</h1>
        </div>
        <label class="mine-pick">Saya ialah
          <select id="myPic"><option value="">— Pilih nama —</option>${pics
            .map((n) => `<option ${n === mine ? 'selected' : ''}>${esc(n)}</option>`)
            .join('')}</select>
        </label>
      </section>
      <div id="mineBody"><div class="empty">Memuatkan…</div></div>`;

    $('#myPic').addEventListener('change', (e) => {
      localStorageSet('myPic', e.target.value);
      viewMine();
    });

    let byId = {};
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const card = (j, actions) => {
      const days = daysSince(j.createdAt);
      const late = j.eta && new Date(j.eta + 'T23:59:59') < new Date() && ['diterima', 'diperiksa', 'dibaiki', 'menunggu_part'].includes(j.status);
      const lateDays = late ? Math.max(1, Math.floor((today - new Date(j.eta + 'T00:00:00')) / 864e5)) : 0;
      return `<div class="mjob ${late ? 'late' : ''}">
        <div class="job-top"><a href="#/job/${encodeURIComponent(j.id)}"><strong>${esc(j.id)}</strong></a>${badge(j.status)}</div>
        <div class="job-dev">${esc([j.device.brand, j.device.model].filter(Boolean).join(' '))}${j.warrantyOf ? ' <span class="kod">🛡 Waranti</span>' : ''}</div>
        <div class="small">${esc(j.problem)}</div>
        <div class="small muted">${days} hari dalam kedai${j.eta ? ` · Anggaran siap ${fmtDate(j.eta, false)}` : ''}${late ? ` · <strong class="late-txt">Lewat ${lateDays} hari</strong>` : ''}</div>
        <div class="mjob-acts">${actions}</div>
      </div>`;
    };

    const draw = (jobs) => {
      byId = {};
      jobs.forEach((j) => (byId[j.id] = j));
      if (!mine) {
        $('#mineBody').innerHTML = '<div class="card empty">Pilih nama anda di atas untuk melihat kerja anda.</div>';
        return;
      }
      const active = jobs.filter((j) => j.status !== 'diambil');
      const sortQ = (a, b) => {
        const ea = a.eta || '9999';
        const eb = b.eta || '9999';
        return ea === eb ? (a.createdAt < b.createdAt ? -1 : 1) : ea < eb ? -1 : 1;
      };
      const my = active.filter((j) => j.pic === mine);
      let progress = '';
      if (settings.showTargetToTech !== false && Number(settings.commissionTarget) > 0) {
        const now = new Date();
        const ms = new Date(now.getFullYear(), now.getMonth(), 1);
        const me2 = (picMonthlySales(jobs, ms, new Date(now.getFullYear(), now.getMonth() + 1, 1))[mine] || {})[monthKey(now)] || 0;
        const target = Number(settings.commissionTarget);
        const pct = Math.min(100, Math.round((me2 / target) * 100));
        const com = commissionFor(me2);
        progress = `<section class="card target-card">
          <div class="target-head"><strong>🎯 Sasaran bulan ini</strong><span>${money(me2)} / ${money(target)}</span></div>
          <div class="target-bar"><span style="width:${pct}%"></span></div>
          <div class="small muted">${me2 >= target ? `✅ Sasaran dicapai · anggaran komisen <strong>${money(com)}</strong>` : `${pct}% · lagi ${money(target - me2)} untuk layak komisen`}</div>
        </section>`;
      }
      const todo = my.filter((j) => ['diterima', 'diperiksa', 'dibaiki'].includes(j.status)).sort(sortQ);
      const part = my.filter((j) => j.status === 'menunggu_part').sort(sortQ);
      const done = my.filter((j) => ['siap', 'batal'].includes(j.status));
      const free = active.filter((j) => !j.pic && ['diterima', 'diperiksa', 'dibaiki', 'menunggu_part'].includes(j.status)).sort(sortQ);
      const acts = (j) =>
        (QUICK[j.status] || []).map(([s, l]) => `<button class="btn small ${s === 'siap' ? 'primary' : ''}" data-act="${s}" data-id="${esc(j.id)}">${l}</button>`).join('');
      const section = (title, list, actFn, empty) =>
        `<section class="card mine-sec"><h2>${title} <span class="muted">(${list.length})</span></h2>${
          list.length ? `<div class="mjobs">${list.map((j) => card(j, actFn(j))).join('')}</div>` : `<p class="muted small">${empty}</p>`
        }</section>`;
      $('#mineBody').innerHTML =
        progress +
        `<div class="tiles mine-tiles">
          <div class="tile" style="border-left-color:#0891b2"><span class="tile-label">Perlu dibuat</span><span class="tile-n">${todo.length}</span></div>
          <div class="tile" style="border-left-color:#d97706"><span class="tile-label">Tunggu part</span><span class="tile-n">${part.length}</span></div>
          <div class="tile" style="border-left-color:#16a34a"><span class="tile-label">Siap, tunggu pelanggan</span><span class="tile-n">${done.length}</span></div>
        </div>` +
        section('🔧 Perlu dibuat', todo, acts, 'Tiada kerja tertunggak. 👍') +
        section('⏳ Menunggu part', part, acts, 'Tiada.') +
        section('📥 Belum ada PIC', free, (j) => `<button class="btn small primary" data-take="${esc(j.id)}">Ambil kerja ini</button>`, 'Semua job sudah ada PIC.') +
        (done.length
          ? `<details class="card mine-sec"><summary><h2>✅ Siap, tunggu pelanggan <span class="muted">(${done.length})</span></h2></summary><div class="mjobs">${done
              .map((j) => card(j, `<a class="btn small" href="#/job/${encodeURIComponent(j.id)}">Buka</a>`))
              .join('')}</div></details>`
          : '');
    };

    let mineMap = new Map();
    const refresh = async () => {
      const jobs = await DB.allJobs();
      if (currentView !== 'saya' || !$('#mineBody')) return;
      mineMap = new Map(jobs.map((j) => [j.id, j]));
      draw(jobs);
    };
    listRefresh = refresh;

    $('#mineBody').addEventListener('click', async (e) => {
      const act = e.target.closest('[data-act]');
      const take = e.target.closest('[data-take]');
      if (!act && !take) return;
      if (take) {
        const j2 = await DB.getJob(take.dataset.take);
        addLog(j2, 'edit', [{ f: 'PIC repair', from: j2.pic || '', to: mine }]);
        j2.pic = mine;
        j2.updatedAt = new Date().toISOString();
        try {
          savedToast(await saveJob(j2), `${j2.id} diambil oleh ${mine}`);
        } catch (err) {
          alert('Gagal simpan: ' + errMsg(err));
        }
        return refresh();
      }
      const status = act.dataset.act;
      const j = cachedCopy(mineMap, act.dataset.id) || (await DB.getJob(act.dataset.id));
      if (!j) return;
      // Siap: maklumkan pelanggan terus (WhatsApp dibuka dahulu supaya tidak disekat browser)
      if (status === 'siap') {
        window.open(`https://wa.me/${waPhone(j.customer.phone)}?text=${encodeURIComponent(statusWaMsg(j, 'siap', ''))}`, '_blank', 'noopener');
      }
      act.disabled = true;
      try {
        savedToast(await applyStatus(j, status, ''), `${j.id}: ${R.statusInfo(status).label}`);
      } catch (err) {
        alert('Gagal simpan: ' + errMsg(err));
      }
      refresh();
    });

    await refresh();
  }

  /* ---------------- laporan jualan ---------------- */
  let reportState = { period: 'bulan', from: '', to: '' };

  function periodRange(key, from, to) {
    const now = new Date();
    const sod = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const today = sod(now);
    switch (key) {
      case 'hari':
        return [today, new Date(today.getTime() + DAY), 'Hari ini'];
      case 'minggu': {
        const s = new Date(today.getTime() - ((today.getDay() + 6) % 7) * DAY); // mula Isnin
        return [s, new Date(s.getTime() + 7 * DAY), 'Minggu ini'];
      }
      case 'bulan_lepas':
        return [new Date(now.getFullYear(), now.getMonth() - 1, 1), new Date(now.getFullYear(), now.getMonth(), 1), 'Bulan lepas'];
      case 'tahun':
        return [new Date(now.getFullYear(), 0, 1), new Date(now.getFullYear() + 1, 0, 1), 'Tahun ini'];
      case 'pilih': {
        const f = from ? new Date(from + 'T00:00:00') : today;
        const t = to ? new Date(to + 'T00:00:00') : today;
        return [f, new Date(t.getTime() + DAY), 'Tempoh dipilih'];
      }
      default:
        return [new Date(now.getFullYear(), now.getMonth(), 1), new Date(now.getFullYear(), now.getMonth() + 1, 1), 'Bulan ini'];
    }
  }

  function computeReport(jobs, start, end) {
    const inR = (iso) => {
      if (!iso) return false;
      const t = new Date(iso).getTime();
      return t >= start.getTime() && t < end.getTime();
    };
    const n = (v) => (v === '' || v == null || isNaN(Number(v)) ? 0 : Number(v));
    const r = {
      received: 0, collected: 0, cancelled: 0, sales: 0, cash: 0, deposits: 0, paidAtPickup: 0,
      repairDays: [], methods: {}, brands: {}, staff: {}, pics: {}, daily: {}, rows: [],
    };
    const monthly = (end - start) / DAY > 62;
    const bucketKey = (iso) => {
      const d = new Date(iso);
      return monthly ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };
    const addCash = (iso, amt) => {
      if (!amt) return;
      const k = bucketKey(iso);
      r.daily[k] = (r.daily[k] || 0) + amt;
    };
    const staffRow = (name) => (r.staff[name] = r.staff[name] || { received: 0, pickups: 0 });
    const picRow = (name) => (r.pics[name] = r.pics[name] || { received: 0, done: 0, sales: 0, claims: 0 });
    const byId = new Map(jobs.map((x) => [x.id, x]));
    r.claims = 0;
    r.reviews = 0;

    jobs.forEach((j) => {
      let touched = false;
      if (inR(j.createdAt)) {
        touched = true;
        r.received++;
        const dep = n(j.deposit);
        r.deposits += dep;
        addCash(j.createdAt, dep);
        if (dep) r.methods['Deposit'] = (r.methods['Deposit'] || 0) + dep;
        const b = (j.device.brand || 'Lain-lain').trim();
        r.brands[b] = (r.brands[b] || 0) + 1;
        staffRow(j.staff || '(tiada nama)').received++;
        picRow(j.pic || '(tiada PIC)').received++;
        if (j.warrantyOf) {
          r.claims++;
          const orig = byId.get(j.warrantyOf);
          picRow((orig && orig.pic) || '(tiada PIC)').claims++;
        }
      }
      if (j.pickup && inR(j.pickup.at)) {
        touched = true;
        r.collected++;
        r.sales += n(j.pickup.finalPrice);
        const paid = n(j.pickup.paid);
        r.paidAtPickup += paid;
        addCash(j.pickup.at, paid);
        if (paid) r.methods[j.pickup.method || 'Lain-lain'] = (r.methods[j.pickup.method || 'Lain-lain'] || 0) + paid;
        r.repairDays.push((new Date(j.pickup.at) - new Date(j.createdAt)) / DAY);
        staffRow(j.pickup.staff || j.staff || '(tiada nama)').pickups++;
        const pr = picRow(j.pic || '(tiada PIC)');
        pr.done++;
        pr.sales += n(j.pickup.finalPrice);
      }
      if (j.reviewAsked && inR(j.reviewAsked.at)) r.reviews++;
      if ((j.history || []).some((h) => h.status === 'batal' && inR(h.at))) {
        touched = true;
        r.cancelled++;
      }
      if (touched) r.rows.push(j);
    });
    r.cash = r.deposits + r.paidAtPickup;
    r.avgDays = r.repairDays.length ? r.repairDays.reduce((a, b) => a + b, 0) / r.repairDays.length : null;

    // Siri masa lengkap (termasuk hari tanpa kutipan)
    r.series = [];
    if (monthly) {
      for (let d = new Date(start.getFullYear(), start.getMonth(), 1); d < end; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
        r.series.push({ key: bucketKey(d), label: d.toLocaleString('ms-MY', { month: 'short' }), full: d.toLocaleString('ms-MY', { month: 'long', year: 'numeric' }), value: r.daily[bucketKey(d)] || 0 });
      }
    } else {
      for (let d = new Date(start); d < end; d = new Date(d.getTime() + DAY)) {
        r.series.push({ key: bucketKey(d), label: String(d.getDate()), full: fmtDate(d.toISOString(), false), value: r.daily[bucketKey(d)] || 0 });
      }
    }

    // Baki belum dikutip: semua device masih dalam kedai (bukan ikut tempoh)
    r.outstanding = 0;
    r.inShop = 0;
    jobs.forEach((j) => {
      if (j.status === 'diambil') return;
      r.inShop++;
      if (j.estimate !== '' && j.estimate != null) r.outstanding += Math.max(0, n(j.estimate) - n(j.deposit));
    });
    return r;
  }

  function rankedBars(obj, fmt, limit = 8) {
    const rows = Object.entries(obj).sort((a, b) => b[1] - a[1]);
    if (!rows.length) return '<p class="muted small">Tiada data dalam tempoh ini.</p>';
    let shown = rows.slice(0, limit);
    if (rows.length > limit) shown.push(['Lain-lain', rows.slice(limit).reduce((a, r) => a + r[1], 0)]);
    const max = Math.max(...shown.map((r) => r[1])) || 1;
    return `<ul class="hbars">${shown
      .map(
        ([k, v]) => `<li><span class="hb-name">${esc(k)}</span><span class="hb-track"><span class="hb-bar" style="width:${Math.max(2, (v / max) * 100)}%"></span></span><span class="hb-val">${fmt(v)}</span></li>`
      )
      .join('')}</ul>`;
  }

  function columnChart(series) {
    const max = Math.max(0, ...series.map((s) => s.value));
    if (!max) return '<p class="muted small">Tiada kutipan dalam tempoh ini.</p>';
    const every = series.length > 16 ? Math.ceil(series.length / 8) : 1;
    return `<div class="colchart" role="img" aria-label="Carta kutipan; lihat jadual di bawah untuk nilai">
      <div class="cc-max small muted">${money(max)}</div>
      <div class="cc-plot">${series
        .map(
          (s, i) => `<button type="button" class="cc-col" data-tip="${esc(s.full)}: ${money(s.value)}" aria-label="${esc(s.full)}: ${money(s.value)}">
            <span class="cc-bar" style="height:${s.value ? Math.max(2, (s.value / max) * 100) : 0}%"></span>
            <span class="cc-x">${i % every === 0 ? esc(s.label) : ''}</span>
          </button>`
        )
        .join('')}</div>
      <div class="cc-tip" hidden></div>
    </div>`;
  }

  function commissionCard(jobs, start, end) {
    const bySales = picMonthlySales(jobs, start, end);
    const months = new Set();
    Object.values(bySales).forEach((m) => Object.keys(m).forEach((k) => months.add(k)));
    const fullMonths = start.getDate() === 1 && end.getDate() === 1 && start.getHours() === 0 && end.getHours() === 0;
    if (!fullMonths)
      return `<div class="card"><h3>💰 Komisen technician</h3><p class="small muted">Komisen dikira ikut bulan. Pilih tempoh <strong>Bulan ini</strong>, <strong>Bulan lepas</strong> atau <strong>Tahun ini</strong> untuk melihat kiraan komisen.</p></div>`;
    const single = monthKey(start) === monthKey(new Date(end.getTime() - 1));
    const pics = Array.from(new Set(picList().concat(Object.keys(bySales))));
    const target = Number(settings.commissionTarget || 0);
    const rows = pics
      .map((pic) => {
        const m = bySales[pic] || {};
        const sales = Object.values(m).reduce((a, b) => a + b, 0);
        const com = Object.values(m).reduce((a, v) => a + commissionFor(v), 0);
        const hit = Object.values(m).filter((v) => v >= target).length;
        return { pic, sales, com, hit, months: Object.keys(m).length };
      })
      .sort((a, b) => b.sales - a.sales);
    const total = rows.reduce((a, r) => a + r.com, 0);
    return `<div class="card">
      <h3>💰 Komisen technician</h3>
      <p class="small muted">${esc(commissionRule())}. Jualan = harga akhir job yang diambil, ikut PIC.${
        single ? '' : ' Tempoh ini merangkumi lebih dari satu bulan — sasaran dikira bagi setiap bulan.'
      }</p>
      <table class="tbl"><thead><tr><th>PIC</th><th class="num">Jualan</th>${
        single ? '<th>Sasaran</th>' : '<th class="num">Bulan capai sasaran</th>'
      }<th class="num">Komisen</th></tr></thead><tbody>${rows
        .map((r) => {
          const pct = target ? Math.min(100, Math.round((r.sales / target) * 100)) : 0;
          return `<tr><td>${esc(r.pic)}</td><td class="num">${money(r.sales)}</td>${
            single
              ? `<td><div class="target-bar sm"><span style="width:${pct}%"></span></div><span class="small ${r.sales >= target ? 'w-ok' : 'muted'}">${pct}%</span></td>`
              : `<td class="num">${r.hit} / ${r.months}</td>`
          }<td class="num"><strong>${money(r.com)}</strong></td></tr>`;
        })
        .join('')}</tbody><tfoot><tr><td colspan="${single ? 3 : 3}"><strong>Jumlah komisen</strong></td><td class="num"><strong>${money(total)}</strong></td></tr></tfoot></table>
    </div>`;
  }

  async function viewReport() {
    if (CLOUD && !DB.isOwner()) {
      app.innerHTML = '<div class="card"><h2>Laporan</h2><p>Hanya owner boleh melihat laporan jualan.</p></div>';
      return;
    }
    app.innerHTML = '<p class="muted">Memuatkan laporan…</p>';
    const jobs = await DB.allJobs({ full: true });
    if (currentView !== 'laporan') return;
    const [start, end, label] = periodRange(reportState.period, reportState.from, reportState.to);
    const r = computeReport(jobs, start, end);
    const periods = [
      ['hari', 'Hari ini'], ['minggu', 'Minggu ini'], ['bulan', 'Bulan ini'], ['bulan_lepas', 'Bulan lepas'], ['tahun', 'Tahun ini'], ['pilih', 'Pilih tarikh…'],
    ];
    const rangeText = `${fmtDate(start.toISOString(), false)} – ${fmtDate(new Date(end.getTime() - 1).toISOString(), false)}`;
    const staffRows = Object.entries(r.staff).sort((a, b) => b[1].received + b[1].pickups - (a[1].received + a[1].pickups));

    app.innerHTML = `
      <div class="report">
        <div class="toolbar">
          <select id="period">${periods.map(([k, l]) => `<option value="${k}" ${reportState.period === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
          ${
            reportState.period === 'pilih'
              ? `<input type="date" id="dFrom" value="${esc(reportState.from)}"><input type="date" id="dTo" value="${esc(reportState.to)}">`
              : ''
          }
        </div>
        <p class="small muted">${esc(label)} · ${rangeText}</p>

        <div class="stats">
          <div class="stat"><span>${money(r.cash)}</span>Kutipan wang<small>deposit + bayaran semasa ambil</small></div>
          <div class="stat"><span>${money(r.sales)}</span>Jualan (device diambil)<small>${r.collected} device · harga akhir</small></div>
          <div class="stat"><span>${r.received}</span>Device diterima<small>${r.cancelled} dibatalkan</small></div>
          <div class="stat"><span>${money(r.outstanding)}</span>Anggaran baki belum dikutip<small>${r.inShop} device masih dalam kedai</small></div>
        </div>

        <div class="card">
          <h3>Kutipan ${r.series.length > 62 || (end - start) / DAY > 62 ? 'bulanan' : 'harian'}</h3>
          ${columnChart(r.series)}
          <details class="table-view"><summary class="small">Lihat jadual</summary>
            <table class="tbl"><thead><tr><th>Tarikh</th><th class="num">Kutipan</th></tr></thead><tbody>${r.series
              .filter((s) => s.value)
              .map((s) => `<tr><td>${esc(s.full)}</td><td class="num">${money(s.value)}</td></tr>`)
              .join('') || '<tr><td colspan="2" class="muted">Tiada kutipan</td></tr>'}</tbody></table>
          </details>
        </div>

        <div class="report-grid">
          <div class="card"><h3>Kutipan ikut cara bayaran</h3>${rankedBars(r.methods, money)}</div>
          <div class="card"><h3>Device diterima ikut jenama</h3>${rankedBars(r.brands, (v) => v + ' unit')}</div>
        </div>

        ${commissionCard(jobs, start, end)}

        <div class="card">
          <h3>Prestasi PIC repair</h3>
          ${
            Object.keys(r.pics).length
              ? `<table class="tbl"><thead><tr><th>PIC</th><th class="num">Job diterima</th><th class="num">Siap &amp; diambil</th><th class="num">Jualan</th><th class="num" title="Claim waranti ke atas kerja PIC ini">Claim waranti</th></tr></thead><tbody>${Object.entries(r.pics)
                  .sort((a, b) => b[1].sales - a[1].sales || b[1].done - a[1].done)
                  .map(([k, v]) => `<tr><td>${esc(k)}</td><td class="num">${v.received}</td><td class="num">${v.done}</td><td class="num">${money(v.sales)}</td><td class="num">${v.claims}</td></tr>`)
                  .join('')}</tbody></table>`
              : '<p class="muted small">Tiada data dalam tempoh ini.</p>'
          }
        </div>

        <div class="card">
          <h3>Prestasi staff kaunter</h3>
          ${
            staffRows.length
              ? `<table class="tbl"><thead><tr><th>Staff</th><th class="num">Device diterima</th><th class="num">Serahan direkod</th></tr></thead><tbody>${staffRows
                  .map(([k, v]) => `<tr><td>${esc(k)}</td><td class="num">${v.received}</td><td class="num">${v.pickups}</td></tr>`)
                  .join('')}</tbody></table>`
              : '<p class="muted small">Tiada data dalam tempoh ini.</p>'
          }
        </div>

        <div class="card">
          <h3>Ringkasan</h3>
          <div class="r-row"><span>Device diterima</span><strong>${r.received}</strong></div>
          <div class="r-row"><span>Device diambil pelanggan</span><strong>${r.collected}</strong></div>
          <div class="r-row"><span>Dibatalkan</span><strong>${r.cancelled}</strong></div>
          <div class="r-row"><span>🛡 Claim waranti diterima</span><strong>${r.claims}</strong></div>
          <div class="r-row"><span>⭐ Review Google diminta</span><strong>${r.reviews}</strong></div>
          <div class="r-row"><span>Purata tempoh repair (terima → ambil)</span><strong>${r.avgDays == null ? '-' : r.avgDays.toFixed(1) + ' hari'}</strong></div>
          <div class="r-row"><span>Deposit diterima</span><strong>${money(r.deposits)}</strong></div>
          <div class="r-row"><span>Bayaran semasa ambil</span><strong>${money(r.paidAtPickup)}</strong></div>
          <p class="small muted">Jualan dikira ikut tarikh device diambil (harga akhir). Kutipan wang dikira ikut tarikh wang diterima: deposit pada hari device diterima, baki pada hari device diambil.</p>
          <button class="btn" id="btnRepCsv">📊 Eksport CSV tempoh ini</button>
        </div>
      </div>`;

    $('#period').addEventListener('change', (e) => {
      reportState.period = e.target.value;
      if (reportState.period === 'pilih' && !reportState.from) {
        const t = new Date();
        reportState.to = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
        reportState.from = reportState.to.slice(0, 8) + '01';
      }
      viewReport();
    });
    ['dFrom', 'dTo'].forEach((idName) => {
      const el = document.getElementById(idName);
      if (el)
        el.addEventListener('change', () => {
          reportState[idName === 'dFrom' ? 'from' : 'to'] = el.value;
          viewReport();
        });
    });

    // Tooltip carta (hover / tekan)
    const chart = $('.colchart');
    if (chart) {
      const tip = $('.cc-tip', chart);
      const show = (col) => {
        tip.textContent = col.dataset.tip;
        tip.hidden = false;
        const cr = chart.getBoundingClientRect();
        const r2 = col.getBoundingClientRect();
        const x = Math.min(Math.max(r2.left - cr.left + r2.width / 2, 60), cr.width - 60);
        tip.style.left = x + 'px';
      };
      chart.addEventListener('mouseover', (e) => e.target.closest('.cc-col') && show(e.target.closest('.cc-col')));
      chart.addEventListener('focusin', (e) => e.target.closest('.cc-col') && show(e.target.closest('.cc-col')));
      chart.addEventListener('click', (e) => e.target.closest('.cc-col') && show(e.target.closest('.cc-col')));
      chart.addEventListener('mouseleave', () => (tip.hidden = true));
    }

    $('#btnRepCsv').addEventListener('click', () => {
      const cell = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
      const head = ['No Resit', 'Tarikh Terima', 'Status', 'Nama', 'Jenama', 'Model', 'Staff', 'Anggaran', 'Deposit', 'Tarikh Ambil', 'Harga Akhir', 'Dibayar Semasa Ambil', 'Cara Bayaran'];
      const lines = r.rows.map((j) =>
        [j.id, j.createdAt, R.statusInfo(j.status).label, j.customer.name, j.device.brand, j.device.model, j.staff, j.estimate, j.deposit,
          j.pickup ? j.pickup.at : '', j.pickup ? j.pickup.finalPrice : '', j.pickup ? j.pickup.paid : '', j.pickup ? j.pickup.method : '']
          .map(cell)
          .join(',')
      );
      const csv = '﻿' + [head.map(cell).join(',')].concat(lines).join('\r\n');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
      a.download = `ogfix-laporan-${start.toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => a.remove(), 1000);
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
          <div class="grid2">
            <label>Pilihan tempoh waranti (satu baris: <code>Nama = hari</code>)<textarea name="warrantyOptions" rows="6">${esc(settings.warrantyOptions)}</textarea></label>
            <p class="small muted" style="align-self:end">Contoh: <code>2 minggu = 14</code>, <code>3 bulan = 90</code>. Staff pilih tempoh ini semasa serahan. Pilihan "Lain-lain" sentiasa ada untuk taip bilangan hari sendiri.</p>
          </div>
          <div class="grid2">
            <label>Peringatan "belum diambil" selepas (hari)<input name="remindDays" type="number" min="1" value="${esc(settings.remindDays)}"></label>
            <label>Device dianggap terbiar selepas (hari)<input name="abandonDays" type="number" min="1" value="${esc(settings.abandonDays)}"></label>
          </div>
          <div class="grid2">
            <label>PIC repair / technician (satu nama satu baris)<textarea name="pics" rows="5">${esc((settings.pics || []).join('\n'))}</textarea></label>
            <label>Slogan (jalur atas)<input name="slogan" value="${esc(settings.slogan)}"></label>
          </div>
          <div class="grid2">
            <label>💰 Sasaran komisen sebulan (RM)<input name="commissionTarget" type="number" min="0" step="1" value="${esc(settings.commissionTarget)}"></label>
            <label>Kadar komisen (%)<input name="commissionRate" type="number" min="0" max="100" step="0.1" value="${esc(settings.commissionRate)}"></label>
            <label>Cara kira komisen<select name="commissionMode">
              <option value="lebihan" ${settings.commissionMode !== 'semua' ? 'selected' : ''}>Atas jualan melebihi sasaran sahaja</option>
              <option value="semua" ${settings.commissionMode === 'semua' ? 'selected' : ''}>Atas semua jualan (bila sasaran dicapai)</option>
            </select></label>
            <label class="check"><input type="checkbox" name="showTargetToTech" ${settings.showTargetToTech !== false ? 'checked' : ''}><span>Tunjuk progres sasaran kepada technician (Kerja saya)</span></label>
          </div>
          <div class="grid2">
            <label>👋 Sapaan mesej WhatsApp<input name="greeting" value="${esc(settings.greeting)}" placeholder="Assalamualaikum / Salam Sejahtera"></label>
          </div>
          <label>✅ Templat mesej Siap (dihantar bila status ditukar ke Siap)
            <textarea name="siapMsg" rows="11">${esc(settings.siapMsg)}</textarea>
          </label>
          <p class="small muted" style="margin-top:-6px">Boleh guna: <code>{salam}</code> <code>{nama}</code> <code>{device}</code> <code>{resit}</code> <code>{kod}</code> <code>{harga}</code> <code>{link}</code> <code>{kedai}</code> <code>{nota}</code>. Baris yang kosong (cth tiada baki bayaran) dibuang secara automatik.
            <button type="button" class="linkbtn" id="siapReset">Guna semula ayat asal</button></p>
          <div class="grid2">
            <label>⭐ Link Google Review<input name="reviewLink" type="url" value="${esc(settings.reviewLink)}" placeholder="https://g.page/r/…/review"></label>
            <label>Mesej minta review ({kedai}, {nama}, {link})<textarea name="reviewMsg" rows="4">${esc(settings.reviewMsg)}</textarea></label>
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

    if ($('#siapReset'))
      $('#siapReset').addEventListener('click', () => {
        $('#setForm [name=siapMsg]').value = DEFAULT_SETTINGS.siapMsg;
        toast('Ayat asal dimasukkan – tekan Simpan Tetapan');
      });

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
        warrantyOptions: fd.get('warrantyOptions').trim() || DEFAULT_SETTINGS.warrantyOptions,
        remindDays: num(fd.get('remindDays')) || 3,
        abandonDays: num(fd.get('abandonDays')) || 30,
        terms: fd.get('terms').trim(),
        pics: fd.get('pics').split('\n').map((x) => x.trim()).filter(Boolean),
        slogan: fd.get('slogan').trim(),
        reviewLink: fd.get('reviewLink').trim(),
        greeting: fd.get('greeting').trim() || DEFAULT_SETTINGS.greeting,
        siapMsg: fd.get('siapMsg').trim() || DEFAULT_SETTINGS.siapMsg,
        reviewMsg: fd.get('reviewMsg').trim() || DEFAULT_SETTINGS.reviewMsg,
        commissionTarget: num(fd.get('commissionTarget')) === '' ? 0 : num(fd.get('commissionTarget')),
        commissionRate: num(fd.get('commissionRate')) === '' ? 0 : num(fd.get('commissionRate')),
        commissionMode: fd.get('commissionMode') === 'semua' ? 'semua' : 'lebihan',
        showTargetToTech: !!fd.get('showTargetToTech'),
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
    const bs = $('#bandShop');
    if (bs) bs.textContent = `${settings.name} / Repair desk`;
    const sl = $('#bandSlogan');
    if (sl) sl.textContent = settings.slogan || '';
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
  const APP_VERSION = '23';

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
      document.body.classList.add('is-owner');
      await loadSettings();
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
      ready = true;
      setLoggedIn(true);
      return route();
    }
    DB.onChange(() => {
      if (ready && ['list', 'saya'].includes(currentView) && listRefresh) listRefresh();
    });
    DB.onAuth((u) => enterSession(u));
  }

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  init();
})();
