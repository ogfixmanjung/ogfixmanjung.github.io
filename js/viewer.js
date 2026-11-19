/* Paparan gambar penuh dalam app (tanpa buka tab baru).
   Browser menyekat gambar data: dibuka dalam tab baru, jadi gambar dipapar di sini. */
(function () {
  let srcs = [];
  let idx = 0;
  let name = 'Gambar';
  let el = null;
  let startX = null;

  function build() {
    if (el) return el;
    el = document.createElement('div');
    el.id = 'photoViewer';
    el.className = 'pv';
    el.hidden = true;
    el.innerHTML = `
      <div class="pv-top">
        <span class="pv-count"></span>
        <div class="pv-acts">
          <button type="button" class="btn small pv-save">💾 Simpan gambar</button>
          <button type="button" class="btn small pv-close" aria-label="Tutup">✕ Tutup</button>
        </div>
      </div>
      <div class="pv-stage">
        <button type="button" class="pv-nav pv-prev" aria-label="Gambar sebelum">‹</button>
        <img class="pv-img" alt="">
        <button type="button" class="pv-nav pv-next" aria-label="Gambar seterusnya">›</button>
      </div>`;
    document.body.appendChild(el);
    el.querySelector('.pv-close').addEventListener('click', close);
    el.querySelector('.pv-prev').addEventListener('click', () => go(-1));
    el.querySelector('.pv-next').addEventListener('click', () => go(1));
    el.querySelector('.pv-save').addEventListener('click', save);
    // tekan kawasan gelap untuk tutup
    el.querySelector('.pv-stage').addEventListener('click', (e) => {
      if (e.target.classList.contains('pv-stage')) close();
    });
    // leret kiri/kanan di telefon
    const stage = el.querySelector('.pv-stage');
    stage.addEventListener('pointerdown', (e) => (startX = e.clientX));
    stage.addEventListener('pointerup', (e) => {
      if (startX == null) return;
      const dx = e.clientX - startX;
      startX = null;
      if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1);
    });
    document.addEventListener('keydown', (e) => {
      if (el.hidden) return;
      if (e.key === 'Escape') close();
      if (e.key === 'ArrowLeft') go(-1);
      if (e.key === 'ArrowRight') go(1);
    });
    return el;
  }

  function show() {
    el.querySelector('.pv-img').src = srcs[idx];
    el.querySelector('.pv-count').textContent = srcs.length > 1 ? `${idx + 1} / ${srcs.length}` : '';
    el.querySelectorAll('.pv-nav').forEach((b) => (b.hidden = srcs.length < 2));
  }

  function go(d) {
    if (srcs.length < 2) return;
    idx = (idx + d + srcs.length) % srcs.length;
    show();
  }

  function open(list, i, label) {
    srcs = (list || []).filter(Boolean);
    if (!srcs.length) return;
    idx = Math.max(0, Math.min(i || 0, srcs.length - 1));
    name = label || 'Gambar';
    build().hidden = false;
    document.body.classList.add('modal-open');
    show();
  }

  function close() {
    if (!el || el.hidden) return;
    el.hidden = true;
    el.querySelector('.pv-img').removeAttribute('src');
    document.body.classList.remove('modal-open');
  }

  async function save() {
    try {
      const blob = await (await fetch(srcs[idx])).blob();
      const ext = (blob.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
      const file = new File([blob], `${name}-${idx + 1}.${ext}`, { type: blob.type });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file] });
          return;
        } catch (e) {
          if (e && e.name === 'AbortError') return;
        }
      }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = file.name;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        URL.revokeObjectURL(a.href);
        a.remove();
      }, 3000);
    } catch (e) {
      alert('Tidak dapat simpan gambar. Tekan lama pada gambar dan pilih "Simpan".');
    }
  }

  // Tekan gambar kecil (resit staff atau pratonton borang) -> buka paparan penuh
  document.addEventListener('click', (e) => {
    const trigger = e.target.closest('.ph-open, #photoPreview .ph img');
    if (!trigger) return;
    e.preventDefault();
    const box = trigger.closest('.photos');
    const imgs = box ? Array.from(box.querySelectorAll('img')) : [];
    const img = trigger.tagName === 'IMG' ? trigger : trigger.querySelector('img');
    const no = (document.querySelector('.r-no') || {}).textContent;
    open(
      imgs.map((i) => i.src),
      Math.max(0, imgs.indexOf(img)),
      no ? 'Gambar-' + no.trim() : 'Gambar-device'
    );
  });

  window.PhotoViewer = { open, close };
})();
