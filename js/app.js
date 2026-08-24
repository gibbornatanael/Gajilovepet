/* =========================================================================
   LOVE Pet Clinic — app.js
   Semua interaksi UI: navigasi, input gaji, slip, rekap tahunan, grafik.
   ========================================================================= */

/* ============================ STATE ============================ */
/* Penyimpanan tahan-banting: kalau localStorage diblokir (mis. mode privat
   atau file:// di sebagian browser), aplikasi tetap jalan untuk sesi ini. */
const gudang = (() => {
  try {
    localStorage.setItem('__tes__', '1'); localStorage.removeItem('__tes__');
    return localStorage;
  } catch (e) {
    console.warn('localStorage tidak tersedia — data hanya bertahan selama sesi ini.');
    const mem = {};
    return { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: (k) => { delete mem[k]; } };
  }
})();

let state = muat();
let periode = periodeTerakhir();
let simpanTimer = null;

function stateBaru() {
  return {
    version: APP.version,
    profil: Object.assign({}, DEFAULT_PROFIL),
    cabang: Object.assign({}, DEFAULT_CABANG),
    roles: DEFAULT_ROLES.slice(),
    tarif: JSON.parse(JSON.stringify(DEFAULT_TARIF)),
    karyawan: JSON.parse(JSON.stringify(SEED_KARYAWAN)),
    payroll: seedPayroll(),
  };
}

/* Migrasi v2 → v3: struktur bonus lama (b1/jaga/lembur/rawat/op sebagai kolom
   terpisah) diubah menjadi qty/rate per komponen, dengan pemisahan cabang.
   Jumlah lama seluruhnya masuk ke cabang pertama; laporan memakai totalnya
   sehingga hasil perhitungannya tidak berubah sedikit pun. */
const PETA_LAMA = { b1: 'clients', jaga: 'jaga', lembur: 'lembur', rawat: 'rawat', op: 'operasi' };
function migrasiBaris(r) {
  if (r.qty && r.rate) return r;
  const qty = {}, rate = {};
  KOMPONEN.forEach((k) => { qty[k.id] = { mdo: 0, tmh: 0 }; rate[k.id] = 0; });
  Object.entries(PETA_LAMA).forEach(([lama, baru]) => {
    qty[baru] = { mdo: Number(r[lama + 'Qty']) || 0, tmh: 0 };
    rate[baru] = Number(r[lama + 'Rate']) || 0;
  });
  const bersih = { empId: r.empId, nama: r.nama, role: r.role,
    pokok: +r.pokok || 0, operasional: +r.operasional || 0, qty, rate,
    makan: +r.makan || 0, tunjLain: +r.tunjLain || 0,
    denda: +r.denda || 0, hutang: +r.hutang || 0, catatan: r.catatan || '' };
  return bersih;
}

function muat() {
  try {
    const raw = gudang.getItem(APP.storageKey);
    if (!raw) return stateBaru();
    const s = JSON.parse(raw);
    if (!s || !s.payroll) return stateBaru();
    s.profil = Object.assign({}, DEFAULT_PROFIL, s.profil || {});
    s.cabang = Object.assign({}, DEFAULT_CABANG, s.cabang || {});
    s.roles = (s.roles && s.roles.length) ? s.roles : DEFAULT_ROLES.slice();
    // v2: posisi Manager (Natanael Montolalu) tidak lagi ikut penggajian
    if (!(s.version >= 2)) {
      s.karyawan = (s.karyawan || []).filter((e) => e.id !== 'nat');
      Object.keys(s.payroll).forEach((k) => {
        s.payroll[k] = s.payroll[k].filter((r) => r.empId !== 'nat');
        if (!s.payroll[k].length) delete s.payroll[k];
      });
    }
    // v3: struktur komponen bonus baru + tarif per komponen
    if (!(s.version >= 3)) {
      Object.keys(s.payroll).forEach((k) => { s.payroll[k] = s.payroll[k].map(migrasiBaris); });
      s.tarif = null; // dibangun ulang dari tarif default di bawah
    }
    // v4: karyawan punya cabang & (opsional) akun login untuk lapor.html
    if (!(s.version >= 4)) {
      (s.karyawan || []).forEach((e) => {
        if (!e.cabang) e.cabang = CABANG[0];
        if (e.username === undefined) e.username = '';
        if (e.authUid === undefined) e.authUid = '';
      });
    }
    s.version = APP.version;
    s.tarif = Object.assign({}, JSON.parse(JSON.stringify(DEFAULT_TARIF)), s.tarif || {});
    return s;
  } catch (e) {
    console.warn('Gagal membaca data tersimpan, memakai data awal.', e);
    return stateBaru();
  }
}

function simpan(diam) {
  state.updatedAt = Date.now();
  gudang.setItem(APP.storageKey, JSON.stringify(state));
  if (window.CLOUD && window.CLOUD.aktif) window.CLOUD.push(state);
  if (!diam) {
    const h = $('#saveHint');
    if (h) { h.textContent = '✓ tersimpan'; h.classList.add('show'); clearTimeout(simpanTimer); simpanTimer = setTimeout(() => h.classList.remove('show'), 1400); }
  }
}

/* Jembatan ke cloud.js — dipakai untuk menerima perubahan dari perangkat lain */
window.LovePet = {
  ambilState: () => state,
  terapkanState(baru) {
    if (!baru || !baru.payroll) return;
    state = baru;
    state.profil = Object.assign({}, DEFAULT_PROFIL, state.profil || {});
    state.cabang = Object.assign({}, DEFAULT_CABANG, state.cabang || {});
    state.roles = (state.roles && state.roles.length) ? state.roles : DEFAULT_ROLES.slice();
    state.tarif = Object.assign({}, JSON.parse(JSON.stringify(DEFAULT_TARIF)), state.tarif || {});
    gudang.setItem(APP.storageKey, JSON.stringify(state));
    if (!state.payroll[periode]) periode = periodeTerakhir();
    render();
  },
  /* Dipakai js/chat.js & js/kasbon.js — keduanya module, jadi tidak bisa
     memanggil fungsi di berkas ini secara langsung. */
  toast: (m) => toast(m),

  /* Dipakai js/kasbon.js sesudah sebuah pengajuan disetujui: kalau
     karyawan itu sudah punya baris gaji di bulan yang sedang dibuka DAN
     slipnya belum dikirim, kolom Hutang/Kasbon-nya langsung disegarkan
     supaya pemilik tidak perlu menghitung & mengetik manual. Slip yang
     sudah disetujui sengaja tidak disentuh — itu snapshot yang sudah
     dijanjikan ke karyawan. */
  terapkanKasbonKeBaris(empId) {
    if (!window.Kasbon) return;
    const r = rows(periode).find((x) => x.empId === empId);
    if (!r) return;
    const T = window.SlipTerbit;
    const s = T && T.siap() ? T.status(empId, periode) : null;
    if (s && s.status === 'disetujui') return;
    const saran = window.Kasbon.cicilanSaran(empId);
    if (!saran) return;
    r.hutang = saran;
    simpan(true);
    render('input');
  },
};

function periodeTerakhir() {
  const keys = Object.keys(state.payroll).sort();
  return keys.length ? keys[keys.length - 1] : isoBulanIni();
}
function isoBulanIni() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/* ============================ HELPER ============================ */
const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inisial = (n) => String(n).replace(/^Drh\.?\s*/i, '').split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), 2200);
}
function rows(key) { return state.payroll[key] || []; }
function emp(id) { return state.karyawan.find((e) => e.id === id); }
function tahunAktif() { return periode.split('-')[0]; }
function kunciTahun(y) {
  return Array.from({ length: 12 }, (_, i) => `${y}-${String(i + 1).padStart(2, '0')}`);
}
function totalBulan(key) { return rows(key).reduce((s, r) => s + hitung(r).total, 0); }

/* ============================ NAVIGASI ============================
   Cuma 6 view sungguhan sekarang: dashboard, gaji (gabungan Input/Slip/
   Rekap), jurnal (gabungan Jurnal/Neraca), kasbon, chat, kelola. Chat &
   Kelola dijangkau lewat ikon di topbar (lihat index.html), bukan tab —
   makanya tidak ada lagi sheet "Lainnya", 4 tab utama + 2 ikon sudah
   cukup ringkas untuk tab bar HP. */
const VIEWS = ['dashboard', 'gaji', 'jurnal', 'kasbon', 'chat', 'kelola'];

/* Nama tab lama (dari sebelum digabung) tetap dikenali — dipakai oleh
   pindahView('slip') dkk. di berkas ini sendiri, dan supaya tautan/hash
   lama (#input, #neraca, dst.) tidak membawa ke layar kosong. Memetakan
   ke [view gabungan, nama sub-tab di dalamnya]. */
const SUBTAB_ALIAS = {
  input: ['gaji', 'input'], slip: ['gaji', 'slip'], tahunan: ['gaji', 'tahunan'],
  neraca: ['jurnal', 'neraca'],
};

let subTabAktif = { gaji: 'input', jurnal: 'jurnal' };

/* Menu segmented DI DALAM view-gaji / view-jurnal — pola yang sama dengan
   segmented Kelola (segAktif/pasangSegmen di bawah), tapi ditulis terpisah
   karena dua alasan: (1) Kelola sudah ada & teruji, tidak perlu diutak-atik
   ulang untuk sekadar menambah grup baru; (2) pasangSegmen() versi Kelola
   memilih pane lewat `$$('.segpane')` TANPA menyaring ke #segKelola saja —
   aman selama cuma satu grup segmented yang memakainya, tapi akan salah
   pilih pane kalau dipakai ulang untuk grup lain. pindahSubTab() di bawah
   menyaring lewat id pane yang eksplisit, jadi tidak mewarisi masalah itu. */
function pindahSubTab(grup, nama, { render: segarkan = true } = {}) {
  subTabAktif[grup] = nama;
  const grupSel = grup === 'gaji' ? '#segGaji' : '#segJurnalMenu';
  $$(`${grupSel} .seg`).forEach((b) => b.classList.toggle('is-active', b.dataset.seg === nama));

  if (grup === 'gaji') {
    $('#gajiPaneInput').classList.toggle('is-active', nama === 'input');
    $('#gajiPaneSlip').classList.toggle('is-active', nama === 'slip');
    $('#gajiPaneTahunan').classList.toggle('is-active', nama === 'tahunan');
    if (segarkan) {
      if (nama === 'input') renderInput();
      else if (nama === 'slip') renderSlipView();
      else if (nama === 'tahunan') renderTahunan();
    }
  } else if (grup === 'jurnal') {
    $('#jurnalPaneJurnal').classList.toggle('is-active', nama === 'jurnal');
    $('#jurnalPaneNeraca').classList.toggle('is-active', nama === 'neraca');
    if (segarkan) {
      if (nama === 'jurnal' && window.Jurnal) window.Jurnal.segarkan(periode);
      else if (nama === 'neraca' && window.Neraca) window.Neraca.segarkan();
    }
  }
}
$('#segGaji').addEventListener('click', (e) => {
  const b = e.target.closest('.seg');
  if (b) pindahSubTab('gaji', b.dataset.seg);
});
$('#segJurnalMenu').addEventListener('click', (e) => {
  const b = e.target.closest('.seg');
  if (b) pindahSubTab('jurnal', b.dataset.seg);
});

