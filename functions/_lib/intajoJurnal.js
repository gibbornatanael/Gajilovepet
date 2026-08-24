/* =========================================================================
   functions/_lib/intajoJurnal.js — pembuatan JURNAL di intajo.com
   -------------------------------------------------------------------------
   TUJUAN AKHIR: nota yang sudah dibaca AI (lihat gemini.js) tidak perlu
   diketik ulang ke intajo — aplikasi ini yang membuat jurnalnya.

   TAHAP SEKARANG: PENELUSURAN, belum ada penulisan sungguhan.
   Alasannya: berbeda dari Neraca/Posting yang endpoint-nya sudah ketahuan
   pasti, formulir jurnal intajo belum pernah dibedah. Menebak nama field
   lalu mengirimnya = berisiko membuat jurnal ngawur di pembukuan
   sungguhan, dan jurnal tidak semudah itu dihapus.

   Maka berkas ini MENEMUKAN SENDIRI bentuk formulirnya, tanpa menyuruh
   pemilik berburu di DevTools:
       1. login (kredensial = secret Cloudflare, sama seperti berkas intajo lain)
       2. ambil HTML halaman, kumpulkan semua tautan yang berbau jurnal
       3. buka tiap calon halaman, bongkar formulirnya: nama input, nama
          select, beserta SELURUH pilihan tiap select — di sinilah
          "transaction list" (penentu ledger) akan kelihatan
       4. laporkan apa adanya ke layar Jurnal

   Sesudah hasil penelusuran terbaca, barulah buatJurnal() di bawah diisi
   dengan nama field yang benar — bukan hasil tebakan.
   ========================================================================= */
import { CABANG, login, ambilSessionCookie } from './intajoScraper.js';

const BASE = 'https://intajo.com';

/* ---- ganti cabang: pola & jebakan yang sama dengan intajoNeraca.js ----
   perubahan cabang baru berlaku pada permintaan BERIKUTNYA, jadi selalu
   ada satu halaman jeda sesudahnya. */
async function gantiCabang(cookie, branchId) {
  const res = await fetch(`${BASE}/secureAPI/branch/change/${branchId}`, {
    headers: { Cookie: cookie, Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
  });
  if (!res.ok) throw new Error('Gagal ganti cabang intajo (' + res.status + ')');
  const j = await res.json().catch(() => ({}));
  if (j.message !== 'Ok') throw new Error('Ganti cabang ditolak intajo: ' + JSON.stringify(j));
  return ambilSessionCookie(res) || cookie;
}

/* Kata yang menandai alamat AKSI, bukan halaman. intajo menjalankan
   sebagian aksinya lewat GET biasa: membuka
   /finaccounting/journal-delete/{id} langsung me-reject jurnal itu —
   ini bukan dugaan, sudah terjadi: 8 jurnal di Journal Pending ter-reject
   karena penjelajah versi lama membuka tiap tautan yang ditemukannya.
   Penjaga di bawah membuat kejadian itu mustahil terulang walau ada yang
   memanggil ambilHalaman() dengan alamat sembarangan. */
const KATA_AKSI = /(delete|remove|reject|authorize|approve|void|cancel|process|signoff|sign-off|post)/i;

function pastikanAman(path) {
  if (!DAFTAR_PUTIH.includes(path)) {
    throw new Error(`Alamat "${path}" tidak ada di daftar putih intajoJurnal.js — ditolak.`);
  }
  if (KATA_AKSI.test(path)) {
    throw new Error(`Alamat "${path}" mengandung kata aksi — ditolak.`);
  }
}

async function ambilHalaman(cookie, path) {
  pastikanAman(path);
  const res = await fetch(BASE + path, { headers: { Cookie: cookie, Accept: 'text/html' } });
  const html = res.ok ? await res.text() : '';
  return { status: res.status, html, cookie: ambilSessionCookie(res) || cookie };
}

/* ======================= pembongkar HTML sederhana =======================
   Worker tidak punya DOM parser, dan proyek ini sengaja tanpa pustaka
   tambahan (lihat catatan di intajoNeraca.js soal PDF). Regex di bawah
   cukup untuk formulir server-rendered gaya intajo. */

const judulHalaman = (html) => (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').trim();

/* uuid ledger — dipastikan bentuknya sebelum ikut dikirim ke intajo,
   supaya tidak ada nilai sembarangan yang lolos ke formulir. */
const POLA_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ambilNilaiInput = (html, nama) => {
  const m = html.match(new RegExp(`<input[^>]*name="${nama}"[^>]*>`, 'i'));
  const v = m && m[0].match(/value="([^"]*)"/i);
  return v ? v[1] : null;
};

function daftarInput(html) {
  const hasil = [];
  for (const m of html.matchAll(/<input\b[^>]*>/gi)) {
    const tag = m[0];
    const nama = tag.match(/name="([^"]*)"/i)?.[1];
    if (!nama) continue;
    const tipe = (tag.match(/type="([^"]*)"/i)?.[1] || 'text').toLowerCase();
    // Nilai csrf_token sengaja TIDAK ikut dikembalikan — ia milik sesi
    // Worker, tak ada gunanya di browser (pola sama dengan intajo-proses.js).
    const nilai = nama === 'csrf_token' ? '(disembunyikan)' : (tag.match(/value="([^"]*)"/i)?.[1] || '');
    hasil.push({ nama, tipe, nilai });
  }
  return hasil;
}

