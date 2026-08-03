# Aplikasi Gaji & Slip Gaji — LOVE Pet Clinic

Aplikasi web sederhana untuk menghitung gaji karyawan dan mencetak slip gaji,
menggantikan file Numbers. Tampilan menyesuaikan HP maupun desktop, bisa
dipakai tanpa internet.

Data **Januari–Juli 2026** sudah terisi persis seperti di file Numbers.

## Cara memakai

- **Sekarang juga:** buka **`index.html`** (klik dua kali).
- **Di iPhone + MacBook:** ikuti **[PANDUAN-DEPLOY.md](PANDUAN-DEPLOY.md)** —
  GitHub → Firebase → Cloudflare Pages, lalu pasang ke Home Screen.

## Tampilan

- **Di HP** — tab bar di bagian bawah layar seperti aplikasi iPhone:
  *Ringkasan · Input · Slip · Nota · Rekap · Kelola*. Judul besar di tiap halaman,
  daftar karyawan yang bisa diketuk, dan kolom isian sudah 16px supaya layar
  tidak ikut nge-zoom saat mengetik.
- **Di desktop** — menu yang sama tampil sebagai sidebar di kiri.
- Halaman **Kelola** memuat dua bagian yang bisa digeser: *Karyawan* dan
  *Pengaturan*.

## Alur kerja tiap bulan

1. Pilih **periode** (mis. *Agustus 2026*) di kanan atas.
2. Buka tab **Input** → tekan **“Salin bulan lalu”**.
   Semua karyawan, gaji pokok, dan tarif bonus ikut tersalin; jumlah performa
   direset ke 0 supaya tinggal diisi.
3. Tetap di tab **Input**, bagian **Performa** — isi jumlahnya saja per
   cabang (Manado / Tomohon). Gaji langsung terhitung.
   Bagian **Gaji & Potongan** hanya disentuh kalau gaji pokok, tarif, denda,
   atau hutang berubah.
4. Buka tab **Slip** → pilih karyawan → **Cetak / PDF**
   (di dialog cetak pilih *Save as PDF*), atau **Cetak semua**
   untuk sekaligus satu halaman per orang.
   Tombol **Salin teks WA** menyalin ringkasan slip untuk dikirim ke karyawan.
5. Tab **Rekap** menampilkan total setahun, grafik, matriks per bulan,
   dan tombol **Unduh CSV**.

## Rumus yang dipakai

```
Gaji diterima =
    Gaji pokok + Tunjangan operasional
  + Clients     (jumlah × tarif)
  + Jaga minggu (jumlah × tarif)
  + Lembur      (jumlah × tarif)
  + Rawat inap  (jumlah × tarif)
  + Styling     (jumlah × tarif)
  + Operasi     (jumlah × tarif)   ← hanya Dokter
  + Tunjangan makan + tunjangan lain
  − Denda/absen − Potongan hutang/kasbon
```

Setiap jumlah diisi terpisah per cabang **Manado** dan **Tomohon**; yang
dipakai menghitung adalah totalnya (nama cabang bisa diganti di Pengaturan).

Tarif default per posisi — nilai Juli 2026, bisa diubah di **Kelola → Pengaturan**:

| Posisi  | Clients | Jaga minggu | Lembur  | Rawat inap | Styling | Operasi | Tunj. makan |
|---------|---------|-------------|---------|------------|---------|---------|-------------|
| Dokter  | 10.000  | 100.000     | 100.000 | 15.000     | 25.000  | 50.000  | 450.000     |
| Admin   | 3.500   | 30.000      | 50.000  | 10.000     | 25.000  | –       | 450.000     |
| Groomer | 10.000  | 30.000      | 50.000  | 10.000     | 25.000  | –       | 450.000     |
| Helper  | 10.000  | 30.000      | 50.000  | 10.000     | 25.000  | –       | 450.000     |

### Menambah jenis bonus baru

Cukup tambah satu baris di array `KOMPONEN` pada [js/data.js](js/data.js).
Halaman input, slip gaji, rekap, dan tabel tarif otomatis ikut menyesuaikan —
tidak perlu menyentuh bagian lain. Tambahkan `laporSendiri: true` kalau
karyawan boleh melaporkannya sendiri lewat halaman **lapor.html** (lihat
bagian berikut).

## Karyawan melapor sendiri — **lapor.html**

