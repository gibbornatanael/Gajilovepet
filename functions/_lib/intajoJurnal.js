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

/* Halaman-halaman yang dijadikan titik awal pencarian tautan. Bukan
   tebakan endpoint jurnal — cuma halaman yang sudah pasti ada dan memuat
   menu samping intajo, tempat tautan sesungguhnya dibaca. */
const HALAMAN_BERMENU = ['/finaccounting/posting', '/dashboard'];

/* Tautan dianggap calon kalau alamatnya menyebut salah satu kata ini. */
const KATA_KUNCI = /(journal|jurnal|transaction|transaksi|voucher|entry)/i;

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

async function ambilHalaman(cookie, path) {
  const res = await fetch(BASE + path, { headers: { Cookie: cookie, Accept: 'text/html' } });
  const html = res.ok ? await res.text() : '';
  return { status: res.status, html, cookie: ambilSessionCookie(res) || cookie };
}

/* ======================= pembongkar HTML sederhana =======================
   Worker tidak punya DOM parser, dan proyek ini sengaja tanpa pustaka
   tambahan (lihat catatan di intajoNeraca.js soal PDF). Regex di bawah
   cukup untuk formulir server-rendered gaya intajo. */

const judulHalaman = (html) => (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').trim();

function tautanCalon(html) {
  const ketemu = new Map();
  for (const m of html.matchAll(/href="([^"#]+)"/gi)) {
    const href = m[1];
    if (!href.startsWith('/') || !KATA_KUNCI.test(href)) continue;
    ketemu.set(href, true);
  }
  return [...ketemu.keys()];
}

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
  for (const m of html.matchAll(/["'`](\/(?:secureAPI|api)\/[^"'`\s]+)["'`]/gi)) ketemu.add(m[1]);
  return [...ketemu].slice(0, 40);
}

function bongkarHalaman(path, status, html) {
  return {
    path, status,
    judul: judulHalaman(html),
    form: daftarForm(html),
    input: daftarInput(html),
    select: daftarSelect(html),
    alamatSkrip: alamatDiSkrip(html),
  };
}

/* =========================== Penelusuran ===========================
   Murni membaca (GET saja) — tidak mengubah apa pun di intajo.
   @param {string} kunciCabang  "manado" | "tomohon"
   @param {string[]} pathTambahan  alamat yang ingin diperiksa langsung,
                                   mis. hasil temuan putaran sebelumnya. */
export async function telusuriJurnal(email, password, kunciCabang, pathTambahan = []) {
  const cabang = CABANG[kunciCabang];
  if (!cabang) throw new Error('Cabang tidak dikenal: ' + kunciCabang);

  let cookie = await login(email, password);
  cookie = await gantiCabang(cookie, cabang.id);

  // Halaman pertama sekaligus jadi jeda supaya ganti cabang berlaku.
  const calon = new Set();
  const halaman = [];
  for (const path of HALAMAN_BERMENU) {
    const r = await ambilHalaman(cookie, path);
    cookie = r.cookie;
    if (r.status === 200) tautanCalon(r.html).forEach((h) => calon.add(h));
  }

  for (const p of pathTambahan) if (typeof p === 'string' && p.startsWith('/')) calon.add(p);

  // Batasi supaya satu permintaan tidak menghabiskan waktu Worker.
  for (const path of [...calon].slice(0, 12)) {
    const r = await ambilHalaman(cookie, path);
    cookie = r.cookie;
    halaman.push(bongkarHalaman(path, r.status, r.html));
  }

  return { cabang: cabang.nama, calonDitemukan: [...calon], halaman };
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

/* ============================ Pembuatan jurnal ============================
   SENGAJA BELUM DIIMPLEMENTASI. Diisi sesudah telusuriJurnal() menunjukkan
   nama field & isi transaction list yang sebenarnya — supaya yang ditulis
   ke pembukuan sungguhan bukan hasil tebakan. */
export async function buatJurnal() {
  throw new Error(
    'Pembuatan jurnal belum diaktifkan — jalankan "Telusuri formulir intajo" dulu, ' +
    'lalu formulirnya dipetakan berdasarkan hasil penelusuran itu.');
}
