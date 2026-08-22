/* =========================================================================
   functions/_lib/intajoNeraca.js — ambil LAPORAN NERACA (balance sheet)
   per cabang dari intajo.com.
   -------------------------------------------------------------------------
   Bedanya dengan intajoScraper.js (ringkasan pendapatan/pengeluaran):
   neraca TIDAK tersedia sebagai JSON. Di intajo.com jalurnya
   Accounting → Outstanding → Print, dan hasilnya sebuah PDF:

       GET /finaccounting/outstand-printBS/{dari}/{sampai}   → application/pdf

   Jadi berkas ini harus membongkar PDF-nya sendiri. Untungnya PDF-nya
   dihasilkan FPDF: teksnya sungguhan (bukan gambar hasil pindai) dan setiap
   potong teks ditulis lengkap dengan koordinatnya —
       BT <x> <y> Td (Kas Besar) Tj ET
   — sehingga tabel bisa disusun ulang dengan mengelompokkan teks yang
   koordinat Y-nya sama (satu baris), lalu menaruh tiap teks ke kolom yang
   rentang X-nya memuatnya. Rentang kolomnya sendiri tidak ditebak: diambil
   dari kotak header (operator "re") yang digambar tepat di belakang tulisan
   Num/Name/Begin/Debit/Credit/Total, jadi kalau intajo menggeser lebar
   kolomnya, pembacaan ikut menyesuaikan sendiri.

   Satu halaman memuat DUA tabel berdampingan: kiri Aset, kanan
   Kewajiban + Modal. Keduanya punya enam kolom yang sama, makanya kotak
   header yang ketemu ada dua belas.

   ---- KENAPA ADA "MUAT ULANG HALAMAN" SETELAH GANTI CABANG ----
   PDF-nya tidak menerima parameter cabang; isinya mengikuti cabang yang
   sedang aktif di sesi. Ganti cabang dilakukan lewat
       GET /secureAPI/branch/change/{branchId}
   TAPI panggilan itu saja belum cukup: cabang barunya baru benar-benar
   berlaku pada permintaan halaman BERIKUTNYA. Kalau PDF langsung diminta
   sesudahnya, yang keluar masih neraca cabang yang LAMA. (Di browser hal
   ini tidak kelihatan karena tombolnya memang menjalankan
   location.reload() sesudah ganti cabang.) Makanya di sini halaman neraca
   ikut dimuat sekali sebagai jeda, dan cookie sesi terbaru selalu
   dipungut ulang di tiap langkah.

   Sebagai jaring pengaman terakhir, baris "Branch : 001 - Manado" di kop
   PDF dicocokkan dengan cabang yang diminta — kalau meleset, sengaja
   dilempar error daripada menyimpan angka salah cabang tanpa ketahuan.
   Angka Manado & Tomohon pernah tertukar diam-diam sekali (commit
   2ea18e3); jangan sampai terulang.

   CATATAN RAPUH: sama seperti intajoScraper.js — ini scraping tanpa API
   resmi. Kalau intajo.com mengubah tata letak PDF-nya, berkas ini bisa
   berhenti bekerja.
   ========================================================================= */
import { CABANG, login, ambilSessionCookie } from './intajoScraper.js';

const BASE = 'https://intajo.com';

/* ---------------------------------------------------------------- ambil */

