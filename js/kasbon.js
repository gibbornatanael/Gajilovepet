/* =========================================================================
   kasbon.js — Kasbon Karyawan (sisi pemilik)
   -------------------------------------------------------------------------
   Karyawan mengajukan lewat lapor.html (tab Kasbon) → tersimpan sebagai
   permintaan berstatus 'menunggu' di klinik/lovepet/kasbonPermintaan.
   Pemilik menyetujui/menolak di sini. Setiap persetujuan menambah saldo
   akun kasbon berjalan di klinik/lovepet/kasbon/{empId} — satu akun per
   karyawan (kalau ia mengajukan lagi sebelum lunas, jumlahnya digabung
   ke saldo yang sama, sesuai kesepakatan; cicilan per bulan mengikuti
   angka yang disetujui pada pengajuan terbaru).

   Potongan bulanan diterapkan ke slip lewat dua jalur:
     • cicilanSaran(empId)      — dipakai app.js saat membuat baris gaji
                                   baru, supaya kolom Hutang/Kasbon terisi
                                   otomatis (masih bisa diedit manual).
     • terapkanPotongan(...)    — dipanggil app.js saat slip DISETUJUI
                                   (atau otorisasinya DITARIK): saldo baru
                                   benar-benar berkurang saat itu, bukan
                                   saat baris gaji sekadar diisi. Dibuat
                                   idempoten lewat peta `dipotong[periode]`
                                   supaya menyetujui ulang / merevisi slip
                                   yang sama tidak memotong dua kali.
   ========================================================================= */

const KLINIK_ID = 'lovepet';

let db = null, fsMod = null;
let kasbonMap = new Map();     // empId -> data klinik/lovepet/kasbon/{empId}
let permintaan = [];           // seluruh klinik/lovepet/kasbonPermintaan

const q  = (s, r = document) => r.querySelector(s);
const qq = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pesanToast = (m) => (window.LovePet && window.LovePet.toast ? window.LovePet.toast(m) : console.log(m));

document.addEventListener('cloud-siap', mulai);

function mulai() {
  const C = window.CLOUD;
  if (!C || !C.aktif || !C.db) return;
  db = C.db; fsMod = C.fsMod;
  dengarkan();
}

function dengarkan() {
  fsMod.onSnapshot(fsMod.collection(db, 'klinik', KLINIK_ID, 'kasbon'), (snap) => {
    kasbonMap = new Map(snap.docs.map((d) => [d.id, Object.assign({ empId: d.id }, d.data())]));
    render();
  }, (e) => console.warn('Kasbon akun:', e));

  fsMod.onSnapshot(fsMod.collection(db, 'klinik', KLINIK_ID, 'kasbonPermintaan'), (snap) => {
    permintaan = snap.docs.map((d) => Object.assign({ id: d.id }, d.data()))
      .sort((a, b) => (b.diajukanMs || 0) - (a.diajukanMs || 0));
    render();
  }, (e) => console.warn('Kasbon permintaan:', e));
}

/* ============================ Render ============================ */
function render() {
  renderLencana();
  if (!q('#view-kasbon')) return;
  renderStat();
  renderPermintaan();
  renderAktif();
  renderRiwayat();
}

function menunggu() { return permintaan.filter((p) => p.status === 'menunggu'); }

function renderLencana() {
  const n = menunggu().length;
  qq('.tabitem[data-view="kasbon"] .tab-badge').forEach((tab) => {
    tab.textContent = n > 99 ? '99+' : String(n);
    tab.hidden = n === 0;
  });
}

function renderStat() {
  const aktifList = Array.from(kasbonMap.values()).filter((k) => k.status === 'aktif' && Number(k.saldo) > 0);
  const totalSaldo = aktifList.reduce((s, k) => s + (Number(k.saldo) || 0), 0);
  q('#kasbonStat').innerHTML = `
    <div class="stat"><div class="k">Menunggu Persetujuan</div><div class="v">${menunggu().length}</div></div>
    <div class="stat"><div class="k">Kasbon Aktif</div><div class="v">${aktifList.length}</div></div>
    <div class="stat"><div class="k">Total Belum Lunas</div><div class="v">${rp(totalSaldo)}</div></div>`;
}

function renderPermintaan() {
  const kotak = q('#kasbonPermintaanList');
  const daftar = menunggu();
  if (!daftar.length) {
    kotak.innerHTML = '<div class="empty">Tidak ada pengajuan yang menunggu.</div>';
    return;
  }
  kotak.innerHTML = daftar.map((p) => `
    <div class="card" style="display:flex;flex-direction:column;gap:10px" data-p="${esc(p.id)}">
      <div class="ot-teks">
        <b>${esc(p.nama)} — mengajukan ${rp(p.jumlah)}</b>
        <p>${p.alasan ? esc(p.alasan) : '<span class="muted">Tidak ada catatan.</span>'}</p>
      </div>
      <label class="field inline"><span>Cicilan disetujui / bulan</span>
        <input type="number" class="cicilan-setuju" min="0" step="10000" value="${Number(p.cicilanPerBulan) || 0}">
      </label>
      <div class="card-foot">
        <button type="button" class="btn btn-primary" data-aksi="setuju">Setujui</button>
        <button type="button" class="btn btn-danger" data-aksi="tolak">Tolak</button>
      </div>
    </div>`).join('');

  qq('#kasbonPermintaanList [data-aksi]').forEach((b) => b.addEventListener('click', () => {
    const kartu = b.closest('[data-p]');
    const p = daftar.find((x) => x.id === kartu.dataset.p);
    if (!p) return;
    if (b.dataset.aksi === 'setuju') {
      const cicilan = Number(kartu.querySelector('.cicilan-setuju').value) || 0;
      setujuiPermintaan(p, cicilan, b);
    } else {
      tolakPermintaan(p, b);
    }
  }));
}

