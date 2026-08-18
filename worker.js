/* =========================================================================
   worker.js — titik masuk Cloudflare Worker ("lovepetcrew")
   -------------------------------------------------------------------------
   Situs ini di-deploy sebagai Worker biasa (bukan Cloudflare Pages), jadi
   TIDAK ada routing otomatis berdasarkan struktur folder. Berkas ini yang
   menyambungkan dua hal:
     • /api/nota, /api/telegram, /api/notify → dilempar ke functions/api/*.js
     • semua alamat lain (index.html, css/, js/, …) → dilayani langsung
       dari berkas statis lewat binding "ASSETS" (diatur di wrangler.jsonc)

   functions/api/nota.js dan functions/api/telegram.js ditulis mengikuti
   gaya Cloudflare Pages Functions — sengaja dipertahankan begitu (dan
   masih bisa dipakai apa adanya) karena keduanya hanya membutuhkan
   { request, env }, jadi tinggal dipanggil langsung dari sini.
   ========================================================================= */
import { onRequestPost as notaHandler } from './functions/api/nota.js';
import { onRequestPost as telegramHandler } from './functions/api/telegram.js';
import { onRequestPost as notifyHandler } from './functions/api/notify.js';
import {
  onRequestPost as intajoSyncHandler,
  onRequestPostTarik as intajoTarikHandler,
  jalankanKalauWaktunya,
} from './functions/api/intajo-sync.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/nota') {
      return request.method === 'POST'
        ? notaHandler({ request, env })
        : new Response('Gunakan POST', { status: 405 });
    }
    if (url.pathname === '/api/telegram') {
      return request.method === 'POST'
        ? telegramHandler({ request, env })
        : new Response('Gunakan POST', { status: 405 });
    }
    if (url.pathname === '/api/notify') {
      return request.method === 'POST'
        ? notifyHandler({ request, env })
        : new Response('Gunakan POST', { status: 405 });
    }
    if (url.pathname === '/api/intajo-sync') {
      return request.method === 'POST'
        ? intajoSyncHandler({ request, env })
        : new Response('Gunakan POST', { status: 405 });
    }
    if (url.pathname === '/api/intajo-tarik') {
      return request.method === 'POST'
        ? intajoTarikHandler({ request, env })
        : new Response('Gunakan POST', { status: 405 });
    }

    // Bukan /api/* → layani sebagai berkas statis (index.html, lapor.html,
    // css/, js/, icons/, sw.js, dst.) persis seperti Cloudflare Pages
    // sebelumnya menyajikan seluruh isi repo.
    return env.ASSETS.fetch(request);
  },

  // Cron Trigger (lihat wrangler.jsonc) berdetak tiap 30 menit, tapi
  // tarikan sungguhan hanya terjadi kalau jam undian berikutnya sudah
  // lewat — jaraknya diacak 2,5–7 jam supaya tidak berpola.
  // Lihat jalankanKalauWaktunya() di functions/api/intajo-sync.js.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      jalankanKalauWaktunya(env).catch((e) => {
        console.error('cron intajo-sync gagal:', e && e.stack);
      })
    );
  },
};
