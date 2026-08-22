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

/* Ketiga kolom, berurutan kiri→kanan. "gabungan" bukan cabang sungguhan:
   ia hasil penjumlahan di Worker, makanya jalurnya beda. */
const KOLOM = [
  { kunci: 'manado', judul: 'Manado', ambil: (d) => d.cabang && d.cabang.manado },
  { kunci: 'tomohon', judul: 'Tomohon', ambil: (d) => d.cabang && d.cabang.tomohon },
  { kunci: 'gabungan', judul: 'Gabungan', ambil: (d) => d.gabungan, gabungan: true },
];

let db = null, fsMod = null;

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
    const d = snap.data();
    if (ket) {
      const jam = d.diperbaruiPada ? new Date(d.diperbaruiPada).toLocaleString('id-ID') : '—';
      ket.textContent = `Neraca per ${tanggalPanjang(d.tanggal || tanggal)} · terakhir ditarik ${jam}`;
    }
    wadah.innerHTML = KOLOM.map((k) => kartuKolom(k, k.ambil(d))).join('');
  } catch (e) {
    console.error('Neraca:', e);
    wadah.innerHTML = '<p class="muted">Gagal memuat neraca.</p>';
  }
}

function kartuKolom(kolom, data) {
  if (!data) return `<div class="card neraca-kartu"><div class="card-head"><h2>${esc(kolom.judul)}</h2></div><p class="muted">Tidak ada data.</p></div>`;

  // Neraca selalu harus seimbang. Kalau tidak, ada yang salah di
  // pembacaan PDF — lebih baik kelihatan daripada diam-diam menyesatkan.
  const seimbang = Math.round((data.totalKiri?.total || 0) - (data.totalKanan?.total || 0)) === 0;

  return `
    <div class="card neraca-kartu">
      <div class="card-head">
        <h2>${esc(kolom.judul)}</h2>
        ${kolom.gabungan ? '<p class="muted">Kedua cabang dijumlahkan; akun Antar Cabang belum dieliminasi.</p>' : ''}
      </div>
      ${sisi('Aset', data.kiri, data.totalKiri)}
      ${sisi('Kewajiban & Modal', data.kanan, data.totalKanan)}
      ${seimbang ? '' : '<p class="neraca-timpang">⚠ Sisi kiri dan kanan tidak seimbang.</p>'}
    </div>`;
}

function sisi(judul, baris, total) {
  if (!baris || !baris.length) return '';
  return `
    <div class="neraca-sisi">
      <p class="cabang-judul">${esc(judul)}</p>
      <table class="tbl neraca-tbl">
        <tbody>${baris.map(barisHtml).join('')}</tbody>
        ${total ? `<tfoot><tr><td>Jumlah</td><td class="num">${uang(total.total)}</td></tr></tfoot>` : ''}
      </table>
    </div>`;
}

/* Tingkat 0–1 adalah akun induk (dicetak tebal di intajo), 2 ke bawah
   rinciannya. Kedalamannya dipakai juga sebagai jarak menjorok. */
function barisHtml(b) {
  const tingkat = Number(b.tingkat) || 0;
  return `<tr class="${tingkat <= 1 ? 'neraca-induk' : ''}">
    <td style="padding-left:${6 + tingkat * 12}px" title="${esc(b.num)}">${esc(b.nama)}</td>
    <td class="num ${Number(b.total) < 0 ? 'neraca-minus' : ''}">${uang(b.total)}</td>
  </tr>`;
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

function gambarProses() {
  const s = prosesStatus;
  const hariTertinggal = Math.max(0, selisihHari(s.tanggalSekarang, tanggalWita(0)));

  q('#prosesIsi').innerHTML = `
    <div class="cabang-row" style="grid-template-columns:repeat(2,1fr)">
      <div class="stat"><div class="k">Buku intajo sekarang</div><div class="v">${tanggalPanjang(s.tanggalSekarang)}</div></div>
      <div class="stat ${hariTertinggal > 0 ? 'untung-minus' : 'untung-plus'}">
        <div class="k">Tertinggal</div><div class="v">${hariTertinggal} hari</div></div>
    </div>
    <p class="muted" style="margin-top:10px">
      Status tutup buku per cabang:
      ${s.cabang.map((c) => `${esc(c.nama)} — ${c.tertutup ? 'sudah' : 'belum'}`).join(' · ')}
    </p>
    <div class="toolbar" style="margin-top:12px">
      <label class="period-picker">
        <span class="sr-only">Proses sampai tanggal</span>
        <input type="date" id="prosesSampai" min="${esc(s.tanggalMinimal)}" value="${esc(s.tanggalMinimal)}">
      </label>
      <button class="btn" id="btnProses" type="button">Proses sampai tanggal ini</button>
    </div>
    <p class="proses-awas">
      ⚠ Tutup buku menulis ke pembukuan intajo dan <b>tidak bisa dibatalkan dari aplikasi ini</b>
      (memundurkannya harus lewat menu Accounting Back Date di intajo). Berlaku untuk kedua cabang
      sekaligus, maksimal ${s.maksHariSekali} hari sekali proses.
    </p>`;

  q('#btnProses').addEventListener('click', (e) => jalankanProses(e.currentTarget));
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
