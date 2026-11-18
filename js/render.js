/* Fungsi dikongsi: format, status, paparan resit, encode link customer. */
(function () {
  const STATUS = [
    { key: 'diterima', label: 'Diterima', color: '#2563eb' },
    { key: 'diperiksa', label: 'Sedang Diperiksa', color: '#7c3aed' },
    { key: 'menunggu_part', label: 'Menunggu Part', color: '#d97706' },
    { key: 'dibaiki', label: 'Dalam Pembaikan', color: '#0891b2' },
    { key: 'siap', label: 'Siap – Sedia Diambil', color: '#16a34a' },
    { key: 'diambil', label: 'Telah Diambil', color: '#475569' },
    { key: 'batal', label: 'Dibatalkan / Tak Dapat Dibaiki', color: '#dc2626' },
  ];

  const DEFAULT_TERMS = [
    'Kedai tidak bertanggungjawab atas kehilangan data. Sila backup data anda sebelum menghantar device.',
    'Anggaran harga mungkin berubah selepas pemeriksaan. Pelanggan akan dimaklumkan sebelum kerja diteruskan.',
    'Deposit yang telah dibayar tidak akan dikembalikan jika pelanggan membatalkan pembaikan selepas part ditempah.',
    'Device yang tidak dituntut dalam tempoh 30 hari selepas dimaklumkan siap bukan lagi tanggungjawab kedai.',
    'Waranti hanya untuk part yang ditukar sahaja dan terbatal jika device terjatuh, terkena air atau dibuka oleh pihak lain.',
    'Sila tunjukkan resit digital ini semasa mengambil device.',
  ].join('\n');

  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function statusInfo(key) {
    return STATUS.find((s) => s.key === key) || { key, label: key, color: '#475569' };
  }

  /* Warna lut sinar tanpa color-mix() (supaya boleh dijana sebagai gambar/PDF) */
  function tint(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }

  function badge(key) {
    const s = statusInfo(key);
    return `<span class="badge" style="color:${s.color};background:${tint(s.color, 0.1)};border-color:${tint(s.color, 0.35)}">${esc(s.label)}</span>`;
  }

  function money(n) {
    if (n === '' || n == null || isNaN(Number(n))) return '-';
    return 'RM ' + Number(n).toFixed(2);
  }

  function fmtDate(iso, withTime = true) {
    if (!iso) return '-';
    const d = new Date(iso);
    if (isNaN(d)) return esc(iso);
    const opts = { day: '2-digit', month: 'short', year: 'numeric' };
    if (withTime) Object.assign(opts, { hour: '2-digit', minute: '2-digit' });
    return d.toLocaleString('ms-MY', opts);
  }

  function maskPhone(p) {
    if (String(p || '').includes('*')) return p; // sudah di-mask
    const d = String(p || '').replace(/\D/g, '');
    if (d.length < 7) return p || '';
    return d.slice(0, 3) + '-' + '*'.repeat(d.length - 7) + d.slice(-4);
  }

  function addDays(iso, days) {
    const d = new Date(iso);
    d.setDate(d.getDate() + Number(days));
    return d.toISOString();
  }

  function row(label, value) {
    if (value === '' || value == null || value === '-') return '';
    return `<div class="r-row"><span>${esc(label)}</span><strong>${value}</strong></div>`;
  }

  function list(items) {
    if (!items || !items.length) return '<p class="muted">Tiada</p>';
    return '<ul class="chips">' + items.map((i) => `<li>${esc(i)}</li>`).join('') + '</ul>';
  }

  /* opts.isPublic = paparan untuk customer (tiada passcode/gambar/tandatangan) */
  function renderReceipt(job, shop, opts = {}) {
    const isPublic = !!opts.isPublic;
    shop = shop || {};
    const c = job.customer || {};
    const d = job.device || {};
    const pk = job.pickup;
    const balance =
      job.estimate !== '' && job.estimate != null
        ? Number(job.estimate || 0) - Number(job.deposit || 0)
        : '';

    const terms = String(shop.terms || '')
      .split('\n')
      .map((t) => t.trim())
      .filter(Boolean);

    const history = (job.history || [])
      .slice()
      .reverse()
      .map(
        (h) => `<li>
          <div class="tl-dot" style="background:${statusInfo(h.status).color};box-shadow:0 0 0 3px ${tint(statusInfo(h.status).color, 0.2)}"></div>
          <div><strong>${esc(statusInfo(h.status).label)}</strong>
          <div class="muted small">${fmtDate(h.at)}</div>
          ${h.note ? `<div class="small">${esc(h.note)}</div>` : ''}</div>
        </li>`
      )
      .join('');

    const photos =
      !isPublic && job.photos && job.photos.length
        ? `<section><h3>Gambar Device</h3><div class="photos">${job.photos
            .map((p, i) => `<a href="${p}" target="_blank" rel="noopener"><img src="${p}" alt="Gambar ${i + 1}"></a>`)
            .join('')}</div></section>`
        : '';

    let signIn = '';
    if (job.signIn && !isPublic) {
      signIn = `<div class="sig"><img src="${job.signIn}" alt="Tandatangan pelanggan"><div class="small muted">Tandatangan pelanggan semasa hantar</div></div>`;
    } else if (job.signed || job.signIn) {
      signIn = `<p class="small">✔ Pelanggan telah bersetuju dengan terma dan menandatangani secara digital pada ${fmtDate(job.createdAt)}.</p>`;
    }

    let pickup = '';
    if (pk) {
      const warrantyUntil = pk.warrantyDays ? fmtDate(addDays(pk.at, pk.warrantyDays), false) : '';
      pickup = `<section><h3>Penyerahan Semula</h3>
        ${row('Tarikh diambil', fmtDate(pk.at))}
        ${row('Diambil oleh', esc(pk.by || c.name))}
        ${row('Harga akhir', money(pk.finalPrice))}
        ${row('Deposit', money(job.deposit))}
        ${row('Dibayar semasa ambil', money(pk.paid))}
        ${row('Cara bayaran', esc(pk.method))}
        ${pk.warrantyDays ? row('Waranti', `${esc(pk.warrantyDays)} hari (sehingga ${warrantyUntil})`) : ''}
        ${pk.note ? row('Nota', esc(pk.note)) : ''}
        ${!isPublic && pk.verified ? row('Pengesahan', esc(pk.verified)) : ''}
        ${
          pk.signOut && !isPublic
            ? `<div class="sig"><img src="${pk.signOut}" alt="Tandatangan ambil"><div class="small muted">Tandatangan semasa ambil</div></div>`
            : pk.signOut || pk.signed
            ? '<p class="small">✔ Ditandatangan secara digital semasa mengambil device.</p>'
            : ''
        }
      </section>`;
    }

    return `<article class="receipt">
      <header class="r-head">
        ${window.OGFIX_LOGO ? OGFIX_LOGO('r-logo') : `<div class="r-shop">${esc(shop.name || 'OGFIX')}</div>`}
        ${shop.address ? `<div class="small">${esc(shop.address)}</div>` : ''}
        ${shop.phone ? `<div class="small">Tel: ${esc(shop.phone)}</div>` : ''}
        <div class="r-title">RESIT PENERIMAAN DEVICE</div>
        <div class="r-no">${esc(job.id)}</div>
        <div class="small muted">Diterima: ${fmtDate(job.createdAt)}</div>
        <div class="r-status">${badge(job.status)}</div>
        ${
          isPublic && job.pickupCode && job.status !== 'diambil'
            ? `<div class="r-code"><div class="r-code-label">KOD AMBIL</div><div class="r-code-num">${esc(job.pickupCode)}</div><div class="small">Sebut / tunjuk kod ini semasa mengambil device</div></div>`
            : ''
        }
      </header>

      <section><h3>Pelanggan</h3>
        ${row('Nama', esc(c.name))}
        ${row('No. Telefon', esc(isPublic ? maskPhone(c.phone) : c.phone))}
      </section>

      <section><h3>Device</h3>
        ${row('Jenama / Model', esc([d.brand, d.model].filter(Boolean).join(' ')))}
        ${row('Warna', esc(d.color))}
        ${row('IMEI / Serial', esc(d.imei))}
        ${!isPublic ? row('Passcode / Pattern', esc(d.passcode)) : ''}
        ${!isPublic && job.location && job.status !== 'diambil' ? row('📍 Lokasi simpanan', esc(job.location)) : ''}
      </section>

      <section><h3>Aksesori Diterima</h3>${list(
        (job.accessories || []).concat(job.accessoriesOther ? [job.accessoriesOther] : [])
      )}</section>

      <section><h3>Keadaan Fizikal</h3>${list(job.condition)}
        ${job.conditionNote ? `<p class="small">${esc(job.conditionNote)}</p>` : ''}
      </section>

      <section><h3>Masalah Dilaporkan</h3><p>${esc(job.problem) || '-'}</p></section>

      <section><h3>Kos & Tempoh</h3>
        ${row('Anggaran harga', money(job.estimate))}
        ${row('Deposit dibayar', money(job.deposit))}
        ${balance !== '' ? row('Anggaran baki', money(balance)) : ''}
        ${row('Anggaran siap', job.eta ? fmtDate(job.eta, false) : '')}
        ${row('Diterima oleh', esc(job.staff))}
      </section>

      ${job.notes ? `<section><h3>Nota</h3><p>${esc(job.notes)}</p></section>` : ''}
      ${photos}

      <section><h3>Status Pembaikan</h3><ul class="timeline">${history}</ul></section>

      ${pickup}

      <section><h3>Pengesahan</h3>${signIn || '<p class="muted small">Tiada tandatangan</p>'}</section>

      ${
        terms.length
          ? `<section class="terms"><h3>Terma & Syarat</h3><ol>${terms.map((t) => `<li>${esc(t)}</li>`).join('')}</ol></section>`
          : ''
      }
    </article>`;
  }

  /* ---- Link untuk customer: data resit diencode dalam URL (tiada server) ---- */
  function b64urlEncode(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function b64urlDecode(s) {
    s = s.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    const bin = atob(s);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  function publicPayload(job, shop) {
    const pk = job.pickup
      ? {
          at: job.pickup.at,
          by: job.pickup.by,
          finalPrice: job.pickup.finalPrice,
          paid: job.pickup.paid,
          method: job.pickup.method,
          warrantyDays: job.pickup.warrantyDays,
          note: job.pickup.note,
          signed: !!job.pickup.signOut,
        }
      : null;
    return {
      v: 1,
      job: {
        id: job.id,
        createdAt: job.createdAt,
        status: job.status,
        customer: { name: job.customer.name, phone: maskPhone(job.customer.phone) },
        device: {
          brand: job.device.brand,
          model: job.device.model,
          color: job.device.color,
          imei: job.device.imei,
        },
        accessories: job.accessories,
        accessoriesOther: job.accessoriesOther,
        condition: job.condition,
        conditionNote: job.conditionNote,
        problem: job.problem,
        estimate: job.estimate,
        deposit: job.deposit,
        eta: job.eta,
        pickupCode: job.status !== 'diambil' ? job.pickupCode || '' : '',
        staff: job.staff,
        history: (job.history || []).map((h) => ({ status: h.status, at: h.at, note: h.note || '' })),
        signed: !!job.signIn,
        pickup: pk,
      },
      shop: { name: shop.name, address: shop.address, phone: shop.phone, terms: shop.terms },
    };
  }

  /* Link resit untuk pelanggan.
     - Mod cloud: link pendek ?id=<token>, data resit diambil dari cloud (status sentiasa terkini)
     - Mod tempatan: data resit dimasukkan dalam link (#r=...) */
  function customerLink(job, shop) {
    const base = new URL('resit.html', location.href);
    if (job.receiptToken) {
      base.search = 'id=' + job.receiptToken;
      return base.toString();
    }
    base.hash = 'r=' + b64urlEncode(JSON.stringify(publicPayload(job, shop)));
    return base.toString();
  }

  function newReceiptToken() {
    const b = new Uint8Array(16);
    crypto.getRandomValues(b);
    let bin = '';
    b.forEach((x) => (bin += String.fromCharCode(x)));
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function decodeCustomerHash(hash) {
    const m = /[#&]r=([A-Za-z0-9_-]+)/.exec(hash || '');
    if (!m) return null;
    try {
      return JSON.parse(b64urlDecode(m[1]));
    } catch (e) {
      return null;
    }
  }

  window.R = {
    STATUS,
    DEFAULT_TERMS,
    esc,
    statusInfo,
    badge,
    money,
    fmtDate,
    maskPhone,
    renderReceipt,
    customerLink,
    decodeCustomerHash,
    publicPayload,
    newReceiptToken,
  };
})();