async function gantiCabang(cookie, branchId) {
  const res = await fetch(`${BASE}/secureAPI/branch/change/${branchId}`, {
    headers: { Cookie: cookie, Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
  });
  if (!res.ok) throw new Error('Gagal ganti cabang intajo (' + res.status + ')');
  const j = await res.json().catch(() => ({}));
  if (j.message !== 'Ok') throw new Error('Ganti cabang ditolak intajo: ' + JSON.stringify(j));
  return ambilSessionCookie(res) || cookie;
}

/* Muat halaman neraca sekali — TANPA ini, PDF sesudahnya masih berisi
   cabang yang lama (lihat catatan panjang di kepala berkas). Isinya tidak
   dipakai; yang dibutuhkan cuma efek sampingnya di sesi + cookie terbaru. */
async function muatUlangHalamanNeraca(cookie) {
  const res = await fetch(`${BASE}/finaccounting/outstand-print-balance-sheet`, {
    headers: { Cookie: cookie, Accept: 'text/html' },
  });
  if (!res.ok) throw new Error('Gagal memuat halaman neraca (' + res.status + ')');
  await res.text();
  return ambilSessionCookie(res) || cookie;
}

async function unduhPdfNeraca(cookie, dari, sampai) {
  const res = await fetch(`${BASE}/finaccounting/outstand-printBS/${dari}/${sampai}`, {
    headers: {
      Cookie: cookie,
      Accept: 'application/pdf',
      Referer: `${BASE}/finaccounting/outstand-print-balance-sheet`,
    },
  });
  if (!res.ok) throw new Error('Gagal unduh PDF neraca (' + res.status + ')');
  return new Uint8Array(await res.arrayBuffer());
}

/* ------------------------------------------------------- bongkar PDF */

/* PDF campuran teks & biner, jadi diperlakukan sebagai byte. latin-1
   memetakan 1 byte = 1 karakter bolak-balik tanpa kehilangan apa pun,
   sehingga aman dipakai buat mencari pola dengan regex lalu dibalik lagi
   jadi byte. (UTF-8 TIDAK bisa — byte >0x7F akan rusak.) */
const keTeksLatin1 = (byte) => {
  let s = '';
  for (let i = 0; i < byte.length; i += 8192) {
    s += String.fromCharCode.apply(null, byte.subarray(i, i + 8192));
  }
  return s;
};
const keByteLatin1 = (teks) => Uint8Array.from(teks, (c) => c.charCodeAt(0) & 0xff);

/* Isi halaman PDF dimampatkan zlib. DecompressionStream ada di Cloudflare
   Workers maupun Node modern, jadi tidak perlu pustaka tambahan. */
async function bukaZlib(byte) {
  const aliran = new Blob([byte]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(aliran).arrayBuffer());
}

/* Kumpulkan seluruh aliran isi halaman jadi satu teks operator PDF.

   Panjang tiap aliran diambil dari "/Length N" di kamus objeknya, BUKAN
   dengan mencari kata "endstream". Sebabnya: isi aliran itu biner, dan PDF
   menyelipkan satu baris baru antara data dan "endstream" — kalau baris itu
   ikut terbawa, pembongkaran zlib menolaknya ("trailing junk").

   Aliran yang bukan teks (logo klinik) tetap terbaca tapi disaring lewat
   ada-tidaknya operator "Tj". */
async function isiHalaman(pdfByte) {
  const mentah = keTeksLatin1(pdfByte);
  const potongan = [];
  for (const m of mentah.matchAll(/\/Length\s+(\d+)\s*>>\s*stream\r?\n/g)) {
    const mulai = m.index + m[0].length;
    const data = mentah.slice(mulai, mulai + Number(m[1]));
    let isi;
    try { isi = keTeksLatin1(await bukaZlib(keByteLatin1(data))); }
    catch { continue; }
    if (isi.includes('Tj')) potongan.push(isi);
  }
  if (!potongan.length) throw new Error('PDF neraca tidak berisi teks yang bisa dibaca');
  return potongan.join('\n');
}

/* PDF melindungi "(", ")" dan "\" di dalam teks dengan backslash. */
const bukaEscapePdf = (s) => s.replace(/\\([()\\])/g, '$1');

/* Semua potong teks beserta koordinatnya. */
function ambilTeksBerkoordinat(isi) {
  const hasil = [];
  for (const m of isi.matchAll(/BT\s+(-?[\d.]+)\s+(-?[\d.]+)\s+Td\s+\(((?:\\.|[^()\\])*)\)\s*Tj/g)) {
    hasil.push({ x: parseFloat(m[1]), y: parseFloat(m[2]), teks: bukaEscapePdf(m[3]) });
  }
  return hasil;
}

/* Rentang X tiap kolom, dibaca dari kotak header:
     "14.17 447.59 56.69 -17.01 re B ... BT 34.08 436.69 Td (Num) Tj"
   Tinggi kotaknya negatif karena FPDF menggambar dari sudut kiri-ATAS.
   Hasilnya 12 kolom berurutan: 6 tabel kiri, lalu 6 tabel kanan. */
const JUDUL_KOLOM = ['Num', 'Name', 'Begin', 'Debit', 'Credit', 'Total'];

function kolomHeader(isi) {
  const pola = new RegExp(
    String.raw`(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+-?[\d.]+\s+re\s+B\s+q\s+0\s+g\s+BT\s+-?[\d.]+\s+-?[\d.]+\s+Td\s+\((` +
    JUDUL_KOLOM.join('|') + String.raw`)\)\s*Tj`, 'g');

  const kolom = [];
  for (const m of isi.matchAll(pola)) {
    kolom.push({ x1: parseFloat(m[1]), x2: parseFloat(m[1]) + parseFloat(m[3]), yHeader: parseFloat(m[2]), kunci: m[4] });
  }
  if (kolom.length !== 12) {
    throw new Error('Struktur tabel PDF neraca tak dikenali (kolom header ketemu ' + kolom.length + ', harusnya 12)');
  }
  kolom.sort((a, b) => a.x1 - b.x1);
  return kolom;
}

/* "(296,537)" = negatif (gaya akuntansi), "32,900,521" = positif. */
function keAngka(teks) {
  if (teks == null) return 0;
  const bersih = String(teks).trim();
  if (!bersih) return 0;
  const negatif = bersih.startsWith('(') && bersih.endsWith(')');
  const angka = Number(bersih.replace(/[(),\s]/g, ''));
  if (!Number.isFinite(angka)) return 0;
  return negatif ? -angka : angka;
}

/* Tingkat kedalaman akun ditandai spasi di depan namanya:
   "Aset" = 0, " Kas" = 1, "  Kas Besar" = 2. */
const tingkatDari = (nama) => (nama.match(/^ */) || [''])[0].length;

/* Susun ulang tabel: kelompokkan teks per baris (koordinat Y sama), lalu
   taruh tiap teks ke kolom yang rentang X-nya memuat titik awal teks.
   Angka rata-kanan, tapi tetap dimulai di dalam kolomnya sendiri, jadi
   penempatan berdasar X awal ini aman. */
function susunBaris(teksList, kolom) {
  const yHeader = kolom[0].yHeader;
  const perY = new Map();
  for (const t of teksList) {
    if (t.y >= yHeader) continue;        // judul & kop halaman
    if (t.y < 30) continue;              // catatan kaki ("Page 1 / 1")
    // Tulisan "Num/Name/Begin/…" duduk sedikit di BAWAH kotak header yang
    // melatarinya, jadi lolos dari saringan yHeader di atas.
    if (JUDUL_KOLOM.includes(t.teks.trim())) continue;
    const kunci = t.y.toFixed(2);
    if (!perY.has(kunci)) perY.set(kunci, []);
    perY.get(kunci).push(t);
  }

  const kiri = [], kanan = [];
  let totalKiri = null, totalKanan = null;

  for (const y of [...perY.keys()].sort((a, b) => Number(b) - Number(a))) {
    const sel = { kiri: {}, kanan: {} };
    for (const t of perY.get(y)) {
      const i = kolom.findIndex((k) => t.x >= k.x1 - 0.5 && t.x < k.x2 + 0.5);
      if (i < 0) continue;
      sel[i < 6 ? 'kiri' : 'kanan'][kolom[i].kunci] = t.teks;
    }

    for (const sisi of ['kiri', 'kanan']) {
      const s = sel[sisi];
      const adaAngka = ['Begin', 'Debit', 'Credit', 'Total'].some((k) => s[k] != null);
      if (!adaAngka) continue;

      const nilai = {
        begin: keAngka(s.Begin), debit: keAngka(s.Debit),
        credit: keAngka(s.Credit), total: keAngka(s.Total),
      };

      // Baris tanpa Num/Name = baris JUMLAH di kaki tabel (yang berlatar
      // hijau di tampilan intajo), bukan akun.
      if (s.Num == null && s.Name == null) {
        if (sisi === 'kiri') totalKiri = nilai; else totalKanan = nilai;
        continue;
      }

      const nama = s.Name == null ? '' : s.Name;
      (sisi === 'kiri' ? kiri : kanan).push({
        num: (s.Num || '').trim(),
        nama: nama.trim(),
        tingkat: tingkatDari(nama),
        ...nilai,
      });
    }
  }

  return { kiri, kanan, totalKiri, totalKanan };
}

/* Baris "Branch : 001 - Manado" di kop PDF — dipakai buat memastikan
   PDF-nya benar-benar cabang yang diminta (lihat catatan paling atas). */
function kodeCabangDiPdf(teksList) {
  const t = teksList.find((s) => /^:\s*\d{3}\s*-/.test(s.teks));
  const m = t && t.teks.match(/(\d{3})/);
  return m ? m[1] : null;
}

/* Satu cabang: ganti cabang → unduh PDF → bongkar → susun tabel. */
async function neracaSatuCabang(cookie, cabang, dari, sampai) {
  let cookieBaru = await gantiCabang(cookie, cabang.id);
  cookieBaru = await muatUlangHalamanNeraca(cookieBaru);
  const pdf = await unduhPdfNeraca(cookieBaru, dari, sampai);
  const isi = await isiHalaman(pdf);
  const teksList = ambilTeksBerkoordinat(isi);

  const kode = kodeCabangDiPdf(teksList);
  if (kode && kode !== cabang.kode) {
    throw new Error(
      `PDF neraca yang diterima cabang ${kode}, padahal yang diminta ${cabang.kode} (${cabang.nama}) — dibatalkan supaya angka tidak tertukar`);
  }

  /* PDF-nya SELALU terbit walau periodenya belum diproses di intajo —
     bentuknya tabel tanpa satu pun baris akun, cuma baris jumlah bernilai
     nol. Itu keadaan wajar (mis. neraca hari ini, sementara pembukuan baru
     diposting sampai akhir bulan lalu), bukan kegagalan, jadi ditandai
     lewat "kosong" dan biarkan pemanggil yang memutuskan. */
  const { kiri, kanan, totalKiri, totalKanan } = susunBaris(teksList, kolomHeader(isi));
  return { kiri, kanan, totalKiri, totalKanan, kosong: !kiri.length && !kanan.length, cookie: cookieBaru };
}

/* Fungsi utama: login sekali, lalu telusuri cabang satu per satu memakai
   cookie terbaru hasil ganti cabang sebelumnya. */
export async function ambilNeracaSemuaCabang(email, password, dari, sampai = dari) {
  let cookie = await login(email, password);
  const hasil = {};
  for (const kunci of Object.keys(CABANG)) {
    const { cookie: cookieBaru, ...neraca } = await neracaSatuCabang(cookie, CABANG[kunci], dari, sampai);
    cookie = cookieBaru;
    hasil[kunci] = neraca;
  }
  return hasil;
}

/* --------------------------------------------------------- konsolidasi */

/* Jumlahkan cabang per nomor akun. Akun "Antar Cabang" (mis. Manado
   mencatat -100.005.006 ke Tomohon, Tomohon mencatat kebalikannya) otomatis
   saling menghapus saat dijumlahkan — itu memang yang diinginkan dari
   laporan konsolidasi.

   Urutan & nama akun mengikuti cabang pertama yang memuat akun itu, supaya
   susunan barisnya sama persis dengan neraca per cabang. */
function gabungSisi(daftarSisi) {
  const urut = [];
  const peta = new Map();
  for (const baris of daftarSisi) {
    for (const b of baris) {
      let g = peta.get(b.num);
      if (!g) {
        g = { num: b.num, nama: b.nama, tingkat: b.tingkat, begin: 0, debit: 0, credit: 0, total: 0 };
        peta.set(b.num, g);
        urut.push(g);
      }
      g.begin += b.begin; g.debit += b.debit; g.credit += b.credit; g.total += b.total;
    }
  }
  return urut;
}

const jumlahTotal = (daftar) => daftar.filter(Boolean).reduce(
  (s, t) => ({ begin: s.begin + t.begin, debit: s.debit + t.debit, credit: s.credit + t.credit, total: s.total + t.total }),
  { begin: 0, debit: 0, credit: 0, total: 0 });

/* true kalau TIDAK ada satu pun cabang yang punya isi — artinya periode itu
   memang belum diproses di intajo, bukan pembacaannya yang gagal. */
export const semuaKosong = (perCabang) => Object.values(perCabang).every((c) => c.kosong);

export function konsolidasikan(perCabang) {
  const semua = Object.values(perCabang);
  return {
    kiri: gabungSisi(semua.map((c) => c.kiri)),
    kanan: gabungSisi(semua.map((c) => c.kanan)),
    totalKiri: jumlahTotal(semua.map((c) => c.totalKiri)),
    totalKanan: jumlahTotal(semua.map((c) => c.totalKanan)),
  };
}
