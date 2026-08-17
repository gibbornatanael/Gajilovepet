/* =========================================================================
   functions/_lib/intajoScraper.js — ambil Pendapatan/Pengeluaran/Keuntungan
   harian per cabang dari dashboard intajo.com (ERP klinik).
   -------------------------------------------------------------------------
   intajo.com TIDAK punya API resmi — ini otomasi login pakai akun Anda
   sendiri (email/password disimpan sebagai secret Cloudflare, tidak pernah
   di kode). Endpointnya ditemukan lewat DevTools browser:
     - POST /login/                          (field: email, password)
     - GET  /secureAPI/branch/change/<uuid>   (pindah cabang aktif)
     - GET  /dashboard/finance/value          (data keuangan cabang aktif)

   CATATAN RAPUH: kalau intajo.com mengubah tampilan/struktur API mereka,
   kode ini bisa berhenti berfungsi tanpa peringatan — bukan bug di sini,
   memang begitu risiko scraping tanpa API resmi.
   ========================================================================= */

const BASE = 'https://intajo.com';

export const CABANG = {
  manado: { nama: 'Manado', id: 'cc1df7cb-1a58-4e81-9ee3-6a9468fab8b2' },
  tomohon: { nama: 'Tomohon', id: 'ef9cbd0b-f50a-4ef2-9bd9-516082f7b98a' },
};

/* Login, kembalikan cookie sesi (string "session=...") untuk dipakai
   di request-request berikutnya. */
async function login(email, password) {
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

function ambilSessionCookie(res) {
  // Cloudflare Workers menggabung banyak Set-Cookie jadi satu header;
  // pisahkan per "session=" karena itu satu-satunya cookie yang dipakai.
  const raw = res.headers.get('set-cookie') || '';
  const m = raw.match(/session=[^;]+/);
  return m ? m[0] : null;
}

async function pindahCabang(cookie, branchId) {
  const res = await fetch(`${BASE}/secureAPI/branch/change/${branchId}`, {
    headers: { Cookie: cookie, 'X-Requested-With': 'XMLHttpRequest' },
  });
  if (!res.ok) throw new Error('Gagal pindah cabang (' + res.status + ')');
}

async function ambilDataKeuangan(cookie) {
  const res = await fetch(`${BASE}/dashboard/finance/value`, {
    headers: { Cookie: cookie, Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
  });
  if (!res.ok) throw new Error('Gagal ambil data finance (' + res.status + ')');
  return res.json();
}

/* trans_date dari intajo formatnya "Tue, 30 Jun 2026 17:00:00 GMT" —
   kita cocokkan lewat bagian TANGGAL-nya saja (UTC), diformat YYYY-MM-DD. */
function tanggalDari(transDateStr) {
  const d = new Date(transDateStr);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function jumlahkanBlok(blokList, namaBlok, tanggalTarget) {
  const blok = blokList.find((b) => b.name === namaBlok);
  if (!blok) return 0;
  return blok.data
    .filter((row) => tanggalDari(row.trans_date) === tanggalTarget)
    .reduce((s, row) => s + (Number(row.nominal) || 0), 0);
}

/* Hasil: { pendapatan, pengeluaran, keuntungan } untuk cabang yang SEDANG
   aktif di sesi ini, untuk satu tanggal (format YYYY-MM-DD). */
async function ringkasanCabangAktif(cookie, tanggalTarget) {
  const data = await ambilDataKeuangan(cookie);
  const pendapatan = jumlahkanBlok(data, 'Pendapatan Bulan Berjalan Pendapatan Tahun Ini', tanggalTarget);
  const pengeluaran = jumlahkanBlok(data, 'Pengeluaran Bulan Berjalan Pengeluaran Tahun Ini', tanggalTarget);
  return { pendapatan, pengeluaran, keuntungan: pendapatan - pengeluaran };
}

/* Fungsi utama: login sekali, lalu ambil ringkasan tiap cabang di CABANG
   untuk tanggal tertentu. */
export async function ambilRingkasanSemuaCabang(email, password, tanggalTarget) {
  const cookie = await login(email, password);
  const hasil = {};
  for (const kunci of Object.keys(CABANG)) {
    await pindahCabang(cookie, CABANG[kunci].id);
    hasil[kunci] = await ringkasanCabangAktif(cookie, tanggalTarget);
  }
  return hasil;
}
