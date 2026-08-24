/* =========================================================================
   POST /api/telegram — webhook bot Telegram
   -------------------------------------------------------------------------
   Alur di grup (satu-satunya jalan nota masuk sekarang — tab Nota di
   aplikasi sudah dihapus, lihat catatan di js/jurnal.js):
     1. Anda forward / kirim foto nota ke grup.
     2. Bot membaca fotonya dengan AI, menyimpannya ke Firestore, dan
        SELALU membuat draft jurnal langsung — tidak ada lagi status
        "Untuk ditahan/Belum/Terkirim ke Risa" untuk dipilih. Setiap nota
        dari sini memang untuk dijurnal pemilik sendiri.
     3. Bot menanyakan CABANG (Manado/Tomohon), lalu mengambil Transaction
        List langsung dari intajo dan menanyakannya sebagai tombol —
        supaya sebagian besar pekerjaan sudah selesai sebelum pemilik
        sempat membuka aplikasi. Ledger debit/kredit & nominalnya tetap
        diisi di tab Jurnal (aplikasi), bukan dari Telegram — pilihannya
        bisa banyak dan perlu dilihat, tidak muat sebagai tombol chat.

   Pengaturan (Cloudflare → Pages → Settings → Variables, semuanya "Secret"):
     TELEGRAM_BOT_TOKEN   token dari @BotFather
     TELEGRAM_SECRET      kata rahasia buatan Anda, dipasang saat setWebhook
     TELEGRAM_CHAT_ID     id grup yang boleh memakai bot (pisahkan koma)
     GEMINI_API_KEY       kunci Google AI Studio
     FIREBASE_API_KEY     sama dengan apiKey di js/firebase-config.js
     FIREBASE_PROJECT_ID  "gajilovepet"
     OWNER_EMAIL          email akun pemilik di aplikasi
     OWNER_PASSWORD       kata sandinya
     INTAJO_EMAIL         akun intajo.com (dipakai buat baca Transaction List)
     INTAJO_PASSWORD      kata sandinya
   Langkah lengkapnya ada di PANDUAN-DEPLOY.md bagian "Bot Telegram".
   ========================================================================= */
import { bacaNota } from '../_lib/gemini.js';
import { bacaEnv } from '../_lib/env.js';
import { ambilDaftarTransaksi } from '../_lib/intajoJurnal.js';
import { CABANG } from '../_lib/intajoScraper.js';

const KLINIK_ID = 'lovepet';
const NAMA_SECRET = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_SECRET', 'TELEGRAM_CHAT_ID',
  'GEMINI_API_KEY', 'FIREBASE_API_KEY', 'FIREBASE_PROJECT_ID', 'OWNER_EMAIL', 'OWNER_PASSWORD',
  'INTAJO_EMAIL', 'INTAJO_PASSWORD'];
const BATAS_FOTO = 700 * 1024;   // sama dengan batas di aplikasi

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
      'Kirim atau forward <b>foto nota</b> ke grup ini. Saya baca isinya, simpan sebagai draft ' +
      'jurnal, lalu tanyakan cabang &amp; transaksinya di intajo.\n\n<code>/id</code> — tampilkan id grup ini.');
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
    const notaId = await buatNota(env, token, Object.assign({}, nota, {
      foto: `data:${mime};base64,${base64}`,
      sumber: 'telegram',
    }));
    // SELALU dibuat — tidak ada lagi status "Untuk ditahan" untuk dipilih
    // dulu. Nota dari Telegram memang untuk dijurnal pemilik sendiri.
    const draftId = await buatDraftJurnal(env, token, notaId, nota);

    await sunting(env, chatId, menunggu, ringkasan(nota) +
      '\n\nTersimpan sebagai draft jurnal. Cabang mana?', tombolCabang(draftId));
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
function tombolCabang(draftId) {
  return {
    inline_keyboard: Object.entries(CABANG).map(([kunci, c]) =>
      [{ text: c.nama, callback_data: `c|${draftId}|${kunci}` }]),
  };
}

