/* =========================================================================
   functions/_lib/intajoPosting.js — Sign Off / Sign On Branch di
   intajo.com (Accounting → Posting).
   -------------------------------------------------------------------------
   Kenapa berkas ini ada: Accounting Process (intajoProses.js) MENOLAK
   berjalan sampai KEDUA cabang di-"Sign Off" lebih dulu di halaman
   Posting — kolom "Close" di formulir Process itu sebenarnya status Sign
   Off tiap cabang, bukan soal jurnal pending seperti dugaan pertama.
   Urutan yang benar di intajo:

       Posting (per cabang, Sign Off Branch)  →  Accounting Process

   Endpointnya (ditemukan dari GET /finaccounting/posting, formulirnya
   satu halaman untuk 3 aksi sekaligus, dibedakan lewat name="submit"):
       GET  /finaccounting/posting   — status cabang AKTIF di sesi
       POST /finaccounting/posting   — csrf_token, journal_pending,
                                        current_date, submit
                                        (submit = "Sign Off" | "Sign On" |
                                        "Process Posting" — berkas ini
                                        cuma memakai dua yang pertama)

   Sama seperti intajoNeraca.js: statusnya per CABANG AKTIF di sesi, jadi
   ganti cabang dulu (dan satu kali reload sebagai jeda — cabang baru
   belum berlaku pada permintaan langsung sesudah ganti, lihat catatan
   panjang di intajoNeraca.js) sebelum membaca/mengubah statusnya.

   Sign Off bisa dibalik dengan Sign On (beda dengan Accounting Process
   yang searah) — tapi tetap MENGUNCI transaksi harian cabang itu selama
   masih sign off, jadi jangan dijalankan sembarang waktu kalau kliniknya
   sedang aktif memakai intajo.
   ========================================================================= */
import { CABANG, login, ambilSessionCookie } from './intajoScraper.js';

const BASE = 'https://intajo.com';
const URL_POSTING = `${BASE}/finaccounting/posting`;

async function gantiCabang(cookie, branchId) {
  const res = await fetch(`${BASE}/secureAPI/branch/change/${branchId}`, {
    headers: { Cookie: cookie, Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
  });
  if (!res.ok) throw new Error('Gagal ganti cabang intajo (' + res.status + ')');
  const j = await res.json().catch(() => ({}));
  if (j.message !== 'Ok') throw new Error('Ganti cabang ditolak intajo: ' + JSON.stringify(j));
  return ambilSessionCookie(res) || cookie;
}

async function muatUlangHalamanPosting(cookie) {
  const res = await fetch(URL_POSTING, { headers: { Cookie: cookie, Accept: 'text/html' } });
  if (!res.ok) throw new Error('Gagal memuat halaman Posting (' + res.status + ')');
  await res.text();
  return ambilSessionCookie(res) || cookie;
}

const ambilNilaiInput = (html, nama) => {
  const m = html.match(new RegExp(`<input[^>]*name="${nama}"[^>]*>`, 'i'));
  const v = m && m[0].match(/value="([^"]*)"/i);
  return v ? v[1] : null;
};

/* Tombol yang tampil di halaman menunjukkan langsung aksi APA yang akan
   terjadi kalau ditekan — dipakai sebagai sumber kebenaran ganda:
   sekaligus status cabang (open ⇢ tombolnya "Sign Off Branch") DAN nilai
   "submit" yang harus dikirim persis sama saat POST. */
function aksiTersediaDari(html) {
  const m = html.match(/data-target="#(signOff|signOn)"\s*>\s*(Sign (?:Off|On) Branch)/i);
  if (!m) throw new Error('Tombol Sign Off/Sign On tak ditemukan — tampilan halaman Posting intajo.com mungkin berubah');
  return m[1] === 'signOff' ? 'Sign Off' : 'Sign On';
}

/* Baca status cabang yang SEDANG AKTIF di sesi. Murni GET. */
export async function bacaStatusPosting(cookie) {
  const res = await fetch(URL_POSTING, { headers: { Cookie: cookie, Accept: 'text/html' } });
  if (!res.ok) throw new Error('Gagal membuka halaman Posting (' + res.status + ')');
  const html = await res.text();

  const csrf = ambilNilaiInput(html, 'csrf_token');
  const journalPending = Number(ambilNilaiInput(html, 'journal_pending') || 0);
  const currentDate = ambilNilaiInput(html, 'current_date');
  if (!csrf || !currentDate) {
    throw new Error('Formulir Posting tak dikenali — tampilan intajo.com mungkin berubah');
  }
  const aksiTersedia = aksiTersediaDari(html); // "Sign Off" (masih Open) | "Sign On" (sudah Sign Off)

  return {
    csrf, journalPending, currentDate,
    tertutup: aksiTersedia === 'Sign On',
    aksiTersedia,
  };
}

