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

### B8. Slip gaji & chat karyawan

Ikut aktif otomatis begitu B1–B7 selesai — **tidak ada setup tambahan**,
memakai Firestore yang sama. Yang perlu diperhatikan hanya dua hal:

1. **Aturan keamanan harus versi terbaru.** Kalau Anda memasang
   `firestore.rules` sebelum Agustus 2026, pasang ulang isinya (langkah
   **B4**) — di dalamnya ada aturan baru untuk koleksi `slip` dan `chat`.
   Tanpa itu, karyawan akan melihat "Gagal memuat slip gaji".
2. **Karyawan harus punya akun login** (langkah B7). Tombol **Setujui &
   kirim** di tab Slip Gaji akan menolak kalau karyawannya belum punya akun,
   dan mengatakan begitu.

Cara memakainya sehari-hari ada di README bagian *"Karyawan mengambil slip
gajinya sendiri"*.

**Supaya HP Anda berbunyi saat ada pesan masuk:** angka merah di dalam
aplikasi selalu jalan tanpa setup apa pun. Untuk bunyi notifikasi sungguhan,
cukup pastikan **bot Telegram sudah aktif** (bagian **E3** di bawah) —
pesan karyawan otomatis diteruskan ke grup Telegram yang sama lewat
`/api/notify`, memakai secret yang sudah ada (`TELEGRAM_BOT_TOKEN`,
`TELEGRAM_CHAT_ID`, `FIREBASE_API_KEY`). Tidak ada secret baru yang perlu
dipasang. Kalau bot-nya belum ada, yang hilang hanya bunyinya — pesannya
tetap tersimpan dan tetap muncul di aplikasi.

---

## C. Cloudflare

> **Catatan (Agustus 2026):** project yang benar-benar melayani situs ini
> adalah **Worker** bernama **`lovepetcrew`** (Compute → Workers & Pages →
> lovepetcrew), memakai `npx wrangler deploy` — bukan Cloudflare **Pages**.
> Kalau Anda mendirikan project baru, pilih **Workers**, bukan Pages, dan
> ikuti langkah di bawah. Repo ini menyertakan `wrangler.jsonc` + `worker.js`
> yang mengatur berkas apa saja yang disajikan sebagai situs statis dan
> merutekan `/api/nota` & `/api/telegram` (lihat **bagian E**) — kedua
> berkas itu WAJIB ikut di-push, wrangler membacanya otomatis saat deploy.

1. Buka <https://dash.cloudflare.com> → **Compute (Workers)** → **Workers & Pages**
   → **Create** → **Workers** → **Connect to Git**
2. Hubungkan akun GitHub, pilih repository ini
3. Build command boleh dikosongkan — `wrangler.jsonc` di repo yang menentukan
   semuanya (nama Worker, berkas mana yang statis, `worker.js` sebagai
   penangan `/api/*`)
4. **Save and Deploy**. Selesai dalam ±1 menit.
5. Alamatnya akan seperti `https://lovepetcrew.<akun-anda>.workers.dev`,
   atau domain kustom kalau sudah dipasang (**Settings → Domains**)

Setiap kali Anda `git push`, Cloudflare otomatis menerbitkan versi terbaru.

### Kalau memakai Firebase, tambahkan domain ini

Firebase menolak login dari alamat yang tidak dikenal:

1. Firebase Console → **Authentication → Settings → Authorized domains**
2. **Add domain** → masukkan alamat `.workers.dev` (atau domain kustom) Anda

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

## E. Pencatatan Pengeluaran (foto nota dibaca AI)

Bagian ini mengaktifkan tab **Nota**. Aplikasi tetap jalan tanpanya — kalau
langkah di bawah dilewati, tab Nota masih bisa dipakai lewat tombol
**"Catat manual"**, hanya pembacaan otomatisnya yang mati.

### E1. Ambil kunci AI (gratis, tanpa kartu kredit)

1. Buka <https://aistudio.google.com/apikey> → masuk dengan akun Google
2. **Create API key** → pilih project mana saja → salin kuncinya
   (bentuknya seperti `AIza…`, panjang ~39 huruf)
