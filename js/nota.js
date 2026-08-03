/* =========================================================================
   nota.js — Pencatatan Pengeluaran (foto nota dibaca AI)
   -------------------------------------------------------------------------
   Alur:
     1. Pemilik memotret / memilih foto nota  → dikompres di perangkat.
     2. Foto dikirim ke /api/nota (Cloudflare Pages Function). Di sanalah
        kunci API Gemini disimpan — TIDAK pernah ada di browser.
     3. AI mengembalikan JSON (tanggal, toko, total, kategori, metode,
        rincian item). Hasilnya ditampilkan untuk diperiksa & dikoreksi,
        sekalian memilih Status, baru disimpan.
     4. Bot Telegram memakai endpoint yang sama dan menulis ke koleksi yang
        sama, jadi nota dari HP maupun dari grup muncul di daftar ini.

   Penyimpanan: koleksi `klinik/lovepet/nota/{id}` di Firestore. Foto
   disimpan terkompresi langsung di dokumen (pola yang sama dengan laporan
   karyawan) supaya tetap gratis di paket Spark — tanpa Firebase Storage.

   Umur foto: 1 bulan. Setelah lewat, foto TIDAK dihapus diam-diam —
   aplikasi menampilkan pemberitahuan untuk mengunduhnya sebagai
   "nota-<bulan>.zip" dulu, baru foto dilepas dari Firestore. Barisnya
   (tanggal, toko, total, rincian) tetap tersimpan selamanya.
   ========================================================================= */

const KLINIK_ID = 'lovepet';

const STATUS = [
  { id: '',         label: 'Kosong',            warna: 'abu'   },
  { id: 'belum',    label: 'Belum kirim Risa',  warna: 'kuning' },
  { id: 'terkirim', label: 'Terkirim ke Risa',  warna: 'hijau' },
  { id: 'tahan',    label: 'Untuk ditahan',     warna: 'merah' },
];
const labelStatus = (id) => (STATUS.find((s) => s.id === (id || '')) || STATUS[0]).label;
const warnaStatus = (id) => (STATUS.find((s) => s.id === (id || '')) || STATUS[0]).warna;

const KATEGORI = ['Obat & Vaksin', 'Pakan', 'Alat Medis', 'Operasional',
  'Kebersihan', 'Perlengkapan', 'Lain-lain'];

/* Foto nota perlu terbaca (angka & nama barang), jadi dikompres lebih
   longgar daripada foto bukti karyawan — tetap dijaga di bawah batas
   1 MB per dokumen Firestore. */
const BATAS_FOTO = 700 * 1024;

let db = null, fsMod = null, ref = null, lepas = null;
let daftar = [];                       // seluruh nota, terbaru di atas
let filterPeriode = 'semua';
let filterStatus = 'semua';
let terbuka = new Set();               // id nota yang rinciannya sedang dibentang

/* ------------------------------- Util kecil ------------------------------- */
const q  = (s, r = document) => r.querySelector(s);
const qq = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rupiah = (v) => 'Rp ' + Math.round(Number(v) || 0).toLocaleString('id-ID');
const pesan = (m) => (window.LovePet && window.LovePet.toast ? window.LovePet.toast(m) : console.log(m));

function tanggalPanjang(iso) {
  if (!iso) return '—';
  const [y, m, d] = String(iso).split('-');
  const bulan = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  return `${Number(d)} ${bulan[Number(m) - 1] || ''} ${y}`;
}
function labelBulan(key) {
  const nama = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  const [y, m] = String(key).split('-');
  return `${nama[Number(m) - 1] || key} ${y}`;
}
function bulanIni() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function hariIni() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/* ============================ Sambungan Firestore ============================ */
document.addEventListener('cloud-siap', mulai);

function mulai() {
  const C = window.CLOUD;
  if (!C || !C.aktif || !C.db) {
    q('#notaKosong').innerHTML =
      '<p class="muted">Fitur nota memerlukan sambungan ke akun (Firebase). ' +
      'Masuk dulu lewat layar login.</p>';
    return;
  }
  db = C.db; fsMod = C.fsMod;
  ref = fsMod.collection(db, 'klinik', KLINIK_ID, 'nota');
  dengarkan();
}