function pindahView(nama, sub) {
  // alias lama supaya tautan #karyawan / #pengaturan tetap jalan
  if (nama === 'karyawan' || nama === 'pengaturan') { segAktif = nama; nama = 'kelola'; }
  if (SUBTAB_ALIAS[nama]) { const a = SUBTAB_ALIAS[nama]; nama = a[0]; sub = sub || a[1]; }
  if (!VIEWS.includes(nama)) nama = 'dashboard';
  if (sub) pindahSubTab(nama, sub, { render: false });   // render(nama) di bawah yang menyegarkan
  $$('[data-view]').forEach((t) => t.classList.toggle('is-active', t.dataset.view === nama));
  $$('.view').forEach((v) => v.classList.toggle('is-active', v.id === 'view-' + nama));
  if (location.hash.slice(1) !== nama) history.replaceState(null, '', '#' + nama);
  window.scrollTo({ top: 0 });
  render(nama);
}
window.addEventListener('hashchange', () => pindahView(location.hash.slice(1)));

$('#tabs').addEventListener('click', (e) => {
  const t = e.target.closest('.tabitem');
  if (t && t.dataset.view) pindahView(t.dataset.view);
});
$('#btnChat').addEventListener('click', () => pindahView('chat'));
$('#btnSetting').addEventListener('click', () => pindahView('kelola'));

/* Segmented control di halaman Kelola */
let segAktif = 'karyawan';
$('#segKelola').addEventListener('click', (e) => {
  const b = e.target.closest('.seg');
  if (!b) return;
  segAktif = b.dataset.seg;
  pasangSegmen();
});
function pasangSegmen() {
  $$('#segKelola .seg').forEach((b) => b.classList.toggle('is-active', b.dataset.seg === segAktif));
  // Disaring ke dalam #view-kelola saja — sejak view-gaji/view-jurnal juga
  // punya elemen ber-class .segpane (untuk sub-tab masing-masing), query
  // tanpa saringan ini akan ikut mereset is-active punya mereka tiap kali
  // Kelola dibuka.
  $$('#view-kelola .segpane').forEach((p) => p.classList.toggle('is-active', p.id === 'seg-' + segAktif));
}

function gantiTema() {
  const baru = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = baru;
  gudang.setItem('lovepet-theme', baru);
  render();
}
$('#themeToggle').addEventListener('click', gantiTema);
document.documentElement.dataset.theme = gudang.getItem('lovepet-theme') || 'light';

/* ============================ PERIODE ============================ */
function isiPeriode() {
  const tahunSet = new Set(Object.keys(state.payroll).map((k) => k.split('-')[0]));
  tahunSet.add(String(new Date().getFullYear()));
  tahunSet.add(tahunAktif());
  const tahun = Array.from(tahunSet).sort();
  const sel = $('#periodeSelect');
  sel.innerHTML = tahun.map((y) =>
    `<optgroup label="${y}">` + kunciTahun(y).map((k) => {
      const ada = state.payroll[k] && state.payroll[k].length;
      return `<option value="${k}"${k === periode ? ' selected' : ''}>${NAMA_BULAN[Number(k.split('-')[1]) - 1]} ${y}${ada ? '' : ' —'}</option>`;
    }).join('') + `</optgroup>`).join('');
}
$('#periodeSelect').addEventListener('change', (e) => {
  periode = e.target.value;
  render();
});

/* ============================ RENDER UTAMA ============================ */
function render(hanya) {
  const nm = state.profil.nama || 'LOVE Pet Clinic';
  $('#brandNama').textContent = nm;
  $('#brandNamaHp').textContent = nm;
  isiPeriode();
  const aktif = hanya || ($('.view.is-active') || {}).id?.replace('view-', '') || 'dashboard';
  if (aktif === 'dashboard') renderDashboard();
  // 'gaji' = view gabungan Input/Slip/Rekap — ketiganya disegarkan
  // sekaligus (sama seperti Kelola menyegarkan Karyawan & Pengaturan
  // sekaligus), supaya isinya tetap benar kalau dropdown bulan/tahun
  // berubah sementara sub-tab lain yang sedang tampil.
  if (aktif === 'gaji' || aktif === 'input')   renderInput();
  if (aktif === 'gaji' || aktif === 'slip')    renderSlipView();
  if (aktif === 'gaji' || aktif === 'tahunan') renderTahunan();
  if (aktif === 'chat' && window.ChatPemilik) window.ChatPemilik.segarkan();
  // 'jurnal' = view gabungan Jurnal/Neraca — sama, disegarkan sekaligus.
  if ((aktif === 'jurnal' || aktif === 'neraca') && window.Neraca) window.Neraca.segarkan();
  if (aktif === 'jurnal' && window.Jurnal) window.Jurnal.segarkan(periode);
  if (aktif === 'kasbon' && window.Kasbon) window.Kasbon.segarkan();
  if (aktif === 'kelola')  { pasangSegmen(); renderKaryawan(); renderPengaturan(); }
}

