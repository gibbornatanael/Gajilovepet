/* =========================================================================
   Accounting Process intajo.com dari aplikasi
   -------------------------------------------------------------------------
   Dua jalur, keduanya khusus pemilik:
     POST /api/proses-status   — baca keadaan (tanggal buku sekarang, dst).
                                 Aman, tidak mengubah apa pun.
     POST /api/proses-jalankan — TUTUP BUKU sampai tanggal yang diminta.
                                 Menulis ke pembukuan sungguhan.

   Sengaja TIDAK ada pemicu cron di sini. Menutup buku adalah keputusan
   akuntansi, bukan sesuatu yang pantas terjadi diam-diam di latar belakang
   — apalagi karena tidak bisa dibatalkan dari aplikasi ini (intajo punya
   menu terpisah "Accounting Back Date" untuk memundurkannya).
   ========================================================================= */
import { bacaEnv } from '../_lib/env.js';
import { login } from '../_lib/intajoScraper.js';
import { bacaStatusProses, jalankanProses, selisihHari, MAKS_HARI_SEKALI } from '../_lib/intajoProses.js';
import { bacaDokumen } from '../_lib/firestoreAdmin.js';
import { uidPemanggil } from './intajo-sync.js';

const NAMA_SECRET = ['INTAJO_EMAIL', 'INTAJO_PASSWORD', 'FIREBASE_SERVICE_ACCOUNT_JSON', 'FIREBASE_API_KEY'];

const jawabJson = (status, isi) =>
  new Response(JSON.stringify(isi), { status, headers: { 'Content-Type': 'application/json' } });

/* Gerbang yang sama persis dengan /api/intajo-tarik: idToken ditukar ke
   Firebase (sekaligus memverifikasi tanda tangan & masa berlaku), lalu
   uid-nya harus punya dokumen pengguna/{uid}. Kembalikan Response kalau
   ditolak, atau null kalau lolos. */
async function tolakKalauBukanPemilik(env, isi) {
  if (!isi || !isi.idToken) return jawabJson(400, { ok: false, error: 'idToken wajib diisi' });
  let uid;
  try { uid = await uidPemanggil(env, isi.idToken); }
  catch { return jawabJson(401, { ok: false, error: 'Sesi tidak sah' }); }
  if (!(await bacaDokumen(env, ['pengguna', uid]))) {
    return jawabJson(403, { ok: false, error: 'Hanya pemilik yang boleh menutup buku' });
  }
  return null;
}

const bacaBadan = async (request) => { try { return await request.json(); } catch { return {}; } };

export async function onRequestPostStatus({ request, env }) {
  env = await bacaEnv(env, NAMA_SECRET);
  const isi = await bacaBadan(request);
  const ditolak = await tolakKalauBukanPemilik(env, isi);
  if (ditolak) return ditolak;

  try {
    const cookie = await login(env.INTAJO_EMAIL, env.INTAJO_PASSWORD);
    const s = await bacaStatusProses(cookie);
    // csrf token milik sesi Worker — tidak ada gunanya di browser, dan
    // tidak perlu ikut keluar dari sini.
    return jawabJson(200, {
      ok: true,
      tanggalSekarang: s.tanggalSekarang,
      tanggalMinimal: s.tanggalMinimal,
      cabang: s.cabang,
      maksHariSekali: MAKS_HARI_SEKALI,
    });
  } catch (e) {
    console.error('proses-status:', e && e.stack);
    return jawabJson(502, { ok: false, error: String((e && e.message) || e) });
  }
}

export async function onRequestPostJalankan({ request, env }) {
  env = await bacaEnv(env, NAMA_SECRET);
  const isi = await bacaBadan(request);
  const ditolak = await tolakKalauBukanPemilik(env, isi);
  if (ditolak) return ditolak;

  const tanggal = isi.tanggal;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tanggal || '')) {
    return jawabJson(400, { ok: false, error: 'Tanggal tujuan wajib diisi (YYYY-MM-DD)' });
  }

  /* Browser ikut mengirim tanggal buku yang SEDANG ia tampilkan. Kalau
     ternyata sudah tidak sama dengan keadaan intajo (mis. halaman dibiarkan
     terbuka lama, atau prosesnya sudah dijalankan dari intajo langsung),
     permintaan ditolak — supaya yang tertutup benar-benar rentang yang
     dilihat pemilik saat menekan tombol, bukan rentang lain. */
  try {
    const cookie = await login(env.INTAJO_EMAIL, env.INTAJO_PASSWORD);
    if (isi.tanggalSekarangDilihat) {
      const s = await bacaStatusProses(cookie);
      if (s.tanggalSekarang !== isi.tanggalSekarangDilihat) {
        return jawabJson(409, {
          ok: false,
          error: `Keadaan berubah: buku intajo sekarang di ${s.tanggalSekarang}, ` +
                 `bukan ${isi.tanggalSekarangDilihat} seperti yang tampil di layar. Muat ulang lalu coba lagi.`,
        });
      }
    }

    const hasil = await jalankanProses(cookie, tanggal);
    return jawabJson(200, {
      ok: true,
      dari: hasil.sebelum,
      sampai: hasil.sesudah,
      hari: selisihHari(hasil.sebelum, hasil.sesudah),
      cabang: hasil.status.cabang,
      tanggalMinimal: hasil.status.tanggalMinimal,
    });
  } catch (e) {
    console.error('proses-jalankan:', e && e.stack);
    return jawabJson(502, { ok: false, error: String((e && e.message) || e) });
  }
}
