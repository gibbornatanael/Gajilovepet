/* =========================================================================
   Sinkronisasi harian intajo.com → Firestore
   -------------------------------------------------------------------------
   Dipanggil dua cara:
     1. Cron Trigger (worker.js: scheduled()) — jalan sendiri tiap 00:00 WITA.
     2. POST /api/intajo-sync dengan header
        "Authorization: Bearer <CRON_SECRET>" — buat tes manual dari Anda
        sendiri (curl), TIDAK untuk dipanggil dari browser aplikasi.

   Menulis ke: klinik/lovepet/ringkasanIntajo/{YYYY-MM-DD}
   ========================================================================= */
import { bacaEnv } from '../_lib/env.js';
import { ambilRingkasanSemuaCabang } from '../_lib/intajoScraper.js';
import { tulisDokumen } from '../_lib/firestoreAdmin.js';

const KLINIK_ID = 'lovepet';
const NAMA_SECRET = ['INTAJO_EMAIL', 'INTAJO_PASSWORD', 'FIREBASE_SERVICE_ACCOUNT_JSON', 'CRON_SECRET'];

export async function jalankanSinkronisasi(env, tanggalTarget) {
  env = await bacaEnv(env, NAMA_SECRET);
  const perCabang = await ambilRingkasanSemuaCabang(env.INTAJO_EMAIL, env.INTAJO_PASSWORD, tanggalTarget);

  const gabungan = Object.values(perCabang).reduce(
    (s, c) => ({
      pendapatan: s.pendapatan + c.pendapatan,
      pengeluaran: s.pengeluaran + c.pengeluaran,
      keuntungan: s.keuntungan + c.keuntungan,
    }),
    { pendapatan: 0, pengeluaran: 0, keuntungan: 0 }
  );

  const dokumen = {
    tanggal: tanggalTarget,
    cabang: perCabang,
    gabungan,
    diperbaruiPada: new Date().toISOString(),
  };

  await tulisDokumen(env, ['klinik', KLINIK_ID, 'ringkasanIntajo', tanggalTarget], dokumen);
  return dokumen;
}

/* Tanggal "kemarin" menurut WITA (UTC+8) — dipanggil saat cron jalan jam
   00:00 WITA, jadi data hari yang baru saja berakhir sudah final. */
export function tanggalKemarinWita() {
  const sekarangWita = new Date(Date.now() + 8 * 60 * 60 * 1000);
  sekarangWita.setUTCDate(sekarangWita.getUTCDate() - 1);
  return `${sekarangWita.getUTCFullYear()}-${String(sekarangWita.getUTCMonth() + 1).padStart(2, '0')}-${String(sekarangWita.getUTCDate()).padStart(2, '0')}`;
}

export async function onRequestPost({ request, env }) {
  const auth = request.headers.get('Authorization') || '';
  const envRahasia = await bacaEnv(env, ['CRON_SECRET']);
  if (auth !== `Bearer ${envRahasia.CRON_SECRET}`) {
    return new Response(JSON.stringify({ error: 'Tidak diizinkan' }), { status: 401 });
  }

  let tanggalTarget;
  try {
    const body = await request.json();
    tanggalTarget = (body && body.tanggal) || tanggalKemarinWita();
  } catch {
    tanggalTarget = tanggalKemarinWita();
  }

  try {
    const dokumen = await jalankanSinkronisasi(env, tanggalTarget);
    return new Response(JSON.stringify({ ok: true, dokumen }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('intajo-sync:', e && e.stack);
    return new Response(JSON.stringify({ ok: false, error: String((e && e.message) || e) }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