/* ====================== RINGKASAN INTAJO (klinik) ====================== */
// Cocok dengan tanggalWita() di functions/api/intajo-sync.js — Worker
// menarik ulang tiap 2,5–7 jam (acak) dan menulis dokumen hari ini serta
// kemarin, jadi di sini hari ini dulu, mundur ke kemarin kalau belum ada.
function tanggalWita(geser = 0) {
  const d = new Date(Date.now() + 8 * 60 * 60 * 1000);
  d.setUTCDate(d.getUTCDate() + geser);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

async function renderIntajo() {
  const kartu = $('#cardIntajo');
  if (!window.CLOUD || !kartu) return;
  const { db, fsMod } = window.CLOUD;
  try {
    let tanggal = null, snap = null;
    for (const kandidat of [tanggalWita(0), tanggalWita(-1)]) {
      const s = await fsMod.getDoc(fsMod.doc(db, 'klinik', KLINIK_ID, 'ringkasanIntajo', kandidat));
      if (s.exists()) { tanggal = kandidat; snap = s; break; }
    }
    if (!snap) { kartu.hidden = true; return; }
    const d = snap.data();
    const [y, m, tgl] = tanggal.split('-');
    $('#intajoTanggal').textContent = `${tgl} ${NAMA_BULAN[Number(m) - 1]} ${y}`;
    const blok = (label, c) => `
      <div class="cabang-blok">
        <p class="cabang-judul">${label}</p>
        <div class="cabang-row">
          <div class="stat"><div class="k">Pendapatan</div><div class="v">${rp(c.pendapatan)}</div></div>
          <div class="stat"><div class="k">Pengeluaran</div><div class="v">${rp(c.pengeluaran)}</div></div>
          <div class="stat ${c.keuntungan < 0 ? 'untung-minus' : 'untung-plus'}"><div class="k">Keuntungan</div><div class="v">${rp(c.keuntungan)}</div></div>
        </div>
      </div>`;
    $('#intajoRow').innerHTML =
      blok('Manado', d.cabang.manado) + blok('Tomohon', d.cabang.tomohon) +
      `<div class="cabang-blok">
        <p class="cabang-judul">Total</p>
        <div class="cabang-row">
          <div class="stat"><div class="k">Pendapatan</div><div class="v">${rp(d.gabungan.pendapatan)}</div></div>
          <div class="stat"><div class="k">Pengeluaran</div><div class="v">${rp(d.gabungan.pengeluaran)}</div></div>
          <div class="stat ${d.gabungan.keuntungan < 0 ? 'untung-minus' : 'untung-plus'}"><div class="k">Keuntungan</div><div class="v">${rp(d.gabungan.keuntungan)}</div></div>
        </div>
      </div>`;
    kartu.hidden = false;
  } catch (e) {
    console.error('renderIntajo:', e);
    kartu.hidden = true;
  }
}

/* Tombol "Tarik data sekarang" — biasanya tidak perlu ditekan (Worker
   menarik sendiri tiap 2,5–7 jam), gunanya kalau ingin angka terbaru saat
   itu juga. Kredensial intajo.com ada di Worker, bukan di sini; yang
   dikirim cuma idToken sebagai bukti bahwa yang menekan adalah pemilik. */
async function tarikIntajoSekarang(tombol) {
  const auth = window.CLOUD && window.CLOUD.auth;
  if (!auth || !auth.currentUser) return alert('Masuk dulu sebagai pemilik.');

  const semula = tombol.textContent;
  tombol.disabled = true;
  tombol.textContent = 'Menarik…';
  try {
    const idToken = await auth.currentUser.getIdToken();
    const res = await fetch('/api/intajo-tarik', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.ok) throw new Error(j.error || 'Gagal (' + res.status + ')');
    await renderIntajo();
    tombol.textContent = 'Data diperbarui';
  } catch (e) {
    console.error('tarikIntajoSekarang:', e);
    alert('Gagal menarik data: ' + e.message);
    tombol.textContent = semula;
  } finally {
    tombol.disabled = false;
    setTimeout(() => { tombol.textContent = semula; }, 3000);
  }
  if (!$('#panelRekapIntajo').hidden) renderRekapIntajo($('#rekapIntajoBulan').value);
}

/* Rekap harian intajo — dimulai dari CUTOFF_REKAP_INTAJO (tanggal fitur ini
   dipasang), BUKAN dari awal data tersimpan. Dokumen sebelum tanggal itu
   ditulis dengan bug tanggal-geser & cabang-kembar (lihat commit sebelumnya
   yang memperbaikinya), jadi sengaja diabaikan supaya rekap tidak
   menyesatkan — bukan lupa dibersihkan. */
const CUTOFF_REKAP_INTAJO = '2026-08-18';

async function bulanBerisiDataIntajo() {
  const { db, fsMod } = window.CLOUD;
  const kol = fsMod.collection(db, 'klinik', KLINIK_ID, 'ringkasanIntajo');
  const q = fsMod.query(kol, fsMod.where('tanggal', '>=', CUTOFF_REKAP_INTAJO), fsMod.orderBy('tanggal', 'asc'));
  const snap = await fsMod.getDocs(q);
  const bulanSet = new Set();
  snap.forEach((d) => bulanSet.add(d.id.slice(0, 7)));
  bulanSet.add(tanggalWita(0).slice(0, 7)); // bulan berjalan selalu ada walau belum ada data
  return [...bulanSet].sort().reverse();
}

async function isiDropdownRekapIntajo() {
  const sel = $('#rekapIntajoBulan');
  if (sel.dataset.terisi) return;
  const bulanList = await bulanBerisiDataIntajo();
  sel.innerHTML = bulanList.map((b) => {
    const [y, m] = b.split('-');
    return `<option value="${b}">${NAMA_BULAN[Number(m) - 1]} ${y}</option>`;
  }).join('');
  sel.dataset.terisi = '1';
}

async function renderRekapIntajo(bulan) {
  const { db, fsMod } = window.CLOUD;
  const tabel = $('#tblRekapIntajo');
  const dari = bulan + '-01', sampai = bulan + '-31';
  const awal = dari > CUTOFF_REKAP_INTAJO ? dari : CUTOFF_REKAP_INTAJO;
  const kol = fsMod.collection(db, 'klinik', KLINIK_ID, 'ringkasanIntajo');
  const q = fsMod.query(kol,
    fsMod.where('tanggal', '>=', awal), fsMod.where('tanggal', '<=', sampai),
    fsMod.orderBy('tanggal', 'desc'));
  const snap = await fsMod.getDocs(q);

  const baris = [];
  snap.forEach((d) => baris.push(d.data()));

  if (!baris.length) {
    tabel.innerHTML = `<tbody><tr><td class="muted">Belum ada data untuk bulan ini.</td></tr></tbody>`;
    return;
  }

  const total = baris.reduce((s, r) => ({
    manadoP: s.manadoP + (r.cabang.manado.pendapatan || 0),
    manadoK: s.manadoK + (r.cabang.manado.pengeluaran || 0),
    tomohonP: s.tomohonP + (r.cabang.tomohon.pendapatan || 0),
    tomohonK: s.tomohonK + (r.cabang.tomohon.pengeluaran || 0),
    untung: s.untung + (r.gabungan.keuntungan || 0),
  }), { manadoP: 0, manadoK: 0, tomohonP: 0, tomohonK: 0, untung: 0 });

  const baris2tgl = (t) => {
    const [y, m, tgl] = t.split('-');
    return `${tgl} ${NAMA_BULAN[Number(m) - 1].slice(0, 3)}`;
  };

  tabel.innerHTML = `
    <thead><tr>
      <th>Tanggal</th><th>Pendapatan Manado</th><th>Pengeluaran Manado</th>
      <th>Pendapatan Tomohon</th><th>Pengeluaran Tomohon</th><th>Keuntungan Total</th>
    </tr></thead>
    <tbody>${baris.map((r) => `<tr>
      <td>${baris2tgl(r.tanggal)}</td>
      <td class="num">${rp(r.cabang.manado.pendapatan)}</td>
      <td class="num">${rp(r.cabang.manado.pengeluaran)}</td>
      <td class="num">${rp(r.cabang.tomohon.pendapatan)}</td>
      <td class="num">${rp(r.cabang.tomohon.pengeluaran)}</td>
      <td class="num"><b>${rp(r.gabungan.keuntungan)}</b></td>
    </tr>`).join('')}</tbody>
    <tfoot><tr>
      <td>Total</td>
      <td class="num">${rp(total.manadoP)}</td>
      <td class="num">${rp(total.manadoK)}</td>
      <td class="num">${rp(total.tomohonP)}</td>
      <td class="num">${rp(total.tomohonK)}</td>
      <td class="num"><b>${rp(total.untung)}</b></td>
    </tr></tfoot>`;
}

$('#btnRekapIntajo')?.addEventListener('click', async () => {
  const panel = $('#panelRekapIntajo');
  panel.hidden = !panel.hidden;
  if (panel.hidden || !window.CLOUD) return;
  await isiDropdownRekapIntajo();
  await renderRekapIntajo($('#rekapIntajoBulan').value);
});
$('#rekapIntajoBulan')?.addEventListener('change', (e) => renderRekapIntajo(e.target.value));

/* ============================ DASHBOARD ============================ */
function renderDashboard() {
  const data = rows(periode);
  renderIntajo();
  $('#ringkasPeriode').textContent = labelPeriode(periode);

  const total = data.reduce((s, r) => s + hitung(r).total, 0);
  const bonus = data.reduce((s, r) => s + hitung(r).totalBonus, 0);
  const potong = data.reduce((s, r) => s + hitung(r).potongan, 0);
  const clients = data.reduce((s, r) => s + qtyTotal(r, 'clients'), 0);

  // Pembanding bulan sebelumnya
  const idx = kunciTahun(tahunAktif()).indexOf(periode);
  const prevKey = idx > 0 ? kunciTahun(tahunAktif())[idx - 1] : null;
  const prevTot = prevKey ? totalBulan(prevKey) : 0;
  let delta = '';
  if (prevTot) {
    const p = ((total - prevTot) / prevTot) * 100;
    delta = `<div class="d ${p >= 0 ? 'up' : 'down'}">${p >= 0 ? '▲' : '▼'} ${Math.abs(p).toFixed(1)}% vs ${NAMA_BULAN[Number(prevKey.split('-')[1]) - 1]}</div>`;
  }

  $('#dashSub').textContent = data.length
    ? `${labelPeriode(periode)} • ${data.length} karyawan`
    : `${labelPeriode(periode)} • belum ada data — mulai dari tab “Input”`;

  $('#statRow').innerHTML = `
    <div class="stat"><div class="k">Total Dibayar</div><div class="v">${rp(total)}</div>${delta}</div>
    <div class="stat"><div class="k">Total Bonus</div><div class="v">${rp(bonus)}</div><div class="d">${total ? ((bonus / total) * 100).toFixed(1) : 0}% dari total</div></div>
    <div class="stat"><div class="k">Total Potongan</div><div class="v">${rp(potong)}</div><div class="d">hutang &amp; denda</div></div>
    <div class="stat"><div class="k">Clients</div><div class="v">${clients.toLocaleString('id-ID')}</div><div class="d">dasar bonus clients</div></div>`;

  // Grafik total per bulan (satu seri → tanpa legenda)
  const keys = kunciTahun(tahunAktif());
  grafik($('#chartBulanan'), {
    rows: keys.map((k, i) => ({ label: NAMA_BULAN[i].slice(0, 3), values: [totalBulan(k)], sorot: k === periode })),
    series: [{ name: 'Total gaji', color: 'var(--series-1)' }],
    horizontal: false,
  });

  // Komposisi: gaji tetap vs bonus (bertumpuk) per karyawan
  grafik($('#chartKomposisi'), {
    rows: data.map((r) => {
      const h = hitung(r);
      const tetap = (+r.pokok || 0) + (+r.operasional || 0) + (+r.makan || 0) + (+r.tunjLain || 0);
      return { label: namaPendek(r.nama), values: [tetap, h.totalBonus], extra: `Potongan ${rp(h.potongan)} • Diterima ${rp(h.total)}` };
    }),
    series: [{ name: 'Gaji tetap & tunjangan', color: 'var(--series-1)' }, { name: 'Bonus', color: 'var(--series-2)' }],
    horizontal: true,
  });

  // Daftar (HP) + tabel (desktop)
  const list = $('#listRingkas');
  const t = $('#tblRingkas');
  if (!data.length) {
    list.innerHTML = '<div class="empty">Belum ada data gaji untuk periode ini.</div>';
    t.innerHTML = '';
  } else {
    list.innerHTML = data.map((r) => {
      const h = hitung(r);
      return `<div class="list-row" data-emp="${r.empId}">
        <div class="avatar">${inisial(r.nama)}</div>
        <div class="who"><b>${esc(r.nama)}</b><small>${esc(r.role)}${h.totalBonus ? ' • bonus ' + rpShort(h.totalBonus) : ''}</small></div>
        <div class="amt"><b>${rp(h.total)}</b>${h.potongan ? `<small>potongan ${rpShort(h.potongan)}</small>` : ''}</div>
        <span class="chev">›</span>
      </div>`;
    }).join('') + `<div class="list-foot"><span>Total</span><span>${rp(total)}</span></div>`;

    t.innerHTML = `
      <thead><tr>
        <th>Karyawan</th><th>Posisi</th><th>Gaji Tetap</th><th>Bonus</th><th>Potongan</th><th>Diterima</th>
      </tr></thead>
      <tbody>${data.map((r) => {
        const h = hitung(r);
        return `<tr class="row-click" data-emp="${r.empId}">
          <td>${esc(r.nama)}</td>
          <td><span class="badge">${esc(r.role)}</span></td>
          <td class="num">${rp((+r.pokok || 0) + (+r.operasional || 0))}</td>
          <td class="num">${rp(h.totalBonus)}</td>
          <td class="num">${h.potongan ? '−' + rp(h.potongan).slice(3) : '—'}</td>
          <td class="num"><b>${rp(h.total)}</b></td>
        </tr>`;
      }).join('')}</tbody>
      <tfoot><tr><td>Total</td><td></td>
        <td class="num">${rp(data.reduce((s, r) => s + (+r.pokok || 0) + (+r.operasional || 0), 0))}</td>
        <td class="num">${rp(bonus)}</td><td class="num">${rp(potong)}</td><td class="num">${rp(total)}</td>
      </tr></tfoot>`;
  }

  renderRekapPerforma(data);
}

/* Rekap performa: jumlah tiap komponen bonus per karyawan bulan ini —
   dipakai untuk menilai kinerja (bukan sekadar nominal rupiah). Sorot
   nilai tertinggi tiap kolom supaya cepat terlihat siapa yang unggul. */
function renderRekapPerforma(data) {
  const el = $('#tblPerforma');
  if (!data.length) { el.innerHTML = '<div class="empty">Belum ada data performa untuk periode ini.</div>'; return; }

  const komp = KOMPONEN;
  const maxTiapKolom = komp.map((k) => Math.max(0, ...data.map((r) => qtyTotal(r, k.id))));

  el.innerHTML = `
    <table class="tbl">
      <thead><tr>
        <th>Karyawan</th>
        ${komp.map((k) => `<th class="num">${k.ikon || ''} ${esc(k.label)}</th>`).join('')}
        <th class="num">Total Poin</th>
      </tr></thead>
      <tbody>${data.map((r) => {
        const nilai = komp.map((k) => qtyTotal(r, k.id));
        const totalPoin = nilai.reduce((s, v) => s + v, 0);
        return `<tr>
          <td>${esc(r.nama)}</td>
          ${komp.map((k, i) => {
            const v = nilai[i];
            const top = v > 0 && v === maxTiapKolom[i];
            return `<td class="num${top ? ' top-performa' : ''}">${v || '—'}</td>`;
          }).join('')}
          <td class="num"><b>${totalPoin}</b></td>
        </tr>`;
      }).join('')}</tbody>
    </table>`;
}

/* Ketuk baris ringkasan (daftar HP atau tabel desktop) → buka slipnya */
$('#view-dashboard').addEventListener('click', (e) => {
  const el = e.target.closest('[data-emp]');
  if (!el) return;
  pindahView('slip');
  $('#slipKaryawan').value = el.dataset.emp;
  renderSlip();
});
function namaPendek(n) {
  const s = String(n).replace(/^Drh\.?\s*/i, '');
  const p = s.split(/\s+/);
  return p.length > 1 ? p[0] + ' ' + p[1][0] + '.' : s;
}

/* ============================ INPUT GAJI ============================
   Dua mode:
   • Performa       — isian bulanan yang rutin: jumlah client, jaga, lembur,
                      rawat inap, styling, operasi — dipisah per cabang.
                      Gaji langsung terhitung.
   • Gaji & Potongan— yang jarang berubah: gaji pokok, tunjangan, tarif,
                      denda, hutang, catatan slip.
   ==================================================================== */
let modeInput = 'performa';

$('#segInput').addEventListener('click', (e) => {
  const b = e.target.closest('.seg');
  if (!b) return;
  modeInput = b.dataset.seg;
  renderInput();
});

function renderInput() {
  const data = rows(periode);
  $$('#segInput .seg').forEach((b) => b.classList.toggle('is-active', b.dataset.seg === modeInput));

  const kosong = !data.length;
  $('#inputPerforma').classList.toggle('is-active', modeInput === 'performa' && !kosong);
  $('#inputRinci').classList.toggle('is-active', modeInput === 'rinci' && !kosong);
  $('#inputKosong').classList.toggle('is-active', kosong);

  if (kosong) {
    $('#inputKosong').innerHTML = `<div class="empty">
      Belum ada baris gaji untuk <b>${labelPeriode(periode)}</b>.<br>
      Tekan “Salin bulan lalu” untuk menyalin karyawan &amp; tarifnya,
      atau “Tambah karyawan”.</div>`;
    $('#inputTotal').textContent = rp(0);
    return;
  }

  if (modeInput === 'performa') renderPerforma(data); else renderRinci(data);
  hitungUlangSemua();
}

/* ---------------------- MODE 1: INPUT PERFORMA ---------------------- */
function renderPerforma(data) {
  const nmCabang = (c) => esc(state.cabang[c] || c);

  /* Kartu per karyawan — dipakai di HP */
  const kartu = data.map((r, i) => {
    const komp = komponenUntuk(r.role);
    return `<article class="emp perf" data-i="${i}">
      <div class="emp-head">
        <div class="avatar">${inisial(r.nama)}</div>
        <div><div class="nm">${esc(r.nama)}</div><div class="rl">${esc(r.role)}</div></div>
        <div class="tot"><b data-total="${i}">—</b><small>diterima</small></div>
      </div>
      <div class="emp-body">
        ${komp.map((k) => `
          <div class="qty-row">
            <div class="qty-head">
              <span class="t">${esc(k.label)}</span>
              <span class="calc" data-calc="${k.id}"></span>
            </div>
            <div class="qty-inputs">
              ${CABANG.map((c) => `<label class="field"><span class="f-label">${nmCabang(c)}</span>
                ${inpQty(i, k.id, c, r)}</label>`).join('')}
            </div>
          </div>`).join('')}
      </div>
      <div class="emp-foot">
        <span class="muted" data-rincian="${i}"></span>
        <span class="grow"></span>
        <button class="btn btn-sm" data-act="slip" data-i="${i}">Slip</button>
      </div>
    </article>`;
  }).join('');

  /* Tabel — dipakai di desktop, meniru tabel "Input performance bulanan" */
  const tabel = `
    <table class="tbl tbl-input">
      <thead>
        <tr>
          <th rowspan="2">Karyawan</th>
          ${KOMPONEN.map((k) => `<th colspan="${CABANG.length}">${esc(k.label)}</th>`).join('')}
          <th rowspan="2">Gaji diterima</th>
        </tr>
        <tr>${KOMPONEN.map(() => CABANG.map((c) => `<th class="sub">${nmCabang(c)}</th>`).join('')).join('')}</tr>
      </thead>
      <tbody>${data.map((r, i) => {
        const boleh = new Set(komponenUntuk(r.role).map((k) => k.id));
        return `<tr>
          <td><b>${esc(namaPendek(r.nama))}</b><div class="sub-lbl">${esc(r.role)}</div></td>
          ${KOMPONEN.map((k) => CABANG.map((c) => `<td>${boleh.has(k.id)
            ? inpQty(i, k.id, c, r) : '<span class="na">–</span>'}</td>`).join('')).join('')}
          <td class="num"><b data-total="${i}">—</b></td>
        </tr>`;
      }).join('')}</tbody>
    </table>`;

  $('#perfCards').innerHTML = kartu;
  $('#perfTable').innerHTML = tabel;
}

function inpQty(i, kid, cab, r) {
  const v = ((r.qty || {})[kid] || {})[cab] || 0;
  return `<input type="number" inputmode="numeric" step="1" min="0"
    data-i="${i}" data-q="${kid}" data-c="${cab}" value="${Number(v) || 0}">`;
}

/* ------------------ MODE 2: GAJI TETAP & POTONGAN ------------------ */
function renderRinci(data) {
  $('#inputRinci').innerHTML = data.map((r, i) => {
    const f = (nama, val, step) => `<input type="number" inputmode="decimal" step="${step || 1}" min="0" data-i="${i}" data-f="${nama}" value="${Number(val) || 0}">`;
    const komp = komponenUntuk(r.role);
    return `<article class="emp" data-i="${i}">
      <div class="emp-head">
        <div class="avatar">${inisial(r.nama)}</div>
        <div><div class="nm">${esc(r.nama)}</div><div class="rl">${esc(r.role)}</div></div>
        <div class="tot"><b data-total="${i}">—</b><small>diterima</small></div>
      </div>
      <div class="emp-body">
        <span class="fs-title">Gaji tetap</span>
        <div class="f-row">
          <label class="field"><span class="f-label">Gaji pokok</span>${f('pokok', r.pokok, 50000)}</label>
          <label class="field"><span class="f-label">Tunj. operasional</span>${f('operasional', r.operasional, 50000)}</label>
        </div>
        <div class="f-row">
          <label class="field"><span class="f-label">Tunjangan makan</span>${f('makan', r.makan, 50000)}</label>
          <label class="field"><span class="f-label">Tunjangan lain</span>${f('tunjLain', r.tunjLain, 50000)}</label>
        </div>

        <div class="divider"></div>
        <span class="fs-title">Tarif bonus bulan ini</span>
        <div class="f-row f-row-3">
          ${komp.map((k) => `<label class="field"><span class="f-label">${esc(k.label)}</span>
            <input type="number" step="500" min="0" data-i="${i}" data-r="${k.id}" value="${Number((r.rate || {})[k.id]) || 0}"></label>`).join('')}
        </div>

        <div class="divider"></div>
        <span class="fs-title">Potongan</span>
        <div class="f-row">
          <label class="field"><span class="f-label">Denda / absen</span>${f('denda', r.denda, 50000)}</label>
          <label class="field"><span class="f-label">Hutang / kasbon</span>${f('hutang', r.hutang, 50000)}</label>
        </div>
        ${window.Kasbon && window.Kasbon.cicilanSaran(r.empId)
          ? `<p class="muted" style="font-size:.76rem;margin:-4px 0 0">Kasbon aktif — cicilan saran ${rp(window.Kasbon.cicilanSaran(r.empId))}/bulan. Lihat rinciannya di tab Kasbon.</p>` : ''}
        <label class="field"><span class="f-label">Catatan (tampil di slip)</span>
          <input type="text" data-i="${i}" data-f="catatan" value="${esc(r.catatan || '')}" placeholder="opsional">
        </label>
      </div>
      <div class="emp-foot">
        <span class="muted" data-rincian="${i}"></span>
        <span class="grow"></span>
        <button class="btn btn-sm btn-danger" data-act="hapus" data-i="${i}">Hapus</button>
      </div>
    </article>`;
  }).join('');
}

/* ------------------------- HITUNG ULANG ------------------------- */
function hitungUlangBaris(i) {
  const r = rows(periode)[i];
  if (!r) return;
  const h = hitung(r);
  $$(`[data-total="${i}"]`).forEach((el) => { el.textContent = rp(h.total); });
  const card = $(`.emp[data-i="${i}"]`);
  if (card) {
    KOMPONEN.forEach((k) => {
      const el = card.querySelector(`[data-calc="${k.id}"]`);
      if (el) el.textContent = rp(h.bonus[k.id]);
    });
    const rin = card.querySelector(`[data-rincian="${i}"]`);
    if (rin) rin.textContent = `Bruto ${rpShort(h.bruto)} − potongan ${rpShort(h.potongan)}`;
  }
}
function hitungUlangSemua() {
  rows(periode).forEach((_, i) => hitungUlangBaris(i));
  $('#inputTotal').textContent = rp(totalBulan(periode));
}

/* --------------------------- INTERAKSI --------------------------- */
$('#gajiPaneInput').addEventListener('input', (e) => {
  const el = e.target;
  const i = Number(el.dataset.i);
  const r = rows(periode)[i];
  if (!r || el.dataset.i === undefined) return;

  if (el.dataset.q) {                              // jumlah performa per cabang
    r.qty[el.dataset.q] = r.qty[el.dataset.q] || {};
    r.qty[el.dataset.q][el.dataset.c] = Number(el.value) || 0;
  } else if (el.dataset.r) {                       // tarif komponen
    r.rate[el.dataset.r] = Number(el.value) || 0;
  } else if (el.dataset.f) {                       // kolom biasa
    r[el.dataset.f] = el.type === 'number' ? (Number(el.value) || 0) : el.value;
  } else return;

  hitungUlangBaris(i);
  $('#inputTotal').textContent = rp(totalBulan(periode));
  simpan();
});

$('#gajiPaneInput').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-act]');
  if (!b) return;
  const i = Number(b.dataset.i);
  const r = rows(periode)[i];
  if (b.dataset.act === 'hapus') {
    if (!confirm(`Hapus baris gaji ${r.nama} untuk ${labelPeriode(periode)}?`)) return;
    state.payroll[periode].splice(i, 1);
    simpan(true); renderInput(); toast('Baris dihapus');
  }
  if (b.dataset.act === 'slip') {
    pindahView('slip');
    $('#slipKaryawan').value = r.empId;
    renderSlip();
  }
});