/* Status Posting KEDUA cabang, dikumpulkan dengan menelusuri satu-satu
   (ganti cabang → jeda reload → baca). Dipakai layar "Tutup Buku" supaya
   pemilik lihat status Manado & Tomohon sebelum memutuskan apa-apa. */
export async function bacaStatusPostingSemuaCabang(email, password) {
  let cookie = await login(email, password);
  const hasil = {};
  for (const kunci of Object.keys(CABANG)) {
    cookie = await gantiCabang(cookie, CABANG[kunci].id);
    cookie = await muatUlangHalamanPosting(cookie);
    hasil[kunci] = await bacaStatusPosting(cookie);
  }
  return hasil;
}

/* Jalankan Sign Off atau Sign On untuk SATU cabang.

   Statusnya dibaca ulang sesudah POST untuk memastikan aksinya benar-benar
   berubah (bukan menyimpulkan dari respons POST yang sulit dipastikan
   artinya) — pola yang sama dengan intajoProses.jalankanProses(). */
export async function jalankanAksiPosting(email, password, kunciCabang, aksi) {
  const cabang = CABANG[kunciCabang];
  if (!cabang) throw new Error('Cabang tidak dikenal: ' + kunciCabang);
  if (aksi !== 'Sign Off' && aksi !== 'Sign On') throw new Error('Aksi tidak dikenal: ' + aksi);

  let cookie = await login(email, password);
  cookie = await gantiCabang(cookie, cabang.id);
  cookie = await muatUlangHalamanPosting(cookie);

  const sebelum = await bacaStatusPosting(cookie);
  if (sebelum.aksiTersedia !== aksi) {
    throw new Error(
      `${cabang.nama} sudah dalam keadaan yang diminta — tombol yang tersedia sekarang "${sebelum.aksiTersedia}", bukan "${aksi}".`);
  }

  const badan = new URLSearchParams({
    csrf_token: sebelum.csrf,
    journal_pending: String(sebelum.journalPending),
    current_date: sebelum.currentDate,
    submit: aksi,
  });
  /* redirect: 'manual' — WAJIB, sama seperti login() di intajoScraper.js.
     intajo merotasi cookie sesi persis di respons 302 sesudah POST ini;
     default fetch (redirect: 'follow') mengikuti redirect itu otomatis
     dan cuma menyisakan header dari halaman TUJUAN akhir, bukan dari 302-
     nya — jadi Set-Cookie yang baru itu lewat begitu saja tanpa kepungut.
     Cookie lama yang lolos ke bacaStatusPosting sesudahnya kadang masih
     jalan (baca statusnya sendiri belum tentu langsung salah), tapi ini
     yang tadi bikin "sesudah" gagal parse dengan pesan
     "Formulir Posting tak dikenali" padahal aksinya sendiri sukses. */
  const res = await fetch(URL_POSTING, {
    method: 'POST',
    redirect: 'manual',
    headers: { Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded', Referer: URL_POSTING },
    body: badan.toString(),
  });
  if (!res.ok && res.status !== 302 && res.status !== 0) throw new Error('intajo menolak ' + aksi + ' (' + res.status + ')');
  cookie = ambilSessionCookie(res) || cookie;

  // Jeda satu halaman sebelum status final dibaca — pola sama dengan
  // muatUlangHalamanPosting sesudah ganti cabang (lihat catatan di kepala
  // berkas): perubahan dari POST ini juga baru "settle" pada permintaan
  // BERIKUTNYA, bukan langsung di respons POST itu sendiri.
  cookie = await muatUlangHalamanPosting(cookie);
  const sesudah = await bacaStatusPosting(cookie);
  if (sesudah.aksiTersedia === sebelum.aksiTersedia) {
    throw new Error(`${aksi} untuk ${cabang.nama} tidak berjalan — status tidak berubah. Cek langsung di intajo.com.`);
  }
  return { cabang: cabang.nama, dari: sebelum.aksiTersedia, sesudah: sesudah.aksiTersedia, status: sesudah };
}
