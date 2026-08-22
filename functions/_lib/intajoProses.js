/* =========================================================================
   functions/_lib/intajoProses.js — Accounting Process ("tutup buku")
   di intajo.com.
   -------------------------------------------------------------------------
   BEDA SIFAT dengan berkas intajo lain di folder ini: intajoScraper.js dan
   intajoNeraca.js hanya MEMBACA. Berkas ini MENULIS ke pembukuan sungguhan
   dan tidak bisa dibatalkan dari sini — intajo menyediakan menu terpisah
   "Accounting Back Date" untuk memundurkannya. Karena itu:

     • tidak pernah dipanggil cron / otomatis — hanya lewat tombol pemilik;
     • tanggal tujuan divalidasi ulang di sisi Worker, tidak percaya
       begitu saja pada apa yang dikirim browser;
     • hasilnya tidak disimpulkan dari respons POST, melainkan dengan
       MEMBACA ULANG status dari intajo sesudahnya (lihat jalankanProses).

   Formulirnya (GET /finaccounting/process) berisi:
     csrf_token   — token per sesi, wajib ikut dikirim
     current_date — readonly; tanggal buku saat ini
     next_date    — tanggal tujuan, minimalnya current_date + 1 hari
     submit=Process

   Prosesnya maju hari demi hari dan berlaku untuk SEMUA cabang sekaligus,
   jadi tidak perlu ganti cabang seperti di intajoNeraca.js.
   ========================================================================= */

const BASE = 'https://intajo.com';
const URL_PROSES = `${BASE}/finaccounting/process`;

/* Batas kewarasan: sekali klik tidak boleh menutup lebih dari sekian hari.
   Bukan aturan intajo — pagar buatan sendiri supaya salah ketik tahun
   (mis. 2027 alih-alih 2026) tidak menutup ratusan hari sekaligus. */
export const MAKS_HARI_SEKALI = 62;

const ambilNilaiInput = (html, nama) => {
  const m = html.match(new RegExp(`<input[^>]*name="${nama}"[^>]*>`, 'i'));
  const v = m && m[0].match(/value="([^"]*)"/i);
  return v ? v[1] : null;
};

/* Status per cabang di tabel "Close" — checkbox-nya readonly, isinya
   sekadar penanda apakah cabang itu sudah ditutup untuk hari berjalan. */
function statusCabang(html) {
  const hasil = [];
  for (const m of html.matchAll(
    /<tr id="rowBranch">\s*<td>\s*<input[^>]*value="(True|False)"[^>]*>\s*<\/td>\s*<td>([^<]*)<\/td>\s*<td>([^<]*)<\/td>/gi)) {
    hasil.push({ tertutup: m[1] === 'True', kode: m[2].trim(), nama: m[3].trim() });
  }
  return hasil;
}

/* Baca keadaan sekarang: tanggal buku, tanggal terdekat yang boleh dituju,
   token, dan status tiap cabang. Murni GET — tidak mengubah apa pun. */
export async function bacaStatusProses(cookie) {
  const res = await fetch(URL_PROSES, { headers: { Cookie: cookie, Accept: 'text/html' } });
  if (!res.ok) throw new Error('Gagal membuka halaman Accounting Process (' + res.status + ')');
  const html = await res.text();

  const tanggalSekarang = ambilNilaiInput(html, 'current_date');
  const csrf = ambilNilaiInput(html, 'csrf_token');
  if (!tanggalSekarang || !csrf) {
    throw new Error('Formulir Accounting Process tak dikenali — tampilan intajo.com mungkin berubah');
  }

  const minNext = (html.match(/<input[^>]*name="next_date"[^>]*>/i) || [''])[0].match(/min="([^"]*)"/i);
  return {
    tanggalSekarang,
    tanggalMinimal: minNext ? minNext[1] : tambahHari(tanggalSekarang, 1),
    cabang: statusCabang(html),
    csrf,
  };
}

const tambahHari = (t, n) => {
  const d = new Date(t + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export const selisihHari = (dari, sampai) =>
  Math.round((Date.parse(sampai + 'T00:00:00Z') - Date.parse(dari + 'T00:00:00Z')) / 86400000);

/* Jalankan tutup buku sampai `sampaiTanggal`.

   Sengaja membaca status DUA KALI: sekali sebelum (untuk mendapat token
   sekaligus memvalidasi tanggal terhadap keadaan intajo yang sebenarnya,
   bukan terhadap tebakan browser), sekali sesudah (untuk memastikan
   tanggal bukunya benar-benar pindah). Respons POST-nya sendiri berupa
   halaman HTML biasa yang sulit dipastikan artinya; tanggal buku yang
   bergeser adalah bukti yang tidak bisa berbohong. */
export async function jalankanProses(cookie, sampaiTanggal) {
  const sebelum = await bacaStatusProses(cookie);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(sampaiTanggal)) throw new Error('Tanggal tidak sah');
  if (sampaiTanggal < sebelum.tanggalMinimal) {
    throw new Error(
      `Tanggal ${sampaiTanggal} sudah lewat — buku intajo sekarang di ${sebelum.tanggalSekarang}, ` +
      `paling cepat bisa diproses sampai ${sebelum.tanggalMinimal}. Tutup buku tidak bisa mundur.`);
  }
  const hari = selisihHari(sebelum.tanggalSekarang, sampaiTanggal);
  if (hari > MAKS_HARI_SEKALI) {
    throw new Error(
      `Permintaan ini menutup ${hari} hari sekaligus (dari ${sebelum.tanggalSekarang}). ` +
      `Dibatasi maksimal ${MAKS_HARI_SEKALI} hari sekali proses — periksa lagi tanggalnya.`);
  }

  const badan = new URLSearchParams({
    csrf_token: sebelum.csrf,
    current_date: sebelum.tanggalSekarang,
    next_date: sampaiTanggal,
    submit: 'Process',
  });

  const res = await fetch(URL_PROSES, {
    method: 'POST',
    headers: {
      Cookie: cookie,
      'Content-Type': 'application/x-www-form-urlencoded',
      Referer: URL_PROSES,
    },
    body: badan.toString(),
  });
  if (!res.ok && res.status !== 302) throw new Error('intajo menolak proses (' + res.status + ')');
  await res.text();

  const sesudah = await bacaStatusProses(cookie);
  if (sesudah.tanggalSekarang === sebelum.tanggalSekarang) {
    throw new Error(
      `Proses tidak berjalan — tanggal buku masih ${sebelum.tanggalSekarang}. ` +
      `Biasanya karena masih ada jurnal yang belum di-authorize atau di-posting di intajo.`);
  }

  return { sebelum: sebelum.tanggalSekarang, sesudah: sesudah.tanggalSekarang, status: sesudah };
}