$('#btnTambahBaris').addEventListener('click', () => {
  if (!state.payroll[periode]) state.payroll[periode] = [];
  const ada = new Set(rows(periode).map((r) => r.empId));
  const tambah = state.karyawan.filter((e) => e.aktif !== false && !ada.has(e.id));
  if (!tambah.length) { toast('Semua karyawan aktif sudah ada di bulan ini'); return; }
  tambah.forEach((e) => {
    const baris = barisBaruUntuk(e, state.tarif);
    if (window.Kasbon) baris.hutang = window.Kasbon.cicilanSaran(e.id);
    state.payroll[periode].push(baris);
  });
  simpan(true); renderInput(); isiPeriode();
  toast(`${tambah.length} karyawan ditambahkan`);
});

$('#btnSalinBulanLalu').addEventListener('click', () => {
  const keys = Object.keys(state.payroll).filter((k) => k < periode && state.payroll[k].length).sort();
  if (!keys.length) { toast('Tidak ada bulan sebelumnya untuk disalin'); return; }
  const src = keys[keys.length - 1];
  if (rows(periode).length && !confirm(`Ganti isi ${labelPeriode(periode)} dengan salinan dari ${labelPeriode(src)}?`)) return;
  state.payroll[periode] = state.payroll[src].map((r) => {
    const baru = JSON.parse(JSON.stringify(r));
    KOMPONEN.forEach((k) => { baru.qty[k.id] = { mdo: 0, tmh: 0 }; });
    baru.denda = 0; baru.catatan = '';
    // Kasbon aktif → pakai cicilan terbaru. Kalau tak ada kasbon aktif,
    // biarkan nilai lama (mis. hutang manual lama yang belum lunas).
    if (window.Kasbon) {
      const saran = window.Kasbon.cicilanSaran(baru.empId);
      if (saran) baru.hutang = saran;
    }
    return baru;
  });
  simpan(true); renderInput(); isiPeriode();
  toast(`Disalin dari ${labelPeriode(src)} — jumlah performa direset ke 0`);
});

