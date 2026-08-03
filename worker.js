/* =========================================================================
   worker.js — titik masuk Cloudflare Worker ("lovepetcrew")
   -------------------------------------------------------------------------
   Situs ini di-deploy sebagai Worker biasa (bukan Cloudflare Pages), jadi
   TIDAK ada routing otomatis berdasarkan struktur folder. Berkas ini yang
   menyambungkan dua hal:
     • /api/nota, /api/telegram      → dilempar ke functions/api/*.js
     • semua alamat lain (index.html, css/, js/, …) → dilayani langsung
       dari berkas statis lewat binding "ASSETS" (diatur di wrangler.jsonc)

   functions/api/nota.js dan functions/api/telegram.js ditulis mengikuti
   gaya Cloudflare Pages Functions — sengaja dipertahankan begitu (dan
   masih bisa dipakai apa adanya) karena keduanya hanya membutuhkan
   { request, env }, jadi tinggal dipanggil langsung dari sini.
   ========================================================================= */
import { onRequestPost as notaHandler } from './functions/api/nota.js';
import { onRequestPost as telegramHandler } from './functions/api/telegram.js';

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

    // Bukan /api/* → layani sebagai berkas statis (index.html, lapor.html,
    // css/, js/, icons/, sw.js, dst.) persis seperti Cloudflare Pages
    // sebelumnya menyajikan seluruh isi repo.
    return env.ASSETS.fetch(request);
  },
};
