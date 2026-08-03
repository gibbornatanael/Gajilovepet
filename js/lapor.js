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
if (!CFG.apiKey || !CFG.projectId) {
  tampilkanLogin(true, 'Aplikasi ini belum tersambung ke server. Hubungi pemilik klinik.');
  $('#loginSubmit').disabled = true;
} else {
  mulai();
}

async function mulai() {
  const V = 'https://www.gstatic.com/firebasejs/10.12.2';
  const [{ initializeApp }, aM, fM] = await Promise.all([
    import(`${V}/firebase-app.js`),
    import(`${V}/firebase-auth.js`),
    import(`${V}/firebase-firestore.js`),
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
    $('#pane-lapor').classList.toggle('is-active', modeLapor === 'lapor');
    $('#pane-capaian').classList.toggle('is-active', modeLapor === 'capaian');
    if (modeLapor === 'capaian') muatCapaian();
  });
  $('#periodeKaryawan').addEventListener('change', muatCapaian);
  $('#fileFoto').addEventListener('change', onFotoDipilih);
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