3. Simpan sementara di Notes. Kunci ini **jangan** ditaruh di dalam kode —
   tempatnya di Cloudflare, langkah berikutnya.

Kuota gratisnya jauh lebih dari cukup untuk klinik (ratusan nota per hari).

### E2. Pasang kunci di Cloudflare

⚠️ Project ini adalah **Worker** (`lovepetcrew`), bukan Pages — tempatnya
**bukan** di Settings → Build → "Variables and secrets" (kotak itu hanya
dibaca saat proses *build*, bukan saat `/api/nota` benar-benar dipanggil).

**Cara paling gampang — lewat Terminal** (terbukti jalan, dialog dashboard
"Add binding → Secrets Store" sering membingungkan/tidak tersimpan):

```
cd "/Users/gibbornatanael/Documents/Slip Gaji Love pet app"
npx wrangler login          # sekali saja, kalau belum pernah
npx wrangler secret put GEMINI_API_KEY
```

Saat diminta, tempel kunci dari **E1** (teks yang diketik tidak akan
terlihat di layar — itu normal), lalu Enter. Muncul `✨ Success!` berarti
sudah aktif — tidak perlu `git push` atau deploy ulang, secret langsung
terpasang ke Worker `lovepetcrew` yang sedang jalan.

<details>
<summary>Alternatif lewat dashboard (kalau lebih suka tanpa Terminal)</summary>

Cloudflare → **Workers & Pages** → **lovepetcrew** → tab **Bindings** →
**Add binding** → **Secrets Store** → **Add Binding** → di form yang
muncul, kalau nilainya belum ada klik **Create secret** dulu (isi *Secret
name* + *Value*), lalu di form binding isi **Variable name** persis
`GEMINI_API_KEY` dan **Secret name** pilih yang baru dibuat → **Save**.
Kalau setelah disimpan "Connected Bindings" tetap kosong, jangan buang
waktu berulang — langsung pakai cara Terminal di atas, hasilnya sama.
</details>

Sesudah ini tombol **Unggah nota** di aplikasi sudah berfungsi. Cara
memastikannya benar: buka `https://lovepetcrew.<akun-anda>.workers.dev/api/nota`
langsung di browser — harus muncul `{"error":"Gunakan POST"}` (tanda
endpoint-nya hidup), bukan halaman 404.

### E3. Bot Telegram (opsional, tapi enak dipakai)

1. Di Telegram, cari **@BotFather** → `/newbot` → beri nama & username
   (harus berakhiran `bot`, mis. `notalovepet_bot`). BotFather membalas
   dengan **token** — salin.
2. Buat grup baru, masukkan bot itu ke dalamnya.
3. Masih di BotFather: `/setprivacy` → pilih bot Anda → **Disable**.
   Tanpa ini bot tidak melihat foto yang dikirim di grup.
4. Pasang tujuh secret berikut lewat Terminal (cara sama seperti **E2** —
   `npx wrangler secret put NAMA`, satu per satu, tempel nilainya saat
   diminta):

| Perintah | Tempel sebagai nilainya |
|---|---|
| `npx wrangler secret put TELEGRAM_BOT_TOKEN` | token dari BotFather |
| `npx wrangler secret put TELEGRAM_SECRET` | kata rahasia karangan Anda, mis. `lovepet-rahasia-2026` |
| `npx wrangler secret put TELEGRAM_CHAT_ID` | isi sementara `0`, diperbaiki di langkah 6 |
| `npx wrangler secret put FIREBASE_API_KEY` | salin `apiKey` dari `js/firebase-config.js` |
| `npx wrangler secret put FIREBASE_PROJECT_ID` | `gajilovepet` |
| `npx wrangler secret put OWNER_EMAIL` | email yang Anda pakai masuk ke aplikasi |
| `npx wrangler secret put OWNER_PASSWORD` | kata sandinya |

5. Sambungkan bot ke aplikasi. Buka alamat ini sekali di browser
   (ganti `TOKEN`, `ALAMAT-WORKER`, dan `RAHASIA` sesuai punya Anda —
   `ALAMAT-WORKER` adalah alamat `lovepetcrew.<akun-anda>.workers.dev` atau
   domain kustom Anda):

   ```
   https://api.telegram.org/botTOKEN/setWebhook?url=https://ALAMAT-WORKER/api/telegram&secret_token=RAHASIA
   ```

   Balasannya harus `{"ok":true,…}`.

