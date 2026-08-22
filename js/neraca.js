/* =========================================================================
   neraca.js — Laporan Neraca (sisi pemilik)
   -------------------------------------------------------------------------
   Menampilkan neraca Manado, Tomohon, dan Gabungan BERDAMPINGAN supaya
   ketiganya bisa dibaca sekali lihat. Datanya tidak diambil dari intajo.com
   dari sini — Worker yang menariknya (functions/api/intajo-neraca.js) dan
   menyimpannya ke klinik/lovepet/neracaIntajo/{YYYY-MM-DD}; halaman ini
   hanya membaca Firestore, sama seperti kartu Ringkasan intajo.

   Tombol "Tarik data sekarang" memanggil /api/neraca-tarik dengan idToken
   sebagai bukti bahwa yang menekan adalah pemilik. Kredensial intajo.com
   ada di Worker, tidak pernah di browser.
   ========================================================================= */

const KLINIK_ID = 'lovepet';

/* Ketiga kolom angka, berurutan kiri→kanan. "gabungan" bukan cabang
   sungguhan: ia hasil penjumlahan di Worker, makanya jalurnya beda. */
const KOLOM = [
  { kunci: 'manado', judul: 'Manado', ambil: (d) => d.cabang && d.cabang.manado },
  { kunci: 'tomohon', judul: 'Tomohon', ambil: (d) => d.cabang && d.cabang.tomohon },
  { kunci: 'gabungan', judul: 'Gabungan', ambil: (d) => d.gabungan, gabungan: true },
];

let db = null, fsMod = null;
let dokumenTerakhir = null;          // dokumen Firestore neraca yang sedang ditampilkan

const q = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* Gaya akuntansi: angka minus ditulis dalam kurung, seperti di intajo. */
function uang(v) {
  const n = Math.round(Number(v) || 0);
  const teks = Math.abs(n).toLocaleString('id-ID');
  return n < 0 ? `(${teks})` : teks;
}