/* Inilah bagian yang menjawab pertanyaan "transaction list itu apa isinya":
   tiap <select> dikembalikan lengkap dengan value + labelnya, karena
   value itulah yang nanti menentukan ledger mana yang kena. */
function daftarSelect(html) {
  const hasil = [];
  for (const m of html.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/gi)) {
    const nama = m[1].match(/name="([^"]*)"/i)?.[1];
    if (!nama) continue;
    const pilihan = [];
    for (const o of m[2].matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/gi)) {
      const value = o[1].match(/value="([^"]*)"/i)?.[1] ?? '';
      const label = o[2].replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
      if (value === '' && !label) continue;
      pilihan.push({ value, label });
    }
    hasil.push({ nama, jumlahPilihan: pilihan.length, pilihan: pilihan.slice(0, 200) });
  }
  return hasil;
}

function daftarForm(html) {
  const hasil = [];
  for (const m of html.matchAll(/<form\b([^>]*)>/gi)) {
    hasil.push({
      action: m[1].match(/action="([^"]*)"/i)?.[1] || '(halaman itu sendiri)',
      method: (m[1].match(/method="([^"]*)"/i)?.[1] || 'GET').toUpperCase(),
    });
  }
  return hasil;
}

/* Select yang isinya diambil lewat AJAX datang kosong di HTML. Kalau itu
   terjadi, alamat AJAX-nya biasanya tertulis di <script> halaman yang sama
   — dikumpulkan di sini supaya penelusuran tidak buntu. */
