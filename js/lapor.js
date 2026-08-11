/* =========================================================================
   lapor.js — logika halaman "Performance Bonus LovePet" (karyawan)
   -------------------------------------------------------------------------
   Butuh Firebase aktif (firebase-config.js terisi) — halaman ini TIDAK
   punya mode lokal, karena tujuannya memang mengirim laporan ke pemilik.
   ========================================================================= */

const $  = (s, r = document) => (r || document).querySelector(s);
const $$ = (s, r = document) => Array.from((r || document).querySelectorAll(s));

const CFG = window.FIREBASE_CONFIG || {};
let db, auth, fsMod, authMod;
let profil = null;          // { empId, nama, role, cabang, authUid }
let cabangAktif = CABANG[0];
let statusHariIni = {};     // kategori -> data laporan aktif hari ini (atau null)
let modeLapor = 'lapor';

function setStatus(teks, jenis) {
  const el = $('#cloudStatus');
  if (!el) return;
  el.textContent = teks; el.className = 'cloud-status ' + (jenis || ''); el.hidden = false;
}
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), 2400);
}
function tampilkanLogin(tampil, pesan) {
  $('#loginOverlay').hidden = !tampil;
  $('#appKaryawan').hidden = tampil;
  const err = $('#loginError');
  if (err) { err.textContent = pesan || ''; err.hidden = !pesan; }
}

/* ------------------------------- Mulai ------------------------------- */
// Pasang penjaga di form SEBELUM Firebase selesai dimuat. Tanpa ini, kalau
// pemuatan SDK Firebase dari gstatic.com gagal/lambat (mis. diblokir WiFi
// klinik), klik "Masuk" akan memicu submit form HTML biasa (form tidak
// punya atribut action) — browser reload halaman ke URL yang sama, yang
// dari sisi pengguna terlihat seperti "tidak terjadi apa-apa".
let siap = false;
$('#loginForm').addEventListener('submit', (e) => {
  if (!siap) {
    e.preventDefault();
    tampilkanLogin(true, 'Masih menyiapkan koneksi, coba lagi sesaat…');
  }
});

if (!CFG.apiKey || !CFG.projectId) {
  tampilkanLogin(true, 'Aplikasi ini belum tersambung ke server. Hubungi pemilik klinik.');
  $('#loginSubmit').disabled = true;
} else {
  mulai().catch((e) => {
    console.error('Gagal memuat Firebase:', e);
    tampilkanLogin(true, 'Gagal terhubung ke server. Coba ganti jaringan (mis. data seluler, bukan WiFi klinik) lalu muat ulang halaman.');
  });
}

function timeout(ms, pesan) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error(pesan)), ms));
}

async function mulai() {
  const V = 'https://www.gstatic.com/firebasejs/10.12.2';
  const [{ initializeApp }, aM, fM] = await Promise.race([
    Promise.all([
      import(`${V}/firebase-app.js`),
      import(`${V}/firebase-auth.js`),
      import(`${V}/firebase-firestore.js`),
    ]),
    timeout(15000, 'Waktu tunggu habis saat memuat Firebase — jaringan mungkin memblokir gstatic.com'),
  ]);
  authMod = aM; fsMod = fM;
  // Nama instance khusus ("karyawan") supaya sesi login karyawan di sini
  // TIDAK tercampur dengan sesi pemilik di index.html — lihat catatan
  // yang sama di cloud.js.
  const app = initializeApp(CFG, 'karyawan');
  auth = authMod.getAuth(app);

  // Gunakan SESSION persistence supaya session karyawan di lapor.html
  // tidak tercampur dengan local cache pemilik. Session akan hilang
  // saat browser/tab ditutup.
  try {
    await authMod.setPersistence(auth, authMod.browserSessionPersistence);
  } catch (e) {
    console.warn('Session persistence tidak didukung, gunakan default:', e.message);
  }

  try {
    db = fsMod.initializeFirestore(app, {
      localCache: fsMod.persistentLocalCache({ tabManager: fsMod.persistentMultipleTabManager() }),
    });
  } catch { db = fsMod.getFirestore(app); }

  siap = true;
  tampilkanLogin(true);   // bersihkan pesan "menyiapkan koneksi" kalau ada
  pasangForm();
  authMod.onAuthStateChanged(auth, onAuthBerubah);
}