6. Di grup, ketik `/id`. Bot membalas id grupnya (angka negatif, mis.
   `-1001234567890`). Ubah Secret `TELEGRAM_CHAT_ID` di Cloudflare menjadi
   angka itu, **Save**, lalu **Retry deployment**. Ini yang mencegah orang
   lain memakai bot Anda.

**Cara pakai:** forward atau kirim foto nota ke grup → bot membalas
ringkasannya + empat tombol status → tekan satu → bot menjawab
"✅ Tersimpan". Notanya langsung muncul di tab Nota aplikasi.

### E4. Tentang keamanan sandi pemilik

`OWNER_PASSWORD` dipakai supaya bot bisa menulis atas nama Anda — dengan
begitu `firestore.rules` tidak perlu dilonggarkan sama sekali. Sandi itu
tersimpan sebagai **Secret** di Cloudflare (terenkripsi, tidak bisa dibaca
lagi setelah disimpan, tidak ikut ke GitHub) dan tidak pernah dikirim ke
Telegram maupun ke browser. Kalau suatu saat Anda ganti sandi aplikasi,
perbarui juga Secret ini.

### E5. Arsip foto bulanan

Foto nota disimpan penuh selama **bulan berjalan + bulan sebelumnya belum
diarsipkan**. Begitu bulannya lewat, di tab Nota muncul spanduk hijau dan
angka merah kecil di ikon tab:

> **Foto nota Juli 2026 siap diarsipkan** — 23 foto… **[Unduh ZIP]**

Menekannya mengunduh `nota-2026-07.zip` (berisi semua fotonya + `daftar.csv`)
**lalu baru** melepas foto itu dari Firestore. Jadi tidak ada foto yang hilang
tanpa salinan. Baris notanya sendiri — tanggal, toko, total, rincian barang —
tetap tersimpan selamanya dan tetap ikut tercetak di PDF.

Simpan ZIP-nya di iCloud/Drive supaya aman.

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
| Nota: “AI tidak bisa membaca — silakan isi manual” | `GEMINI_API_KEY` belum diisi atau salah ketik (lihat **E2**), atau kuota harian habis. Formulirnya tetap terbuka, jadi bisa diisi tangan |
| Bot Telegram diam saja saat difoto | Privacy mode masih aktif → BotFather `/setprivacy` → **Disable** (**E3** langkah 3), lalu keluarkan & masukkan lagi botnya ke grup |
| Bot menjawab “Grup ini belum diizinkan” | `TELEGRAM_CHAT_ID` belum diperbarui — salin angka yang disebut bot ke Secret itu, Save, Retry deployment (**E3** langkah 6) |
| Bot menjawab “Login Firebase gagal” | `OWNER_EMAIL` / `OWNER_PASSWORD` salah, atau sandi aplikasi baru diganti tanpa memperbarui Secret-nya |
| Nota dari Telegram tidak muncul di aplikasi | Tarik layar untuk memuat ulang; kalau tetap kosong cek `FIREBASE_PROJECT_ID` sudah `gajilovepet` |

---

## Rencana berikutnya (karyawan ikut memakai)

**Sudah berjalan:** karyawan bisa login di `lapor.html` untuk melaporkan
performa sendiri (Lembur, Rawat Inap, Styling, Operasi) dengan foto bukti,
**mengambil slip gajinya sendiri**, dan **chat dengan Anda** — lihat bagian
**B7** dan **B8** di atas serta README.

Struktur yang dipakai:

```
klinik/lovepet/karyawan/{empId}                      → profil + authUid (dibuat pemilik)
klinik/lovepet/laporan/{empId}_{tanggal}_{kategori}   → satu laporan performa
klinik/lovepet/slip/{empId}_{periode}                 → slip yang sudah disetujui (snapshot)
klinik/lovepet/chat/{empId}                           → ringkasan ruang percakapan
klinik/lovepet/chat/{empId}/pesan/{id}                → tiap gelembung chat
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






