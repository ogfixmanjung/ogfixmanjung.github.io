/* Simpan resit sebagai Gambar (PNG) atau PDF – berfungsi di iPhone, Android & komputer. */
(function () {
  const LIBS = {
    h2c: 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
    jspdf: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  };
  const loaded = {};

  function load(src) {
    if (!loaded[src]) {
      loaded[src] = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = src;
        s.onload = resolve;
        s.onerror = () => {
          delete loaded[src];
          reject(new Error('Tiada sambungan internet'));
        };
        document.head.appendChild(s);
      });
    }
    return loaded[src];
  }

  function toBlob(canvas, type, quality) {
    return new Promise((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Gagal jana gambar'))), type, quality)
    );
  }

  async function capture(el) {
    await load(LIBS.h2c);
    // Logo SVG ditukar kepada <img> bersaiz tetap dalam salinan (html2canvas kurang tepat melukis SVG inline)
    const logos = Array.from(el.querySelectorAll('svg')).map((svg, i) => {
      svg.setAttribute('data-export-i', i);
      const r = svg.getBoundingClientRect();
      const copy = svg.cloneNode(true);
      copy.setAttribute('width', Math.round(r.width));
      copy.setAttribute('height', Math.round(r.height));
      const color = getComputedStyle(svg).color || '#000';
      copy.querySelectorAll('[fill="currentColor"]').forEach((p) => p.setAttribute('fill', color));
      return {
        w: r.width,
        h: r.height,
        src: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(copy)),
      };
    });
    try {
      return await window.html2canvas(el, {
        scale: 2,
        backgroundColor: '#ffffff',
        logging: false,
        useCORS: true,
        onclone: (doc) => {
          logos.forEach((l, i) => {
            const svg = doc.querySelector(`svg[data-export-i="${i}"]`);
            if (!svg) return;
            const img = doc.createElement('img');
            img.src = l.src;
            img.width = Math.round(l.w);
            img.height = Math.round(l.h);
            img.className = svg.getAttribute('class') || '';
            img.style.width = l.w + 'px';
            img.style.height = l.h + 'px';
            svg.replaceWith(img);
          });
        },
      });
    } finally {
      el.querySelectorAll('svg[data-export-i]').forEach((s) => s.removeAttribute('data-export-i'));
    }
  }

  async function makePdf(canvas) {
    await load(LIBS.jspdf);
    const { jsPDF } = window.jspdf;
    const w = canvas.width / 2;
    const h = canvas.height / 2;
    const pdf = new jsPDF({ unit: 'pt', format: [w, h], orientation: h >= w ? 'portrait' : 'landscape', compress: true });
    pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, w, h);
    return pdf.output('blob');
  }

  /* Kongsi (iPhone/Android: "Simpan ke Foto/Fail") atau muat turun (komputer) */
  async function deliver(blob, name) {
    const file = new File([blob], name, { type: blob.type });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: name });
        return;
      } catch (e) {
        if (e && e.name === 'AbortError') return; // pengguna batalkan
      }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 4000);
  }

  function modal(html) {
    let m = document.getElementById('exportModal');
    if (!m) {
      m = document.createElement('div');
      m.id = 'exportModal';
      m.className = 'modal';
      document.body.appendChild(m);
      m.addEventListener('click', (e) => {
        if (e.target === m || e.target.closest('[data-close]')) close();
      });
    }
    m.innerHTML = `<div class="modal-box">${html}</div>`;
    m.hidden = false;
    document.body.classList.add('modal-open');
    return m;
  }

  function close() {
    const m = document.getElementById('exportModal');
    if (m) {
      m.hidden = true;
      const img = m.querySelector('img');
      if (img) URL.revokeObjectURL(img.src);
      m.innerHTML = '';
    }
    document.body.classList.remove('modal-open');
  }

  /* el: elemen .receipt yang hendak disimpan; name: nama fail tanpa sambungan */
  async function open(el, name) {
    modal('<p class="center">Menyediakan resit…</p>');
    let png, pdf;
    try {
      const canvas = await capture(el);
      png = await toBlob(canvas, 'image/png');
      pdf = await makePdf(canvas);
    } catch (err) {
      console.error(err);
      modal(`<h3>Tidak dapat sediakan resit</h3>
        <p>${(err && err.message) || err}. Cuba lagi, atau ambil screenshot skrin ini.</p>
        <div class="btn-col"><button class="btn" data-close>Tutup</button></div>`);
      return;
    }
    const m = modal(`
      <h3>Simpan Resit</h3>
      <div class="modal-preview"><img src="${URL.createObjectURL(png)}" alt="Resit ${name}"></div>
      <p class="small muted">iPhone: tekan lama pada gambar di atas dan pilih <strong>Simpan ke Foto</strong>, atau guna butang di bawah.</p>
      <div class="btn-col">
        <button class="btn primary" id="saveImg">🖼 Simpan Gambar</button>
        <button class="btn" id="savePdf">📄 Simpan PDF</button>
        <button class="btn" data-close>Tutup</button>
      </div>`);
    m.querySelector('#saveImg').addEventListener('click', () => deliver(png, name + '.png'));
    m.querySelector('#savePdf').addEventListener('click', () => deliver(pdf, name + '.pdf'));
  }

  window.ReceiptExport = { open, close };
})();