function renderAktif() {
  const kotak = q('#kasbonAktifList');
  const daftar = Array.from(kasbonMap.values())
    .filter((k) => k.status === 'aktif' && Number(k.saldo) > 0)
    .sort((a, b) => (b.updateMs || 0) - (a.updateMs || 0));
  if (!daftar.length) {
    kotak.innerHTML = '<div class="empty">Belum ada kasbon aktif.</div>';
    return;
  }
  kotak.innerHTML = daftar.map((k) => {
    const saldo = Number(k.saldo) || 0, cicilan = Number(k.cicilanPerBulan) || 0;
    const totalAwal = Math.max(Number(k.totalDiajukan) || 0, saldo, 1);
    const persen = Math.max(0, Math.min(100, Math.round((1 - saldo / totalAwal) * 100)));
    const sisaBulan = bulanLagiKasbon(saldo, cicilan);
    return `<div class="card" style="display:flex;flex-direction:column;gap:10px" data-emp="${esc(k.empId)}">
      <div class="ot-teks">
        <b>${esc(k.nama)}</b>
        <p>Sisa ${rp(saldo)} · cicilan ${rp(cicilan)}/bulan · ${sisaBulan === Infinity ? 'cicilan belum diatur' : `≈ ${sisaBulan} bulan lagi`}</p>
      </div>
      <div class="kasbon-progress"><span style="width:${persen}%"></span></div>
      <div class="card-foot">
        <button type="button" class="btn" data-lunas="${esc(k.empId)}">Tandai lunas</button>
      </div>
    </div>`;
  }).join('');

  qq('#kasbonAktifList [data-lunas]').forEach((b) => b.addEventListener('click', () => tandaiLunas(b.dataset.lunas, b)));
}

function renderRiwayat() {
  const kotak = q('#kasbonRiwayatList');
  const ditolak = permintaan.filter((p) => p.status === 'ditolak')
    .map((p) => ({ nama: p.nama, jumlah: p.jumlah, waktu: p.diprosesMs, status: 'Ditolak' }));
  const lunas = Array.from(kasbonMap.values()).filter((k) => k.status === 'lunas')
    .map((k) => ({ nama: k.nama, jumlah: k.totalDiajukan, waktu: k.updateMs, status: 'Lunas' }));
  const baris = ditolak.concat(lunas).sort((a, b) => (b.waktu || 0) - (a.waktu || 0));

  if (!baris.length) { kotak.innerHTML = '<div class="empty">Belum ada riwayat.</div>'; return; }
  kotak.innerHTML = `<table class="tbl"><thead><tr><th>Karyawan</th><th>Jumlah</th><th>Status</th><th>Tanggal</th></tr></thead><tbody>
    ${baris.map((b) => `<tr><td>${esc(b.nama)}</td><td>${rp(b.jumlah)}</td><td>${esc(b.status)}</td>` +
      `<td>${b.waktu ? new Date(b.waktu).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}</td></tr>`).join('')}
    </tbody></table>`;
}

/* ============================ Aksi ============================ */
async function setujuiPermintaan(p, cicilan, tombol) {
  if (cicilan <= 0) { pesanToast('Isi cicilan per bulan dulu'); return; }
  if (!confirm(`Setujui kasbon ${p.nama} — ${rp(p.jumlah)}, cicilan ${rp(cicilan)}/bulan?`)) return;
  const lama = tombol.textContent;
  tombol.disabled = true; tombol.textContent = 'Memproses…';
  try {
    const now = Date.now();
    const ref = fsMod.doc(db, 'klinik', KLINIK_ID, 'kasbon', p.empId);
    const snap = await fsMod.getDoc(ref);
    const ada = snap.exists() ? snap.data() : null;
    await fsMod.setDoc(ref, {
      empId: p.empId, nama: p.nama, authUid: p.authUid,
      saldo: (Number(ada && ada.saldo) || 0) + Number(p.jumlah),
      totalDiajukan: (Number(ada && ada.totalDiajukan) || 0) + Number(p.jumlah),
      cicilanPerBulan: cicilan,
      status: 'aktif',
      mulaiMs: (ada && ada.mulaiMs) || now,
      updateMs: now,
      dipotong: (ada && ada.dipotong) || {},
    }, { merge: true });

    await fsMod.updateDoc(fsMod.doc(db, 'klinik', KLINIK_ID, 'kasbonPermintaan', p.id), {
      status: 'disetujui', diprosesMs: now, cicilanDisetujui: cicilan,
    });

    await kabari(p.empId, p.authUid,
      `Kasbon ${rp(p.jumlah)} disetujui, cicilan ${rp(cicilan)}/bulan. Lihat rinciannya di tab Kasbon.`);

    if (window.LovePet) window.LovePet.terapkanKasbonKeBaris(p.empId);
    pesanToast('Kasbon disetujui');
  } catch (e) {
    console.error(e);
    pesanToast('Gagal menyetujui: ' + (e.message || e));
  } finally {
    tombol.disabled = false; tombol.textContent = lama;
  }
}

