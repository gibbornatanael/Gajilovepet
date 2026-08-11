/* =========================================================================
   POST /api/notify — meneruskan pesan karyawan ke bot Telegram pemilik
   -------------------------------------------------------------------------
   Kenapa perlu endpoint sendiri:
   Firestore tidak bisa "memicu" apa pun sendiri tanpa Cloud Functions
   (berbayar). Jadi yang memberi kabar adalah HP karyawan sendiri: sesudah
   pesannya tersimpan di Firestore, lapor.js memanggil endpoint ini, lalu
   di sinilah token bot Telegram dipakai — token itu tidak pernah ada di
   browser siapa pun.

   Pesannya SELALU sudah tersimpan lebih dulu di Firestore. Kalau langkah
   ini gagal (sinyal putus, secret belum dipasang), yang hilang hanyalah
   bunyi notifikasi — percakapannya sendiri tetap utuh dan lencana merah di
   aplikasi pemilik tetap muncul.

   Siapa yang boleh memakai: hanya seseorang yang sedang benar-benar login
   sebagai karyawan. Itu diperiksa dengan menukar idToken-nya ke Firebase
   (accounts:lookup) dan memastikan emailnya berdomain karyawan. Tanpa
   pemeriksaan ini, siapa pun yang tahu alamatnya bisa mengirimi Anda spam.

   Memakai secret yang SUDAH ada untuk bot nota — tidak ada yang baru:
     TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, FIREBASE_API_KEY
   ========================================================================= */
import { bacaEnv } from '../_lib/env.js';

const NAMA_SECRET = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'FIREBASE_API_KEY'];
const DOMAIN_KARYAWAN = 'karyawan.lovepet.app';

export async function onRequestPost({ request, env }) {
  env = await bacaEnv(env, NAMA_SECRET);

  let isi;
  try { isi = await request.json(); } catch { return jawab(400, 'Bukan JSON'); }

  const { idToken, teks } = isi || {};
  if (!idToken || !teks) return jawab(400, 'idToken dan teks wajib diisi');

  // Bukti bahwa pengirimnya memang karyawan yang sedang login
  let email;
  try { email = await emailPengirim(env, idToken); }
  catch (e) { return jawab(401, 'Sesi tidak sah'); }
  if (!email.endsWith('@' + DOMAIN_KARYAWAN)) return jawab(403, 'Bukan akun karyawan');

  const nama = potong(isi.nama || email.split('@')[0], 60);
  const judul = isi.tipe === 'revisi'
    ? `📄 <b>${lolos(nama)}</b> minta revisi slip ${lolos(potong(isi.periodeLabel || '', 30))}`
    : `💬 Pesan baru dari <b>${lolos(nama)}</b>`;

  const pesan = `${judul}\n\n${lolos(potong(teks, 900))}\n\n<i>Balas lewat tab Chat di aplikasi gaji.</i>`;

  try { await kirimSemua(env, pesan); }
  catch (e) {
    console.error('notify:', e && e.stack);
    // Karyawan tidak perlu tahu urusan Telegram — pesannya sudah tersimpan.
    return jawab(200, 'Tersimpan, notifikasi gagal');
  }
  return jawab(200, 'ok');
}

/* Tukar idToken → data akun. Ini sekaligus memverifikasi tanda tangan &
   masa berlakunya, tanpa perlu memuat pustaka JWT apa pun. */
async function emailPengirim(env, idToken) {
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${env.FIREBASE_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
    });
  const j = await res.json();
  const user = j && j.users && j.users[0];
  if (!res.ok || !user || !user.email) throw new Error('token tidak sah');
  return String(user.email).toLowerCase();
}

async function kirimSemua(env, teks) {
  const tujuan = String(env.TELEGRAM_CHAT_ID || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!env.TELEGRAM_BOT_TOKEN || !tujuan.length) throw new Error('Bot Telegram belum diatur');

  for (const chatId of tujuan) {
    const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: teks, parse_mode: 'HTML' }),
    });
    if (!res.ok) throw new Error('Telegram menolak (' + res.status + ')');
  }
}

const potong = (s, n) => String(s == null ? '' : s).slice(0, n);
const lolos = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const jawab = (status, pesan) =>
  new Response(JSON.stringify({ ok: status === 200, pesan }),
    { status, headers: { 'Content-Type': 'application/json' } });
