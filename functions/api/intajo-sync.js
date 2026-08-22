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
import { tulisDokumen, bacaDokumen } from '../_lib/firestoreAdmin.js';

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

/* Tanggal menurut WITA (UTC+8). geser = 0 berarti hari ini, -1 kemarin. */
export function tanggalWita(geser = 0) {
  const sekarangWita = new Date(Date.now() + 8 * 60 * 60 * 1000);
  sekarangWita.setUTCDate(sekarangWita.getUTCDate() + geser);
  return `${sekarangWita.getUTCFullYear()}-${String(sekarangWita.getUTCMonth() + 1).padStart(2, '0')}-${String(sekarangWita.getUTCDate()).padStart(2, '0')}`;
}
export const tanggalKemarinWita = () => tanggalWita(-1);

/* Sekali tarik = dua hari: HARI INI (angka berjalan, itu yang mau dilihat
   sepanjang hari) dan KEMARIN (supaya angka penutup hari kemarin ikut
   difinalkan kalau tarikan terakhir kemarin terjadi sebelum klinik tutup). */
export async function sinkronDuaHari(env) {
  const hasil = {};
  for (const tanggal of [tanggalWita(0), tanggalWita(-1)]) {
    hasil[tanggal] = await jalankanSinkronisasi(env, tanggal);
  }
  return hasil;
}

/* ---------------------- JADWAL ACAK 2,5–7 JAM ----------------------
   Cron Cloudflare hanya bisa berjadwal tetap, dan pola tetap itu persis
   yang tidak diinginkan. Jadi cron dipasang tiap 30 menit sebagai "detak",
   tapi tarikan sungguhan hanya terjadi kalau waktunya sudah lewat jam yang
   diundi sebelumnya. Sesudah menarik, diundi lagi jarak berikutnya —
   jadi jaraknya berbeda-beda terus (2,5 / 4 / 6,5 jam, dst).             */
const JADWAL_PATH = ['klinik', KLINIK_ID, 'sistem', 'jadwalIntajo'];
const JEDA_MIN_MENIT = 150;  // 2,5 jam
const JEDA_MAKS_MENIT = 420; // 7 jam

/* Diundi dengan crypto (bukan Math.random) supaya benar-benar tidak
   berpola dan tidak bisa ditebak dari luar. Dibulatkan ke 30 menit karena
   detak cron memang tiap 30 menit. */
function jedaAcakMenit() {
  const langkah = (JEDA_MAKS_MENIT - JEDA_MIN_MENIT) / 30;
  const undi = crypto.getRandomValues(new Uint32Array(1))[0] % (langkah + 1);
  return JEDA_MIN_MENIT + undi * 30;
}

export async function jalankanKalauWaktunya(env) {
  env = await bacaEnv(env, NAMA_SECRET);
  const jadwal = await bacaDokumen(env, JADWAL_PATH);
  const sekarang = Date.now();
  const berikutnya = jadwal && jadwal.berikutnyaPada ? Date.parse(jadwal.berikutnyaPada) : 0;

  // Jadwal belum pernah ada (deploy pertama) → tarik sekarang, lalu undi.
  if (berikutnya && sekarang < berikutnya) return { ditarik: false, berikutnyaPada: jadwal.berikutnyaPada };

  await sinkronDuaHari(env);
  return { ditarik: true, berikutnyaPada: await undiJadwalBerikutnya(env, sekarang) };
}

async function undiJadwalBerikutnya(env, sekarang) {
  const jeda = jedaAcakMenit();
  const berikutnyaPada = new Date(sekarang + jeda * 60 * 1000).toISOString();
  await tulisDokumen(env, JADWAL_PATH, {
    berikutnyaPada,
    jedaMenit: jeda,
    terakhirDitarikPada: new Date(sekarang).toISOString(),
  });
  return berikutnyaPada;
}

/* POST /api/intajo-tarik — tombol "Tarik data sekarang" di tab Ringkasan.
   Ini SATU-SATUNYA jalur yang boleh dipanggil dari browser, dan hanya oleh
   pemilik: idToken-nya ditukar ke Firebase (sekaligus memverifikasi tanda
   tangan & masa berlaku), lalu uid-nya harus punya dokumen pengguna/{uid} —
   definisi "pemilik" yang sama persis dengan firestore.rules. Kredensial
   intajo.com sendiri tidak pernah menyentuh browser. */
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

  try {
    const dokumen = await sinkronDuaHari(env);
    // Undi ulang jadwal supaya tarikan otomatis tidak menyusul beberapa
    // menit sesudah tarikan manual ini.
    await undiJadwalBerikutnya(env, Date.now());
    return jawabJson(200, { ok: true, dokumen });
  } catch (e) {
    console.error('intajo-tarik:', e && e.stack);
    return jawabJson(502, { ok: false, error: String((e && e.message) || e) });
  }
}

export async function uidPemanggil(env, idToken) {
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${env.FIREBASE_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
    });
  const j = await res.json();
  const user = j && j.users && j.users[0];
  if (!res.ok || !user || !user.localId) throw new Error('token tidak sah');
  return user.localId;
}

const jawabJson = (status, isi) =>
  new Response(JSON.stringify(isi), { status, headers: { 'Content-Type': 'application/json' } });

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
