/* =========================================================================
   POST /api/nota — dipanggil tombol "Unggah nota" di index.html
   Kirim: { "gambar": "data:image/jpeg;base64,…" }
   Balas: { tanggal, toko, total, kategori, metode, items[], catatan }

   Endpoint ini hanya MEMBACA foto; penyimpanan ke Firestore tetap dikerjakan
   browser dengan akun yang sedang login, jadi aturan keamanan Firestore
   tidak perlu dilonggarkan sama sekali.
   ========================================================================= */
import { bacaNota, uraikanDataUrl } from '../_lib/gemini.js';
import { bacaEnv } from '../_lib/env.js';

const BATAS = 4 * 1024 * 1024;   // gambar terkompresi jauh di bawah ini

export async function onRequestPost({ request, env }) {
  env = await bacaEnv(env, ['GEMINI_API_KEY']);
  try {
    const body = await request.json();
    if (!body || !body.gambar) return balas({ error: 'Tidak ada gambar' }, 400);
    if (String(body.gambar).length > BATAS) return balas({ error: 'Gambar terlalu besar' }, 413);

    const { mime, base64 } = uraikanDataUrl(body.gambar);
    if (!mime.startsWith('image/')) return balas({ error: 'Berkas bukan gambar' }, 400);

    const nota = await bacaNota(base64, mime, env.GEMINI_API_KEY);
    return balas(nota, 200);
  } catch (e) {
    console.error('api/nota:', e && e.message);
    return balas({ error: String((e && e.message) || 'Gagal membaca nota') }, 502);
  }
}

/* Metode selain POST otomatis dijawab 405 oleh Cloudflare Pages. */

function balas(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