function tanggalWita(geser = 0) {
  const d = new Date(Date.now() + 8 * 60 * 60 * 1000);
  d.setUTCDate(d.getUTCDate() + geser);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

const NAMA_BULAN_SINGKAT = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
function tanggalPanjang(t) {
  const [y, m, tgl] = String(t).split('-');
  return `${tgl} ${NAMA_BULAN_SINGKAT[Number(m) - 1]} ${y}`;
}

/* ============================ Mulai ============================ */
document.addEventListener('cloud-siap', mulai);

function mulai() {
  const C = window.CLOUD;
  if (!C || !C.aktif || !C.db) return;
  db = C.db; fsMod = C.fsMod;

  q('#neracaTanggal')?.addEventListener('change', segarkan);
  q('#btnTarikNeraca')?.addEventListener('click', (e) => tarikSekarang(e.currentTarget));
  segarkan();
  muatStatusProses();
}

/* Tanggal yang ditampilkan pertama kali BUKAN hari ini, melainkan neraca
   terbaru yang sudah tersimpan. Sebabnya intajo hanya mengisi neraca untuk
   periode yang pembukuannya sudah diproses — neraca "hari ini" hampir
   selalu masih kosong, jadi membukanya di tanggal itu cuma menampilkan
   halaman hampa. Nama dokumen = tanggalnya, jadi urutan id = urutan waktu. */
async function tanggalTerbaruTersimpan() {
  try {
    const snap = await fsMod.getDocs(fsMod.query(
      fsMod.collection(db, 'klinik', KLINIK_ID, 'neracaIntajo'),
      fsMod.orderBy(fsMod.documentId(), 'desc'), fsMod.limit(1)));
    return snap.empty ? null : snap.docs[0].id;
  } catch (e) {
    console.warn('Neraca terbaru:', e);
    return null;
  }
}

/* ============================ Baca & render ============================ */

/* Dipanggil app.js tiap kali tab Neraca dibuka. */
async function segarkan() {
  if (!db) return;
  const wadah = q('#neracaKolom');
  const ket = q('#neracaKeterangan');
  const input = q('#neracaTanggal');
  if (!wadah || !input) return;

  if (!input.value) input.value = (await tanggalTerbaruTersimpan()) || tanggalWita(0);
  const tanggal = input.value;

  wadah.innerHTML = '<p class="muted">Memuat…</p>';
  try {
    const snap = await fsMod.getDoc(fsMod.doc(db, 'klinik', KLINIK_ID, 'neracaIntajo', tanggal));
    if (!snap.exists()) {
      wadah.innerHTML = '';
      if (ket) ket.textContent =
        `Belum ada neraca tersimpan untuk ${tanggalPanjang(tanggal)}. Tekan "Tarik data sekarang" untuk mengambilnya dari intajo.com — hasilnya baru terisi kalau pembukuan periode itu sudah diproses di intajo.`;
      return;
    }
    dokumenTerakhir = snap.data();
    if (ket) {
      const jam = dokumenTerakhir.diperbaruiPada ? new Date(dokumenTerakhir.diperbaruiPada).toLocaleString('id-ID') : '—';
      ket.textContent = `Neraca per ${tanggalPanjang(dokumenTerakhir.tanggal || tanggal)} · terakhir ditarik ${jam}`;
    }
    gambarKolom();
  } catch (e) {
    console.error('Neraca:', e);
    wadah.innerHTML = '<p class="muted">Gagal memuat neraca.</p>';
  }
}

/* Digambar ulang dari dokumenTerakhir (tanpa baca Firestore lagi) — dipakai
   waktu neraca pertama dimuat maupun setelah popup detail ditutup. */
function gambarKolom() {
  const wadah = q('#neracaKolom');
  if (!wadah || !dokumenTerakhir) return;
  wadah.innerHTML = tabelUtama(dokumenTerakhir);
  q('#btnDetailNeraca')?.addEventListener('click', () => bukaDetail(dokumenTerakhir));
}

/* Nama akun dipakai bersama oleh Manado, Tomohon & Gabungan (satu bagan
   akun yang sama) — jadi ditulis SEKALI di kolom paling kiri, dan angka
   ketiganya ditaruh sejajar di sebelahnya supaya langsung bisa dibandingkan
   tanpa bolak-balik antar kartu.

   Urutan barisnya diambil dari d.gabungan (kiri/kanan): itu sudah berupa
   gabungan SEMUA akun dari kedua cabang dalam urutan yang konsisten (lihat
   gabungSisi() di intajoNeraca.js), jadi dipakai sebagai "daftar induk".
   Akun yang cuma dipunyai satu cabang (mis. "Rek. Pusat" cuma ada di
   Tomohon) otomatis ikut muncul, dan cabang yang tidak punya akun itu
   ditampilkan "–" alih-alih 0 (beda arti: 0 = punya akunnya tapi saldo
   nol, "–" = akun itu tidak ada di cabang tersebut sama sekali). */
function baseNum(rows) {
  const m = new Map();
  (rows || []).forEach((r) => m.set(r.num, r));
  return m;
}

function tabelUtama(d) {
  const gab = d.gabungan;
  if (!gab) return '<p class="muted">Tidak ada data.</p>';

  const status = KOLOM.map((k) => {
    const data = k.ambil(d);
    return {
      kunci: k.kunci, judul: k.judul,
      seimbang: data ? Math.round((data.totalKiri?.total || 0) - (data.totalKanan?.total || 0)) === 0 : true,
    };
  });
  const adaTimpang = status.some((s) => !s.seimbang);

  const peta = {
    manado: { kiri: baseNum(d.cabang?.manado?.kiri), kanan: baseNum(d.cabang?.manado?.kanan) },
    tomohon: { kiri: baseNum(d.cabang?.tomohon?.kiri), kanan: baseNum(d.cabang?.tomohon?.kanan) },
  };

  const bagian = (judul, masterRows, sisiKunci, totalManado, totalTomohon, totalGabungan) => {
    if (!masterRows || !masterRows.length) return '';
    const baris = masterRows.map((m) => {
      const manado = peta.manado[sisiKunci].get(m.num);
      const tomohon = peta.tomohon[sisiKunci].get(m.num);
      const tingkat = Number(m.tingkat) || 0;
      const sel = (v) => v == null
        ? '<td class="num neraca-nihil">–</td>'
        : `<td class="num ${Number(v.total) < 0 ? 'neraca-minus' : ''}">${uang(v.total)}</td>`;
      return `<tr class="${tingkat <= 1 ? 'neraca-induk' : ''}">
        <td style="padding-left:${8 + tingkat * 13}px" title="${esc(m.num)}">${esc(m.nama)}</td>
        ${sel(manado)}${sel(tomohon)}
        <td class="num ${Number(m.total) < 0 ? 'neraca-minus' : ''}">${uang(m.total)}</td>
      </tr>`;
    }).join('');
    return `<tbody>
      <tr class="neraca-bagian"><td colspan="4">${esc(judul)}</td></tr>
      ${baris}
      <tr class="neraca-jumlah">
        <td>Jumlah ${esc(judul)}</td>
        <td class="num">${uang(totalManado)}</td>
        <td class="num">${uang(totalTomohon)}</td>
        <td class="num">${uang(totalGabungan)}</td>
      </tr>
    </tbody>`;
  };

  return `
    <div class="card">
      <div class="card-head neraca-head">
        <div>
          <h2>Neraca — Manado, Tomohon &amp; Gabungan</h2>
          <p class="muted neraca-catatan">Kolom Gabungan = kedua cabang dijumlahkan; akun Antar Cabang belum dieliminasi.</p>
        </div>
        <button type="button" class="btn ghost btn-sm" id="btnDetailNeraca">Lihat detail (Begin/Debit/Credit)</button>
      </div>
      <div class="table-scroll">
        <table class="tbl neraca-tbl">
          <thead>
            <tr>
              <th>Akun</th>
              ${status.map((s) => `<th${s.kunci === 'gabungan' ? ' class="neraca-kol-gabungan"' : ''}>${esc(s.judul)}${s.seimbang ? '' : ' ⚠'}</th>`).join('')}
            </tr>
          </thead>
          ${bagian('Aset', gab.kiri, 'kiri',
            d.cabang?.manado?.totalKiri?.total, d.cabang?.tomohon?.totalKiri?.total, gab.totalKiri?.total)}
          ${bagian('Kewajiban &amp; Modal', gab.kanan, 'kanan',
            d.cabang?.manado?.totalKanan?.total, d.cabang?.tomohon?.totalKanan?.total, gab.totalKanan?.total)}
        </table>
      </div>
      ${adaTimpang ? `<p class="neraca-timpang">⚠ ${status.filter((s) => !s.seimbang).map((s) => s.judul).join(', ')}: sisi Aset dan Kewajiban+Modal tidak seimbang.</p>` : ''}
    </div>`;
}
/* ==================== Popup detail (Begin/Debit/Credit/Total) ====================
   Dibuka dari tombol "Lihat detail". Beda dari tabel utama: di sini SETIAP
   cabang dapat 4 kolom angka sendiri (bukan cuma Total), jadi lebarnya
   sengaja dibiarkan lebar dan digulir sendiri di dalam popup — supaya
   tabel ringkas di halaman utama tidak ikut mengempis gara-gara ini. */
function bukaDetail(d) {
  const dialog = q('#neracaDialog');
  if (!dialog) return;

  const peta = {
    manado: { kiri: baseNum(d.cabang?.manado?.kiri), kanan: baseNum(d.cabang?.manado?.kanan) },
    tomohon: { kiri: baseNum(d.cabang?.tomohon?.kiri), kanan: baseNum(d.cabang?.tomohon?.kanan) },
  };
  const kosong = { begin: 0, debit: 0, credit: 0, total: 0 };

  const headerGrup = KOLOM.map((k) =>
    `<th colspan="4" class="neraca-grup-head${k.kunci === 'gabungan' ? ' neraca-kol-gabungan' : ''}">${esc(k.judul)}</th>`).join('');
  const headerSub = KOLOM.map(() => '<th class="num">Begin</th><th class="num">Debit</th><th class="num">Credit</th><th class="num">Total</th>').join('');

  const selDetail = (v) => {
    const x = v || kosong;
    const kelas = v == null ? ' neraca-nihil' : (Number(x.total) < 0 ? ' neraca-minus' : '');
    return `<td class="num">${v ? uang(x.begin) : '–'}</td><td class="num">${v ? uang(x.debit) : '–'}</td>` +
      `<td class="num">${v ? uang(x.credit) : '–'}</td><td class="num${kelas}">${v ? uang(x.total) : '–'}</td>`;
  };

  const bagian = (judul, masterRows, sisiKunci, tot) => {
    if (!masterRows || !masterRows.length) return '';
    const baris = masterRows.map((m) => {
      const tingkat = Number(m.tingkat) || 0;
      return `<tr class="${tingkat <= 1 ? 'neraca-induk' : ''}">
        <td style="padding-left:${8 + tingkat * 13}px" title="${esc(m.num)}">${esc(m.nama)}</td>
        ${selDetail(peta.manado[sisiKunci].get(m.num))}
        ${selDetail(peta.tomohon[sisiKunci].get(m.num))}
        ${selDetail(m)}
      </tr>`;
    }).join('');
    return `<tbody>
      <tr class="neraca-bagian"><td colspan="13">${esc(judul)}</td></tr>
      ${baris}
      <tr class="neraca-jumlah">
        <td>Jumlah ${esc(judul)}</td>
        ${selDetail(tot.manado)}${selDetail(tot.tomohon)}${selDetail(tot.gabungan)}
      </tr>
    </tbody>`;
  };

  dialog.innerHTML = `
    <div class="neraca-dialog-card">
      <div class="card-head">
        <h2>Detail Neraca per ${esc(tanggalPanjang(d.tanggal))}</h2>
        <button type="button" class="btn ghost btn-sm" id="neracaDetailTutup">Tutup</button>
      </div>
      <div class="table-scroll">
        <table class="tbl neraca-tbl neraca-tbl-detail">
          <thead>
            <tr><th rowspan="2"></th>${headerGrup}</tr>
            <tr>${headerSub}</tr>
          </thead>
          ${bagian('Aset', d.gabungan.kiri, 'kiri', {
            manado: d.cabang?.manado?.totalKiri, tomohon: d.cabang?.tomohon?.totalKiri, gabungan: d.gabungan.totalKiri,
          })}
          ${bagian('Kewajiban &amp; Modal', d.gabungan.kanan, 'kanan', {
            manado: d.cabang?.manado?.totalKanan, tomohon: d.cabang?.tomohon?.totalKanan, gabungan: d.gabungan.totalKanan,
          })}
        </table>
      </div>
    </div>`;
  dialog.hidden = false;

  const tutup = () => { dialog.hidden = true; dialog.innerHTML = ''; };
  q('#neracaDetailTutup', dialog).addEventListener('click', tutup);
  dialog.addEventListener('click', (e) => { if (e.target === dialog) tutup(); }, { once: true });
  document.addEventListener('keydown', function esc1(e) {
    if (e.key === 'Escape') { tutup(); document.removeEventListener('keydown', esc1); }
  });
}

/* ============================ Tarik manual ============================ */
async function tarikSekarang(tombol) {
  const auth = window.CLOUD && window.CLOUD.auth;
  if (!auth || !auth.currentUser) return alert('Masuk dulu sebagai pemilik.');

  const tanggal = q('#neracaTanggal')?.value || tanggalWita(0);
  const semula = tombol.textContent;
  tombol.disabled = true;
  tombol.textContent = 'Menarik…';
  try {
    const idToken = await auth.currentUser.getIdToken();
    const res = await fetch('/api/neraca-tarik', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken, tanggal }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.ok) throw new Error(j.error || 'Gagal (' + res.status + ')');
    await segarkan();
    tombol.textContent = 'Data diperbarui';
  } catch (e) {
    console.error('tarikNeraca:', e);
    alert('Gagal menarik neraca: ' + e.message);
    tombol.textContent = semula;
  } finally {
    tombol.disabled = false;
    setTimeout(() => { tombol.textContent = semula; }, 3000);
  }
}