function dengarkan() {
  if (lepas) lepas();
  const kueri = fsMod.query(ref, fsMod.orderBy('tanggal', 'desc'), fsMod.limit(500));
  lepas = fsMod.onSnapshot(kueri, (snap) => {
    daftar = snap.docs.map((d) => Object.assign({ id: d.id }, d.data()));
    render();
  }, (e) => {
    console.warn('Nota:', e);
    q('#notaKosong').innerHTML = '<p class="muted">Gagal memuat daftar nota. Periksa koneksi.</p>';
  });
}

/* ================================ Render ================================ */
function terpakai() {
  return daftar.filter((n) => {
    if (filterPeriode !== 'semua' && String(n.tanggal || '').slice(0, 7) !== filterPeriode) return false;
    if (filterStatus !== 'semua' && (n.status || '') !== filterStatus) return false;
    return true;
  });
}

function render() {
  if (!q('#view-nota')) return;
  isiFilterPeriode();
  renderRingkasan();
  renderDaftar();
  renderArsip();
}

function isiFilterPeriode() {
  const sel = q('#notaPeriode');
  if (!sel) return;
  const periode = Array.from(new Set(daftar.map((n) => String(n.tanggal || '').slice(0, 7))
    .filter(Boolean))).sort().reverse();
  if (filterPeriode !== 'semua' && !periode.includes(filterPeriode)) filterPeriode = 'semua';
  sel.innerHTML = '<option value="semua">Semua bulan</option>' +
    periode.map((p) => `<option value="${p}">${esc(labelBulan(p))}</option>`).join('');
  sel.value = filterPeriode;
}

function renderRingkasan() {
  const data = terpakai();
  const total = data.reduce((s, n) => s + (Number(n.total) || 0), 0);
  const perStatus = STATUS.map((s) => ({
    s, jml: data.filter((n) => (n.status || '') === s.id).length,
  }));
  q('#notaStat').innerHTML = `
    <div class="stat"><div class="k">Jumlah nota</div><div class="v">${data.length}</div></div>
    <div class="stat"><div class="k">Total pengeluaran</div><div class="v">${esc(rupiah(total))}</div></div>
    <div class="stat"><div class="k">Belum kirim Risa</div><div class="v">${perStatus[1].jml}</div></div>
    <div class="stat"><div class="k">Ditahan</div><div class="v">${perStatus[3].jml}</div></div>`;
}

function renderDaftar() {
  const wrap = q('#notaList');
  const data = terpakai();
  q('#notaKosong').innerHTML = data.length ? '' :
    '<p class="muted">Belum ada nota di tampilan ini. Tekan “Unggah nota” untuk memulai, ' +
    'atau kirim fotonya ke grup Telegram.</p>';

  wrap.innerHTML = data.map((n) => {
    const items = Array.isArray(n.items) ? n.items : [];
    const buka = terbuka.has(n.id);
    return `
    <article class="nota-row${buka ? ' is-open' : ''}" data-id="${esc(n.id)}">
      <button class="nota-head" type="button" data-aksi="buka" aria-expanded="${buka}">
        <span class="nota-tgl">${esc(tanggalPanjang(n.tanggal))}</span>
        <span class="nota-judul">
          <strong>${esc(n.toko || 'Nota tanpa nama')}</strong>
          <small>${esc(n.kategori || 'Tanpa kategori')}${items.length ? ` · ${items.length} item` : ''}${n.sumber === 'telegram' ? ' · Telegram' : ''}</small>
        </span>
        <span class="nota-total">${esc(rupiah(n.total))}</span>
        <span class="nota-status s-${warnaStatus(n.status)}">${esc(labelStatus(n.status))}</span>
        <span class="nota-kar" aria-hidden="true">›</span>
      </button>

      <div class="nota-detail" ${buka ? '' : 'hidden'}>
        ${items.length ? `
        <div class="table-scroll">
          <table class="tbl nota-items">
            <thead><tr><th>Barang</th><th class="ka">Qty</th><th class="ka">Harga</th><th class="ka">Jumlah</th></tr></thead>
            <tbody>${items.map((it) => `
              <tr><td>${esc(it.nama || '—')}</td>
                  <td class="ka">${esc(it.qty || '')}</td>
                  <td class="ka">${it.harga ? esc(rupiah(it.harga)) : ''}</td>
                  <td class="ka">${it.subtotal ? esc(rupiah(it.subtotal)) : ''}</td></tr>`).join('')}
            </tbody>
          </table>
        </div>` : '<p class="muted">Rincian barang tidak tercatat pada nota ini.</p>'}

        <dl class="nota-meta">
          <div><dt>Metode bayar</dt><dd>${esc(n.metode || '—')}</dd></div>
          <div><dt>Catatan</dt><dd>${esc(n.catatan || '—')}</dd></div>
          <div><dt>Foto</dt><dd>${n.foto ? 'Tersimpan' : (n.arsip ? 'Sudah diarsipkan (ZIP)' : 'Tidak ada')}</dd></div>
        </dl>

        ${n.foto ? `<a class="nota-foto" href="${n.foto}" target="_blank" rel="noopener">
            <img src="${n.foto}" alt="Foto nota ${esc(n.toko || '')}" loading="lazy"></a>` : ''}

        <div class="nota-aksi">
          <label class="field inline">
            <span>Status</span>
            <select data-aksi="status">
              ${STATUS.map((s) => `<option value="${s.id}"${(n.status || '') === s.id ? ' selected' : ''}>${esc(s.label)}</option>`).join('')}
            </select>
          </label>
          <span class="grow"></span>
          <button class="btn" data-aksi="ubah">Ubah</button>
          <button class="btn btn-danger" data-aksi="hapus">Hapus</button>
        </div>
      </div>
    </article>`;
  }).join('');
}

