# OGFIX – Sistem Terima Device (Resit Digital)

Sistem untuk kedai repair phone merekod device yang diterima daripada pelanggan, **tanpa resit kertas**.
Semua rekod disimpan dalam sistem, dan pelanggan menerima **resit digital melalui WhatsApp**.

Ini web app (PWA): boleh dibuka di browser telefon, tablet atau PC, dan boleh di-*install* ke skrin utama macam apps biasa. Boleh juga digunakan tanpa internet.

## Fungsi

- **Terima device**: nama dan no. telefon pelanggan, jenama/model, warna, IMEI, passcode, aksesori yang diterima, keadaan fizikal, gambar device, masalah, anggaran harga, deposit dan tarikh anggaran siap.
- **Tandatangan digital** pelanggan terus di skrin, serta persetujuan terma & syarat.
- **No. resit automatik** dalam format `OGF-YYMMDD-001`.
- **Hantar resit via WhatsApp**: pelanggan terima link resit digital yang lengkap.
  - Passcode, gambar dan tandatangan **tidak** dipapar pada resit pelanggan.
  - No. telefon pelanggan di-mask, contohnya `012-***6789`.
- **Kemaskini status**: Diterima → Sedang Diperiksa → Menunggu Part → Dalam Pembaikan → Siap → Telah Diambil (atau Dibatalkan). Setiap perubahan direkod dalam timeline, dan pelanggan boleh dimaklumkan terus melalui WhatsApp.
- **Serahan semula**: rekod harga akhir, bayaran, cara bayaran, waranti dan tandatangan pengambil.
- **Senarai & carian** ikut no. resit, nama, telefon, IMEI atau model, dengan filter ikut status.
- **Tetapan kedai**: nama, alamat, telefon, prefix no. resit, waranti lalai dan terma & syarat.
- **Backup / Pulih** data (fail JSON) dan **Eksport CSV** untuk dibuka dalam Excel.
- **Cetak / Simpan PDF** jika perlu.

## Cara online-kan (percuma, guna GitHub Pages)

1. Merge branch ini ke `main`.
2. Di GitHub, buka repo ini → **Settings** → **Pages**.
3. Di bawah *Build and deployment*, pilih **Source: Deploy from a branch**, kemudian **Branch: `main`** dan folder **`/ (root)`**. Tekan **Save**.
4. Selepas 1–2 minit, app boleh dibuka di
   `https://<username>.github.io/SYSTEM-TERIMA-DEVICE-OGFIX/`
5. Buka link tersebut di telefon/tablet kaunter, kemudian:
   - **Android (Chrome)**: menu ⋮ → *Add to Home screen* / *Install app*
   - **iPhone (Safari)**: butang Share → *Add to Home Screen*

> Nota: link resit yang dihantar kepada pelanggan menggunakan alamat app ini. Jadi pastikan app dibuka melalui alamat GitHub Pages (bukan fail di komputer) sebelum menghantar resit.

## Cara guna harian

1. Tekan **+ Terima Device**, isi borang, dan minta pelanggan baca terma serta tandatangan di skrin.
2. Tekan **Simpan & Jana Resit**, kemudian **Hantar via WhatsApp**. Pelanggan terus dapat resit digital.
3. Bila ada perkembangan, buka rekod, tukar **status**, dan WhatsApp pelanggan akan dibuka dengan mesej kemaskini serta link resit terbaru.
4. Bila pelanggan datang ambil, semak no. resit pada WhatsApp mereka, kemudian tekan **Rekod Serahan Semula** dan minta pelanggan tandatangan.

## PENTING: data & backup

- Data disimpan **dalam browser peranti yang digunakan** (IndexedDB). Tiada server dan tiada kos bulanan.
- Data **tidak** dikongsi secara automatik antara dua peranti. Gunakan satu peranti utama di kaunter.
- Buat **backup** secara berkala melalui **Tetapan → Muat turun backup**, dan simpan fail di Google Drive atau hantar ke WhatsApp sendiri. Jika telefon rosak atau data browser dipadam, pulihkan dengan **Pulihkan dari backup**.
- Jika anda perlukan beberapa staff / peranti berkongsi data yang sama secara live, sistem ini boleh dinaik taraf menggunakan database online (contohnya Firebase atau Supabase).

## Struktur fail

| Fail | Fungsi |
|---|---|
| `index.html` | App staff (kaunter) |
| `resit.html` | Halaman resit digital untuk pelanggan |
| `js/app.js` | Logik app: borang, senarai, status, serahan, tetapan |
| `js/render.js` | Paparan resit & penjanaan link pelanggan |
| `js/db.js` | Simpanan data (IndexedDB) |
| `css/style.css` | Reka bentuk |
| `sw.js`, `manifest.webmanifest`, `icon.svg` | Fungsi PWA (install & offline) |

Untuk cuba di komputer sendiri: `python3 -m http.server 8000`, kemudian buka `http://localhost:8000`.