Selain aplikasi utama ini, ada satu halaman terpisah untuk karyawan:
**"Performance Bonus LovePet"** (`lapor.html`). Karyawan cukup menekan tombol
kategori (Lembur / Rawat Inap / Styling / Operasi — Operasi hanya muncul
untuk Dokter), diarahkan ke kamera untuk foto bukti, lalu langsung melihat
capaian bulanannya. Maksimal satu laporan per kategori per hari, dan bisa
dibatalkan hari itu juga.

**Butuh Firebase aktif** (lihat PANDUAN-DEPLOY.md) — halaman ini tidak
punya mode lokal, karena memang tujuannya mengirim laporan ke pemilik.

Alur untuk Anda sebagai pemilik:

1. **Kelola → Karyawan** → pada karyawan yang bersangkutan, isi **Cabang**,
   lalu di bagian **Akun login** isi nama pengguna + kata sandi awal →
   **Buat akun login**.
2. Bagikan link `lapor.html` (mis. `https://gaji-love-pet.pages.dev/lapor.html`)
   beserta nama pengguna & sandinya ke karyawan — lewat WhatsApp misalnya.
   Sarankan mereka **Bagikan → Add to Home Screen** supaya seperti aplikasi.
3. Laporan yang masuk **tidak otomatis** mengubah gaji — di **Input →
   Performa**, tekan **“Tarik laporan karyawan”** untuk menjumlahkan laporan
   bulan berjalan ke kolom performa (Anda tetap bisa mengedit angkanya
   setelah ditarik, misalnya kalau ada laporan yang meragukan).

**Soal foto bukti**: disimpan terkompresi kecil (~20–60 KB) langsung di
database Firestore — sengaja **bukan** Firebase Storage, supaya tetap di
paket gratis dan tidak perlu kartu kredit. Otomatis dikosongkan (bukan
dihapus datanya, hanya fotonya) setelah 90 hari, dijalankan diam-diam setiap
kali aplikasi pemilik atau karyawan dibuka — bukan jadwal pasti tengah malam,
tapi cukup untuk menjaga ukuran database tetap kecil.

## Pencatatan pengeluaran — tab **Nota**

Foto nota difoto/diunggah, lalu dibaca AI (Google Gemini) menjadi baris
pengeluaran: **tanggal, toko, total, kategori, metode bayar, dan rincian
barang per item**. Hasil bacaannya selalu ditampilkan dulu untuk diperiksa
dan dikoreksi sebelum tersimpan — AI tidak pernah menyimpan diam-diam.

Setiap nota punya kolom **Status**: *Kosong* (bawaan) · *Belum kirim Risa* ·
*Terkirim ke Risa* · *Untuk ditahan*. Statusnya bisa diubah kapan saja
langsung dari daftar.

Daftarnya sengaja ringkas — satu baris per nota. **Ketuk barisnya** untuk
membentangkan rincian barang, foto, dan tombol Ubah/Hapus. Tombol
**Cetak / PDF** mencetak semuanya lengkap dengan rincian tiap barang,
mengikuti filter bulan & status yang sedang aktif.

Ada dua cara memasukkan nota:

| Cara | Langkah |
|---|---|
| **Dari aplikasi** | tab Nota → **Unggah nota** → potret/pilih foto → periksa hasilnya → pilih status → Simpan |
| **Dari Telegram** | forward foto nota ke grup → bot membalas ringkasan + 4 tombol status → tekan satu → bot menjawab "✅ Tersimpan" (atau menjelaskan kalau gagal) |

Kalau AI sedang tidak bisa dipakai, tombol **Catat manual** membuka formulir
yang sama untuk diisi tangan.

**Umur foto: 1 bulan.** Setelah bulannya lewat, foto tidak dihapus begitu
saja — muncul spanduk di tab Nota (dan angka merah kecil di ikon tabnya)
yang menawarkan mengunduh `nota-2026-07.zip` berisi seluruh fotonya +
`daftar.csv`. Foto baru dilepas dari penyimpanan **setelah** ZIP-nya
terunduh. Baris notanya sendiri tetap tersimpan selamanya.

Cara memasang kunci AI dan bot Telegram ada di **PANDUAN-DEPLOY.md bagian E**.

## Catatan hasil pemeriksaan file Numbers

Semua total per karyawan Januari–Juni **sama persis** dengan file Numbers.

**Natanael Montolalu (Manager) tidak disertakan** dalam penggajian sesuai
permintaan — baik di data Jan–Juni maupun di daftar karyawan. Namanya tetap
dipakai sebagai penanda tangan slip; ubah di *Kelola → Pengaturan* bila perlu.

