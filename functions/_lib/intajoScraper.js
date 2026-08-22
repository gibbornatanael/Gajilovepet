/* =========================================================================
   functions/_lib/intajoScraper.js — ambil Pendapatan/Pengeluaran/Keuntungan
   harian per cabang dari dashboard intajo.com (ERP klinik).
   -------------------------------------------------------------------------
   intajo.com TIDAK punya API resmi — ini otomasi login pakai akun Anda
   sendiri (email/password disimpan sebagai secret Cloudflare, tidak pernah
   di kode). Endpointnya ditemukan lewat DevTools browser:
     - POST /login/                   (field: email, password)
     - GET  /dashboard/finance/value  (data keuangan SEMUA cabang sekaligus)

   CATATAN RAPUH: kalau intajo.com mengubah tampilan/struktur API mereka,
   kode ini bisa berhenti berfungsi tanpa peringatan — bukan bug di sini,
   memang begitu risiko scraping tanpa API resmi.
   ========================================================================= */

const BASE = 'https://intajo.com';

/* ID branch di intajo.com sempat tertukar di sini — nama cabang yang benar
   untuk tiap ID sudah dicek ulang dari dashboard intajo.com langsung. */
/* "kode" = nomor cabang seperti tercetak di intajo ("001 - Manado").
   Dipakai intajoNeraca.js untuk MEMASTIKAN PDF yang terunduh benar-benar
   milik cabang yang diminta — lihat catatan di berkas itu. */
export const CABANG = {
  manado: { nama: 'Manado', kode: '001', id: 'ef9cbd0b-f50a-4ef2-9bd9-516082f7b98a' },
  tomohon: { nama: 'Tomohon', kode: '002', id: 'cc1df7cb-1a58-4e81-9ee3-6a9468fab8b2' },
};

/* Login, kembalikan cookie sesi (string "session=...") untuk dipakai
   di request-request berikutnya. */
export async function login(email, password) {
  const res = await fetch(`${BASE}/login/`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `email=${encodeURIComponent(email)}&password=${encodeURIComponent(password)}`,
  });
  const cookie = ambilSessionCookie(res);
  if (!cookie) throw new Error('Login intajo.com gagal — cookie sesi tidak didapat (cek email/password secret)');
  return cookie;
}

export function ambilSessionCookie(res) {
  // Cloudflare Workers menggabung banyak Set-Cookie jadi satu header;
  // pisahkan per "session=" karena itu satu-satunya cookie yang dipakai.
  const raw = res.headers.get('set-cookie') || '';
  const m = raw.match(/session=[^;]+/);
  return m ? m[0] : null;
}

async function ambilDataKeuangan(cookie) {
  const res = await fetch(`${BASE}/dashboard/finance/value`, {
    headers: { Cookie: cookie, Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
  });
  if (!res.ok) throw new Error('Gagal ambil data finance (' + res.status + ')');
  return res.json();
}

/* trans_date dari intajo formatnya "Tue, 30 Jun 2026 17:00:00 GMT".
   PENTING: jam 17:00 GMT itu BUKAN sore hari — itu tengah malam waktu
   Indonesia, yaitu awal hari BERIKUTNYA. Jadi baris "30 Jun 17:00 GMT"
   sebenarnya transaksi tanggal 1 Juli. Membaca bagian tanggalnya mentah-
   mentah (yang dilakukan versi sebelumnya) menggeser semuanya mundur satu
   hari, itu sebabnya angka hari kemarin selalu 0. Digeser +8 jam (WITA)
   dulu, baru diambil tanggalnya. */
function tanggalDari(transDateStr) {
  const d = new Date(new Date(transDateStr).getTime() + 8 * 60 * 60 * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/* Satu respons /dashboard/finance/value berisi blok untuk SEMUA cabang —
   nama bloknya sama persis, yang membedakan hanya field "branch". Versi
   sebelumnya mencari blok cuma lewat nama, jadi selalu dapat blok cabang
   pertama (Manado) untuk kedua cabang — itu sebabnya angka Manado dan
   Tomohon selalu kembar dan "gabungan" cuma Manado dikali dua. */
function jumlahkanBlok(blokList, branchId, namaBlok, tanggalTarget) {
  const blok = blokList.find((b) => b.branch === branchId && b.name === namaBlok);
  if (!blok) return 0;
  return (blok.data || [])
    .filter((row) => tanggalDari(row.trans_date) === tanggalTarget)
    .reduce((s, row) => s + (Number(row.nominal) || 0), 0);
}

function ringkasanCabang(data, branchId, tanggalTarget) {
  const pendapatan = jumlahkanBlok(data, branchId, 'Pendapatan Bulan Berjalan Pendapatan Tahun Ini', tanggalTarget);
  const pengeluaran = jumlahkanBlok(data, branchId, 'Pengeluaran Bulan Berjalan Pengeluaran Tahun Ini', tanggalTarget);
  return { pendapatan, pengeluaran, keuntungan: pendapatan - pengeluaran };
}

/* Fungsi utama: login sekali, ambil data sekali, lalu pisahkan per cabang.
   Tidak perlu berpindah cabang di sesi intajo — datanya sudah lengkap. */
export async function ambilRingkasanSemuaCabang(email, password, tanggalTarget) {
  const cookie = await login(email, password);
  const data = await ambilDataKeuangan(cookie);

  const hasil = {};
  for (const kunci of Object.keys(CABANG)) {
    hasil[kunci] = ringkasanCabang(data, CABANG[kunci].id, tanggalTarget);
  }
  return hasil;
}