/* Telegram membatasi callback_data 64 byte — makanya yang dikirim per
   tombol transaksi cuma KODE-nya (2-6 huruf), bukan value penuh
   "KEB|S|<uuid>". Value lengkapnya dicari ulang dari Transaction List
   saat tombolnya ditekan, lihat pilihTransaksi(). */
function tombolTransaksi(draftId, daftar) {
  const tombol = daftar.map((t) => ({
    text: t.label.length > 40 ? `${t.kode} - ${t.nama.slice(0, 28)}…` : t.label,
    callback_data: `t|${draftId}|${t.kode}`,
  }));
  const baris = [];
  for (let i = 0; i < tombol.length; i += 2) baris.push(tombol.slice(i, i + 2));
  return { inline_keyboard: baris };
}

async function tanganiTombol(cq, env) {
  const chatId = cq.message && cq.message.chat && cq.message.chat.id;
  if (!grupBoleh(chatId, env)) { await jawabTombol(env, cq.id, 'Grup tidak diizinkan'); return; }

  const [tag, draftId, nilai] = String(cq.data || '').split('|');
  if (!draftId) { await jawabTombol(env, cq.id, ''); return; }

  try {
    if (tag === 'c') await pilihCabang(cq, env, draftId, nilai);
    else if (tag === 't') await pilihTransaksi(cq, env, draftId, nilai);
    else await jawabTombol(env, cq.id, '');
  } catch (e) {
    console.error('tombol telegram:', e && e.stack);
    await jawabTombol(env, cq.id, 'Gagal');
    await kirim(env, chatId, '⚠️ Gagal memproses tombol.\n' + kodeAman(e), cq.message.message_id);
  }
}

/* Tombol cabang ditekan → simpan cabangnya di draft, lalu langsung
   ambilkan Transaction List dari intajo (perlu login + buka halaman
   Journal Create, jadi terasa beberapa detik — pesannya disunting dua
   kali supaya jeda itu tidak terasa seperti macet). */
async function pilihCabang(cq, env, draftId, cabangKey) {
  const chatId = cq.message.chat.id;
  if (!CABANG[cabangKey]) { await jawabTombol(env, cq.id, 'Cabang tidak dikenal'); return; }

  const token = await masukFirebase(env);
  await ubahDraft(env, token, draftId, { cabang: s(cabangKey) });
  await jawabTombol(env, cq.id, 'Cabang: ' + CABANG[cabangKey].nama);

  const asli = String(cq.message.text || '').split('\n\nTersimpan sebagai draft jurnal.')[0];
  await sunting(env, chatId, cq.message.message_id,
    asli + `\n\nCabang: <b>${CABANG[cabangKey].nama}</b>. Mengambil transaction list dari intajo…`);

  const { transaksi } = await ambilDaftarTransaksi(env.INTAJO_EMAIL, env.INTAJO_PASSWORD, cabangKey);
  await sunting(env, chatId, cq.message.message_id,
    asli + `\n\nCabang: <b>${CABANG[cabangKey].nama}</b>. Pilih transaksinya:`,
    tombolTransaksi(draftId, transaksi));
}

/* Tombol transaksi ditekan → cari lagi value lengkapnya dari Transaction
   List (kode saja tidak cukup buat mengisi field "transaksi" draft —
   lihat catatan di tombolTransaksi tentang batas 64 byte). */