$('#btnResetBulan').addEventListener('click', () => {
  if (!confirm(`Hapus SEMUA baris gaji ${labelPeriode(periode)}?`)) return;
  delete state.payroll[periode];
  simpan(true); renderInput(); isiPeriode(); toast('Bulan dikosongkan');
});
$('#btnTarikLaporan').addEventListener('click', tarikLaporanKaryawan);

/* ============================ SLIP GAJI ============================ */
function renderSlipView() {
  const data = rows(periode);
  const sel = $('#slipKaryawan');
  const lama = sel.value;
  sel.innerHTML = data.map((r) => `<option value="${r.empId}">${esc(r.nama)}</option>`).join('')
    || '<option value="">— tidak ada data —</option>';
  if (data.some((r) => r.empId === lama)) sel.value = lama;
  renderSlip();
}
$('#slipKaryawan').addEventListener('change', renderSlip);

function renderSlip() {
  const id = $('#slipKaryawan').value;
  const r = rows(periode).find((x) => x.empId === id);
  $('#slipArea').innerHTML = r ? htmlSlip(r) :
    `<div class="empty">Belum ada data gaji ${labelPeriode(periode)}. Isi dulu di tab “Input Gaji”.</div>`;
  renderOtorisasi();
}

/* Ubah satu baris gaji menjadi SNAPSHOT — angka yang sudah jadi, lepas dari
   `state`. Inilah yang disimpan ke Firestore saat slip disetujui, sehingga
   karyawan bisa membuka slipnya sendiri tanpa boleh mengintip data orang
   lain. Bentuk & artinya dijelaskan di js/slip-render.js. */
function snapshotSlip(r, key) {
  key = key || periode;
  const h = hitung(r);
  const e = emp(r.empId) || {};
  const p = state.profil;
  const rapi = (list) => list.filter((x) => x.nilai)
    .map((x) => ({ label: x.label, nilai: x.nilai, ket: x.ket || '' }));

  return {
    periode: key,
    periodeLabel: labelPeriode(key),
    nama: r.nama,
    role: r.role,
    tanggal: new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }),
    klinik: {
      nama: p.nama || '', subjudul: p.subjudul || '', alamat: p.alamat || '',
      kota: p.kota || '', telp: p.telp || '',
      penandatangan: p.penandatangan || '', jabatan: p.jabatanPenandatangan || '',
    },
    bank: e.bank || '',
    norek: e.norek || '',
    bergabung: e.mulai ? new Date(e.mulai).toLocaleDateString('id-ID', { month: 'long', year: 'numeric' }) : '',
    pendapatan: rapi(h.pendapatan),
    potonganList: rapi(h.potonganList),
    bruto: h.bruto, potongan: h.potongan, total: h.total,
    terbilang: terbilang(h.total),
    catatan: r.catatan || '',
  };
}

function htmlSlip(r) { return window.SlipRender.gambar(snapshotSlip(r)); }

/* ---------------- Otorisasi slip (tombol di atas pratinjau) ----------------
   Logika penerbitannya ada di js/slip-terbit.js — ia sebuah module dan
   memegang sambungan Firestore. Di sini hanya tombolnya. */
function renderOtorisasi() {
  const kotak = $('#slipOtorisasi');
  if (!kotak) return;
  const id = $('#slipKaryawan').value;
  const r = rows(periode).find((x) => x.empId === id);
  const T = window.SlipTerbit;

  if (!r) { kotak.hidden = true; return; }
  kotak.hidden = false;

  if (!T || !T.siap()) {
    kotak.className = 'otorisasi';
    kotak.innerHTML = '<div class="ot-teks"><b>Belum tersambung ke server.</b>' +
      '<p>Masuk ke akun dulu supaya slip bisa dikirim ke karyawan.</p></div>';
    return;
  }
  if (!(emp(id) || {}).authUid) {
    kotak.className = 'otorisasi';
    kotak.innerHTML = '<div class="ot-teks"><b>Karyawan ini belum punya akun.</b>' +
      '<p>Buatkan dulu di Kelola → Karyawan supaya ia bisa membuka slipnya sendiri.</p></div>';
    return;
  }

  const s = T.status(id, periode);
  const disetujui = s && s.status === 'disetujui';
  kotak.className = 'otorisasi' + (disetujui ? ' is-ok' : '');
  kotak.innerHTML = `
    <div class="ot-teks">
      <b>${disetujui ? '✓ Sudah dikirim ke ' + esc(r.nama) : 'Belum dikirim ke karyawan'}</b>
      <p>${disetujui
        ? `Disetujui ${esc(s.disetujuiLabel)}${s.versi > 1 ? ` · revisi ke-${s.versi}` : ''}. ` +
          (s.revisiDiminta ? '<span class="ot-minta">Karyawan meminta revisi — lihat tab Chat.</span>'
                           : 'Ia sudah bisa membukanya di halaman Lovepet Crew.')
        : 'Setelah disetujui, slip ini langsung muncul di halaman Lovepet Crew miliknya.'}</p>
    </div>
    ${disetujui
      ? `<button class="btn btn-danger" data-ot="tarik">Tarik otorisasi</button>
         <button class="btn" data-ot="setujui">Kirim ulang</button>`
      : `<button class="btn btn-primary" data-ot="setujui">Setujui &amp; kirim</button>`}`;

  $$('#slipOtorisasi [data-ot]').forEach((b) => b.addEventListener('click', () => aksiOtorisasi(b.dataset.ot, r, b)));
}

async function aksiOtorisasi(aksi, r, tombol) {
  const T = window.SlipTerbit;
  const lama = tombol.textContent;
  tombol.disabled = true; tombol.textContent = 'Memproses…';
  try {
    if (aksi === 'tarik') {
      if (!confirm(`Tarik otorisasi slip ${r.nama} — ${labelPeriode(periode)}?\n\n` +
        'Ia tidak bisa mengunduhnya lagi sampai Anda menyetujui ulang.')) return;
      await T.tarik(r.empId, periode);
      // Potongan kasbon bulan ini belum jadi final — kembalikan sisanya
      // sampai slip ini disetujui ulang. Kegagalan di sini tidak boleh
      // membuat otorisasi yang sudah ditarik terlihat gagal.
      if (window.Kasbon) await window.Kasbon.terapkanPotongan(r.empId, periode, 0).catch((e) => console.warn('Kasbon (tarik):', e));
      toast('Otorisasi ditarik — slip disembunyikan dari karyawan');
    } else {
      await T.setujui(r.empId, periode, snapshotSlip(r), (emp(r.empId) || {}).authUid);
      if (window.Kasbon) await window.Kasbon.terapkanPotongan(r.empId, periode, Number(r.hutang) || 0).catch((e) => console.warn('Kasbon (setujui):', e));
      toast(`Slip ${r.nama} dikirim — ia sudah bisa mengunduhnya`);
    }
  } catch (e) {
    console.error(e);
    toast('Gagal: ' + (e.message || e));
  } finally {
    tombol.disabled = false; tombol.textContent = lama;
    renderOtorisasi();
  }
}
document.addEventListener('slip-terbit-berubah', renderOtorisasi);

let cetakDisiapkan = false;
function cetak(html) {
  $('#printArea').innerHTML = html;
  cetakDisiapkan = true;
  window.print();
}

/* Kalau pengguna menekan Cmd/Ctrl+P langsung, siapkan isi cetakan
   sesuai tab yang sedang terbuka supaya kertas tidak keluar kosong. */
window.addEventListener('beforeprint', () => {
  if (cetakDisiapkan) return;
  const aktif = (($('.view.is-active') || {}).id || '').replace('view-', '');
  let html = '';
  if (aktif === 'slip') {
    const r = rows(periode).find((x) => x.empId === $('#slipKaryawan').value);
    html = r ? htmlSlip(r) : '';
  } else if (aktif === 'tahunan') {
    html = `<h2>Rekap Gaji ${esc(state.profil.nama)} — ${tahunAktif()}</h2>` + ($('#tblTahunan') || {}).outerHTML;
  } else if (aktif === 'dashboard' || aktif === 'input') {
    html = `<h2>${esc(state.profil.nama)} — Daftar Gaji ${labelPeriode(periode)}</h2>` +
      `<table class="tbl"><thead><tr><th>Karyawan</th><th>Posisi</th><th>Gaji tetap</th><th>Bonus</th><th>Potongan</th><th>Diterima</th></tr></thead><tbody>` +
      rows(periode).map((r) => {
        const h = hitung(r);
        return `<tr><td>${esc(r.nama)}</td><td>${esc(r.role)}</td><td>${rp((+r.pokok || 0) + (+r.operasional || 0))}</td><td>${rp(h.totalBonus)}</td><td>${rp(h.potongan)}</td><td><b>${rp(h.total)}</b></td></tr>`;
      }).join('') +
      `</tbody><tfoot><tr><td colspan="5">Total</td><td>${rp(totalBulan(periode))}</td></tr></tfoot></table>`;
  }
  $('#printArea').innerHTML = html || '<p>Buka tab “Slip Gaji” lalu tekan tombol Cetak / PDF.</p>';
});
window.addEventListener('afterprint', () => { cetakDisiapkan = false; });
$('#btnCetakSlip').addEventListener('click', () => {
  const r = rows(periode).find((x) => x.empId === $('#slipKaryawan').value);
  if (!r) { toast('Tidak ada slip untuk dicetak'); return; }
  cetak(htmlSlip(r));
});
$('#btnCetakSemua').addEventListener('click', () => {
  const data = rows(periode);
  if (!data.length) { toast('Belum ada data bulan ini'); return; }
  cetak(data.map(htmlSlip).join(''));
});
/* Unduh slip sebagai gambar PNG — html2canvas dimuat hanya saat dipakai
   (lazy import), supaya aplikasi tetap ringan kalau tombol ini tak disentuh. */
