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
import {
  onRequestPostTarik as neracaTarikHandler,
  sinkronNeracaHariIni,
} from './functions/api/intajo-neraca.js';
import {
  onRequestPostStatus as prosesStatusHandler,
  onRequestPostJalankan as prosesJalankanHandler,
} from './functions/api/intajo-proses.js';
import { onRequestPost as mokaCatatHandler, catatKeMokaKalauWaktunya } from './functions/api/moka-catat.js';

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
    if (url.pathname === '/api/neraca-tarik') {
      return request.method === 'POST'
        ? neracaTarikHandler({ request, env })
        : new Response('Gunakan POST', { status: 405 });
    }
    if (url.pathname === '/api/proses-status') {
      return request.method === 'POST'
        ? prosesStatusHandler({ request, env })
        : new Response('Gunakan POST', { status: 405 });
    }
    if (url.pathname === '/api/proses-jalankan') {
      return request.method === 'POST'
        ? prosesJalankanHandler({ request, env })
        : new Response('Gunakan POST', { status: 405 });
    }
    if (url.pathname === '/api/moka-catat') {
      return request.method === 'POST'
        ? mokaCatatHandler({ request, env })
        : new Response('Gunakan POST', { status: 405 });
    }

    // Bukan /api/* → layani sebagai berkas statis (index.html, lapor.html,
    // css/, js/, icons/, sw.js, dst.) persis seperti Cloudflare Pages
    // sebelumnya menyajikan seluruh isi repo.
    return env.ASSETS.fetch(request);
  },

  // Cron Trigger (lihat wrangler.jsonc) berdetak tiap 30 menit, dua
  // pekerjaan independen nebeng di detak yang sama:
  //  1. jalankanKalauWaktunya   — tarikan intajo acak tiap 2,5–7 jam.
  //     Neraca hari ini ikut ditarik SESUDAHNYA, tapi hanya kalau tarikan
  //     ringkasan memang jadi berjalan — jadi neraca cukup menumpang
  //     jadwal acak yang sudah ada, tak perlu jadwal sendiri. Gagalnya
  //     neraca (scraping PDF lebih rapuh) tidak boleh menggagalkan
  //     ringkasan, makanya error-nya ditangkap terpisah.
  //  2. catatKeMokaKalauWaktunya — jam 23:30 WITA, catat keuntungan hari
  //     itu ke dompet LOVEPET di MokaFamilyOS (detak berikutnya jadi
  //     mekanisme retry otomatis kalau gagal).
  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      jalankanKalauWaktunya(env)
        .then((hasil) =>
          hasil && hasil.ditarik
            ? sinkronNeracaHariIni(env).catch((e) => {
                console.error('cron neraca gagal:', e && e.stack);
              })
            : null
        )
        .catch((e) => {
          console.error('cron intajo-sync gagal:', e && e.stack);
        })
    );
    ctx.waitUntil(
      catatKeMokaKalauWaktunya(env).catch((e) => {
        console.error('cron moka-catat gagal:', e && e.stack);
      })
    );
  },
};