/* Klik di dalam daftar — satu penangan untuk semua baris */
document.addEventListener('click', (e) => {
  const row = e.target.closest('.nota-row');
  if (!row) return;
  const id = row.dataset.id;
  const aksi = (e.target.closest('[data-aksi]') || {}).dataset;
  if (!aksi) return;

  if (aksi.aksi === 'buka') {
    if (terbuka.has(id)) terbuka.delete(id); else terbuka.add(id);
    renderDaftar();
  } else if (aksi.aksi === 'hapus') {
    hapusNota(id);
  } else if (aksi.aksi === 'ubah') {
    const n = daftar.find((x) => x.id === id);
    if (n) ubahNota(n);
  }
});

document.addEventListener('change', (e) => {
  const row = e.target.closest('.nota-row');
  if (row && e.target.matches('[data-aksi="status"]')) {
    simpanPerubahan(row.dataset.id, { status: e.target.value });
    return;
  }
  if (e.target.id === 'notaPeriode') { filterPeriode = e.target.value; render(); }
  if (e.target.id === 'notaStatus')  { filterStatus  = e.target.value; render(); }
});

/* ============================== Unggah nota ============================== */
let tombolSiap = false;
function pasangTombol() {
  const inp = q('#notaFile');
  if (!inp || tombolSiap) return;
  tombolSiap = true;
  q('#btnUnggahNota').addEventListener('click', () => inp.click());
  inp.addEventListener('change', async () => {
    const file = inp.files && inp.files[0];
    inp.value = '';
    if (file) await unggah(file);
  });
  q('#btnNotaManual').addEventListener('click', () => {
    ubahNota({ tanggal: hariIni(), toko: '', total: 0, kategori: '', metode: '', items: [], status: '' }, true);
  });
  q('#btnCetakNota').addEventListener('click', cetakDaftar);
  // Tombol "Unduh ZIP" dipasang di renderArsip — ia baru ada saat ada arsip.
}
document.addEventListener('DOMContentLoaded', pasangTombol);
if (document.readyState !== 'loading') pasangTombol();

async function unggah(file) {
  if (!ref) { pesan('Belum tersambung ke akun'); return; }
  sibuk(true, 'Mengecilkan foto…');
  let foto;
  try {
    foto = await kompresNota(file);
  } catch (e) {
    sibuk(false); pesan('Foto tidak terbaca'); return;
  }

  sibuk(true, 'AI sedang membaca nota…');
  let hasil = null;
  try {
    hasil = await bacaDenganAI(foto);
  } catch (e) {
    console.warn('AI nota:', e);
    pesan('AI tidak bisa membaca — silakan isi manual');
  }
  sibuk(false);

  const awal = Object.assign(
    { tanggal: hariIni(), toko: '', total: 0, kategori: '', metode: '', items: [], catatan: '' },
    hasil || {}, { status: '', foto });
  ubahNota(awal, true);
}