$('#btnUnduhGambar').addEventListener('click', async () => {
  const r = rows(periode).find((x) => x.empId === $('#slipKaryawan').value);
  if (!r) { toast('Pilih karyawan dulu'); return; }
  const tombol = $('#btnUnduhGambar');
  tombol.disabled = true; tombol.textContent = 'Menyiapkan…';
  try {
    const { default: html2canvas } = await import('https://esm.sh/html2canvas@1.4.1');
    const node = $('#slipArea .slip');
    const canvas = await html2canvas(node, { scale: 2, backgroundColor: '#ffffff' });
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = `slip-${r.nama.replace(/\s+/g, '-')}-${periode}.png`;
    a.click();
    toast('Gambar diunduh');
  } catch (e) {
    console.error(e);
    toast('Gagal membuat gambar: ' + (e.message || e));
  } finally {
    tombol.disabled = false; tombol.textContent = 'Unduh gambar (PNG)';
  }
});
$('#btnSalinWA').addEventListener('click', async () => {
  const r = rows(periode).find((x) => x.empId === $('#slipKaryawan').value);
  if (!r) { toast('Pilih karyawan dulu'); return; }
  const h = hitung(r);
  const txt = [
    `*${state.profil.nama}* — Slip Gaji ${labelPeriode(periode)}`,
    `Nama: ${r.nama} (${r.role})`, '',
    ...h.pendapatan.filter((x) => x.nilai).map((x) => `• ${x.label}: ${rp(x.nilai)}${x.ket ? ` (${x.ket})` : ''}`),
    `Total pendapatan: ${rp(h.bruto)}`,
    ...(h.potongan ? ['', ...h.potonganList.filter((x) => x.nilai).map((x) => `• ${x.label}: −${rp(x.nilai)}`)] : []),
    '', `*Gaji diterima: ${rp(h.total)}*`, `(${terbilang(h.total)})`,
    ...(r.catatan ? ['', `Catatan: ${r.catatan}`] : []),
  ].join('\n');
  try { await navigator.clipboard.writeText(txt); toast('Teks slip disalin — tinggal tempel di WhatsApp'); }
  catch { prompt('Salin teks berikut:', txt); }
});

/* ============================ REKAP TAHUNAN ============================ */
function renderTahunan() {
  const y = tahunAktif();
  const keys = kunciTahun(y);
  $('#tahunChip').textContent = y;

  const totalTahun = keys.reduce((s, k) => s + totalBulan(k), 0);
  const bulanTerisi = keys.filter((k) => rows(k).length).length;
  const bonusTahun = keys.reduce((s, k) => s + rows(k).reduce((a, r) => a + hitung(r).totalBonus, 0), 0);
  const clientsTahun = keys.reduce((s, k) => s + rows(k).reduce((a, r) => a + qtyTotal(r, 'clients'), 0), 0);

  $('#statTahun').innerHTML = `
    <div class="stat"><div class="k">Total Setahun</div><div class="v">${rp(totalTahun)}</div><div class="d">${bulanTerisi} bulan terisi</div></div>
    <div class="stat"><div class="k">Rata-rata / Bulan</div><div class="v">${rp(bulanTerisi ? totalTahun / bulanTerisi : 0)}</div></div>
    <div class="stat"><div class="k">Total Bonus</div><div class="v">${rp(bonusTahun)}</div><div class="d">${totalTahun ? ((bonusTahun / totalTahun) * 100).toFixed(1) : 0}% dari total</div></div>
    <div class="stat"><div class="k">Total Clients</div><div class="v">${clientsTahun.toLocaleString('id-ID')}</div></div>`;

  // Daftar karyawan yang muncul di tahun ini
  const ids = [];
  keys.forEach((k) => rows(k).forEach((r) => { if (!ids.includes(r.empId)) ids.push(r.empId); }));
  const perKaryawan = ids.map((id) => {
    const nama = (rows(keys.find((k) => rows(k).some((r) => r.empId === id)) || keys[0]).find((r) => r.empId === id) || {}).nama || id;
    const perBulan = keys.map((k) => {
      const r = rows(k).find((x) => x.empId === id);
      return r ? hitung(r).total : 0;
    });
    return { id, nama, perBulan, total: perBulan.reduce((a, b) => a + b, 0) };
  });

  grafik($('#chartKaryawan'), {
    rows: perKaryawan.slice().sort((a, b) => b.total - a.total)
      .map((k) => ({ label: namaPendek(k.nama), values: [k.total] })),
    series: [{ name: 'Total setahun', color: 'var(--series-1)' }],
    horizontal: true,
  });

  grafik($('#chartTren'), {
    rows: keys.map((k, i) => {
      const d = rows(k);
      const tetap = d.reduce((s, r) => s + (+r.pokok || 0) + (+r.operasional || 0) + (+r.makan || 0) + (+r.tunjLain || 0), 0);
      const bon = d.reduce((s, r) => s + hitung(r).totalBonus, 0);
      return { label: NAMA_BULAN[i].slice(0, 3), values: [tetap, bon] };
    }),
    series: [{ name: 'Gaji tetap & tunjangan', color: 'var(--series-1)' }, { name: 'Bonus', color: 'var(--series-2)' }],
    horizontal: false,
  });

  const t = $('#tblTahunan');
  t.innerHTML = `
    <thead><tr><th>Karyawan</th>${keys.map((k, i) => `<th>${NAMA_BULAN[i].slice(0, 3)}</th>`).join('')}<th>Total</th></tr></thead>
    <tbody>${perKaryawan.map((k) => `<tr>
      <td>${esc(k.nama)}</td>
      ${k.perBulan.map((v) => `<td class="num">${v ? rpShort(v) : '—'}</td>`).join('')}
      <td class="num"><b>${rpShort(k.total)}</b></td></tr>`).join('')}</tbody>
    <tfoot><tr><td>Total</td>
      ${keys.map((k) => `<td class="num">${totalBulan(k) ? rpShort(totalBulan(k)) : '—'}</td>`).join('')}
      <td class="num">${rpShort(totalTahun)}</td></tr></tfoot>`;

  $('#btnExportCsv').onclick = () => exportCsv(y, keys, perKaryawan, totalTahun);
  $('#btnCetakRekap').onclick = () => cetak(`<h2>Rekap Gaji ${esc(state.profil.nama)} — ${y}</h2>` + t.outerHTML);
}

function exportCsv(y, keys, perKaryawan, totalTahun) {
  const head = ['Karyawan', ...keys.map((k, i) => NAMA_BULAN[i]), 'Total'];
  const lines = [head.join(';')];
  perKaryawan.forEach((k) => lines.push([k.nama, ...k.perBulan, k.total].join(';')));
  lines.push(['TOTAL', ...keys.map((k) => totalBulan(k)), totalTahun].join(';'));
  unduh(`rekap-gaji-${y}.csv`, '﻿' + lines.join('\n'), 'text/csv');
  toast('CSV diunduh');
}
function unduh(nama, isi, tipe) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([isi], { type: tipe }));
  a.download = nama; a.click(); URL.revokeObjectURL(a.href);
}

/* ============================ KARYAWAN ============================ */
function renderKaryawan() {
  $('#karyawanList').innerHTML = state.karyawan.map((e, i) => `
    <article class="emp" data-k="${i}">
      <div class="emp-head">
        <div class="avatar">${inisial(e.nama)}</div>
        <div><div class="nm">${esc(e.nama)}</div><div class="rl">${esc(e.role)}</div></div>
        <div class="tot"><b>${rpShort((+e.pokok || 0) + (+e.operasional || 0))}</b><small>gaji tetap</small></div>
      </div>
      <div class="emp-body">
        <label class="field" style="margin-bottom:8px"><span class="f-label">Nama lengkap</span>
          <input type="text" data-k="${i}" data-f="nama" value="${esc(e.nama)}"></label>
        <div class="f-row">
          <label class="field"><span class="f-label">Posisi</span>
            <select data-k="${i}" data-f="role">${state.roles.map((r) => `<option${r === e.role ? ' selected' : ''}>${esc(r)}</option>`).join('')}</select></label>
          <label class="field"><span class="f-label">Status</span>
            <select data-k="${i}" data-f="aktif">
              <option value="1"${e.aktif !== false ? ' selected' : ''}>Aktif</option>
              <option value="0"${e.aktif === false ? ' selected' : ''}>Non-aktif</option>
            </select></label>
        </div>
        <div class="f-row">
          <label class="field"><span class="f-label">Gaji pokok</span>
            <input type="number" step="50000" data-k="${i}" data-f="pokok" value="${+e.pokok || 0}"></label>
          <label class="field"><span class="f-label">Tunj. operasional</span>
            <input type="number" step="50000" data-k="${i}" data-f="operasional" value="${+e.operasional || 0}"></label>
        </div>
        <div class="f-row">
          <label class="field"><span class="f-label">Tunjangan makan</span>
            <input type="number" step="50000" data-k="${i}" data-f="makan" value="${+e.makan || 0}"></label>
          <label class="field"><span class="f-label">Mulai bekerja</span>
            <input type="date" data-k="${i}" data-f="mulai" value="${esc(e.mulai || '')}"></label>
        </div>
        <div class="f-row">
          <label class="field"><span class="f-label">Bank</span>
            <input type="text" data-k="${i}" data-f="bank" value="${esc(e.bank || '')}" placeholder="mis. BCA"></label>
          <label class="field"><span class="f-label">No. rekening</span>
            <input type="text" data-k="${i}" data-f="norek" value="${esc(e.norek || '')}"></label>
        </div>
        <label class="field"><span class="f-label">Cabang</span>
          <select data-k="${i}" data-f="cabang">${CABANG.map((c) =>
            `<option value="${c}"${(e.cabang || CABANG[0]) === c ? ' selected' : ''}>${esc(state.cabang[c] || c)}</option>`).join('')}</select>
        </label>

        <div class="divider"></div>
        ${blokAkunLogin(e, i)}
      </div>
      <div class="emp-foot">
        <span class="muted">Total diterima ${tahunAktif()}: ${rpShort(totalKaryawanTahun(e.id))}</span>
        <span class="grow"></span>
        <button class="btn btn-sm btn-danger" data-hapus="${i}">Hapus</button>
      </div>
    </article>`).join('');
}

/* ---------------- Akun login karyawan (untuk lapor.html) ---------------- */
function blokAkunLogin(e, i) {
  const cloudAktif = window.CLOUD && window.CLOUD.aktif;
  if (!cloudAktif) {
    return `<span class="fs-title">Akun login (lapor.html)</span>
      <p class="muted" style="margin:-2px 0 0">Aktifkan sinkronisasi cloud dulu (lihat PANDUAN-DEPLOY.md) sebelum membuat akun karyawan.</p>`;
  }
  const punyaAkun = Boolean(e.authUid);
  return `<span class="fs-title">Akun login (lapor.html)</span>
    ${punyaAkun ? `<p class="muted" style="margin:-2px 0 8px">Nama pengguna saat ini: <b>${esc(e.username)}</b></p>` : ''}
    <div class="f-row akun-form" data-akun="${i}" ${punyaAkun ? 'hidden' : ''}>
      <label class="field"><span class="f-label">Nama pengguna</span>
        <input type="text" data-akun-user="${i}" placeholder="mis. risa" value="${esc(e.username || slugNama(e.nama))}"></label>
      <label class="field"><span class="f-label">Kata sandi awal</span>
        <input type="text" data-akun-pass="${i}" placeholder="min. 6 karakter"></label>
    </div>
    <button type="button" class="btn btn-sm" data-buat-akun="${i}">${punyaAkun ? 'Ganti sandi (buat ulang)' : 'Buat akun login'}</button>`;
}
function slugNama(nama) {
  return String(nama).replace(/^Drh\.?\s*/i, '').trim().split(/\s+/)[0].toLowerCase();
}
function totalKaryawanTahun(id) {
  return kunciTahun(tahunAktif()).reduce((s, k) => {
    const r = rows(k).find((x) => x.empId === id);
    return s + (r ? hitung(r).total : 0);
  }, 0);
}