async function tolakPermintaan(p, tombol) {
  if (!confirm(`Tolak pengajuan kasbon ${p.nama} — ${rp(p.jumlah)}?`)) return;
  const lama = tombol.textContent;
  tombol.disabled = true; tombol.textContent = 'Memproses…';
  try {
    await fsMod.updateDoc(fsMod.doc(db, 'klinik', KLINIK_ID, 'kasbonPermintaan', p.id), {
      status: 'ditolak', diprosesMs: Date.now(),
    });
    await kabari(p.empId, p.authUid, `Pengajuan kasbon ${rp(p.jumlah)} belum bisa disetujui.`);
    pesanToast('Pengajuan ditolak');
  } catch (e) {
    console.error(e);
    pesanToast('Gagal menolak: ' + (e.message || e));
  } finally {
    tombol.disabled = false; tombol.textContent = lama;
  }
}

async function tandaiLunas(empId, tombol) {
  const k = kasbonMap.get(empId);
  if (!k) return;
  if (!confirm(`Tandai kasbon ${k.nama} lunas? Sisa ${rp(k.saldo)} akan dihapus dari saldo aktif.`)) return;
  tombol.disabled = true;
  try {
    await fsMod.setDoc(fsMod.doc(db, 'klinik', KLINIK_ID, 'kasbon', empId),
      { saldo: 0, status: 'lunas', updateMs: Date.now() }, { merge: true });
    await kabari(empId, k.authUid, 'Kasbonmu sudah dilunasi. Terima kasih!');
    pesanToast('Ditandai lunas');
  } catch (e) {
    console.error(e);
    pesanToast('Gagal: ' + (e.message || e));
    tombol.disabled = false;
  }
}

/* Dipanggil app.js saat slip DISETUJUI (jumlahHutang = angka di kolom
   Hutang/Kasbon periode itu) atau saat otorisasinya DITARIK (jumlahHutang
   = 0, seolah periode itu belum pernah dipotong). Dibuat berbasis delta
   supaya aman dipanggil berkali-kali untuk periode yang sama (revisi,
   kirim ulang) tanpa memotong saldo dua kali. */
async function terapkanPotongan(empId, periode, jumlahHutang) {
  if (!db) return;
  const ref = fsMod.doc(db, 'klinik', KLINIK_ID, 'kasbon', empId);
  const snap = await fsMod.getDoc(ref);
  if (!snap.exists()) return;
  const k = snap.data();
  const dipotong = Object.assign({}, k.dipotong || {});
  const sebelumnya = Number(dipotong[periode]) || 0;
  const baru = Math.max(0, Number(jumlahHutang) || 0);
  const delta = baru - sebelumnya;
  if (delta === 0) return;

  const saldo = Math.max(0, (Number(k.saldo) || 0) - delta);
  dipotong[periode] = baru;
  await fsMod.setDoc(ref, {
    saldo, dipotong, updateMs: Date.now(),
    status: saldo <= 0 && k.status === 'aktif' ? 'lunas' : k.status,
  }, { merge: true });
}

function cicilanSaran(empId) {
  const k = kasbonMap.get(empId);
  if (!k || k.status !== 'aktif' || !(Number(k.saldo) > 0)) return 0;
  return Math.min(Number(k.cicilanPerBulan) || 0, Number(k.saldo) || 0);
}

/* Catatan otomatis ke ruang chat karyawan — sama seperti slip-terbit.js. */
async function kabari(empId, authUid, teks) {
  if (!authUid) return;
  try {
    const now = Date.now();
    const ruang = fsMod.doc(db, 'klinik', KLINIK_ID, 'chat', empId);
    await fsMod.addDoc(fsMod.collection(ruang, 'pesan'), {
      dari: 'pemilik', teks, ms: now, empId, authUid, tipe: 'sistem',
    });
    await fsMod.setDoc(ruang, {
      empId, authUid,
      terakhirTeks: teks.slice(0, 120), terakhirMs: now, terakhirDari: 'pemilik',
      belumKaryawan: fsMod.increment(1),
    }, { merge: true });
  } catch (e) {
    console.warn('Kabar otomatis (kasbon) gagal:', e);
  }
}

window.Kasbon = {
  segarkan: render,
  cicilanSaran,
  terapkanPotongan,
};