/* Kompres bertahap sampai muat di satu dokumen Firestore */
async function kompresNota(file) {
  let lebar = 1100, kualitas = 0.62, foto = '';
  for (let i = 0; i < 5; i++) {
    foto = await kompresGambar(file, { lebarMaks: lebar, kualitas });
    if (foto.length < BATAS_FOTO) return foto;
    lebar = Math.round(lebar * 0.8);
    kualitas = Math.max(0.35, kualitas - 0.07);
  }
  return foto;
}

async function bacaDenganAI(dataUrl) {
  const res = await fetch('/api/nota', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gambar: dataUrl }),
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const j = await res.json();
  if (!j || j.error) throw new Error((j && j.error) || 'kosong');
  return j;
}

function sibuk(aktif, teks) {
  const el = q('#notaSibuk');
  if (!el) return;
  el.hidden = !aktif;
  if (teks) el.textContent = teks;
}

/* ========================== Dialog periksa / ubah ========================== */
function ubahNota(n, baru) {
  const ov = q('#notaDialog');
  const items = Array.isArray(n.items) && n.items.length ? n.items : [{ nama: '', qty: '', harga: '', subtotal: '' }];

  ov.innerHTML = `
  <form class="nota-card" id="notaForm">
    <h2>${baru ? 'Periksa hasil pembacaan' : 'Ubah nota'}</h2>
    <p class="muted">${baru ? 'AI sudah mengisi sebisanya — koreksi yang meleset, lalu pilih statusnya.' : 'Perbaiki data nota ini.'}</p>

    <div class="form-grid">
      <label class="field"><span class="f-label">Tanggal</span>
        <input type="date" name="tanggal" value="${esc(n.tanggal || hariIni())}" required></label>
      <label class="field"><span class="f-label">Toko / penjual</span>
        <input type="text" name="toko" value="${esc(n.toko || '')}" placeholder="mis. Apotek Sehat" required></label>
      <label class="field"><span class="f-label">Total</span>
        <input type="number" name="total" value="${Number(n.total) || 0}" min="0" step="1" required></label>
      <label class="field"><span class="f-label">Kategori</span>
        <select name="kategori">
          <option value="">— kosong —</option>
          ${KATEGORI.map((k) => `<option${(n.kategori || '') === k ? ' selected' : ''}>${esc(k)}</option>`).join('')}
        </select></label>
      <label class="field"><span class="f-label">Metode bayar</span>
        <input type="text" name="metode" value="${esc(n.metode || '')}" placeholder="Tunai / Transfer / QRIS"></label>
      <label class="field"><span class="f-label">Status</span>
        <select name="status">
          ${STATUS.map((s) => `<option value="${s.id}"${(n.status || '') === s.id ? ' selected' : ''}>${esc(s.label)}</option>`).join('')}
        </select></label>
    </div>

    <div class="card-head"><h3>Rincian barang</h3>
      <p class="muted">Kosongkan yang tidak ada. Baris kosong diabaikan.</p></div>
    <div id="notaItems">${items.map(barisItem).join('')}</div>
    <button type="button" class="btn" id="notaTambahItem">Tambah baris</button>

    <label class="field"><span class="f-label">Catatan</span>
      <input type="text" name="catatan" value="${esc(n.catatan || '')}" placeholder="opsional"></label>

    ${n.foto ? `<img class="nota-pratinjau" src="${n.foto}" alt="Pratinjau nota">` : ''}

    <div class="nota-dialog-aksi">
      <button type="button" class="btn" id="notaBatal">Batal</button>
      <button type="submit" class="btn btn-primary">${baru ? 'Simpan nota' : 'Simpan perubahan'}</button>
    </div>
  </form>`;
  ov.hidden = false;

  q('#notaTambahItem').addEventListener('click', () => {
    q('#notaItems').insertAdjacentHTML('beforeend', barisItem({}));
  });
  q('#notaBatal').addEventListener('click', () => { ov.hidden = true; ov.innerHTML = ''; });
  q('#notaItems').addEventListener('click', (e) => {
    if (e.target.matches('[data-hapus-item]')) e.target.closest('.nota-item').remove();
  });

  q('#notaForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const isian = {
      tanggal: f.get('tanggal'),
      toko: String(f.get('toko') || '').trim(),
      total: Number(f.get('total')) || 0,
      kategori: f.get('kategori') || '',
      metode: String(f.get('metode') || '').trim(),
      status: f.get('status') || '',
      catatan: String(f.get('catatan') || '').trim(),
      items: qq('.nota-item').map((row) => ({
        nama: row.querySelector('[name=i_nama]').value.trim(),
        qty: row.querySelector('[name=i_qty]').value.trim(),
        harga: Number(row.querySelector('[name=i_harga]').value) || 0,
        subtotal: Number(row.querySelector('[name=i_subtotal]').value) || 0,
      })).filter((it) => it.nama || it.subtotal),
    };
    ov.hidden = true; ov.innerHTML = '';
    if (baru) await simpanBaru(Object.assign(isian, { foto: n.foto || '', sumber: 'aplikasi' }));
    else await simpanPerubahan(n.id, isian);
  });
}