/* ==================== TUTUP BUKU (Accounting Process) ====================
   Satu-satunya bagian aplikasi ini yang MENULIS ke intajo.com. Tidak bisa
   dibatalkan dari sini (intajo punya menu terpisah "Accounting Back Date"),
   jadi alurnya sengaja dibuat berlapis: keadaan sebenarnya ditampilkan
   dulu, berapa hari yang akan tertutup dihitung dan disebutkan, lalu
   pemilik harus MENGETIK ULANG tanggal tujuannya sebagai persetujuan.
   Tombol yang cuma perlu "OK" terlalu mudah tertekan tanpa dibaca. */

let prosesStatus = null;

async function muatStatusProses() {
  const wadah = q('#prosesIsi');
  const auth = window.CLOUD && window.CLOUD.auth;
  if (!wadah || !auth || !auth.currentUser) return;

  wadah.innerHTML = '<p class="muted">Memuat keadaan pembukuan…</p>';
  try {
    const idToken = await auth.currentUser.getIdToken();
    const res = await fetch('/api/proses-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.ok) throw new Error(j.error || 'Gagal (' + res.status + ')');
    prosesStatus = j;
    gambarProses();
  } catch (e) {
    console.error('proses-status:', e);
    wadah.innerHTML = `<p class="muted">Tidak bisa membaca keadaan pembukuan intajo: ${esc(e.message)}</p>`;
  }
}

/* Baru ketahuan setelah percobaan pertama gagal: Accounting Process
   menolak berjalan sampai KEDUA cabang di-"Sign Off" lebih dulu di halaman
   Posting intajo — bukan soal jurnal pending seperti dugaan awal. Jadi
   status Sign Off ditampilkan lebih dulu di sini, dan tombol tutup buku
   dikunci selama masih ada cabang yang belum Sign Off, supaya pemilik
   tidak lagi menebak-nebak kenapa prosesnya ditolak. */
function gambarProses() {
  const s = prosesStatus;
  const hariTertinggal = Math.max(0, selisihHari(s.tanggalSekarang, tanggalWita(0)));
  const kunciCabang = Object.keys(s.posting || {});
  const semuaSignOff = kunciCabang.length > 0 && kunciCabang.every((k) => s.posting[k].tertutup);
  const namaCabang = { manado: 'Manado', tomohon: 'Tomohon' };

  q('#prosesIsi').innerHTML = `
    <div class="cabang-row" style="grid-template-columns:repeat(2,1fr)">
      <div class="stat"><div class="k">Buku intajo sekarang</div><div class="v">${tanggalPanjang(s.tanggalSekarang)}</div></div>
      <div class="stat ${hariTertinggal > 0 ? 'untung-minus' : 'untung-plus'}">
        <div class="k">Tertinggal</div><div class="v">${hariTertinggal} hari</div></div>
    </div>

    <p class="cabang-judul" style="margin-top:14px">1. Sign Off Branch (wajib sebelum tutup buku)</p>
    <div class="neraca-signoff-row">
      ${kunciCabang.map((k) => {
        const p = s.posting[k];
        return `<div class="neraca-signoff-cabang">
          <span class="badge ${p.tertutup ? '' : 'badge-open'}">${esc(namaCabang[k] || k)} — ${p.tertutup ? 'Sign Off ✓' : 'Open (belum Sign Off)'}</span>
          <button type="button" class="btn ${p.tertutup ? 'ghost' : ''} btn-sm" data-signoff-cabang="${k}" data-signoff-aksi="${esc(p.aksiTersedia)}">
            ${esc(p.aksiTersedia)}
          </button>
        </div>`;
      }).join('')}
    </div>
    <p class="muted neraca-catatan" style="margin-top:6px">
      Sign Off mengunci transaksi harian cabang itu di intajo sampai di-Sign On lagi. Jangan dijalankan saat klinik sedang aktif mencatat transaksi.
    </p>

    <p class="cabang-judul" style="margin-top:16px">2. Tutup Buku (Accounting Process)</p>
    <div class="toolbar">
      <label class="period-picker">
        <span class="sr-only">Proses sampai tanggal</span>
        <input type="date" id="prosesSampai" min="${esc(s.tanggalMinimal)}" value="${esc(s.tanggalMinimal)}" ${semuaSignOff ? '' : 'disabled'}>
      </label>
      <button class="btn" id="btnProses" type="button" ${semuaSignOff ? '' : 'disabled'}>Proses sampai tanggal ini</button>
    </div>
    ${semuaSignOff ? '' : '<p class="muted neraca-catatan">Menunggu semua cabang Sign Off dulu.</p>'}
    <p class="proses-awas">
      ⚠ Tutup buku menulis ke pembukuan intajo dan <b>tidak bisa dibatalkan dari aplikasi ini</b>
      (memundurkannya harus lewat menu Accounting Back Date di intajo). Berlaku untuk kedua cabang
      sekaligus, maksimal ${s.maksHariSekali} hari sekali proses.
    </p>`;

  q('#btnProses')?.addEventListener('click', (e) => jalankanProses(e.currentTarget));
  q('#prosesIsi').querySelectorAll('[data-signoff-cabang]').forEach((btn) => {
    btn.addEventListener('click', () => jalankanSignoff(btn, btn.dataset.signoffCabang, btn.dataset.signoffAksi));
  });
}

async function jalankanSignoff(tombol, cabang, aksi) {
  const namaCabang = { manado: 'Manado', tomohon: 'Tomohon' }[cabang] || cabang;
  const peringatan = aksi === 'Sign Off'
    ? `Sign Off ${namaCabang} akan MENGUNCI transaksi harian cabang itu di intajo — klinik tidak bisa mencatat transaksi baru sampai di-Sign On lagi.\n\nJangan dijalankan kalau klinik sedang aktif memakai intajo.\n\nLanjutkan Sign Off ${namaCabang}?`
    : `Sign On ${namaCabang} akan membuka kembali cabang itu untuk transaksi harian.\n\nLanjutkan Sign On ${namaCabang}?`;
  if (!confirm(peringatan)) return;

  const semula = tombol.textContent;
  tombol.disabled = true;
  tombol.textContent = 'Memproses…';
  try {
    const idToken = await window.CLOUD.auth.currentUser.getIdToken();
    const res = await fetch('/api/proses-signoff', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken, cabang, aksi }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.ok) throw new Error(j.error || 'Gagal (' + res.status + ')');
    await muatStatusProses();
  } catch (e) {
    console.error('proses-signoff:', e);
    alert(`Gagal ${aksi} ${namaCabang}: ` + e.message);
    tombol.disabled = false;
    tombol.textContent = semula;
  }
}

