/* =========================================================================
   Sinkronisasi LAPORAN NERACA intajo.com → Firestore
   -------------------------------------------------------------------------
   Saudara dekat intajo-sync.js, tapi untuk laporan yang berbeda:
   intajo-sync.js  → ringkasan pendapatan/pengeluaran harian (dari JSON)
   berkas ini      → neraca per cabang + konsolidasi   (dari PDF)

   Dipanggil dua cara:
     1. Nebeng cron (worker.js): tiap kali tarikan ringkasan benar-benar
        jalan, neraca hari itu ikut ditarik. Jadi tidak perlu jadwal acak
        sendiri — cukup ikut jadwal yang sudah ada.
     2. POST /api/neraca-tarik — tombol "Tarik data sekarang" di menu
        Laporan Neraca, boleh menyebut tanggal tertentu.

   Menulis ke: klinik/lovepet/neracaIntajo/{YYYY-MM-DD}
   ========================================================================= */
import { bacaEnv } from '../_lib/env.js';
import { ambilNeracaSemuaCabang, konsolidasikan, semuaKosong } from '../_lib/intajoNeraca.js';
import { tulisDokumen, bacaDokumen } from '../_lib/firestoreAdmin.js';
import { tanggalWita, uidPemanggil } from './intajo-sync.js';

const KLINIK_ID = 'lovepet';
const NAMA_SECRET = ['INTAJO_EMAIL', 'INTAJO_PASSWORD', 'FIREBASE_SERVICE_ACCOUNT_JSON'];

/* Neraca adalah posisi keuangan PADA satu tanggal, bukan rentang, jadi
   "dari" dan "sampai" di intajo diisi tanggal yang sama.

   Kembalikan null kalau periodenya belum diproses di intajo (neracanya
   masih kosong melompong). Dokumen kosong sengaja TIDAK ditulis: kalau
   ditulis, halaman Neraca akan menampilkan tabel nol yang menyesatkan,
   dan dokumen itu harus dibersihkan lagi begitu pembukuannya diposting. */
export async function jalankanSinkronisasiNeraca(env, tanggal) {
  env = await bacaEnv(env, NAMA_SECRET);
  const perCabang = await ambilNeracaSemuaCabang(env.INTAJO_EMAIL, env.INTAJO_PASSWORD, tanggal, tanggal);
  if (semuaKosong(perCabang)) return null;

  const dokumen = {
    tanggal,
    cabang: perCabang,
    gabungan: konsolidasikan(perCabang),
    diperbaruiPada: new Date().toISOString(),
  };

  await tulisDokumen(env, ['klinik', KLINIK_ID, 'neracaIntajo', tanggal], dokumen);
  return dokumen;
}

/* Tanggal terakhir bulan LALU menurut WITA — mis. "2026-07-31" kalau
   sekarang Agustus. Itu periode tutup buku yang paling mungkin sudah
   diproses di intajo. */
function akhirBulanLalu() {
  const d = new Date(Date.now() + 8 * 60 * 60 * 1000);
  d.setUTCDate(0); // tanggal 0 = hari terakhir bulan sebelumnya
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/* Dipanggil worker.js sesudah tarikan ringkasan berhasil.

   Dicoba HARI INI dulu. Kalau kosong — dan biasanya memang kosong, karena
   intajo baru mengisi neraca setelah pembukuan periodenya diproses —
   jatuh ke akhir bulan lalu, yaitu tutup buku terakhir. Dengan begitu
   halaman Neraca selalu punya isi tanpa pemilik harus menarik manual,
   dan otomatis berpindah ke angka harian begitu intajo memprosesnya.

   Akhir bulan lalu dilewat kalau dokumennya sudah ada: angkanya tidak
   berubah lagi, jadi menariknya ulang tiap beberapa jam cuma memboroskan
   permintaan ke intajo.com. */
export async function sinkronNeracaHariIni(env) {
  const hariIni = await jalankanSinkronisasiNeraca(env, tanggalWita(0));
  if (hariIni) return hariIni;

  const tanggalTutup = akhirBulanLalu();
  const sudahAda = await bacaDokumen(await bacaEnv(env, NAMA_SECRET), ['klinik', KLINIK_ID, 'neracaIntajo', tanggalTutup]);
  return sudahAda ? null : jalankanSinkronisasiNeraca(env, tanggalTutup);
}

/* POST /api/neraca-tarik — satu-satunya jalur dari browser, hanya untuk
   pemilik. Pola verifikasinya sama persis dengan /api/intajo-tarik:
   idToken ditukar ke Firebase, lalu uid-nya harus punya dokumen
   pengguna/{uid}. Kredensial intajo.com tidak pernah menyentuh browser. */
export async function onRequestPostTarik({ request, env }) {
  env = await bacaEnv(env, [...NAMA_SECRET, 'FIREBASE_API_KEY']);

  let isi;
  try { isi = await request.json(); } catch { isi = {}; }
  if (!isi || !isi.idToken) return jawabJson(400, { ok: false, error: 'idToken wajib diisi' });

  let uid;
  try { uid = await uidPemanggil(env, isi.idToken); }
  catch { return jawabJson(401, { ok: false, error: 'Sesi tidak sah' }); }

  if (!(await bacaDokumen(env, ['pengguna', uid]))) {
    return jawabJson(403, { ok: false, error: 'Hanya pemilik yang boleh menarik data' });
  }

  const tanggal = /^\d{4}-\d{2}-\d{2}$/.test(isi.tanggal || '') ? isi.tanggal : tanggalWita(0);

  try {
    const dokumen = await jalankanSinkronisasiNeraca(env, tanggal);
    if (!dokumen) {
      return jawabJson(200, {
        ok: false, kosong: true,
        error: `Neraca ${tanggal} masih kosong di intajo.com — pembukuan periode itu belum diproses (Accounting → Accounting Process). Coba tanggal akhir periode yang sudah ditutup.`,
      });
    }
    return jawabJson(200, { ok: true, dokumen });
  } catch (e) {
    console.error('neraca-tarik:', e && e.stack);
    return jawabJson(502, { ok: false, error: String((e && e.message) || e) });
  }
}

const jawabJson = (status, isi) =>
  new Response(JSON.stringify(isi), { status, headers: { 'Content-Type': 'application/json' } });
