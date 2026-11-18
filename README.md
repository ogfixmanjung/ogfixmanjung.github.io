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

## Dua mod simpanan data

| | Mod Tempatan (asal) | Mod Cloud (Firebase) |
|---|---|---|
| Data disimpan | Dalam browser peranti itu sahaja | Online (Google Firebase) |
| Staff lain boleh akses | ❌ | ✅ Dari telefon masing-masing |
| Perlu login | Tidak | Ya (email + password) |
| Data hilang jika telefon rosak | Ya (kecuali ada backup) | Tidak |
| Kos | Percuma | Percuma (pelan Spark cukup untuk kedai biasa) |

Mod dipilih melalui fail `js/config.js`. Jika `FIREBASE_CONFIG = null`, app guna mod tempatan.

## Setup Firebase (mod cloud, dibuat sekali sahaja)

1. Buka <https://console.firebase.google.com> dan login dengan akaun Google kedai.
2. **Create a project**: namakan `ogfix`, tutup Google Analytics, kemudian tekan **Create project**.
3. **Authentication**: menu kiri **Build → Authentication → Get started**. Pilih **Email/Password**, hidupkan (*Enable*), dan tekan **Save**.
4. **Firestore**: menu kiri **Build → Firestore Database → Create database**.
   - Pilih lokasi **asia-southeast1 (Singapore)**.
   - Pilih **Start in production mode**, kemudian tekan **Create**.
5. **Rules**: dalam Firestore, buka tab **Rules**.
   - Padam semua isi asal dan tampal isi fail [`firestore.rules`](firestore.rules).
   - Tukar `EMAIL_OWNER@gmail.com` kepada email owner (huruf kecil), kemudian tekan **Publish**.
6. **Daftar web app**: klik ⚙ (sebelah *Project Overview*) **→ Project settings**. Di bawah *Your apps*, tekan ikon **`</>`**, namakan `ogfix-web`, dan tekan **Register app**.
7. Salin objek `firebaseConfig` yang dipaparkan, kemudian masukkan ke dalam `js/config.js`:
   ```js
   window.FIREBASE_CONFIG = {
     apiKey: "...",
     authDomain: "....firebaseapp.com",
     projectId: "...",
     storageBucket: "...",
     messagingSenderId: "...",
     appId: "..."
   };
   ```
   Nilai `apiKey` ini **bukan rahsia**. Ia memang direka untuk berada dalam kod website, dan keselamatan data dikawal oleh Rules di langkah 5.
8. Push ke `main`. GitHub Pages akan dikemaskini dalam 1–2 minit.

### Mula guna

1. **Owner** buka app, masukkan email owner (sama seperti dalam Rules) dan password baru, kemudian tekan **"Daftar akaun"**. Akaun pertama dengan email owner akan menjadi owner.
2. **Staff** buka app di telefon sendiri, dan daftar dengan email serta password mereka. Mereka akan nampak skrin *Menunggu Kelulusan*.
3. Owner buka **Tetapan → Staff**, tambah email staff, dan minta staff tekan **Semak Semula**.
4. Jika peranti kaunter ada rekod lama (mod tempatan), owner buka **Tetapan → Pindah Data Lama ke Cloud** pada peranti tersebut.

### Kebenaran

| Tindakan | Owner | Staff |
|---|---|---|
| Terima device, kemaskini status, serahan semula | ✅ | ✅ |
| Lihat & cari semua rekod | ✅ | ✅ |
| Padam rekod | ✅ | ❌ |
| Ubah tetapan kedai, urus staff | ✅ | ❌ |

Orang luar yang mendaftar tetapi emailnya tidak ditambah oleh owner tidak boleh melihat sebarang data.

### Nota mod cloud

- App masih boleh digunakan sekejap tanpa internet. Data disimpan dalam telefon dan akan sync bila internet kembali.
- Senarai di skrin dikemaskini secara automatik bila staff lain buat perubahan.
- Gambar device dikecilkan secara automatik supaya kekal dalam had percuma Firebase.

## Backup (mod tempatan)

Dalam mod tempatan, data disimpan **dalam browser peranti yang digunakan**. Buat **backup** secara berkala melalui **Tetapan → Muat turun backup**, dan simpan fail tersebut di Google Drive.

## Struktur fail

| Fail | Fungsi |
|---|---|
| `index.html` | App staff (kaunter) |
| `resit.html` | Halaman resit digital untuk pelanggan |
| `js/app.js` | Logik app: borang, senarai, status, serahan, tetapan |
| `js/render.js` | Paparan resit & penjanaan link pelanggan |
| `js/config.js` | Tetapan Firebase (kosong = mod tempatan) |
| `js/db-local.js` | Simpanan mod tempatan (IndexedDB) |
| `js/db-cloud.js` | Simpanan mod cloud (Firebase Firestore + login) |
| `js/db.js` | Pilih mod simpanan |
| `firestore.rules` | Peraturan keselamatan database (salin ke Firebase Console) |
| `css/style.css` | Reka bentuk |
| `sw.js`, `manifest.webmanifest` | Fungsi PWA (install & offline) |
| `img/` | Logo ogfix. & ikon apps |

Untuk cuba di komputer sendiri: `python3 -m http.server 8000`, kemudian buka `http://localhost:8000`.