$('#karyawanList').addEventListener('input', (e) => {
  const el = e.target;
  if (el.dataset.k === undefined || !el.dataset.f) return;
  const k = state.karyawan[Number(el.dataset.k)];
  const f = el.dataset.f;
  if (f === 'aktif') k.aktif = el.value === '1';
  else if (['pokok', 'operasional', 'makan'].includes(f)) k[f] = Number(el.value) || 0;
  else k[f] = el.value;
  if (f === 'nama' || f === 'role') {
    // sinkronkan ke baris gaji yang belum dicetak (semua periode)
    Object.values(state.payroll).forEach((list) => list.forEach((r) => {
      if (r.empId === k.id) { r.nama = k.nama; r.role = k.role; }
    }));
  }
  simpan(true);
  if (f === 'cabang' || f === 'nama' || f === 'role' || f === 'aktif') sinkronRosterKaryawan();
});
$('#karyawanList').addEventListener('change', (e) => {
  if (e.target.dataset.f === 'role') renderKaryawan();
});
$('#karyawanList').addEventListener('click', async (e) => {
  const bHapus = e.target.closest('[data-hapus]');
  if (bHapus) {
    const i = Number(bHapus.dataset.hapus);
    const k = state.karyawan[i];
    if (!confirm(`Hapus ${k.nama} dari daftar karyawan? Data gaji bulan-bulan lalu tetap tersimpan.`)) return;
    state.karyawan.splice(i, 1);
    simpan(true); renderKaryawan(); toast('Karyawan dihapus');
    return;
  }

  const bAkun = e.target.closest('[data-buat-akun]');
  if (bAkun) {
    const i = Number(bAkun.dataset.buatAkun);
    const k = state.karyawan[i];
    const form = $(`.akun-form[data-akun="${i}"]`);
    if (form && form.hidden) { form.hidden = false; bAkun.textContent = 'Simpan akun'; return; }

    const username = $(`[data-akun-user="${i}"]`).value.trim();
    const sandi = $(`[data-akun-pass="${i}"]`).value;
    if (!username || sandi.length < 6) { toast('Isi nama pengguna & sandi minimal 6 karakter'); return; }
    if (!window.Provisioning) { toast('Modul akun belum siap, coba lagi sesaat'); return; }

    bAkun.disabled = true; bAkun.textContent = 'Memproses…';
    try {
      const hasil = await window.Provisioning.buatAkunKaryawan(username, sandi);
      k.username = hasil.username; k.authUid = hasil.authUid;
      simpan(true);
      await sinkronRosterKaryawan();
      renderKaryawan();
      toast(`Akun untuk ${k.nama} siap — bagikan nama pengguna & sandi ini ke mereka`);
    } catch (err) {
      toast('Gagal membuat akun: ' + (err.message || err));
      bAkun.disabled = false; bAkun.textContent = k.authUid ? 'Ganti sandi (buat ulang)' : 'Buat akun login';
    }
  }
});
$('#btnTambahKaryawan').addEventListener('click', () => {
  const nama = prompt('Nama lengkap karyawan baru:');
  if (!nama) return;
  const id = nama.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 18) + '-' + Math.random().toString(36).slice(2, 5);
  state.karyawan.push({ id, nama: nama.trim(), role: state.roles[0] || 'Karyawan', pokok: 0, operasional: 0, makan: 0, aktif: true, mulai: '', bank: '', norek: '', cabang: CABANG[0], username: '', authUid: '' });
  simpan(true); renderKaryawan(); toast('Karyawan ditambahkan — lengkapi datanya');
});

/* ==================== SINKRON ROSTER & TARIK LAPORAN KARYAWAN ====================
   Roster karyawan (nama/posisi/cabang/authUid) disalin ke
   klinik/{KLINIK_ID}/karyawan/{empId} supaya:
   • lapor.html tahu posisi & cabang karyawan yang login
   • aturan Firestore bisa memastikan seorang karyawan hanya menulis
     laporan atas namanya sendiri (lihat firestore.rules)              */
let sinkronRosterTimer = null;
function sinkronRosterKaryawan() {
  if (!(window.CLOUD && window.CLOUD.aktif)) return;
  clearTimeout(sinkronRosterTimer);
  sinkronRosterTimer = setTimeout(async () => {
    const { db, fsMod } = window.CLOUD;
    for (const k of state.karyawan) {
      try {
        await fsMod.setDoc(fsMod.doc(db, 'klinik', KLINIK_ID, 'karyawan', k.id), {
          nama: k.nama, role: k.role, cabang: k.cabang || CABANG[0],
          aktif: k.aktif !== false, username: k.username || '', authUid: k.authUid || '',
        });
      } catch (e) { console.warn('Sinkron roster gagal untuk', k.id, e); }
    }
  }, 800);
}
document.addEventListener('cloud-siap', () => { sinkronRosterKaryawan(); bersihkanFotoLamaSemua(); });

/* Foto bukti laporan karyawan otomatis dikosongkan setelah 90 hari.
   Karena tidak ada server terjadwal (aplikasi statis, tanpa Cloud
   Functions), ini dijalankan opportunis setiap kali pemilik ATAU
   karyawan membuka aplikasi (lihat juga bersihkanFotoLama di lapor.js) —
   ditahan maksimal sekali/hari lewat localStorage supaya ringan.        */
async function bersihkanFotoLamaSemua() {
  const kunci = 'lovepet-bersih-foto';
  if (Date.now() - Number(gudang.getItem(kunci) || 0) < 24 * 3600 * 1000) return;
  const { db, fsMod } = window.CLOUD;
  try {
    const cutoff = tanggalISO(new Date(Date.now() - 90 * 24 * 3600 * 1000));
    const q = fsMod.query(fsMod.collection(db, 'klinik', KLINIK_ID, 'laporan'), fsMod.where('tanggal', '<', cutoff));
    const snap = await fsMod.getDocs(q);
    await Promise.all(snap.docs.filter((d) => d.data().foto).map((d) =>
      fsMod.updateDoc(d.ref, { foto: null })));
    gudang.setItem(kunci, String(Date.now()));
  } catch (e) { console.warn('Bersih foto lama (pemilik) gagal, tidak fatal:', e); }
}

/* Menjumlahkan laporan aktif bulan berjalan per karyawan+kategori+cabang,
   lalu menuliskannya ke qty performa periode ini (tidak menimpa qty yang
   sudah diisi manual kalau laporannya nihil untuk sel tsb).             */
async function tarikLaporanKaryawan() {
  if (!(window.CLOUD && window.CLOUD.aktif)) { toast('Aktifkan sinkronisasi cloud dulu'); return; }
  const { db, fsMod } = window.CLOUD;
  const awal = periode + '-01', akhir = periode + '-31';
  let snap;
  try {
    const q = fsMod.query(
      fsMod.collection(db, 'klinik', KLINIK_ID, 'laporan'),
      fsMod.where('tanggal', '>=', awal), fsMod.where('tanggal', '<=', akhir),
      fsMod.where('status', '==', 'aktif'),
    );
    snap = await fsMod.getDocs(q);
  } catch (e) { toast('Gagal mengambil laporan: ' + e.message); return; }

  const jumlah = {}; // empId -> kategori -> cabang -> qty
  snap.forEach((doc) => {
    const d = doc.data();
    jumlah[d.empId] = jumlah[d.empId] || {};
    jumlah[d.empId][d.kategori] = jumlah[d.empId][d.kategori] || { mdo: 0, tmh: 0 };
    jumlah[d.empId][d.kategori][d.cabang] = (jumlah[d.empId][d.kategori][d.cabang] || 0) + 1;
  });

  if (!Object.keys(jumlah).length) { toast('Belum ada laporan karyawan untuk ' + labelPeriode(periode)); return; }

  let disentuh = 0;
  rows(periode).forEach((r) => {
    const jk = jumlah[r.empId];
    if (!jk) return;
    Object.entries(jk).forEach(([kat, cb]) => {
      if (!r.qty[kat]) return;
      r.qty[kat] = { mdo: cb.mdo || 0, tmh: cb.tmh || 0 };
      disentuh++;
    });
  });

  if (disentuh) { simpan(true); renderInput(); toast(`${snap.size} laporan ditarik dari ${Object.keys(jumlah).length} karyawan`); }
  else toast('Laporan ditemukan, tapi tidak ada karyawan yang cocok di bulan ini');
}

/* ============================ PENGATURAN ============================ */
function renderPengaturan() {
  const p = state.profil;
  const fld = (k, label, ph) => `<label class="field"><span class="f-label">${label}</span>
    <input type="text" data-p="${k}" value="${esc(p[k] || '')}" placeholder="${ph || ''}"></label>`;
  $('#formProfil').innerHTML = `
    <div class="f-row">${fld('nama', 'Nama klinik')}${fld('subjudul', 'Subjudul', 'Klinik Hewan & Petshop')}</div>
    <div class="f-row">${fld('alamat', 'Alamat')}${fld('kota', 'Kota')}</div>
    <div class="f-row">${fld('telp', 'Telepon / WA')}${fld('penandatangan', 'Nama penandatangan')}</div>
    <div class="f-row">${fld('jabatanPenandatangan', 'Jabatan penandatangan')}<span></span></div>`;

  $('#formCabang').innerHTML = `<div class="f-row">${CABANG.map((c, i) =>
    `<label class="field"><span class="f-label">Cabang ${i + 1}</span>
      <input type="text" data-cab="${c}" value="${esc(state.cabang[c] || '')}"></label>`).join('')}</div>`;

  $('#posisiList').innerHTML = state.roles.map((r, i) => {
    const dipakai = state.karyawan.filter((e) => e.role === r).length;
    return `<div class="posisi-row" data-i="${i}">
      <input type="text" data-posisi="${i}" value="${esc(r)}">
      <span class="muted posisi-pakai">${dipakai ? `${dipakai} karyawan` : 'tidak dipakai'}</span>
      <button type="button" class="btn btn-sm btn-danger" data-hapus-posisi="${i}" ${dipakai ? 'disabled title="Pindahkan dulu karyawan yang masih berposisi ini"' : ''}>Hapus</button>
    </div>`;
  }).join('');

  const cloudAktif = window.CLOUD && window.CLOUD.aktif;
  $('#akunKet').textContent = cloudAktif
    ? 'Data tersinkron otomatis ke semua perangkat yang memakai akun yang sama. Tetap bisa dipakai saat offline — perubahan menyusul saat online lagi.'
    : 'Mode lokal: data hanya tersimpan di perangkat ini. Isi js/firebase-config.js untuk mengaktifkan sinkronisasi antar perangkat (lihat PANDUAN-DEPLOY.md).';
  $('#btnKeluar').style.display = cloudAktif ? '' : 'none';

  const kol = KOMPONEN.map((k) => [k.id, k.label]).concat([['makan', 'Tunj. makan']]);
  $('#tblTarif').innerHTML = `
    <thead><tr><th>Posisi</th>${kol.map((c) => `<th>${c[1]}</th>`).join('')}</tr></thead>
    <tbody>${state.roles.map((r) => `<tr><td>${esc(r)}</td>${kol.map((c) =>
      `<td><input type="number" step="500" style="width:96px" data-tarif="${r}" data-tk="${c[0]}" value="${(state.tarif[r] || {})[c[0]] || 0}"></td>`).join('')}</tr>`).join('')}</tbody>`;
}