function barisItem(it) {
  return `<div class="nota-item">
    <input type="text"   name="i_nama"     value="${esc(it.nama || '')}"  placeholder="Nama barang">
    <input type="text"   name="i_qty"      value="${esc(it.qty || '')}"   placeholder="Qty">
    <input type="number" name="i_harga"    value="${it.harga || ''}"      placeholder="Harga">
    <input type="number" name="i_subtotal" value="${it.subtotal || ''}"   placeholder="Jumlah">
    <button type="button" class="icon-btn" data-hapus-item title="Hapus baris">✕</button>
  </div>`;
}

/* ============================== Tulis ke cloud ============================== */
async function simpanBaru(data) {
  try {
    await fsMod.addDoc(ref, Object.assign({}, data, {
      dibuat: Date.now(),
      uid: (window.CLOUD.auth.currentUser || {}).uid || '',
      arsip: false,
    }));
    pesan('Nota tersimpan');
  } catch (e) {
    console.warn(e);
    pesan('Gagal menyimpan nota');
  }
}

async function simpanPerubahan(id, patch) {
  try {
    await fsMod.updateDoc(fsMod.doc(ref, id), Object.assign({}, patch, { diubah: Date.now() }));
    if (patch.status !== undefined && Object.keys(patch).length === 1) pesan('Status diperbarui');
    else pesan('Nota diperbarui');
  } catch (e) {
    console.warn(e);
    pesan('Gagal menyimpan perubahan');
  }
}

async function hapusNota(id) {
  const n = daftar.find((x) => x.id === id);
  if (!confirm(`Hapus nota ${n ? n.toko : ''} (${n ? rupiah(n.total) : ''})? Tidak bisa dibatalkan.`)) return;
  try {
    await fsMod.deleteDoc(fsMod.doc(ref, id));
    terbuka.delete(id);
    pesan('Nota dihapus');
  } catch (e) { pesan('Gagal menghapus'); }
}

/* ============================ Arsip foto bulanan ============================ */
/* Foto yang bulannya sudah lewat dikumpulkan jadi satu ZIP. Ia baru dilepas
   dari Firestore SETELAH ZIP-nya benar-benar terunduh — jadi tidak ada foto
   yang hilang tanpa salinan. */
function siapArsip() {
  const kini = bulanIni();
  const per = {};
  daftar.forEach((n) => {
    if (!n.foto) return;
    const p = String(n.tanggal || '').slice(0, 7);
    if (!p || p >= kini) return;                 // bulan berjalan belum diarsipkan
    (per[p] = per[p] || []).push(n);
  });
  const keys = Object.keys(per).sort();
  return keys.length ? { periode: keys[0], nota: per[keys[0]], sisa: keys.length - 1 } : null;
}

function renderArsip() {
  const box = q('#notaArsip');
  const a = siapArsip();
  const tab = q('.tabitem[data-view="nota"] .tab-badge');

  if (!a) {
    box.hidden = true;
    if (tab) tab.hidden = true;
    return;
  }
  box.hidden = false;
  box.dataset.periode = a.periode;
  box.innerHTML = `
    <div>
      <strong>Foto nota ${esc(labelBulan(a.periode))} siap diarsipkan</strong>
      <p class="muted">${a.nota.length} foto sudah lewat 1 bulan. Unduh sebagai
        <code>nota-${esc(a.periode)}.zip</code> — setelah terunduh, fotonya dilepas
        dari penyimpanan tapi daftar &amp; rinciannya tetap ada.
        ${a.sisa ? `Masih ada ${a.sisa} bulan lain menyusul.` : ''}</p>
    </div>
    <button class="btn btn-primary" id="btnArsipNota">Unduh ZIP</button>`;
  q('#btnArsipNota').addEventListener('click', unduhArsip);

  if (tab) { tab.hidden = false; tab.textContent = a.nota.length > 99 ? '99+' : String(a.nota.length); }
}