async function onAuthBerubah(user) {
  if (!user) { profil = null; tampilkanLogin(true); return; }

  setStatus('Menyiapkan…', 'sibuk');
  try {
    const q = fsMod.query(
      fsMod.collection(db, 'klinik', KLINIK_ID, 'karyawan'),
      fsMod.where('authUid', '==', user.uid),
    );
    const snap = await fsMod.getDocs(q);
    if (snap.empty) {
      tampilkanLogin(true, 'Akun ini belum terhubung ke data karyawan. Hubungi pemilik klinik.');
      await authMod.signOut(auth);
      return;
    }
    const d = snap.docs[0];
    profil = { empId: d.id, authUid: user.uid, ...d.data() };
    cabangAktif = profil.cabang || CABANG[0];

    tampilkanLogin(false);
    $('#namaKaryawan').textContent = `${profil.nama} · ${profil.role}`;
    setStatus('Tersinkron', 'ok');
    renderAyatHarian();

    await muatStatusHariIni();
    renderCabangToggle();
    renderLaporGrid();
    isiPeriodeKaryawan();
    await muatCapaian();
    dengarkanSlip();               // slip yang sudah disetujui pemilik
    dengarkanChat();               // percakapan dengan manager
    bersihkanFotoLama(user.uid);   // tidak ditunggu — jalan di latar belakang
  } catch (e) {
    console.error(e);
    setStatus('Gagal memuat data', 'galat');
    toast('Gagal memuat data: ' + e.message);
  }
}

/* ------------------------------- Login ------------------------------- */
function pasangForm() {
  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const user = $('#loginUser').value.trim();
    const sandi = $('#loginSandi').value;
    const tombol = $('#loginSubmit');
    tombol.disabled = true; tombol.textContent = 'Memproses…';
    try {
      await authMod.signInWithEmailAndPassword(auth, emailDariUsername(user), sandi);
    } catch (err) {
      tampilkanLogin(true, pesanGalat(err));
    } finally {
      tombol.disabled = false; tombol.textContent = 'Masuk';
    }
  });
  $('#btnKeluarKaryawan').addEventListener('click', () => {
    if (confirm('Keluar dari aplikasi?')) {
      authMod.signOut(auth).catch(console.error);
      // Clear cache supaya session berikutnya fresh
      if (db && typeof db.clearPersistence === 'function') {
        db.clearPersistence().catch(console.error);
      }
    }
  });
  $('#segLapor').addEventListener('click', (e) => {
    const b = e.target.closest('.seg');
    if (!b) return;
    modeLapor = b.dataset.seg;
    $$('#segLapor .seg').forEach((s) => s.classList.toggle('is-active', s === b));
    ['lapor', 'capaian', 'slip', 'chat'].forEach((n) =>
      $('#pane-' + n).classList.toggle('is-active', modeLapor === n));
    if (modeLapor === 'capaian') muatCapaian();
    if (modeLapor === 'chat') { gulirChatKeBawah(); tandaiChatTerbaca(); }
  });
  $('#periodeKaryawan').addEventListener('change', muatCapaian);
  $('#fileFoto').addEventListener('change', onFotoDipilih);
  pasangSlip();
  pasangChat();
}
function pesanGalat(err) {
  const kode = (err && err.code) || '';
  if (kode.includes('invalid-credential') || kode.includes('wrong-password') || kode.includes('user-not-found')) return 'Nama pengguna atau kata sandi salah.';
  if (kode.includes('too-many-requests')) return 'Terlalu banyak percobaan. Coba lagi beberapa menit.';
  if (kode.includes('network')) return 'Tidak ada koneksi internet.';
  return 'Gagal masuk: ' + (err && err.message ? err.message : kode || 'tidak diketahui');
}

