/* =========================================================================
   Jurnal intajo.com dari aplikasi — tahap penelusuran
   -------------------------------------------------------------------------
     POST /api/jurnal-telusuri — buka formulir jurnal intajo dan laporkan
                                 bentuknya (nama field + isi tiap dropdown,
                                 termasuk "transaction list" yang menentukan
                                 ledger). GET saja, tidak mengubah apa pun.
     POST /api/jurnal-transaksi — daftar Transaction List intajo, supaya
                                 kode transaksi bisa dipilih dari dropdown
                                 saat membuat preset. GET juga, aman.
     POST /api/jurnal-buat     — MEMBUAT jurnal sungguhan. Masih menolak
                                 sampai hasil penelusuran dipakai untuk
                                 mengisi buatJurnal() di intajoJurnal.js.

   Gerbangnya sama dengan /api/proses-*: khusus pemilik, dan tanpa cron —
   menulis ke pembukuan adalah keputusan operasional, bukan sesuatu yang
   pantas terjadi diam-diam di latar belakang.
   ========================================================================= */
import { bacaEnv } from '../_lib/env.js';
import { telusuriJurnal, ambilDaftarTransaksi, buatJurnal } from '../_lib/intajoJurnal.js';
import { bacaDokumen } from '../_lib/firestoreAdmin.js';
import { uidPemanggil } from './intajo-sync.js';

const NAMA_SECRET = ['INTAJO_EMAIL', 'INTAJO_PASSWORD', 'FIREBASE_SERVICE_ACCOUNT_JSON', 'FIREBASE_API_KEY'];

const jawabJson = (status, isi) =>
  new Response(JSON.stringify(isi), { status, headers: { 'Content-Type': 'application/json' } });

async function tolakKalauBukanPemilik(env, isi) {
  if (!isi || !isi.idToken) return jawabJson(400, { ok: false, error: 'idToken wajib diisi' });
  let uid;
  try { uid = await uidPemanggil(env, isi.idToken); }
  catch { return jawabJson(401, { ok: false, error: 'Sesi tidak sah' }); }
  if (!(await bacaDokumen(env, ['pengguna', uid]))) {
    return jawabJson(403, { ok: false, error: 'Hanya pemilik yang boleh membuat jurnal' });
  }
  return null;
}

const bacaBadan = async (request) => { try { return await request.json(); } catch { return {}; } };

export async function onRequestPostTelusuri({ request, env }) {
  env = await bacaEnv(env, NAMA_SECRET);
  const isi = await bacaBadan(request);
  const ditolak = await tolakKalauBukanPemilik(env, isi);
  if (ditolak) return ditolak;

  const cabang = ['manado', 'tomohon'].includes(isi.cabang) ? isi.cabang : 'manado';
  const tambahan = Array.isArray(isi.path) ? isi.path.slice(0, 8) : [];

  try {
    const hasil = await telusuriJurnal(env.INTAJO_EMAIL, env.INTAJO_PASSWORD, cabang, tambahan);
    return jawabJson(200, { ok: true, ...hasil });
  } catch (e) {
    console.error('jurnal-telusuri:', e && e.stack);
    return jawabJson(502, { ok: false, error: String((e && e.message) || e) });
  }
}

export async function onRequestPostTransaksi({ request, env }) {
  env = await bacaEnv(env, NAMA_SECRET);
  const isi = await bacaBadan(request);
  const ditolak = await tolakKalauBukanPemilik(env, isi);
  if (ditolak) return ditolak;

  const cabang = ['manado', 'tomohon'].includes(isi.cabang) ? isi.cabang : 'manado';
  try {
    const hasil = await ambilDaftarTransaksi(env.INTAJO_EMAIL, env.INTAJO_PASSWORD, cabang);
    return jawabJson(200, { ok: true, ...hasil });
  } catch (e) {
    console.error('jurnal-transaksi:', e && e.stack);
    return jawabJson(502, { ok: false, error: String((e && e.message) || e) });
  }
}

export async function onRequestPostBuat({ request, env }) {
  env = await bacaEnv(env, NAMA_SECRET);
  const isi = await bacaBadan(request);
  const ditolak = await tolakKalauBukanPemilik(env, isi);
  if (ditolak) return ditolak;

  try {
    const hasil = await buatJurnal(env.INTAJO_EMAIL, env.INTAJO_PASSWORD, isi);
    return jawabJson(200, { ok: true, ...hasil });
  } catch (e) {
    console.error('jurnal-buat:', e && e.stack);
    return jawabJson(502, { ok: false, error: String((e && e.message) || e) });
  }
}
