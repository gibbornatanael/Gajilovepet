/* =========================================================================
   published.js — menu "Published" (sisi pemilik)
   -------------------------------------------------------------------------
   Satu tempat untuk memeriksa APA YANG BENAR-BENAR TAYANG di halaman
   "Lovepet Crew" tiap karyawan, tanpa harus login ke akun mereka satu per
   satu. Pilih nama lewat dropdown; isinya read-only.

   Tiga bagian, meniru tab yang dilihat karyawan di lapor.html:
     • Slip Gaji — semua slip yang sudah diterbitkan ke dia (snapshot),
                   plus tanda kalau angkanya sudah beda dari perhitungan
                   terkini, dan periode yang baris gajinya sudah ada tapi
                   slipnya BELUM dikirim.
     • Capaian   — laporan performa yang dia kirim (lembur, grooming, dst).
     • Kasbon    — kasbon aktif & riwayat pengajuannya.

   Semua data sudah dipegang modul lain (slip-terbit.js, kasbon.js) atau
   bisa dibaca langsung oleh pemilik (koleksi `laporan`). Modul ini hanya
   menyusun ulang tampilannya.
   ========================================================================= */

const KLINIK_ID = 'lovepet';

let db = null, fsMod = null;
let empId = null;                       // karyawan yang sedang ditinjau
let subTab = 'slip';
let slipDipilih = null;                 // periode slip yang dibuka di pane Slip
let laporanCache = { empId: null, docs: [] };
let capaianToken = 0;                   // anti tumpang-tindih render async
let terpasang = false;

const q  = (s, r = document) => r.querySelector(s);
const qq = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* --------------------------- Pemasangan ---------------------------
   Registrasi listener & panggilan awal dikumpulkan di BAWAH berkas, setelah
   semua deklarasi, supaya tidak menyentuh `let` yang belum terinisialisasi
   (TDZ) saat modul dievaluasi. */
