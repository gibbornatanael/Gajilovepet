# Panduan Memasang Aplikasi di Internet

Tujuannya: aplikasi bisa dibuka dari **iPhone dan MacBook**, dengan **angka
yang selalu sama** di keduanya.

Ada tiga bagian. Kerjakan berurutan — total sekitar 30–40 menit.

```
  A. GitHub        → menyimpan kode
  B. Firebase      → menyimpan data (supaya iPhone & MacBook sinkron)
  C. Cloudflare    → menyajikan aplikasi ke internet
```

---

## Jawaban singkat: apakah perlu Firebase?

**Ya, kalau ingin data sama di iPhone dan MacBook.**

Cloudflare Pages hanya menyajikan berkas (HTML/CSS/JS) — ia tidak menyimpan
data. Tanpa database, setiap perangkat menyimpan datanya sendiri di dalam
browser; input di MacBook tidak akan muncul di iPhone.

Firebase mengisi bagian yang hilang itu. Untuk skala klinik ini (7 karyawan ×
12 bulan ≈ beberapa KB), pemakaiannya jauh di bawah batas gratis Firebase —
praktis tidak akan pernah ditagih.

> Kalau Anda memutuskan cukup satu perangkat saja, lewati **bagian B**.
> Aplikasi tetap berjalan penuh dalam mode lokal; cukup rutin pakai
> **Kelola → Pengaturan → Unduh cadangan**.

---

## A. Menaruh kode di GitHub

> ⚠️ **Buat repository PRIVATE.** Berkas `js/data.js` berisi gaji asli
> karyawan Anda. Repository publik berarti siapa pun bisa membacanya.

1. Buka <https://github.com/new>
2. **Repository name**: `gaji-love-pet` · pilih **Private** · jangan centang
   apa pun · tekan **Create repository**
3. Di MacBook, buka **Terminal**, lalu jalankan baris berikut satu per satu
   (ganti `USERNAME` dengan nama akun GitHub Anda):

```bash
cd ~/Documents/"Slip Gaji Love pet app"
git init
git add .
git commit -m "Aplikasi gaji LOVE Pet Clinic"
git branch -M main
git remote add origin https://github.com/USERNAME/gaji-love-pet.git
git push -u origin main
```

Berkas `.numbers` tidak ikut terkirim — sudah dikecualikan lewat `.gitignore`.

Untuk mengirim perubahan berikutnya:

```bash
cd ~/Documents/"Slip Gaji Love pet app"
git add . && git commit -m "perubahan bulan ini" && git push
```

---

## B. Firebase — supaya iPhone & MacBook sinkron

### B1. Buat project

1. Buka <https://console.firebase.google.com> → **Create a project**
2. Nama: `gaji-love-pet` → **Continue**
3. Google Analytics: **matikan** (tidak perlu) → **Create project**

### B2. Aktifkan login

1. Menu kiri **Build → Authentication** → **Get started**
2. Tab **Sign-in method** → pilih **Email/Password** → nyalakan sakelar
   pertama → **Save**

### B3. Aktifkan database

1. Menu kiri **Build → Firestore Database** → **Create database**
2. Pilih lokasi **asia-southeast1 (Singapore)** — paling dekat dari Indonesia
3. Pilih **Start in production mode** → **Create**

### B4. Pasang aturan keamanan ⚠️ jangan dilewati

1. Masuk ke tab **Rules** di halaman Firestore
2. Hapus seluruh isinya, ganti dengan isi berkas **`firestore.rules`**
   yang ada di folder ini
3. Tekan **Publish**

Tanpa langkah ini, data gaji bisa dibaca orang lain.

### B5. Salin konfigurasi ke aplikasi

1. Ikon gerigi ⚙️ (kiri atas) → **Project settings**
2. Gulir ke bawah sampai **Your apps** → tekan ikon web **`</>`**
3. App nickname: `gaji` → **Register app**
4. Akan muncul blok `const firebaseConfig = { ... }` — salin isinya
5. Buka berkas **`js/firebase-config.js`** di folder ini, isikan nilainya:

```js
window.FIREBASE_CONFIG = {
  apiKey: 'AIza…',
  authDomain: 'gaji-love-pet.firebaseapp.com',
  projectId: 'gaji-love-pet',
  storageBucket: 'gaji-love-pet.appspot.com',
  messagingSenderId: '1234567890',
  appId: '1:1234567890:web:abcdef',
};
```

6. Simpan, lalu kirim ke GitHub:
   `git add . && git commit -m "aktifkan firebase" && git push`

> Nilai-nilai di atas memang boleh terlihat publik — itu memang rancangannya.
> Yang menjaga data Anda adalah **aturan di langkah B4 + login**.

### B6. Buat akun Anda

Setelah aplikasi online (bagian C), buka aplikasinya → akan muncul layar masuk
→ isi email & kata sandi → tekan **Buat akun baru**. Cukup sekali.
Di iPhone, masuk dengan email dan kata sandi yang **sama** — datanya langsung
mengikuti.

### B7. (Opsional) Aktifkan laporan karyawan — lapor.html

Begitu B1–B6 selesai, halaman **lapor.html** ("Performance Bonus LovePet")
otomatis ikut aktif — pakai Firestore yang sama, tidak perlu setup terpisah.

1. Di aplikasi utama: **Kelola → Karyawan** → pilih karyawan → isi **Cabang**
   → di bagian **Akun login**, isi nama pengguna + kata sandi awal → tekan
   **Buat akun login**.
