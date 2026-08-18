/* =========================================================================
   Catat keuntungan harian klinik ke dompet "LOVEPET" di MokaFamilyOS
   -------------------------------------------------------------------------
   Tiap hari jam 23:30 WITA (jam tutup toko), tarik ulang ringkasan intajo
   hari itu supaya angkanya final, lalu catat KEUNTUNGAN GABUNGAN (Manado +
   Tomohon) sebagai satu transaksi di dompet LOVEPET milik MokaFamilyOS:
   positif → pendapatan, negatif → pengeluaran. Kalau persis Rp0 dianggap
   mencurigakan (bisa berarti gagal tarik data, bukan benar-benar tutup
   tanpa transaksi — pernah kejadian sebelumnya), jadi TIDAK dicatat,
   cukup diberi tahu lewat Telegram supaya dicek manual.

   Tidak berjalan lewat Cron Trigger sendiri — nebeng di detak 30 menit
   yang sudah ada (lihat worker.js: scheduled()), sama seperti penarikan
   acak intajo. Itu juga sekaligus jadi mekanisme retry: kalau gagal jam
   23:30 (mis. intajo.com atau Moka lagi down), detak 00:00 masih akan
   mencoba lagi untuk tanggal yang sama, sampai berhasil atau tanggalnya
   sendiri berganti.
   ========================================================================= */
import { bacaEnv } from '../_lib/env.js';
import { bacaDokumen, tulisDokumen } from '../_lib/firestoreAdmin.js';
import { catatTransaksiMoka } from '../_lib/mokaFirestore.js';
import { jalankanSinkronisasi, tanggalWita } from './intajo-sync.js';

const KLINIK_ID = 'lovepet';
const GUARD_PATH = ['klinik', KLINIK_ID, 'sistem', 'mokaPencatatan'];
const NAMA_DOMPET = 'LOVEPET';
const JAM_TUTUP = { jam: 23, menit: 30 };
const COOLDOWN_ALERT_MS = 55 * 60 * 1000; // jangan spam Telegram tiap 30 menit kalau terus gagal

const NAMA_SECRET = [
  'INTAJO_EMAIL', 'INTAJO_PASSWORD', 'FIREBASE_SERVICE_ACCOUNT_JSON',
  'MOKA_FIREBASE_SERVICE_ACCOUNT_JSON', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID',
];

function waktuWita() {
  const d = new Date(Date.now() + 8 * 60 * 60 * 1000);
  return { jam: d.getUTCHours(), menit: d.getUTCMinutes() };
}

function sudahLewatJamTutup() {
  const { jam, menit } = waktuWita();
  return jam > JAM_TUTUP.jam || (jam === JAM_TUTUP.jam && menit >= JAM_TUTUP.menit);
}

async function kirimTelegram(env, teks) {
  const tujuan = String(env.TELEGRAM_CHAT_ID || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!env.TELEGRAM_BOT_TOKEN || !tujuan.length) return;
  for (const chatId of tujuan) {
    await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: teks, parse_mode: 'HTML' }),
    }).catch(() => {}); // notifikasi gagal terkirim bukan alasan menggagalkan proses utama
  }
}

export async function catatKeMokaKalauWaktunya(env) {
  env = await bacaEnv(env, NAMA_SECRET);

  const target = sudahLewatJamTutup() ? tanggalWita(0) : tanggalWita(-1);
  const guard = await bacaDokumen(env, GUARD_PATH);
  if (guard && guard.tanggalTerakhir >= target) return { dilakukan: false, alasan: 'sudah-ditangani', target };

  try {
    const dokumen = await jalankanSinkronisasi(env, target);
    const keuntungan = dokumen.gabungan.keuntungan;

    if (keuntungan === 0) {
      await kirimTelegram(env,
        `⚠️ Ringkasan intajo.com tanggal ${target} keuntungannya persis Rp0 — dicurigai gagal tarik data, ` +
        `BUKAN dicatat ke dompet LOVEPET Moka. Cek tab Ringkasan → Lihat detail, atau tarik ulang manual.`);
      await tulisDokumen(env, GUARD_PATH, {
        tanggalTerakhir: target, statusTerakhir: 'dilewati-nol', jumlahTerakhir: 0,
        diperbaruiPada: new Date().toISOString(),
      });
      return { dilakukan: false, alasan: 'nol-dicurigai', target };
    }

    const kind = keuntungan > 0 ? 'income' : 'expense';
    const hasil = await catatTransaksiMoka(env, {
      namaDompet: NAMA_DOMPET, kind, jumlah: keuntungan,
      kategori: 'Klinik', catatan: 'Ringkasan intajo.com (otomatis)', tanggal: target,
    });

    await tulisDokumen(env, GUARD_PATH, {
      tanggalTerakhir: target, statusTerakhir: 'tercatat', jumlahTerakhir: keuntungan, kindTerakhir: kind,
      diperbaruiPada: new Date().toISOString(),
    });
    return { dilakukan: true, target, keuntungan, kind, hasil };
  } catch (e) {
    console.error('catatKeMokaKalauWaktunya:', e && e.stack);
    const sudahDiberitahuBaruBaru = guard && guard.gagalDiberitahuPada &&
      (Date.now() - Date.parse(guard.gagalDiberitahuPada)) < COOLDOWN_ALERT_MS;
    if (!sudahDiberitahuBaruBaru) {
      await kirimTelegram(env,
        `🔴 Gagal mencatat keuntungan ${target} ke Moka: ${String((e && e.message) || e).slice(0, 300)}\n` +
        `Akan dicoba lagi otomatis di detak berikutnya.`);
      await tulisDokumen(env, GUARD_PATH, {
        ...(guard || {}), gagalDiberitahuPada: new Date().toISOString(),
      });
    }
    return { dilakukan: false, alasan: 'error', target, error: String((e && e.message) || e) };
  }
}

/* POST /api/moka-catat — tombol tes manual dari Anda sendiri (curl), sama
   polanya dengan /api/intajo-sync: header "Authorization: Bearer
   <CRON_SECRET>". TIDAK dipanggil dari browser aplikasi. */
export async function onRequestPost({ request, env }) {
  const auth = request.headers.get('Authorization') || '';
  const envRahasia = await bacaEnv(env, ['CRON_SECRET']);
  if (auth !== `Bearer ${envRahasia.CRON_SECRET}`) {
    return new Response(JSON.stringify({ error: 'Tidak diizinkan' }), { status: 401 });
  }
  try {
    const hasil = await catatKeMokaKalauWaktunya(env);
    return new Response(JSON.stringify({ ok: true, ...hasil }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String((e && e.message) || e) }), { status: 502, headers: { 'Content-Type': 'application/json' } });
  }
}
