/* =========================================================================
   POST /api/telegram — webhook bot Telegram
   -------------------------------------------------------------------------
   Alur di grup:
     1. Anda forward / kirim foto nota ke grup.
     2. Bot membaca fotonya dengan AI, langsung menyimpannya ke Firestore
        dengan status "Kosong", lalu membalas ringkasannya beserta empat
        tombol status.
     3. Anda tekan salah satu tombol → status diperbarui dan bot menyunting
        pesannya jadi "✅ Tersimpan …". Kalau gagal, bot mengatakan gagalnya
        dan apa sebabnya.

   Nota disimpan lebih dulu (sebelum status dipilih) supaya foto tidak pernah
   hilang kalau Anda keburu menutup Telegram — status tinggal diubah, baik
   dari tombol di sini maupun dari daftar di aplikasi.

   Pengaturan (Cloudflare → Pages → Settings → Variables, semuanya "Secret"):
     TELEGRAM_BOT_TOKEN   token dari @BotFather
     TELEGRAM_SECRET      kata rahasia buatan Anda, dipasang saat setWebhook
     TELEGRAM_CHAT_ID     id grup yang boleh memakai bot (pisahkan koma)
     GEMINI_API_KEY       kunci Google AI Studio
     FIREBASE_API_KEY     sama dengan apiKey di js/firebase-config.js
     FIREBASE_PROJECT_ID  "gajilovepet"
     OWNER_EMAIL          email akun pemilik di aplikasi
     OWNER_PASSWORD       kata sandinya
   Langkah lengkapnya ada di PANDUAN-DEPLOY.md bagian "Bot Telegram".
   ========================================================================= */
import { bacaNota } from '../_lib/gemini.js';
import { bacaEnv } from '../_lib/env.js';

const KLINIK_ID = 'lovepet';
const NAMA_SECRET = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_SECRET', 'TELEGRAM_CHAT_ID',
  'GEMINI_API_KEY', 'FIREBASE_API_KEY', 'FIREBASE_PROJECT_ID', 'OWNER_EMAIL', 'OWNER_PASSWORD'];
const BATAS_FOTO = 700 * 1024;   // sama dengan batas di aplikasi

const STATUS = [
  { id: 'belum',    label: 'Belum kirim Risa' },
  { id: 'terkirim', label: 'Terkirim ke Risa' },
  { id: 'tahan',    label: 'Untuk ditahan' },
  { id: '',         label: 'Kosongkan dulu' },
];
const labelStatus = (id) =>
  (STATUS.find((s) => s.id === (id || '')) || { label: 'Kosong' }).label;

export async function onRequestPost({ request, env }) {
  env = await bacaEnv(env, NAMA_SECRET);

  // Hanya Telegram yang tahu kata rahasia ini — permintaan lain diabaikan.
  if (env.TELEGRAM_SECRET &&
      request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== env.TELEGRAM_SECRET) {
    return new Response('no', { status: 401 });
  }

  let update;
  try { update = await request.json(); } catch { return ok(); }

  try {
    if (update.callback_query) await tanganiTombol(update.callback_query, env);
    else if (update.message)   await tanganiPesan(update.message, env);
  } catch (e) {
    console.error('telegram:', e && e.stack);
  }
  // Selalu 200 — kalau tidak, Telegram akan mengirim ulang update yang sama.
  return ok();
}

const ok = () => new Response('ok');

/* ----------------------------- Izin per grup ----------------------------- */
function grupBoleh(chatId, env) {
  const izin = String(env.TELEGRAM_CHAT_ID || '').split(',').map((s) => s.trim()).filter(Boolean);
  return izin.length === 0 || izin.includes(String(chatId));
}

/* ------------------------------ Pesan masuk ------------------------------ */
async function tanganiPesan(msg, env) {
  const chatId = msg.chat && msg.chat.id;
  if (!grupBoleh(chatId, env)) {
    await kirim(env, chatId, `Grup ini belum diizinkan. Id-nya: <code>${chatId}</code>`);
    return;
  }

  const teks = String(msg.text || '').trim();
  if (teks.startsWith('/start') || teks.startsWith('/bantuan') || teks.startsWith('/help')) {
    await kirim(env, chatId,
      'Kirim atau forward <b>foto nota</b> ke grup ini. Saya baca isinya, simpan ke aplikasi, ' +
      'lalu tanyakan statusnya.\n\n<code>/id</code> — tampilkan id grup ini.');
    return;
  }
  if (teks.startsWith('/id')) {
    await kirim(env, chatId, `Id grup ini: <code>${chatId}</code>`);
    return;
  }

  const foto = pilihFoto(msg);
  if (!foto) {
    if (msg.document) {
      await kirim(env, chatId,
        'Itu terkirim sebagai <b>berkas</b>, bukan foto. Kirim ulang sebagai foto ' +
        '(atau kompres dulu) supaya bisa saya baca.');
    }
    return;   // pesan teks biasa di grup diabaikan diam-diam
  }

  const menunggu = await kirim(env, chatId, '🔎 Membaca nota…', msg.message_id);

  try {
    const { base64, mime } = await unduhFoto(env, foto.file_id);
    const nota = await bacaNota(base64, mime, env.GEMINI_API_KEY);

    const token = await masukFirebase(env);
    const id = await buatNota(env, token, Object.assign({}, nota, {
      foto: `data:${mime};base64,${base64}`,
      status: '',
      sumber: 'telegram',
    }));

    await sunting(env, chatId, menunggu, ringkasan(nota) +
      '\n\nSudah tersimpan di aplikasi. Statusnya apa?', tombolStatus(id));
  } catch (e) {
    console.error('nota telegram:', e && e.stack);
    await sunting(env, chatId, menunggu,
      '⚠️ <b>Gagal menyimpan nota.</b>\n' + kodeAman(e) +
      '\n\nCoba kirim ulang fotonya, atau catat manual lewat aplikasi.');
  }
}