Satu hal yang berbeda dari file Numbers, karena rumusnya keliru di sana:
**Gracia Rumengan tidak ikut dijumlah di total Juni** — rumus `SUM(X3:X8)`
berhenti di baris 8, sedangkan Gracia ada di baris 9. Totalnya jadi:

| Bulan   | Total di Numbers | Total di aplikasi |
|---------|------------------|-------------------|
| Januari | 21.874.500       | 18.074.500        |
| Februari| 21.518.500       | 17.718.500        |
| Maret   | 21.977.000       | 18.177.000        |
| April   | 18.205.500       | 18.205.500 ✓      |
| Mei     | 17.792.500       | 17.792.500 ✓      |
| Juni    | 20.082.500       | **21.782.500**    |
| Juli    | 19.164.000       | **20.914.000**    |

Jan–Maret turun tepat Rp 3.800.000/bulan karena gaji Manager dikeluarkan.
April & Mei sudah sama persis — di file Numbers gaji Manager memang tidak
ikut terhitung di dua bulan itu (rumusnya kosong). Juni & Juli naik
Rp 1.700.000/1.750.000 karena Gracia kini ikut dijumlah.

Angka **per karyawan** semuanya cocok persis di ketujuh bulan.

Catatan kecil lain: nama *Airin Kosman* (Jan–Mei) dan *Ayrin Kosman* (Juni)
disatukan memakai ejaan terbaru, **Ayrin Kosman**. Ubah di *Kelola → Karyawan* kalau
ejaan yang benar berbeda.

## Data & cadangan

Ada dua mode, aplikasinya menyesuaikan sendiri:

- **Mode lokal** (bawaan) — data hanya di perangkat yang dipakai. Aktif selama
  `js/firebase-config.js` masih kosong.
- **Mode tersinkron** — setelah Firebase diisi dan Anda masuk, data otomatis
  sama di semua perangkat. Tetap bisa dipakai offline; perubahan menyusul saat
  online lagi. Statusnya terlihat di pojok kiri bawah (desktop) atau tepat di
  atas tab bar (HP).

Sekalipun sudah tersinkron, sesekali tekan **Kelola → Pengaturan → Unduh
cadangan** setelah tutup buku bulanan — itu jaring pengaman di luar cloud.
**Kembalikan data awal** menghapus semua perubahan dan kembali ke Jan–Juli 2026.

## Isi folder

```
index.html                  aplikasi pemilik
lapor.html                  aplikasi karyawan ("Performance Bonus LovePet")
css/styles.css               tampilan aplikasi pemilik (+ aturan cetak A4)
css/lapor.css                tampilan tambahan khusus lapor.html
js/data.js                   komponen bonus, tarif, rumus, data Jan–Juli 2026
js/app.js                    logika aplikasi pemilik: input, slip, rekap
js/cloud.js                  sinkronisasi Firebase aplikasi pemilik (opsional)
js/provisioning.js           pemilik membuat akun login karyawan
js/lapor.js                  logika aplikasi karyawan
js/nota.js                   pencatatan pengeluaran: unggah nota, arsip ZIP, cetak
functions/_lib/gemini.js     pembacaan foto nota oleh AI (jalan di server Cloudflare)
functions/api/nota.js        endpoint untuk tombol "Unggah nota"
functions/api/telegram.js    webhook bot Telegram
js/firebase-config.js        ← isi ini untuk mengaktifkan sinkronisasi & lapor.html
firestore.rules              aturan keamanan database — wajib dipasang
manifest.webmanifest         agar index.html bisa dipasang di Home Screen
manifest-lapor.webmanifest   agar lapor.html bisa dipasang di Home Screen
sw.js                        agar kedua aplikasi tetap terbuka tanpa internet
_headers                      header keamanan (dibaca Cloudflare)
wrangler.jsonc                konfigurasi Worker "lovepetcrew" — berkas statis + /api/*
worker.js                     titik masuk Worker: merutekan /api/* , sisanya berkas statis
.assetsignore                 berkas yang TIDAK ikut disajikan publik (functions/, .git, dst.)
PANDUAN-DEPLOY.md            langkah GitHub → Firebase → Cloudflare
```

Untuk menambah/mengubah karyawan tidak perlu menyentuh kode — pakai
**Kelola → Karyawan**. Kode hanya perlu diubah kalau ada jenis bonus yang benar-benar baru.