async function pilihTransaksi(cq, env, draftId, kode) {
  const chatId = cq.message.chat.id;
  const token = await masukFirebase(env);
  const draft = await bacaDraft(env, token, draftId);
  if (!draft || !draft.cabang) { await jawabTombol(env, cq.id, 'Draft/cabang belum ada'); return; }

  const { transaksi } = await ambilDaftarTransaksi(env.INTAJO_EMAIL, env.INTAJO_PASSWORD, draft.cabang);
  const cocok = transaksi.find((t) => t.kode === kode);
  if (!cocok) { await jawabTombol(env, cq.id, 'Transaksi tidak ditemukan lagi'); return; }

  await ubahDraft(env, token, draftId, { transaksi: s(cocok.value) });
  await jawabTombol(env, cq.id, 'Tersimpan: ' + kode);

  const asli = String(cq.message.text || '').split('\n\nCabang:')[0];
  await sunting(env, chatId, cq.message.message_id,
    asli + `\n\n✅ Cabang: <b>${CABANG[draft.cabang].nama}</b> · Transaksi: <b>${lolos(cocok.label)}</b>.\n` +
    'Buka aplikasi (tab Jurnal) untuk isi ledger &amp; kirim ke intajo.');
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
        sumber:   s('telegram'),
        foto:     s(n.foto),
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

const pangkalanDraft = (env) =>
  `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}` +
  `/databases/(default)/documents/klinik/${KLINIK_ID}/jurnalDraft`;

/* Cangkang draft jurnal — SAMA PERSIS bentuknya dengan yang dibuat
   js/jurnal.js untuk preset & catat-manual, supaya kartu draft dari
   Telegram tidak perlu penanganan khusus di sisi aplikasi. Baris & ledger
   sengaja kosong: itu tetap diisi pemilik sendiri di tab Jurnal — bot
   cuma membantu sampai tahap cabang + kode transaksi. */
async function buatDraftJurnal(env, token, notaId, n) {
  const res = await fetch(pangkalanDraft(env), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({
      fields: {
        notaId: s(notaId),
        nama: s(n.toko ? `${n.toko} — ${rupiah(n.total)}` : rupiah(n.total)),
        tanggal: s(n.tanggal || hariIni()),
        cabang: s(''), transaksi: s(''),
        baris: { arrayValue: { values: [] } },
        sumberNota: {
          mapValue: {
            fields: {
              tanggal: s(n.tanggal), toko: s(n.toko), total: i(n.total),
              kategori: s(n.kategori), metode: s(n.metode), catatan: s(n.catatan),
            },
          },
        },
        dibuat: i(Date.now()),
      },
    }),
  });
  const j = await res.json();
  if (!res.ok) throw new Error('Buat draft jurnal gagal: ' + ((j.error && j.error.message) || res.status));
  return String(j.name || '').split('/').pop();
}

/* Timpa field tertentu saja di draft (cabang lalu transaksi, dua langkah
   terpisah sesuai urutan tombol yang ditekan pemilik). */
async function ubahDraft(env, token, draftId, fields) {
  const mask = Object.keys(fields).map((k) => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join('&');
  const res = await fetch(`${pangkalanDraft(env)}/${encodeURIComponent(draftId)}?${mask}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error('Ubah draft gagal: ' + ((j.error && j.error.message) || res.status));
  }
}

/* Dibaca saat tombol transaksi ditekan — perlu tahu cabang yang sudah
   disimpan di langkah sebelumnya untuk mengambil Transaction List yang
   benar (lihat pilihTransaksi()). */
async function bacaDraft(env, token, draftId) {
  const res = await fetch(`${pangkalanDraft(env)}/${encodeURIComponent(draftId)}`, {
    headers: { Authorization: 'Bearer ' + token },
  });
  if (!res.ok) return null;
  const j = await res.json();
  const f = j.fields || {};
  const str = (v) => (v && 'stringValue' in v ? v.stringValue : '');
  return { cabang: str(f.cabang), transaksi: str(f.transaksi) };
}

const s = (v) => ({ stringValue: String(v == null ? '' : v) });
const i = (v) => ({ integerValue: String(Math.round(Number(v) || 0)) });

function hariIni() {
  // Klinik ada di WIB — pakai UTC+7 supaya nota malam hari tidak mundur sehari.
  const d = new Date(Date.now() + 7 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}