/* Pilih ukuran foto terbesar yang masih muat di satu dokumen Firestore. */
function pilihFoto(msg) {
  const sizes = Array.isArray(msg.photo) ? msg.photo.slice() : [];
  if (!sizes.length) return null;
  sizes.sort((a, b) => (a.file_size || 0) - (b.file_size || 0));
  const muat = sizes.filter((s) => (s.file_size || 0) * 1.37 < BATAS_FOTO);
  return muat.length ? muat[muat.length - 1] : sizes[0];
}

async function unduhFoto(env, fileId) {
  const info = await api(env, 'getFile', { file_id: fileId });
  const path = info.result && info.result.file_path;
  if (!path) throw new Error('Foto tidak bisa diambil dari Telegram');

  const res = await fetch(`https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${path}`);
  if (!res.ok) throw new Error('Unduh foto gagal (' + res.status + ')');
  const buf = await res.arrayBuffer();

  const mime = /\.png$/i.test(path) ? 'image/png' : 'image/jpeg';
  return { base64: keBase64(buf), mime };
}

/* btoa() hanya menerima string, jadi byte-nya dipotong per blok supaya
   tidak melampaui batas argumen String.fromCharCode. */
function keBase64(buf) {
  const bytes = new Uint8Array(buf);
  let biner = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    biner += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
  }
  return btoa(biner);
}

/* ------------------------------ Tombol status ------------------------------ */
function tombolStatus(id) {
  return {
    inline_keyboard: STATUS.map((s) => [{ text: s.label, callback_data: `s|${id}|${s.id}` }]),
  };
}

async function tanganiTombol(cq, env) {
  const chatId = cq.message && cq.message.chat && cq.message.chat.id;
  if (!grupBoleh(chatId, env)) { await jawabTombol(env, cq.id, 'Grup tidak diizinkan'); return; }

  const [tag, id, status] = String(cq.data || '').split('|');
  if (tag !== 's' || !id) { await jawabTombol(env, cq.id, ''); return; }

  try {
    const token = await masukFirebase(env);
    await ubahStatus(env, token, id, status || '');
    await jawabTombol(env, cq.id, 'Tersimpan: ' + labelStatus(status));

    const asli = String(cq.message.text || '').split('\n\nSudah tersimpan')[0];
    await sunting(env, chatId, cq.message.message_id,
      asli + `\n\n✅ Tersimpan di aplikasi — status: <b>${labelStatus(status)}</b>`);
  } catch (e) {
    console.error('status telegram:', e && e.stack);
    await jawabTombol(env, cq.id, 'Gagal menyimpan status');
    await kirim(env, chatId, '⚠️ Status gagal diubah.\n' + kodeAman(e), cq.message.message_id);
  }
}

/* -------------------------------- Ringkasan -------------------------------- */
function rupiah(v) { return 'Rp ' + (Number(v) || 0).toLocaleString('id-ID'); }
const lolos = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function ringkasan(n) {
  const baris = [
    `🧾 <b>${lolos(n.toko || 'Nota tanpa nama')}</b>`,
    `${lolos(n.tanggal || 'tanggal tidak terbaca')} · ${lolos(n.kategori || 'tanpa kategori')}` +
      (n.metode ? ` · ${lolos(n.metode)}` : ''),
    `Total: <b>${lolos(rupiah(n.total))}</b>`,
  ];
  if (n.items.length) {
    baris.push('');
    n.items.slice(0, 12).forEach((it) => {
      baris.push(`• ${lolos(it.nama)}${it.qty ? ` (${lolos(it.qty)})` : ''}` +
        (it.subtotal ? ` — ${lolos(rupiah(it.subtotal))}` : ''));
    });
    if (n.items.length > 12) {
      baris.push(`… dan ${n.items.length - 12} barang lagi (lengkapnya ada di aplikasi)`);
    }
  }
  if (!n.total) baris.push('\n⚠️ Total tidak terbaca — perbaiki lewat aplikasi.');
  return baris.join('\n');
}