const selisihHari = (dari, sampai) =>
  Math.round((Date.parse(sampai + 'T00:00:00Z') - Date.parse(dari + 'T00:00:00Z')) / 86400000);

async function jalankanProses(tombol) {
  const s = prosesStatus;
  const sampai = q('#prosesSampai')?.value;
  if (!s || !sampai) return;

  if (sampai < s.tanggalMinimal) {
    return alert(`Tutup buku tidak bisa mundur. Paling cepat ke ${tanggalPanjang(s.tanggalMinimal)}.`);
  }
  const hari = selisihHari(s.tanggalSekarang, sampai);
  if (hari > s.maksHariSekali) {
    return alert(`Itu ${hari} hari sekaligus — dibatasi maksimal ${s.maksHariSekali} hari sekali proses.`);
  }

  // Persetujuan: ketik ulang tanggalnya. Bukan sekadar OK/Batal.
  const jawab = prompt(
    `Akan menutup pembukuan ${hari} hari:\n` +
    `  dari ${tanggalPanjang(s.tanggalSekarang)}\n` +
    `  sampai ${tanggalPanjang(sampai)}\n` +
    `untuk KEDUA cabang. Tidak bisa dibatalkan dari aplikasi ini.\n\n` +
    `Kalau yakin, ketik ulang tanggal tujuannya (${sampai}):`);
  if (jawab === null) return;
  if (jawab.trim() !== sampai) return alert('Tanggal yang diketik tidak sama — dibatalkan, tidak ada yang diproses.');

  const semula = tombol.textContent;
  tombol.disabled = true;
  tombol.textContent = 'Memproses…';
  try {
    const idToken = await window.CLOUD.auth.currentUser.getIdToken();
    const res = await fetch('/api/proses-jalankan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken, tanggal: sampai, tanggalSekarangDilihat: s.tanggalSekarang }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.ok) throw new Error(j.error || 'Gagal (' + res.status + ')');
    alert(`Berhasil. Buku intajo sekarang di ${tanggalPanjang(j.sampai)} (${j.hari} hari diproses).`);
    await muatStatusProses();
  } catch (e) {
    console.error('proses-jalankan:', e);
    alert('Gagal menutup buku: ' + e.message);
  } finally {
    tombol.disabled = false;
    tombol.textContent = semula;
  }
}

window.Neraca = { segarkan };