/* ----------------------------- Ayat harian ----------------------------- */
function renderAyatHarian() {
  const el = $('#ayatHarian');
  if (!el || !window.ayatHariIni) return;
  const a = window.ayatHariIni();
  el.innerHTML = `<div class="ayat-ikon">📖</div><div class="ayat-teks">“${esc(a.teks)}”<span class="ayat-ref">${esc(a.ref)}</span></div>`;
}

/* --------------------------- Cabang toggle --------------------------- */
function renderCabangToggle() {
  $('#cabangToggle').innerHTML = CABANG.map((c) =>
    `<button type="button" data-c="${c}" class="${c === cabangAktif ? 'is-active' : ''}">${esc(DEFAULT_CABANG[c] || c)}</button>`
  ).join('');
  $$('#cabangToggle button').forEach((b) => b.addEventListener('click', () => {
    cabangAktif = b.dataset.c;
    $$('#cabangToggle button').forEach((x) => x.classList.toggle('is-active', x === b));
  }));
}
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

/* ------------------------- Status hari ini ------------------------- */
function idLaporan(empId, tanggal, kategori) { return `${empId}_${tanggal}_${kategori}`; }

async function muatStatusHariIni() {
  const hari = tanggalISO();
  const komp = komponenLaporSendiri(profil.role);
  const hasil = await Promise.all(komp.map(async (k) => {
    try {
      const ref = fsMod.doc(db, 'klinik', KLINIK_ID, 'laporan', idLaporan(profil.empId, hari, k.id));
      const snap = await fsMod.getDoc(ref);
      return [k.id, snap.exists() && snap.data().status === 'aktif' ? snap.data() : null];
    } catch { return [k.id, null]; }
  }));
  statusHariIni = Object.fromEntries(hasil);
}

/* ------------------------------ Lapor grid ------------------------------ */
function renderLaporGrid() {
  const komp = komponenLaporSendiri(profil.role);
  $('#laporGrid').innerHTML = komp.map((k) => {
    const s = statusHariIni[k.id];
    if (s) {
      return `<div class="lapor-tile sudah" data-k="${k.id}">
        <div class="ikon">${k.ikon || '✅'}</div>
        <div class="label">${esc(k.label)}</div>
        <div class="status-ok">✓ Sudah lapor</div>
        <small class="muted">${esc(DEFAULT_CABANG[s.cabang] || s.cabang)}</small>
        <button type="button" class="batalkan" data-batal="${k.id}">Batalkan</button>
      </div>`;
    }
    return `<div class="lapor-tile" data-k="${k.id}">
      <div class="ikon">${k.ikon || '📸'}</div>
      <div class="label">${esc(k.label)}</div>
      <button type="button" class="aksi" data-lapor="${k.id}">Lapor</button>
    </div>`;
  }).join('');

  $$('#laporGrid [data-lapor]').forEach((b) => b.addEventListener('click', () => mulaiLapor(b.dataset.lapor)));
  $$('#laporGrid [data-batal]').forEach((b) => b.addEventListener('click', () => batalkanLaporan(b.dataset.batal)));
}

let kategoriTerpilih = null;
function mulaiLapor(kategori) {
  kategoriTerpilih = kategori;
  $('#fileFoto').value = '';
  $('#fileFoto').click();
}

async function onFotoDipilih(e) {
  const file = e.target.files && e.target.files[0];
  if (!file || !kategoriTerpilih) return;
  const kategori = kategoriTerpilih;
  const tile = $(`.lapor-tile[data-k="${kategori}"]`);
  if (tile) tile.innerHTML = `<div class="sibuk">Menyimpan…</div>`;

  try {
    const foto = await kompresGambar(file);
    const hari = tanggalISO();
    const data = {
      empId: profil.empId, authUid: profil.authUid,
      kategori, cabang: cabangAktif, tanggal: hari,
      status: 'aktif', foto,
      waktu: fsMod.serverTimestamp(), dibuatMs: Date.now(),
    };
    await fsMod.setDoc(fsMod.doc(db, 'klinik', KLINIK_ID, 'laporan', idLaporan(profil.empId, hari, kategori)), data);
    statusHariIni[kategori] = data;
    renderLaporGrid();
    toast('Tersimpan! Lihat capaianmu →');
    setTimeout(() => $('#segLapor .seg[data-seg="capaian"]').click(), 500);
  } catch (err) {
    console.error(err);
    toast('Gagal menyimpan: ' + err.message);
    renderLaporGrid();
  }
}