2. Bagikan alamat `.../lapor.html` + nama pengguna & sandi ke karyawan
   tersebut (lewat WhatsApp, dsb).
3. Karyawan bisa langsung memakainya. Sarankan mereka **Bagikan → Add to
   Home Screen** juga.

Foto bukti disimpan langsung di Firestore (dikompresi kecil), **bukan**
Firebase Storage — jadi tidak perlu paket Blaze / kartu kredit untuk fitur
ini.

> **Catatan index database:** pertama kali karyawan membuka tab **Capaian**,
> atau Anda menekan **Tarik laporan karyawan**, Firestore mungkin menampilkan
> pesan *"The query requires an index"* di Console browser (tekan F12 untuk
> melihatnya). Ini normal untuk sekali pertama — klik tautan biru di pesan
> itu, akan terbuka Firebase Console dengan index sudah terisi, tinggal tekan
> **Create**. Tunggu ±1 menit, lalu coba lagi. Setelah itu tidak akan muncul
> lagi.

---

## C. Cloudflare Pages

1. Buka <https://dash.cloudflare.com> → menu **Workers & Pages** →
   **Create** → tab **Pages** → **Connect to Git**
2. Hubungkan akun GitHub, pilih repository `gaji-love-pet`
3. Isi pengaturan build:

   | Kolom | Isi |
   |---|---|
   | Framework preset | **None** |
   | Build command | *(kosongkan)* |
   | Build output directory | `/` |

   Aplikasi ini HTML/CSS/JS biasa — tidak perlu proses build sama sekali.
4. **Save and Deploy**. Selesai dalam ±1 menit.
5. Alamatnya akan seperti `https://gaji-love-pet.pages.dev`

Setiap kali Anda `git push`, Cloudflare otomatis menerbitkan versi terbaru.

### Kalau memakai Firebase, tambahkan domain ini

Firebase menolak login dari alamat yang tidak dikenal:

1. Firebase Console → **Authentication → Settings → Authorized domains**
2. **Add domain** → masukkan `gaji-love-pet.pages.dev`
   (dan domain sendiri, kalau nanti Anda pasang)

---

## D. Memasang di iPhone & MacBook

**iPhone (Safari)**
1. Buka alamat `.pages.dev` tadi
2. Tekan tombol Bagikan ⬆️ → **Add to Home Screen** → **Add**
3. Ikonnya muncul di layar utama dan terbuka layar penuh, tanpa address bar

**MacBook (Safari)**
1. Buka alamatnya → menu **File → Add to Dock**

Aplikasi tetap bisa dibuka **tanpa internet** (service worker menyimpan
salinannya), dan perubahan yang Anda buat saat offline akan menyusul
tersinkron begitu kembali online.

---

## Kalau ada masalah

| Gejala | Penyebab & solusi |
|---|---|
| Layar masuk tidak muncul | `js/firebase-config.js` masih kosong → aplikasi sengaja jalan mode lokal |
| “auth/unauthorized-domain” | Domain belum didaftarkan — ulangi bagian C paling bawah |
| “Missing or insufficient permissions” | Aturan Firestore belum dipasang — ulangi **B4** |
| Data iPhone ≠ MacBook | Pastikan keduanya masuk dengan **email yang sama**; cek tulisan status di menu Kelola |
| Versi lama masih muncul setelah push | Tutup aplikasi lalu buka lagi. Kalau masih, naikkan angka `VERSI` di `sw.js` lalu push |
| Ingin mundur ke keadaan sebelumnya | Cloudflare Pages → **Deployments** → pilih versi lama → **Rollback** |
| “The query requires an index” di lapor.html / saat Tarik laporan | Normal sekali di awal — klik tautan di pesan error (F12 → tab Console), tekan Create di Firebase Console, tunggu ±1 menit |
| Karyawan: “Akun ini belum terhubung ke data karyawan” | Akun dibuat tapi Kelola → Karyawan belum sempat tersinkron — buka aplikasi pemilik sebentar (memicu sinkron), lalu karyawan coba masuk lagi |
| Kamera tidak terbuka saat tekan tombol lapor | Sebagian browser desktop membuka jendela pilih berkas biasa (bukan kamera) — ini normal, kamera asli hanya muncul di HP |

---

## Rencana berikutnya (karyawan ikut memakai)

**Sudah berjalan:** karyawan bisa login di `lapor.html` dan melaporkan
performa sendiri (Lembur, Rawat Inap, Styling, Operasi) dengan foto bukti —
lihat bagian **B7** di atas dan bagian "Karyawan melapor sendiri" di README.

Struktur yang dipakai:

```
klinik/lovepet/karyawan/{empId}                      → profil + authUid (dibuat pemilik)
klinik/lovepet/laporan/{empId}_{tanggal}_{kategori}   → satu laporan performa
```

**Belum ada, jadi PR berikutnya:** fitur **absen** (jam masuk/pulang).
Ikuti pola yang sama — tambah koleksi baru, jangan bongkar yang sudah ada:

```
klinik/lovepet/absen/{empId}_{tanggal}   → jam masuk, jam pulang, status
```

Beri hak akses serupa `laporan` di `firestore.rules` (karyawan hanya tulis
miliknya sendiri, pemilik baca/tulis semua), lalu tambah tab ketiga
("Absen") di `lapor.html` di samping *Lapor* dan *Capaian*. `js/lapor.js`
sudah punya semua utilitas yang dibutuhkan (auth karyawan, profil, tanggal
ISO) — tinggal disambung.