async function unduhArsip() {
  const a = siapArsip();
  if (!a) return;
  sibuk(true, 'Menyusun ZIP…');
  try {
    const { default: JSZip } = await import('https://esm.sh/jszip@3.10.1');
    const zip = new JSZip();

    const baris = [['Tanggal', 'Toko', 'Kategori', 'Metode', 'Status', 'Total', 'Berkas foto']];
    a.nota.forEach((n, i) => {
      const aman = String(n.toko || 'nota').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 40);
      const nama = `${n.tanggal || a.periode}_${aman || 'nota'}_${String(i + 1).padStart(3, '0')}.jpg`;
      const base64 = String(n.foto).split(',')[1] || '';
      zip.file(nama, base64, { base64: true });
      baris.push([n.tanggal || '', n.toko || '', n.kategori || '', n.metode || '',
        labelStatus(n.status), Number(n.total) || 0, nama]);
    });
    zip.file('daftar.csv', baris.map((r) =>
      r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n'));

    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const a2 = document.createElement('a');
    a2.href = url; a2.download = `nota-${a.periode}.zip`;
    document.body.appendChild(a2); a2.click(); a2.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);

    sibuk(true, 'Melepas foto dari penyimpanan…');
    for (const n of a.nota) {
      await fsMod.updateDoc(fsMod.doc(ref, n.id), {
        foto: fsMod.deleteField(), arsip: true, diarsipkan: Date.now(),
      });
    }
    pesan(`Arsip ${labelBulan(a.periode)} tersimpan`);
  } catch (e) {
    console.warn('Arsip:', e);
    pesan('Gagal membuat ZIP — foto tidak diubah');
  } finally {
    sibuk(false);
  }
}

/* ================================ Cetak PDF ================================ */
/* Di layar rincian disembunyikan supaya daftar ringkas; di kertas semuanya
   ditampilkan lengkap sesuai permintaan. */
function cetakDaftar() {
  const data = terpakai();
  if (!data.length) { pesan('Tidak ada nota untuk dicetak'); return; }
  const profil = (window.LovePet.ambilState().profil) || {};
  const judul = filterPeriode === 'semua' ? 'Semua periode' : labelBulan(filterPeriode);
  const total = data.reduce((s, n) => s + (Number(n.total) || 0), 0);

  const html = `
    <h2>${esc(profil.nama || 'LOVE Pet Clinic')} — Daftar Pengeluaran</h2>
    <p>Periode: ${esc(judul)}${filterStatus !== 'semua' ? ` · Status: ${esc(labelStatus(filterStatus))}` : ''} ·
       ${data.length} nota · Total ${esc(rupiah(total))}</p>
    ${data.map((n) => {
      const items = Array.isArray(n.items) ? n.items : [];
      return `
      <table class="tbl nota-cetak">
        <thead>
          <tr><th colspan="4">${esc(tanggalPanjang(n.tanggal))} — ${esc(n.toko || 'Tanpa nama')}
            <span style="float:right">${esc(rupiah(n.total))}</span></th></tr>
          <tr><td colspan="4">Kategori: ${esc(n.kategori || '—')} ·
            Bayar: ${esc(n.metode || '—')} · Status: ${esc(labelStatus(n.status))}
            ${n.catatan ? ` · ${esc(n.catatan)}` : ''}</td></tr>
        </thead>
        ${items.length ? `<tbody>
          <tr><th>Barang</th><th>Qty</th><th>Harga</th><th>Jumlah</th></tr>
          ${items.map((it) => `<tr><td>${esc(it.nama || '—')}</td><td>${esc(it.qty || '')}</td>
            <td>${it.harga ? esc(rupiah(it.harga)) : ''}</td>
            <td>${it.subtotal ? esc(rupiah(it.subtotal)) : ''}</td></tr>`).join('')}
        </tbody>` : ''}
      </table>`;
    }).join('')}
    <p style="margin-top:12px"><b>Total keseluruhan: ${esc(rupiah(total))}</b></p>`;

  window.LovePet.cetak(html);
}