async function batalkanLaporan(kategori) {
  const k = komponenLaporSendiri(profil.role).find((x) => x.id === kategori);
  if (!confirm(`Batalkan laporan ${k ? k.label : kategori} hari ini?`)) return;
  const hari = tanggalISO();
  try {
    await fsMod.updateDoc(fsMod.doc(db, 'klinik', KLINIK_ID, 'laporan', idLaporan(profil.empId, hari, kategori)), {
      status: 'batal', authUid: profil.authUid, empId: profil.empId,
    });
    statusHariIni[kategori] = null;
    renderLaporGrid();
    toast('Laporan dibatalkan');
    if (modeLapor === 'capaian') muatCapaian();
  } catch (err) {
    toast('Gagal membatalkan: ' + err.message);
  }
}

/* -------------------------------- Capaian -------------------------------- */
function isiPeriodeKaryawan() {
  const sekarang = new Date();
  const opsi = [];
  for (let i = 0; i < 6; i++) {
    const d = new Date(sekarang.getFullYear(), sekarang.getMonth() - i, 1);
    opsi.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  $('#periodeKaryawan').innerHTML = opsi.map((k) =>
    `<option value="${k}">${labelPeriode(k)}</option>`).join('');
}

async function muatCapaian() {
  if (!profil) return;
  const periode = $('#periodeKaryawan').value || tanggalISO().slice(0, 7);
  const awal = periode + '-01', akhir = periode + '-31';
  let snap;
  try {
    const q = fsMod.query(
      fsMod.collection(db, 'klinik', KLINIK_ID, 'laporan'),
      fsMod.where('authUid', '==', profil.authUid),
      fsMod.where('tanggal', '>=', awal), fsMod.where('tanggal', '<=', akhir),
      fsMod.orderBy('tanggal', 'desc'),
    );
    snap = await fsMod.getDocs(q);
  } catch (e) {
    console.error(e);
    $('#riwayatList').innerHTML = `<div class="empty">Gagal memuat riwayat. ${e.code === 'failed-precondition' ? 'Server sedang menyiapkan index — coba lagi sesaat.' : esc(e.message)}</div>`;
    return;
  }

  const komp = komponenLaporSendiri(profil.role);
  const hitungKat = Object.fromEntries(komp.map((k) => [k.id, 0]));
  const baris = [];
  snap.forEach((doc) => {
    const d = doc.data();
    if (d.status === 'aktif') hitungKat[d.kategori] = (hitungKat[d.kategori] || 0) + 1;
    baris.push(d);
  });

  $('#statKaryawan').innerHTML = komp.map((k) => `
    <div class="stat">
      <div class="k">${k.ikon || ''} ${esc(k.label)}</div>
      <div class="v">${hitungKat[k.id] || 0}</div>
    </div>`).join('');

  const hari = tanggalISO();
  $('#riwayatList').innerHTML = baris.length ? baris.map((d) => {
    const k = komp.find((x) => x.id === d.kategori);
    const batal = d.status === 'batal';
    const bisaBatal = !batal && d.tanggal === hari;
    return `<div class="riwayat-row">
      ${d.foto ? `<img src="${d.foto}" alt="">` : `<div class="thumb" style="width:44px;height:44px;border-radius:9px;background:var(--surface-2);display:grid;place-items:center">${k ? k.ikon : '📷'}</div>`}
      <div class="info">
        <b>${esc(k ? k.label : d.kategori)}</b>
        <small>${formatTanggal(d.tanggal)} · ${esc(DEFAULT_CABANG[d.cabang] || d.cabang)}${batal ? ' · <span class="batal-badge">Dibatalkan</span>' : ''}</small>
      </div>
      ${bisaBatal ? `<button type="button" class="batalkan" data-batal2="${d.kategori}">Batalkan</button>` : ''}
    </div>`;
  }).join('') : '<div class="empty">Belum ada laporan bulan ini.</div>';

  $$('#riwayatList [data-batal2]').forEach((b) => b.addEventListener('click', () => batalkanLaporan(b.dataset.batal2)));
}
function formatTanggal(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${NAMA_BULAN[m - 1].slice(0, 3)}`;
}

/* =========================================================================
   SLIP GAJI
   -------------------------------------------------------------------------
   Karyawan tidak pernah membaca data gaji mentah — pemilik "menerbitkan"
   snapshot slip miliknya ke klinik/lovepet/slip/{empId}_{periode} saat ia
   menyetujuinya (lihat js/slip-terbit.js). Yang tampil di sini hanyalah slip
   berstatus 'disetujui'. Kalau pemilik menarik otorisasinya (mis. karena ada
   salah hitung), slipnya langsung hilang dari daftar sampai disetujui lagi.

   Hanya 3 bulan terakhir yang ditampilkan — cukup untuk keperluan
   administrasi tanpa menumpuk di layar.
   ========================================================================= */
const SIMPAN_BULAN = 3;

let slipSemua = [];        // slip disetujui, terbaru di atas
let slipTerbuka = null;
let lepasSlip = null;

/* Periode terlama yang masih ditampilkan, mis. "2026-06" kalau sekarang Agustus. */
function batasPeriodeSlip() {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - (SIMPAN_BULAN - 1));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/* Kueri hanya disaring pada authUid (satu syarat) supaya tidak memerlukan
   index gabungan di Firestore; sisanya disaring & diurutkan di sini —
   jumlah slip milik satu orang hanya belasan, jadi ini murah. */
function dengarkanSlip() {
  if (lepasSlip) lepasSlip();
  const kueri = fsMod.query(
    fsMod.collection(db, 'klinik', KLINIK_ID, 'slip'),
    fsMod.where('authUid', '==', profil.authUid),
  );
  lepasSlip = fsMod.onSnapshot(kueri, (snap) => {
    const batas = batasPeriodeSlip();
    slipSemua = snap.docs
      .map((d) => Object.assign({ id: d.id }, d.data()))
      .filter((s) => s.status === 'disetujui' && String(s.periode) >= batas)
      .sort((a, b) => String(b.periode).localeCompare(String(a.periode)));

    // Slip yang sedang dibuka bisa saja baru ditarik otorisasinya —
    // kalau begitu, tutup dan kembalikan ke daftar.
    if (slipTerbuka) {
      const masih = slipSemua.find((s) => s.id === slipTerbuka.id);
      if (!masih) { slipTerbuka = null; tampilkanDaftarSlip(); toast('Slip ini sedang diperbaiki manager'); }
      else { slipTerbuka = masih; renderSlipTerbuka(); }
    }
    renderDaftarSlip();
  }, (e) => {
    console.warn('Slip:', e);
    $('#slipDaftar').innerHTML = '<div class="empty">Gagal memuat slip gaji. Periksa koneksi.</div>';
  });
}

function renderDaftarSlip() {
  const kotak = $('#slipDaftar');
  if (!slipSemua.length) {
    kotak.innerHTML = '<div class="empty">Belum ada slip gaji yang bisa dibuka.<br>' +
      'Slip muncul di sini setelah manager menyetujuinya.</div>';
    return;
  }
  kotak.innerHTML = slipSemua.map((s) => {
    const d = s.data || {};
    return `<button type="button" class="slip-baris" data-slip="${esc(s.id)}">
      <span class="slip-baris-ikon">📄</span>
      <span class="slip-baris-isi">
        <b>${esc(d.periodeLabel || s.periode)}</b>
        <small>Disetujui ${esc(s.disetujuiLabel || '—')}${s.versi > 1 ? ` · revisi ke-${s.versi}` : ''}${
          s.revisiDiminta ? ' · <span class="slip-tinjau">sedang ditinjau</span>' : ''}</small>
      </span>
      <span class="slip-baris-nilai">${rp(d.total || 0)}</span>
    </button>`;
  }).join('');

  $$('#slipDaftar [data-slip]').forEach((b) => b.addEventListener('click', () => {
    slipTerbuka = slipSemua.find((s) => s.id === b.dataset.slip) || null;
    if (slipTerbuka) { renderSlipTerbuka(); tampilkanSlipTerbuka(); }
  }));
}

function tampilkanSlipTerbuka() {
  $('#slipDaftar').hidden = true;
  $('#slipBuka').hidden = false;
  $('#revisiForm').hidden = true;
  window.scrollTo({ top: 0 });
}
function tampilkanDaftarSlip() {
  $('#slipBuka').hidden = true;
  $('#slipDaftar').hidden = false;
}

function renderSlipTerbuka() {
  const s = slipTerbuka;
  if (!s) return;
  $('#slipIsi').innerHTML = window.SlipRender.gambar(s.data,
    { cap: s.versi > 1 ? `Revisi ke-${s.versi}` : '' });
  $('#btnMintaRevisi').textContent = s.revisiDiminta ? 'Kirim keterangan lagi' : 'Minta revisi';
}

function pasangSlip() {
  $('#slipKembali').addEventListener('click', () => { slipTerbuka = null; tampilkanDaftarSlip(); });

  /* Unduh sebagai PNG. html2canvas dimuat saat dipakai saja (lazy import),
     sama seperti di aplikasi pemilik, supaya halaman ini tetap ringan. */
  $('#btnUnduhSlipPng').addEventListener('click', async () => {
    if (!slipTerbuka) return;
    const tombol = $('#btnUnduhSlipPng');
    tombol.disabled = true; tombol.textContent = 'Menyiapkan…';
    try {
      const { default: html2canvas } = await import('https://esm.sh/html2canvas@1.4.1');
      const node = $('#slipIsi .slip');
      const canvas = await html2canvas(node, { scale: 2, backgroundColor: '#ffffff' });
      const a = document.createElement('a');
      a.href = canvas.toDataURL('image/png');
      a.download = `slip-${String(profil.nama).replace(/\s+/g, '-')}-${slipTerbuka.periode}.png`;
      a.click();
      toast('Slip tersimpan sebagai gambar');
    } catch (e) {
      console.error(e);
      toast('Gagal membuat gambar: ' + (e.message || e));
    } finally {
      tombol.disabled = false; tombol.textContent = 'Unduh PNG';
    }
  });

  $('#btnMintaRevisi').addEventListener('click', () => {
    $('#revisiForm').hidden = false;
    $('#revisiAlasan').focus();
  });
  $('#btnBatalRevisi').addEventListener('click', () => { $('#revisiForm').hidden = true; });

  $('#revisiForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const alasan = $('#revisiAlasan').value.trim();
    if (!alasan || !slipTerbuka) return;
    const tombol = $('#btnKirimRevisi');
    tombol.disabled = true; tombol.textContent = 'Mengirim…';
    try {
      await kirimPermintaanRevisi(slipTerbuka, alasan);
      $('#revisiAlasan').value = '';
      $('#revisiForm').hidden = true;
      toast('Terkirim ke manager — lihat balasannya di tab Chat');
    } catch (err) {
      console.error(err);
      toast('Gagal mengirim: ' + (err.message || err));
    } finally {
      tombol.disabled = false; tombol.textContent = 'Kirim';
    }
  });
}

/* Permintaan revisi sengaja dikirim sebagai PESAN CHAT biasa (bertanda
   slipnya), bukan sistem tersendiri: dengan begitu tanya-jawabnya berlanjut
   di satu tempat. Penanda di dokumen slip hanya dipakai supaya pemilik
   melihat lencana "sedang ditinjau" di tombol otorisasinya. */
async function kirimPermintaanRevisi(slip, alasan) {
  await fsMod.updateDoc(fsMod.doc(db, 'klinik', KLINIK_ID, 'slip', slip.id), {
    revisiDiminta: true, revisiAlasan: alasan.slice(0, 500), revisiMs: Date.now(),
  });
  await kirimPesanChat(alasan, {
    tipe: 'revisi',
    periode: slip.periode,
    periodeLabel: (slip.data && slip.data.periodeLabel) || slip.periode,
  });
}

/* =========================================================================
   CHAT MANAGER
   -------------------------------------------------------------------------
   Satu ruang per karyawan di klinik/lovepet/chat/{empId}; isinya di
   subkoleksi `pesan`. Karyawan hanya boleh menambah pesan — tidak mengubah
   atau menghapus (dijaga di firestore.rules), supaya percakapan soal gaji
   tidak bisa disunting setelah terkirim.
   ========================================================================= */
const BATAS_PESAN = 300;

let pesanChat = [];
let lepasChat = null, lepasRuangChat = null;
let belumDibaca = 0;

const ruangChatRef = () => fsMod.doc(db, 'klinik', KLINIK_ID, 'chat', profil.empId);

function dengarkanChat() {
  if (lepasChat) lepasChat();
  const kueri = fsMod.query(
    fsMod.collection(ruangChatRef(), 'pesan'),
    fsMod.orderBy('ms', 'desc'), fsMod.limit(BATAS_PESAN),
  );
  lepasChat = fsMod.onSnapshot(kueri, (snap) => {
    pesanChat = snap.docs.map((d) => Object.assign({ id: d.id }, d.data())).reverse();
    renderChat();
    if (modeLapor === 'chat') { gulirChatKeBawah(); tandaiChatTerbaca(); }
  }, (e) => {
    console.warn('Chat:', e);
    $('#chatPesan').innerHTML = '<div class="chat-sibuk">Gagal memuat percakapan.</div>';
  });

  if (lepasRuangChat) lepasRuangChat();
  lepasRuangChat = fsMod.onSnapshot(ruangChatRef(), (snap) => {
    belumDibaca = snap.exists() ? (Number(snap.data().belumKaryawan) || 0) : 0;
    const b = $('#segBadgeChat');
    b.textContent = belumDibaca > 99 ? '99+' : String(belumDibaca);
    b.hidden = belumDibaca === 0;
    if (modeLapor === 'chat') tandaiChatTerbaca();
  }, () => {});
}

function renderChat() {
  const kotak = $('#chatPesan');
  if (!pesanChat.length) {
    kotak.innerHTML = '<div class="chat-sibuk">Belum ada pesan.<br>' +
      'Ada yang mau ditanyakan ke manager? Tulis di bawah.</div>';
    return;
  }
  let hariTerakhir = '';
  kotak.innerHTML = pesanChat.map((p) => {
    const hari = tanggalHariChat(p.ms);
    const pemisah = hari !== hariTerakhir ? `<div class="chat-hari"><span>${esc(hari)}</span></div>` : '';
    hariTerakhir = hari;
    // Kabar otomatis saat slip disetujui / ditarik — ditaruh di tengah tanpa
    // gelembung, seperti pesan sistem di WhatsApp.
    if (p.tipe === 'sistem') {
      return `${pemisah}<div class="chat-sistem">${esc(p.teks)} <small>${jamChat(p.ms)}</small></div>`;
    }
    const milikku = p.dari === 'karyawan';
    const kepala = p.tipe === 'revisi'
      ? `<span class="bubble-tag">📄 Minta revisi — ${esc(p.periodeLabel || p.periode || '')}</span>` : '';
    return `${pemisah}<div class="bubble-row ${milikku ? 'kanan' : 'kiri'}">
      <div class="bubble${p.tipe === 'revisi' ? ' is-revisi' : ''}">
        ${kepala}
        <span class="bubble-teks">${esc(p.teks)}</span>
        <span class="bubble-jam">${jamChat(p.ms)}</span>
      </div>
    </div>`;
  }).join('');
}

function gulirChatKeBawah() {
  const k = $('#chatPesan');
  if (k) k.scrollTop = k.scrollHeight;
}

async function tandaiChatTerbaca() {
  if (!belumDibaca) return;
  try { await fsMod.setDoc(ruangChatRef(), { belumKaryawan: 0 }, { merge: true }); }
  catch (e) { console.warn('Tandai terbaca:', e); }
}

function pasangChat() {
  $('#chatForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('#chatInput');
    const teks = input.value.trim();
    if (!teks) return;
    input.value = ''; aturTinggiChat();
    try { await kirimPesanChat(teks); }
    catch (err) {
      console.error(err);
      toast('Gagal mengirim: ' + (err.message || err));
      input.value = teks;
    }
  });
  $('#chatInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#chatForm').requestSubmit(); }
  });
  $('#chatInput').addEventListener('input', aturTinggiChat);
}

function aturTinggiChat() {
  const t = $('#chatInput');
  t.style.height = 'auto';
  t.style.height = Math.min(120, t.scrollHeight) + 'px';
}

async function kirimPesanChat(teks, tambahan) {
  const now = Date.now();
  const ref = ruangChatRef();

  await fsMod.addDoc(fsMod.collection(ref, 'pesan'), Object.assign({
    dari: 'karyawan', teks, ms: now,
    empId: profil.empId, authUid: profil.authUid, tipe: 'teks',
  }, tambahan || {}));

  await fsMod.setDoc(ref, {
    empId: profil.empId, authUid: profil.authUid, nama: profil.nama,
    terakhirTeks: teks.slice(0, 120), terakhirMs: now, terakhirDari: 'karyawan',
    belumKaryawan: 0,
    belumPemilik: fsMod.increment(1),
  }, { merge: true });

  beriTahuPemilik(teks, tambahan);   // tidak ditunggu
}

/* Lencana di aplikasi selalu jalan, tapi HP pemilik hanya berbunyi kalau
   pesannya diteruskan ke bot Telegram yang sudah dipakai untuk nota.
   Kalau endpoint-nya belum dipasang, kegagalannya diabaikan diam-diam —
   pesannya sendiri sudah aman tersimpan di Firestore. */
async function beriTahuPemilik(teks, tambahan) {
  try {
    const idToken = await auth.currentUser.getIdToken();
    await fetch('/api/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        idToken,
        nama: profil.nama,
        teks,
        tipe: (tambahan && tambahan.tipe) || 'teks',
        periodeLabel: (tambahan && tambahan.periodeLabel) || '',
      }),
    });
  } catch (e) { console.warn('Notifikasi Telegram dilewati:', e); }
}

function jamChat(ms) {
  const d = new Date(Number(ms) || 0);
  return `${String(d.getHours()).padStart(2, '0')}.${String(d.getMinutes()).padStart(2, '0')}`;
}
function tanggalHariChat(ms) {
  const d = new Date(Number(ms) || 0);
  const sama = (a, b) => a.toDateString() === b.toDateString();
  if (sama(d, new Date())) return 'Hari ini';
  if (sama(d, new Date(Date.now() - 86400000))) return 'Kemarin';
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
}

/* ----------------------- Bersihkan foto lama (>90 hari) ----------------------- */
async function bersihkanFotoLama(uid) {
  const kunci = 'lapor-bersih-' + uid;
  const terakhir = Number(localStorage.getItem(kunci) || 0);
  if (Date.now() - terakhir < 24 * 3600 * 1000) return;
  try {
    const cutoff = tanggalISO(new Date(Date.now() - 90 * 24 * 3600 * 1000));
    const q = fsMod.query(
      fsMod.collection(db, 'klinik', KLINIK_ID, 'laporan'),
      fsMod.where('authUid', '==', uid), fsMod.where('tanggal', '<', cutoff),
    );
    const snap = await fsMod.getDocs(q);
    await Promise.all(snap.docs.filter((d) => d.data().foto).map((d) =>
      fsMod.updateDoc(d.ref, { foto: null, authUid: d.data().authUid, empId: d.data().empId, status: d.data().status })));
    localStorage.setItem(kunci, String(Date.now()));
  } catch (e) { console.warn('Bersih foto lama (karyawan) gagal, tidak fatal:', e); }
}