/* Jangan bocorkan kunci/token ke dalam pesan grup. */
function kodeAman(e) {
  const m = String((e && e.message) || 'tidak diketahui').slice(0, 200);
  return '<i>' + lolos(m.replace(/key=[^&\s]+/gi, 'key=…')) + '</i>';
}

/* ------------------------------- API Telegram ------------------------------- */
async function api(env, metode, isi) {
  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${metode}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(isi),
  });
  const j = await res.json();
  if (!j.ok) throw new Error(`Telegram ${metode}: ${j.description || res.status}`);
  return j;
}

async function kirim(env, chatId, teks, balasKe) {
  const j = await api(env, 'sendMessage', {
    chat_id: chatId, text: teks, parse_mode: 'HTML',
    reply_to_message_id: balasKe, allow_sending_without_reply: true,
  });
  return j.result.message_id;
}

async function sunting(env, chatId, messageId, teks, tombol) {
  await api(env, 'editMessageText', {
    chat_id: chatId, message_id: messageId, text: teks,
    parse_mode: 'HTML', reply_markup: tombol,
  });
}

async function jawabTombol(env, id, teks) {
  try { await api(env, 'answerCallbackQuery', { callback_query_id: id, text: teks }); }
  catch { /* pemberitahuan kecil — tidak masalah kalau gagal */ }
}

/* ------------------------------ Firebase REST ------------------------------ */
/* Bot menulis memakai akun pemilik yang sama dengan aplikasi, lewat REST API.
   Karena itu firestore.rules tidak perlu dilonggarkan sedikit pun: bagi
   Firestore, ini pemilik yang sedang menyimpan nota. Email & sandinya hanya
   ada sebagai Secret di Cloudflare, tidak pernah dikirim ke Telegram. */
let cacheToken = null;   // dipakai ulang selama isolate hidup

async function masukFirebase(env) {
  if (cacheToken && cacheToken.kedaluwarsa > Date.now() + 60000) return cacheToken.token;
  if (!env.OWNER_EMAIL || !env.OWNER_PASSWORD || !env.FIREBASE_API_KEY) {
    throw new Error('Akun pemilik belum diatur di Cloudflare');
  }

  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${env.FIREBASE_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: env.OWNER_EMAIL, password: env.OWNER_PASSWORD, returnSecureToken: true,
      }),
    });
  const j = await res.json();
  if (!res.ok || !j.idToken) {
    throw new Error('Login Firebase gagal: ' + ((j.error && j.error.message) || res.status));
  }
  cacheToken = {
    token: j.idToken,
    kedaluwarsa: Date.now() + (Number(j.expiresIn || 3600) * 1000),
  };
  return j.idToken;
}

const pangkalan = (env) =>
  `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}` +
  `/databases/(default)/documents/klinik/${KLINIK_ID}/nota`;

async function buatNota(env, token, n) {
  const res = await fetch(pangkalan(env), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({
      fields: {
        tanggal:  s(n.tanggal || hariIni()),
        toko:     s(n.toko),
        total:    i(n.total),
        kategori: s(n.kategori),
        metode:   s(n.metode),
        catatan:  s(n.catatan),
        status:   s(n.status || ''),
        sumber:   s('telegram'),
        foto:     s(n.foto),
        arsip:    { booleanValue: false },
        dibuat:   i(Date.now()),
        items: {
          arrayValue: {
            values: (n.items || []).map((it) => ({
              mapValue: {
                fields: {
                  nama: s(it.nama), qty: s(it.qty),
                  harga: i(it.harga), subtotal: i(it.subtotal),
                },
              },
            })),
          },
        },
      },
    }),
  });
  const j = await res.json();
  if (!res.ok) throw new Error('Simpan gagal: ' + ((j.error && j.error.message) || res.status));
  return String(j.name || '').split('/').pop();
}

async function ubahStatus(env, token, id, status) {
  const url = `${pangkalan(env)}/${encodeURIComponent(id)}` +
    '?updateMask.fieldPaths=status&updateMask.fieldPaths=diubah';
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ fields: { status: s(status), diubah: i(Date.now()) } }),
  });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error('Ubah status gagal: ' + ((j.error && j.error.message) || res.status));
  }
}

const s = (v) => ({ stringValue: String(v == null ? '' : v) });
const i = (v) => ({ integerValue: String(Math.round(Number(v) || 0)) });

function hariIni() {
  // Klinik ada di WIB — pakai UTC+7 supaya nota malam hari tidak mundur sehari.
  const d = new Date(Date.now() + 7 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}