function pasang() {
  if (terpasang || !q('#view-published')) return;
  terpasang = true;

  q('#pubKaryawan').addEventListener('change', (e) => pilihKaryawan(e.target.value));
  q('#pubCapaianPeriode').addEventListener('change', renderCapaian);

  q('#segPub').addEventListener('click', (e) => {
    const b = e.target.closest('.seg');
    if (b) gantiSub(b.dataset.seg);
  });

  q('#pubSlipList').addEventListener('click', (e) => {
    const b = e.target.closest('[data-periode]');
    if (!b) return;
    slipDipilih = b.dataset.periode;
    renderSlip();
    q('#pubSlipView').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  q('#pubBukaChat').addEventListener('click', () => { location.hash = 'chat'; });
}

function tampil() {
  const v = q('#view-published');
  return v && v.classList.contains('is-active');
}

/* --------------------------- Util data --------------------------- */
function daftarKaryawan() {
  return (window.LovePet && window.LovePet.daftarKaryawan) ? window.LovePet.daftarKaryawan() : [];
}
function karyawanIni() {
  return daftarKaryawan().find((e) => e.id === empId) || null;
}
function namaCabang(kunci) {
  const st = window.LovePet && window.LovePet.ambilState ? window.LovePet.ambilState() : null;
  return (st && st.cabang && st.cabang[kunci]) ||
    (typeof DEFAULT_CABANG !== 'undefined' && DEFAULT_CABANG[kunci]) || kunci || '—';
}

/* Bandingkan HANYA angka-angka slip (bukan tanggal cetak / identitas klinik) */
function sidikAngka(s) {
  if (!s) return '';
  const baris = (l) => (l || []).map((x) => `${x.label}=${Math.round(Number(x.nilai) || 0)}`).join('|');
  return [baris(s.pendapatan), baris(s.potonganList),
    Math.round(s.bruto || 0), Math.round(s.potongan || 0), Math.round(s.total || 0)].join('#');
}

/* --------------------------- Render utama --------------------------- */
function segarkan() {
  if (!q('#view-published')) return;
  laporanCache = { empId: null, docs: [] };   // tiap buka menu → tarik laporan segar
  isiDropdownKaryawan();
  isiDropdownPeriode();

  if (!db) {
    tampilkanButuhCloud();
    return;
  }

  const daftar = daftarKaryawan();
  if (!daftar.length) {
    q('#pubSlipList').innerHTML = '<div class="empty">Belum ada karyawan.</div>';
    q('#pubSlipView').innerHTML = '';
    q('#pubCapaianStat').innerHTML = '';
    q('#pubCapaianRiwayat').innerHTML = '';
    q('#pubKasbonIsi').innerHTML = '';
    q('#pubCatatanAkun').hidden = true;
    return;
  }
  if (!empId || !daftar.some((e) => e.id === empId)) empId = daftar[0].id;
  q('#pubKaryawan').value = empId;

  renderCatatanAkun();
  gantiSub(subTab);   // render pane yang sedang aktif saja
}
window.Published = { segarkan };

function tampilkanButuhCloud() {
  const pesan = '<div class="empty">Menu ini butuh sinkronisasi cloud aktif. Masuk ke akun di Setting → Akun &amp; Sinkronisasi.</div>';
  q('#pubSlipList').innerHTML = pesan;
  q('#pubSlipView').innerHTML = '';
  q('#pubCapaianStat').innerHTML = '';
  q('#pubCapaianRiwayat').innerHTML = pesan;
  q('#pubKasbonIsi').innerHTML = pesan;
  q('#pubCatatanAkun').hidden = true;
}

function isiDropdownKaryawan() {
  const sel = q('#pubKaryawan');
  const lama = sel.value;
  const daftar = daftarKaryawan()
    .slice()
    .sort((a, b) => (b.aktif !== false) - (a.aktif !== false) || String(a.nama).localeCompare(String(b.nama)));
  sel.innerHTML = daftar.map((e) =>
    `<option value="${esc(e.id)}">${esc(e.nama)}${e.aktif === false ? ' (nonaktif)' : ''}</option>`).join('')
    || '<option value="">— tidak ada karyawan —</option>';
  if (daftar.some((e) => e.id === lama)) sel.value = lama;
}

function isiDropdownPeriode() {
  const sel = q('#pubCapaianPeriode');
  const lama = sel.value;
  const now = new Date();
  const opsi = ['<option value="">Semua bulan</option>'];
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    opsi.push(`<option value="${k}">${labelPeriode(k)}</option>`);
  }
  sel.innerHTML = opsi.join('');
  if (lama) sel.value = lama;
}

function pilihKaryawan(id) {
  empId = id || null;
  slipDipilih = null;
  laporanCache = { empId: null, docs: [] };
  q('#pubSlipView').innerHTML = '';
  renderCatatanAkun();
  gantiSub(subTab);   // pane aktif; pane lain menyusul saat diklik
}

function gantiSub(nama, { render: segarkanPane = true } = {}) {
  subTab = nama || 'slip';
  qq('#segPub .seg').forEach((b) => b.classList.toggle('is-active', b.dataset.seg === subTab));
  q('#pubPaneSlip').classList.toggle('is-active', subTab === 'slip');
  q('#pubPaneCapaian').classList.toggle('is-active', subTab === 'capaian');
  q('#pubPaneKasbon').classList.toggle('is-active', subTab === 'kasbon');
  if (!segarkanPane) return;
  if (subTab === 'slip') renderSlip();
  else if (subTab === 'capaian') renderCapaian();
  else if (subTab === 'kasbon') renderKasbon();
}

/* --------------------------- Catatan akun --------------------------- */
function renderCatatanAkun() {
  const kotak = q('#pubCatatanAkun');
  const e = karyawanIni();
  if (e && !e.authUid) {
    kotak.hidden = false;
    kotak.innerHTML = `<div class="ot-teks">
      <b>${esc(e.nama)} belum punya akun login</b>
      <p>Halaman Lovepet Crew belum bisa dibuka olehnya — slip, capaian & kasbon di bawah belum sampai ke layarnya. Buat akun di <b>Setting → Karyawan</b>.</p>
    </div>`;
  } else {
    kotak.hidden = true;
    kotak.innerHTML = '';
  }
}

/* ------------------------------ Slip Gaji ------------------------------ */
function petaSlipTerbit() {
  const T = window.SlipTerbit;
  const arr = (T && T.semua) ? T.semua(empId) : [];
  const m = new Map();
  arr.forEach((d) => m.set(String(d.periode), d));
  return m;
}

/* Semua periode yang relevan untuk karyawan ini: yang slipnya sudah terbit
   + yang baris gajinya ada di state (mungkin belum diterbitkan). */
function periodeRelevan(terbit) {
  const set = new Set(terbit.keys());
  const st = window.LovePet && window.LovePet.ambilState ? window.LovePet.ambilState() : null;
  if (st && st.payroll) {
    Object.keys(st.payroll).forEach((k) => {
      if ((st.payroll[k] || []).some((r) => r.empId === empId)) set.add(k);
    });
  }
  return Array.from(set).sort((a, b) => b.localeCompare(a));
}

function labelStatus(doc) {
  if (!doc) return { teks: 'Belum diterbitkan', kelas: 'mute' };
  if (doc.status === 'ditarik') return { teks: 'Ditarik', kelas: 'mute' };
  if (doc.revisiDiminta) return { teks: 'Revisi diminta', kelas: 'warn' };
  if (doc.status === 'disetujui') return { teks: `Tayang${doc.versi > 1 ? ` · revisi ke-${doc.versi}` : ''}`, kelas: 'ok' };
  return { teks: esc(doc.status || '—'), kelas: 'mute' };
}

function renderSlip() {
  if (!db || !empId) return;
  const terbit = petaSlipTerbit();
  const periode = periodeRelevan(terbit);
  const list = q('#pubSlipList');

  if (!periode.length) {
    list.innerHTML = '<div class="empty">Belum ada slip maupun baris gaji untuk karyawan ini.</div>';
    q('#pubSlipView').innerHTML = '';
    return;
  }

  if (slipDipilih && !periode.includes(slipDipilih)) slipDipilih = null;

  list.innerHTML = periode.map((k) => {
    const doc = terbit.get(k) || null;
    const st = labelStatus(doc);
    const kini = window.LovePet && window.LovePet.slipTerkini ? window.LovePet.slipTerkini(empId, k) : null;
    const beda = doc && doc.status === 'disetujui' && !doc.revisiDiminta && kini &&
      sidikAngka(doc.data) !== sidikAngka(kini);
    const nilai = doc && doc.data ? doc.data.total : (kini ? kini.total : null);
    return `<button type="button" class="pub-slip-baris${k === slipDipilih ? ' is-active' : ''}" data-periode="${esc(k)}">
      <span class="pb-per">📄 ${esc(labelPeriode(k))}</span>
      ${nilai != null ? `<span class="pb-nilai">${rp(nilai)}</span>` : ''}
      <span class="pub-badge ${st.kelas}">${st.teks}</span>
      ${beda ? '<span class="pub-flag">⚠ beda dari angka terkini</span>' : ''}
    </button>`;
  }).join('');

  renderSlipView(terbit);
}

function renderSlipView(terbit) {
  const box = q('#pubSlipView');
  if (!slipDipilih) { box.innerHTML = ''; return; }
  terbit = terbit || petaSlipTerbit();
  const doc = terbit.get(slipDipilih) || null;
  const kini = window.LovePet && window.LovePet.slipTerkini ? window.LovePet.slipTerkini(empId, slipDipilih) : null;

  if (doc && doc.data && doc.status === 'disetujui') {
    const ket = doc.revisiDiminta
      ? `Karyawan minta revisi: “${esc(doc.revisiAlasan || '')}”. Slip ini masih tampil & bisa diunduh olehnya sampai Anda menyetujui ulang.`
      : `Disetujui ${esc(doc.disetujuiLabel || '—')}. Persis seperti yang dilihat & bisa diunduh karyawan di tab Slip Gaji.`;
    box.innerHTML = `<p class="muted pub-slip-ket">${ket}</p>` +
      window.SlipRender.gambar(doc.data, { cap: doc.versi > 1 ? `Revisi ke-${doc.versi}` : '' });
    return;
  }

  if (doc && doc.data && doc.status === 'ditarik') {
    box.innerHTML = `<p class="muted pub-slip-ket">Slip ini <b>ditarik</b> — sekarang <b>tidak tampil</b> di layar karyawan. Di bawah snapshot terakhir sebelum ditarik, sebagai acuan.</p>` +
      window.SlipRender.gambar(doc.data, { cap: 'Ditarik' });
    return;
  }

  if (kini) {
    box.innerHTML = `<p class="muted pub-slip-ket">Baris gaji ${esc(labelPeriode(slipDipilih))} sudah ada, tapi slipnya <b>belum diterbitkan</b> ke karyawan. Di bawah pratinjau dari angka sekarang — terbitkan lewat <b>Gaji/Bonus → Slip</b>.</p>` +
      window.SlipRender.gambar(kini);
  } else {
    box.innerHTML = '<div class="empty">Tidak ada data slip untuk periode ini.</div>';
  }
}

/* ------------------------------ Capaian ------------------------------ */
async function renderCapaian() {
  if (!db || !empId) return;
  const token = ++capaianToken;
  const statBox = q('#pubCapaianStat');
  const riwBox = q('#pubCapaianRiwayat');

  if (laporanCache.empId !== empId) {
    riwBox.innerHTML = '<p class="muted" style="padding:10px 4px">Memuat…</p>';
    try {
      const snap = await fsMod.getDocs(fsMod.query(
        fsMod.collection(db, 'klinik', KLINIK_ID, 'laporan'),
        fsMod.where('empId', '==', empId),
      ));
      if (token !== capaianToken) return;
      const docs = snap.docs.map((d) => d.data())
        .sort((a, b) => String(b.tanggal || '').localeCompare(String(a.tanggal || '')));
      laporanCache = { empId, docs };
    } catch (e) {
      console.warn('Published/capaian:', e);
      if (token !== capaianToken) return;
      statBox.innerHTML = '';
      riwBox.innerHTML = `<div class="empty">Gagal memuat laporan. ${esc(e.message || '')}</div>`;
      return;
    }
  }

  const bulan = q('#pubCapaianPeriode').value;
  const dipakai = laporanCache.docs.filter((d) => !bulan || String(d.tanggal || '').startsWith(bulan));
  const e = karyawanIni();
  const komp = (typeof komponenLaporSendiri === 'function' && e) ? komponenLaporSendiri(e.role) : [];

  const hitung = Object.fromEntries(komp.map((k) => [k.id, 0]));
  dipakai.forEach((d) => { if (d.status === 'aktif' && hitung[d.kategori] != null) hitung[d.kategori]++; });

  statBox.innerHTML = komp.length
    ? komp.map((k) => `<div class="stat">
        <div class="k">${k.ikon || ''} ${esc(k.label)}</div>
        <div class="v">${hitung[k.id] || 0}</div>
      </div>`).join('')
    : '';

  if (!dipakai.length) {
    riwBox.innerHTML = `<div class="empty">Belum ada laporan${bulan ? ' di ' + esc(labelPeriode(bulan)) : ''}.</div>`;
    return;
  }

  riwBox.innerHTML = dipakai.map((d) => {
    const k = komp.find((x) => x.id === d.kategori);
    const batal = d.status === 'batal';
    return `<div class="pub-riwayat-row">
      ${d.foto
        ? `<img src="${d.foto}" alt="">`
        : `<div class="thumb">${k ? (k.ikon || '📷') : '📷'}</div>`}
      <div class="info">
        <b>${esc(k ? k.label : d.kategori)}</b>
        <small>${esc(formatTanggal(d.tanggal))} · ${esc(namaCabang(d.cabang))}${batal ? ' · <span class="pub-batal">Dibatalkan</span>' : ''}</small>
      </div>
    </div>`;
  }).join('');
}

function formatTanggal(iso) {
  if (!iso) return '—';
  const [y, m, d] = String(iso).split('-').map(Number);
  const bln = (typeof NAMA_BULAN !== 'undefined' && NAMA_BULAN[m - 1]) ? NAMA_BULAN[m - 1].slice(0, 3) : m;
  return `${d} ${bln} ${y}`;
}

/* ------------------------------ Kasbon ------------------------------ */
function renderKasbon() {
  if (!db || !empId) return;
  const box = q('#pubKasbonIsi');
  const K = window.Kasbon;
  const akun = (K && K.akun) ? K.akun(empId) : null;
  const pengajuan = (K && K.pengajuan) ? K.pengajuan(empId) : [];

  let html = '';

  const saldo = Number(akun && akun.saldo) || 0;
  if (akun && akun.status === 'aktif' && saldo > 0) {
    const cicilan = Number(akun.cicilanPerBulan) || 0;
    const totalAwal = Math.max(Number(akun.totalDiajukan) || 0, saldo, 1);
    const persen = Math.max(0, Math.min(100, Math.round((1 - saldo / totalAwal) * 100)));
    const sisaBulan = (typeof bulanLagiKasbon === 'function') ? bulanLagiKasbon(saldo, cicilan) : 0;
    html += `<div class="card">
      <div class="card-head"><h2>Kasbon Aktif</h2></div>
      <p class="muted" style="margin:0 0 8px">Sisa ${rp(saldo)} · cicilan ${rp(cicilan)}/bulan · ${
        sisaBulan === Infinity ? 'cicilan belum diatur' : `≈ ${sisaBulan} bulan lagi`}</p>
      <div class="kasbon-progress"><span style="width:${persen}%"></span></div>
    </div>`;
  }

  const labelSt = { menunggu: 'Menunggu', disetujui: 'Disetujui', ditolak: 'Ditolak' };
  html += `<div class="card">
    <div class="card-head"><h2>Riwayat Pengajuan</h2></div>
    ${pengajuan.length ? pengajuan
      .slice()
      .sort((a, b) => (b.diajukanMs || 0) - (a.diajukanMs || 0))
      .map((p) => {
        const st = ['menunggu', 'disetujui', 'ditolak'].includes(p.status) ? p.status : 'menunggu';
        const cic = Number(p.cicilanPerBulan) || 0;
        return `<div class="pub-riwayat-row">
          <div class="thumb">💸</div>
          <div class="info">
            <b>${rp(p.jumlah)} <span class="kasbon-status ${st}">${labelSt[st]}</span></b>
            <small>${esc(p.diajukanIso ? formatTanggal(p.diajukanIso) : tglMs(p.diajukanMs))}${
              cic ? ` · cicilan ${rp(cic)}/bln` : ''}${p.alasan ? ` · ${esc(p.alasan)}` : ''}</small>
          </div>
        </div>`;
      }).join('')
      : '<div class="empty">Belum pernah mengajukan kasbon.</div>'}
  </div>`;

  box.innerHTML = html;
}

function tglMs(ms) {
  if (!ms) return '—';
  return new Date(ms).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}

/* ===================== Registrasi (dijalankan sekali) ===================== */
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', pasang);
else pasang();

/* cloud-siap mungkin sudah lewat sebelum modul ini dievaluasi — ambil
   sambungannya langsung kalau memang sudah aktif. */
if (window.CLOUD && window.CLOUD.aktif && window.CLOUD.db) {
  db = window.CLOUD.db; fsMod = window.CLOUD.fsMod;
}
document.addEventListener('cloud-siap', () => {
  const C = window.CLOUD;
  if (!C || !C.aktif || !C.db) return;
  db = C.db; fsMod = C.fsMod;
  if (tampil()) segarkan();
});

/* Ikut menyegarkan kalau data sumbernya berubah sementara menu ini terbuka */
document.addEventListener('slip-terbit-berubah', () => { if (tampil()) renderSlip(); });
document.addEventListener('kasbon-berubah',      () => { if (tampil()) renderKasbon(); });