$('#formProfil').addEventListener('input', (e) => {
  if (!e.target.dataset.p) return;
  state.profil[e.target.dataset.p] = e.target.value;
  $('#brandNama').textContent = state.profil.nama || 'LOVE Pet Clinic';
  simpan(true);
});
$('#formCabang').addEventListener('input', (e) => {
  if (!e.target.dataset.cab) return;
  state.cabang[e.target.dataset.cab] = e.target.value;
  simpan(true);
});

/* Posisi Karyawan ------------------------------------------------------
   Rename ditangani saat kolom kehilangan fokus (bukan tiap ketikan) —
   supaya baris tarif & pilihan posisi di form karyawan tidak dirender
   ulang di tengah mengetik. Perubahan lalu dirambatkan ke karyawan &
   baris gaji yang sudah ada, persis seperti mengubah posisi satu
   karyawan (lihat listener #karyawanList di atas). */
$('#posisiList').addEventListener('change', (e) => {
  const el = e.target;
  if (!el.dataset.posisi) return;
  const i = Number(el.dataset.posisi);
  const lama = state.roles[i];
  const baru = el.value.trim();
  if (!baru) { el.value = lama; return; }
  if (baru === lama) return;
  if (state.roles.some((r, j) => j !== i && r === baru)) {
    toast('Posisi ini sudah ada'); el.value = lama; return;
  }

  state.roles[i] = baru;
  if (state.tarif[lama] && !state.tarif[baru]) state.tarif[baru] = state.tarif[lama];
  delete state.tarif[lama];
  state.karyawan.forEach((k) => { if (k.role === lama) k.role = baru; });
  Object.values(state.payroll).forEach((list) => list.forEach((r) => { if (r.role === lama) r.role = baru; }));

  simpan(true); renderKaryawan(); renderPengaturan(); sinkronRosterKaryawan();
  toast(`Posisi "${lama}" diganti jadi "${baru}"`);
});
$('#posisiList').addEventListener('click', (e) => {
  const b = e.target.closest('[data-hapus-posisi]');
  if (!b || b.disabled) return;
  const i = Number(b.dataset.hapusPosisi);
  const nama = state.roles[i];
  if (!confirm(`Hapus posisi "${nama}"?`)) return;
  state.roles.splice(i, 1);
  delete state.tarif[nama];
  simpan(true); renderPengaturan(); toast('Posisi dihapus');
});
$('#btnTambahPosisi').addEventListener('click', () => {
  const nama = prompt('Nama posisi baru:');
  if (!nama || !nama.trim()) return;
  const bersih = nama.trim();
  if (state.roles.includes(bersih)) { toast('Posisi ini sudah ada'); return; }
  state.roles.push(bersih);
  simpan(true); renderPengaturan(); toast(`Posisi "${bersih}" ditambahkan`);
});
$('#tblTarif').addEventListener('input', (e) => {
  const el = e.target;
  if (!el.dataset.tarif) return;
  state.tarif[el.dataset.tarif] = state.tarif[el.dataset.tarif] || {};
  state.tarif[el.dataset.tarif][el.dataset.tk] = Number(el.value) || 0;
  simpan(true);
});

$('#btnBackup').addEventListener('click', () => {
  unduh(`cadangan-gaji-lovepet-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(state, null, 2), 'application/json');
  toast('Cadangan diunduh');
});
$('#fileRestore').addEventListener('change', (e) => {
  const f = e.target.files[0];
  if (!f) return;
  const fr = new FileReader();
  fr.onload = () => {
    try {
      const s = JSON.parse(fr.result);
      if (!s.payroll || !s.karyawan) throw new Error('format');
      if (!confirm('Ganti semua data saat ini dengan isi file cadangan?')) return;
      state = s; state.profil = Object.assign({}, DEFAULT_PROFIL, s.profil || {});
      state.roles = (s.roles && s.roles.length) ? s.roles : DEFAULT_ROLES.slice();
      periode = periodeTerakhir();
      simpan(true); render(); toast('Data dipulihkan');
    } catch { alert('File tidak dikenali sebagai cadangan aplikasi ini.'); }
  };
  fr.readAsText(f);
  e.target.value = '';
});
$('#btnFactory').addEventListener('click', () => {
  if (!confirm('Kembalikan ke data awal (Januari–Juni 2026)? Semua perubahan Anda akan hilang.')) return;
  state = stateBaru(); periode = periodeTerakhir();
  simpan(true); render(); toast('Data awal dikembalikan');
});

/* ============================ GRAFIK ============================
   Satu fungsi untuk bar vertikal & horizontal, bisa bertumpuk.
   Seri memakai slot warna kategori tervalidasi (biru → oranye).      */
function grafik(el, opt) {
  const { rows: data, series, horizontal } = opt;
  const maks = Math.max(1, ...data.map((r) => r.values.reduce((a, b) => a + b, 0)));
  const banyakSeri = series.length > 1;

  el.innerHTML = '';
  if (!data.length || maks <= 1) {
    el.innerHTML = '<div class="empty">Belum ada data untuk ditampilkan.</div>';
    return;
  }

  const tip = document.createElement('div');
  tip.className = 'tip';
  el.appendChild(tip);

  let svg;
  if (horizontal) {
    const padL = 96, padR = 62, tinggiBaris = 30, padT = 6;
    const W = 640, H = padT + data.length * tinggiBaris + 6;
    const lebar = W - padL - padR;
    let g = '';
    data.forEach((r, i) => {
      const y = padT + i * tinggiBaris;
      const tebal = 16;
      g += `<text class="axis-text" x="${padL - 8}" y="${y + tebal / 2 + 4}" text-anchor="end">${esc(r.label)}</text>`;
      let x = padL;
      r.values.forEach((v, s) => {
        if (v <= 0) return;
        const w = (v / maks) * lebar;
        // celah 2px antar segmen bertumpuk
        const wq = Math.max(0, w - (s > 0 ? 2 : 0));
        const xq = x + (s > 0 ? 2 : 0);
        g += `<rect class="bar" x="${xq}" y="${y}" width="${wq}" height="${tebal}" rx="4"
                fill="${series[s].color}" data-tip="${esc(r.label)} — ${esc(series[s].name)}: ${rp(v)}${r.extra ? ' • ' + esc(r.extra) : ''}"></rect>`;
        x += w;
      });
      const tot = r.values.reduce((a, b) => a + b, 0);
      g += `<text class="val-text" x="${padL + (tot / maks) * lebar + 7}" y="${y + tebal / 2 + 4}">${rpShort(tot)}</text>`;
    });
    svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Grafik batang">${g}</svg>`;
  } else {
    const padL = 8, padR = 8, padB = 22, padT = 20;
    const W = 640, H = 260;
    const lebar = W - padL - padR, tinggi = H - padT - padB;
    const stepX = lebar / data.length;
    const tebal = Math.min(30, stepX * 0.56);
    const totals = data.map((r) => r.values.reduce((a, b) => a + b, 0));
    const puncak = totals.indexOf(Math.max(...totals));
    let g = '';
    // garis bantu + skala
    for (let i = 0; i <= 3; i++) {
      const y = padT + (tinggi / 3) * i;
      g += `<line class="grid-line" x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}"></line>`;
    }
    g += `<text class="axis-text" x="${padL}" y="${padT - 6}">skala ${rpShort(maks)}</text>`;
    g += `<line class="axis-line" x1="${padL}" y1="${padT + tinggi}" x2="${W - padR}" y2="${padT + tinggi}"></line>`;
    data.forEach((r, i) => {
      const cx = padL + stepX * i + stepX / 2;
      const tot = r.values.reduce((a, b) => a + b, 0);
      let yBawah = padT + tinggi;
      r.values.forEach((v, s) => {
        if (v <= 0) return;
        const h = (v / maks) * tinggi;
        const hq = Math.max(0, h - (s > 0 ? 2 : 0));
        g += `<rect class="bar" x="${cx - tebal / 2}" y="${yBawah - hq}" width="${tebal}" height="${hq}" rx="4"
                fill="${series[s].color}"
                data-tip="${esc(r.label)} — ${esc(series[s].name)}: ${rp(v)}"></rect>`;
        yBawah -= h;
      });
      // label nilai hanya pada bulan tertinggi & bulan yang dipilih (sisanya lewat tooltip)
      if (tot > 0 && (i === puncak || r.sorot)) {
        g += `<text class="val-text" x="${cx}" y="${padT + tinggi - (tot / maks) * tinggi - 6}" text-anchor="middle">${rpShort(tot)}</text>`;
      }
      // penanda bulan yang sedang dipilih
      if (r.sorot) g += `<rect x="${cx - tebal / 2 - 3}" y="${padT + tinggi + 2}" width="${tebal + 6}" height="3" rx="1.5" fill="var(--brand)"></rect>`;
      g += `<text class="axis-text" x="${cx}" y="${H - 6}" text-anchor="middle"${r.sorot ? ' font-weight="700"' : ''}>${esc(r.label)}</text>`;
    });
    svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Grafik batang">${g}</svg>`;
  }

  el.insertAdjacentHTML('beforeend', svg);
  if (banyakSeri) {
    el.insertAdjacentHTML('beforeend',
      `<div class="legend">${series.map((s) => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join('')}</div>`);
  }

  el.querySelectorAll('rect[data-tip]').forEach((rect) => {
    rect.addEventListener('mouseenter', (ev) => {
      const b = el.getBoundingClientRect(), t = rect.getBoundingClientRect();
      tip.textContent = rect.dataset.tip;
      tip.style.left = (t.left - b.left + t.width / 2) + 'px';
      tip.style.top = (t.top - b.top) + 'px';
      tip.classList.add('show');
    });
    rect.addEventListener('mouseleave', () => tip.classList.remove('show'));
  });
}

/* ============================ MULAI ============================ */
pindahView(location.hash.slice(1) || 'dashboard');

$('#btnTarikIntajo')?.addEventListener('click', (ev) => tarikIntajoSekarang(ev.currentTarget));

document.addEventListener('cloud-siap', () => {
  const aktif = ($('.view.is-active') || {}).id?.replace('view-', '');
  if (aktif === 'kelola') { renderKaryawan(); renderPengaturan(); }
  if (aktif === 'dashboard') renderIntajo();
});