function alamatDiSkrip(html) {
  const ketemu = new Set();
  for (const m of html.matchAll(/["'`](\/[a-z][^"'`\s<>]*)["'`]/gi)) {
    const a = m[1];
    if (/^\/(secureAPI|api|API)\//.test(a) || /(journal|jurnal|ledger|transaction)/i.test(a)) ketemu.add(a);
  }
  return [...ketemu].slice(0, 40);
}

/* Potongan JavaScript di sekitar sebuah kata kunci.

   Dipakai karena mengetahui ALAMAT saja ternyata tidak cukup: skrip
   halaman Journal Create menyebut "/secureAPI/transactionlist/get/"
   tanpa uuid, lalu menambahkan sendiri entah apa. Menebak lanjutannya
   sudah dicoba dan salah (jawabannya selalu []), jadi lebih baik membaca
   kodenya langsung — di situ terlihat metodenya, parameternya, dan
   bentuk jawaban yang diharapkan. */
function cuplikanSkrip(html, kata) {
  const hasil = [];
  let dari = 0;
  for (let i = 0; i < 3; i++) {
    const pos = html.indexOf(kata, dari);
    if (pos === -1) break;
    hasil.push(html.slice(Math.max(0, pos - 500), pos + 900));
    dari = pos + kata.length;
  }
  return hasil;
}

function bongkarHalaman(path, status, html) {
  return {
    path, status,
    judul: judulHalaman(html),
    form: daftarForm(html),
    input: daftarInput(html),
    select: daftarSelect(html),
    alamatSkrip: alamatDiSkrip(html),
    // Bagian yang paling menentukan sekarang: bagaimana baris ledger diisi.
    skripTransactionlist: cuplikanSkrip(html, 'transactionlist'),
    skripLedger: cuplikanSkrip(html, 'det_trans_led'),
  };
}

/* =========================== Penelusuran ===========================
   HANYA membuka alamat yang ada di daftar putih di bawah. TIDAK memungut
   tautan dari halaman lalu membukanya sendiri — itu pernah dilakukan
   versi sebelumnya dan berbahaya.

   Sebabnya: intajo menjalankan sebagian aksinya lewat GET biasa (tombol
   roda gigi di tiap baris jurnal menuju alamat, bukan formulir POST).
   Penjelajah yang membuka semua tautan berbau "journal" karena itu BISA
   menjalankan aksi — reject, remove — tanpa pernah bermaksud begitu.
   Andaian "GET selalu aman" berlaku di aplikasi yang taat HTTP; intajo
   tidak boleh diandaikan begitu.

   Menambah alamat ke DAFTAR_PUTIH harus diperiksa manusia dulu:
   pastikan itu halaman formulir atau daftar, BUKAN alamat aksi. */
const DAFTAR_PUTIH = [
  '/dashboard',                      // halaman jeda sesudah ganti cabang
  '/finaccounting/journal-create',   // formulir Journal Create (alamat dipastikan pemilik dari address bar)
];

export async function telusuriJurnal(email, password, kunciCabang) {
  const cabang = CABANG[kunciCabang];
  if (!cabang) throw new Error('Cabang tidak dikenal: ' + kunciCabang);

  let cookie = await login(email, password);
  cookie = await gantiCabang(cookie, cabang.id);
  // Satu halaman jeda supaya ganti cabang berlaku (lihat intajoNeraca.js).
  cookie = (await ambilHalaman(cookie, '/dashboard')).cookie;

  const halaman = [];
  for (const path of DAFTAR_PUTIH) {
    const r = await ambilHalaman(cookie, path);
    cookie = r.cookie;
    halaman.push(bongkarHalaman(path, r.status, r.html));
  }
  return { cabang: cabang.nama, diperiksa: DAFTAR_PUTIH, halaman };
}

/* ======================= Daftar Transaction List =======================
   Dipakai layar Jurnal supaya kode transaksi bisa DIPILIH dari dropdown,
   bukan diketik dari ingatan.

   Tidak ada alamat yang di-hardcode di sini: daftarnya dicari dengan
   menelusuri halaman seperti di atas, lalu diambil <select> yang isinya
   paling banyak berbentuk "KODE - Keterangan" (mis. "SEW - pembayaran
   sewa"). Pola itu ciri khas Transaction List intajo dan tidak dipakai
   dropdown lain di halaman yang sama. Jadi kalau intajo memindahkan
   halamannya, fungsi ini masih menemukannya sendiri. */
const POLA_KODE = /^([A-Z0-9]{2,6})\s*-\s*(.+)$/;

export async function ambilDaftarTransaksi(email, password, kunciCabang) {
  const { halaman } = await telusuriJurnal(email, password, kunciCabang);

  let terbaik = null;
  for (const h of halaman) {
    for (const sel of h.select || []) {
      if (sel.nama === 'userMenu_branch') continue;   // pemilih cabang, bukan transaksi
      const cocok = sel.pilihan.filter((p) => p.value && POLA_KODE.test(p.label));
      if (cocok.length >= 3 && (!terbaik || cocok.length > terbaik.cocok.length)) {
        terbaik = { path: h.path, field: sel.nama, cocok };
      }
    }
  }
  if (!terbaik) {
    throw new Error('Transaction List tidak ketemu di halaman jurnal intajo — ' +
      'coba tombol "Telusuri formulir intajo" untuk melihat apa yang sebenarnya terbaca.');
  }

  return {
    path: terbaik.path,
    field: terbaik.field,
    transaksi: terbaik.cocok.map((p) => {
      const m = POLA_KODE.exec(p.label);
      return { value: p.value, kode: m[1], nama: m[2].trim(), label: p.label };
    }),
  };
}

/* ================= Ledger yang boleh dipakai transaksi =================
   Di halaman Journal Create dropdown ledger datang KOSONG; isinya diambil
   JavaScript halaman itu lewat:

       var number = $("#transaction_number").val().split('|')[0];   // "KEB"
       GET /secureAPI/transactionlist/get/{number}
       → [ { id, name, ballance: "D" | "C" }, … ]

   Yang dikirim adalah KODE transaksinya, bukan uuid — percobaan pertama
   memakai uuid dan jawabannya selalu [] tanpa pesan salah apa pun.

   Huruf tengah nilai transaksi ("KEB|S|…") adalah TIPE, dan menentukan
   bentuk barisnya (lihat transShow() di halaman itu):
     • bukan "M" → tepat DUA baris: satu Debit, satu Credit. Add Row mati.
     • "M"       → baris bebas ditambah, semuanya dipilih sendiri.
   Kalau daftar ledger untuk satu sisi cuma berisi satu pilihan, praktis
   ledger itu sudah dipatok — tinggal dipakai tanpa perlu ditanyakan. */
const POLA_KODE_TRANS = /^[A-Z0-9]{2,6}$/;

/* "KEB|S|c75e5e61-…" → { kode: "KEB", tipe: "S", uuid: "c75e5e61-…" } */
export function uraikanNilaiTransaksi(nilai) {
  const bagian = String(nilai || '').split('|');
  if (bagian.length !== 3 || !POLA_KODE_TRANS.test(bagian[0])) {
    throw new Error('Nilai transaksi tidak dikenali: ' + nilai);
  }
  return { kode: bagian[0], tipe: bagian[1], uuid: bagian[2] };
}

export async function ambilLedgerTransaksi(email, password, kunciCabang, nilaiTransaksi) {
  const { kode, tipe } = uraikanNilaiTransaksi(nilaiTransaksi);
  const cabang = CABANG[kunciCabang];
  if (!cabang) throw new Error('Cabang tidak dikenal: ' + kunciCabang);

  let cookie = await login(email, password);
  cookie = await gantiCabang(cookie, cabang.id);
  // Halaman formulir dimuat lebih dulu — jadi jeda setelah ganti cabang,
  // sekaligus memastikan sesi memang punya akses ke Journal Create.
  cookie = (await ambilHalaman(cookie, '/finaccounting/journal-create')).cookie;

  const alamat = `/secureAPI/transactionlist/get/${kode}`;
  const res = await fetch(BASE + alamat, {
    headers: { Cookie: cookie, Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
  });
  const teks = await res.text();
  if (!res.ok) throw new Error(`intajo menolak ${alamat} (${res.status})`);

  let data;
  try { data = JSON.parse(teks); } catch {
    throw new Error(`Jawaban ${alamat} bukan JSON: ${teks.slice(0, 200)}`);
  }
  if (!Array.isArray(data)) throw new Error(`Jawaban ${alamat} bukan daftar`);

  const sisi = (huruf) => data
    .filter((o) => String(o.ballance || '').toUpperCase() === huruf)
    .map((o) => ({ id: String(o.id), nama: String(o.name || '') }));

  return { kode, tipe, alamat, bebasTambahBaris: tipe === 'M', debit: sisi('D'), kredit: sisi('C') };
}

/* ============================ Pembuatan jurnal ============================
   SATU-SATUNYA bagian berkas ini yang menulis ke intajo. Formulirnya
   (POST ke /finaccounting/journal-create) berisi:

       csrf_token          diambil dari halaman yang baru dimuat
       transaction_number  nilai penuh, mis. "KEB|S|c75e5e61-…"
       transaction_date    YYYY-MM-DD
       det_trans_bal       "D" | "C"   ┐
       det_trans_led       uuid ledger │ diulang satu set per baris,
       det_trans_des       deskripsi   │ dipasangkan server menurut urutan
       det_trans_nom       nominal     ┘
       submit              "Submit"

   Baris dikirim apa adanya dari preset — fungsi ini tidak memilih ledger
   sendiri, tidak menambah baris, dan tidak menebak apa pun. */

/* Debit dan kredit wajib seimbang; intajo menampilkannya sebagai
   "Difference" dan menolak yang tidak nol. Diperiksa di sini juga supaya
   penolakannya jelas sebelum ada apa pun terkirim. */
function periksaSeimbang(baris) {
  const jumlah = (sisi) => baris
    .filter((b) => b.bal === sisi)
    .reduce((t, b) => t + Math.round(Number(b.nom) || 0), 0);
  const d = jumlah('D'), c = jumlah('C');
  if (d !== c) {
    throw new Error(`Debit (${d.toLocaleString('id-ID')}) dan kredit (${c.toLocaleString('id-ID')}) tidak seimbang — selisih ${Math.abs(d - c).toLocaleString('id-ID')}.`);
  }
  if (d <= 0) throw new Error('Nominal jurnal masih nol.');
}

export async function buatJurnal(email, password, isi) {
  const { cabang: kunciCabang, transaksi, tanggal, baris } = isi || {};
  const cabang = CABANG[kunciCabang];
  if (!cabang) throw new Error('Cabang tidak dikenal: ' + kunciCabang);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tanggal || '')) throw new Error('Tanggal jurnal wajib YYYY-MM-DD');
  if (!Array.isArray(baris) || baris.length < 2) throw new Error('Jurnal butuh minimal dua baris (debit dan kredit)');

  const { kode } = uraikanNilaiTransaksi(transaksi);
  for (const b of baris) {
    if (b.bal !== 'D' && b.bal !== 'C') throw new Error('Sisi baris wajib D atau C');
    if (!POLA_UUID.test(b.led || '')) throw new Error('Ledger baris tidak sah: ' + b.led);
    if (!String(b.des || '').trim()) throw new Error('Tiap baris wajib punya deskripsi');
  }
  periksaSeimbang(baris);

  let cookie = await login(email, password);
  cookie = await gantiCabang(cookie, cabang.id);

  /* Muat formulirnya: sekaligus jeda supaya ganti cabang berlaku, sumber
     csrf_token, DAN pemastian bahwa kode transaksinya memang tersedia di
     cabang ini — daftar transaksi bisa berbeda antar cabang. */
  const halaman = await ambilHalaman(cookie, '/finaccounting/journal-create');
  cookie = halaman.cookie;
  if (halaman.status !== 200) throw new Error('Gagal membuka formulir Journal Create (' + halaman.status + ')');

  const csrf = ambilNilaiInput(halaman.html, 'csrf_token');
  if (!csrf) throw new Error('csrf_token tidak ditemukan — tampilan intajo mungkin berubah');

  const pilihan = daftarSelect(halaman.html).find((s) => s.nama === 'transaction_number');
  const cocok = (pilihan?.pilihan || []).find((p) => p.value === transaksi);
  if (!cocok) {
    throw new Error(`Transaksi ${kode} tidak ada di daftar Journal Create cabang ${cabang.nama}. ` +
      'Muat ulang daftar transaksi di preset, lalu pilih ulang.');
  }

  const badan = new URLSearchParams();
  badan.append('csrf_token', csrf);
  badan.append('transaction_number', transaksi);
  badan.append('transaction_date', tanggal);
  for (const b of baris) {
    badan.append('det_trans_bal', b.bal);
    badan.append('det_trans_led', b.led);
    badan.append('det_trans_des', String(b.des).trim());
    // Tanpa pemisah ribuan: yang tampil di layar intajo ("3.800.000")
    // adalah hasil inputmask, bukan yang dikirim.
    badan.append('det_trans_nom', String(Math.round(Number(b.nom) || 0)));
  }
  badan.append('submit', 'Submit');

  /* redirect: 'manual' — alasan sama dengan intajoPosting.js: intajo
     merotasi cookie sesi di respons 302, dan mengikuti redirect otomatis
     membuat header itu hilang. */
  const res = await fetch(BASE + '/finaccounting/journal-create', {
    method: 'POST',
    redirect: 'manual',
    headers: {
      Cookie: cookie,
      'Content-Type': 'application/x-www-form-urlencoded',
      Referer: BASE + '/finaccounting/journal-create',
    },
    body: badan.toString(),
  });

  /* 302 = formulir diterima dan intajo memindahkan ke halaman daftar.
     200 = halaman digambar ulang, yang di aplikasi ini berarti DITOLAK
     (formulirnya kembali dengan pesan galat), jadi jangan dilaporkan
     sukses — pelajaran dari intajoPosting.js: jangan menyimpulkan
     berhasil dari "tidak error". */
  const lokasi = res.headers.get('location') || '';
  if (res.status === 302 || res.status === 303) {
    return { ok: true, kode, cabang: cabang.nama, tanggal, lokasi };
  }
  if (res.status === 200) {
    const html = await res.text();
    const pesan = (html.match(/<div[^>]*alert[^>]*>([\s\S]{0,300}?)<\/div>/i) || [])[1] || '';
    throw new Error('intajo tidak menyimpan jurnalnya' +
      (pesan ? ': ' + pesan.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim() : ' (formulir dikembalikan tanpa pesan).'));
  }
  throw new Error('intajo menjawab ' + res.status + ' saat menyimpan jurnal');
}
