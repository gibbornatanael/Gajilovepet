/* =========================================================================
   slip-terbit.js — menerbitkan slip gaji ke karyawan (sisi pemilik)
   -------------------------------------------------------------------------
   Kenapa slip perlu "diterbitkan" dan tidak dibaca langsung:
   seluruh data gaji semua karyawan ada di SATU dokumen `pengguna/{uid}`
   milik pemilik. Kalau karyawan boleh membacanya, ia otomatis bisa melihat
   gaji rekan-rekannya. Maka saat pemilik menekan "Setujui & kirim", angka
   slip orang itu saja disalin sebagai snapshot ke dokumen tersendiri:

       klinik/lovepet/slip/{empId}_{periode}

   Sifat snapshot ini disengaja: ia TIDAK ikut berubah kalau pemilik nanti
   mengedit angka di aplikasi. Slip yang sudah disetujui adalah bukti — agar
   berubah, pemilik harus menarik otorisasi, memperbaiki, lalu menyetujui
   ulang (versinya naik). Dengan begitu tidak ada angka yang berganti diam-
   diam di layar karyawan.

   Status dokumen:
     'disetujui' — karyawan boleh melihat & mengunduh PNG
     'ditarik'   — otorisasi dicabut; slip hilang dari layar karyawan,
                   dokumennya tetap ada supaya riwayatnya tidak putus
   ========================================================================= */

const KLINIK_ID = 'lovepet';

let db = null, fsMod = null, lepas = null;
let peta = new Map();        // "{empId}_{periode}" -> data dokumen

const idSlip = (empId, periode) => `${empId}_${periode}`;

document.addEventListener('cloud-siap', mulai);

function mulai() {
  const C = window.CLOUD;
  if (!C || !C.aktif || !C.db) return;
  db = C.db; fsMod = C.fsMod;
  dengarkan();
}

/* Pemilik memantau seluruh slip terbit sekaligus, supaya tombol otorisasi
   di tab Slip Gaji langsung mencerminkan keadaan terbaru — termasuk kalau
   karyawan baru saja menekan "Minta revisi". */
function dengarkan() {
  if (lepas) lepas();
  lepas = fsMod.onSnapshot(
    fsMod.collection(db, 'klinik', KLINIK_ID, 'slip'),
    (snap) => {
      peta = new Map(snap.docs.map((d) => [d.id, d.data()]));
      document.dispatchEvent(new CustomEvent('slip-terbit-berubah'));
    },
    (e) => console.warn('Slip terbit:', e),
  );
}

function status(empId, periode) {
  return peta.get(idSlip(empId, periode)) || null;
}

/* Semua slip yang pernah diterbitkan ke seorang karyawan — dipakai menu
   Published (js/published.js) untuk memperlihatkan persis apa yang tampil
   di tab Slip Gaji miliknya, semua periode sekaligus. Terbaru di atas. */
function semua(empId) {
  return Array.from(peta.values())
    .filter((d) => d.empId === empId)
    .sort((a, b) => String(b.periode).localeCompare(String(a.periode)));
}

/* Setujui — tulis snapshot & buka aksesnya untuk karyawan.
   Versi naik setiap kali isinya benar-benar berbeda dari yang sudah pernah
   dikirim, atau setiap kali slip dihidupkan lagi setelah ditarik. Angka ini
   yang dipakai sebagai cap "revisi ke-n" di sudut slip. */
async function setujui(empId, periode, snapshot, authUid) {
  if (!db) throw new Error('Belum tersambung ke server');
  if (!authUid) throw new Error('Karyawan ini belum punya akun login');

  const ref = fsMod.doc(db, 'klinik', KLINIK_ID, 'slip', idSlip(empId, periode));
  const lama = status(empId, periode);
  const berubah = !lama || lama.status !== 'disetujui' ||
    JSON.stringify(lama.data) !== JSON.stringify(snapshot);
  const versi = lama ? (Number(lama.versi) || 1) + (berubah ? 1 : 0) : 1;

  const now = Date.now();
  await fsMod.setDoc(ref, {
    empId, authUid, periode,
    status: 'disetujui',
    versi,
    data: snapshot,
    disetujuiMs: now,
    disetujuiLabel: new Date(now).toLocaleDateString('id-ID',
      { day: 'numeric', month: 'long', year: 'numeric' }),
    // Menyetujui ulang = permintaan revisi dianggap sudah ditanggapi.
    revisiDiminta: false,
    revisiAlasan: '',
  });

  await kabari(empId, authUid, versi > 1
    ? `Slip ${snapshot.periodeLabel} sudah diperbaiki dan disetujui ulang (revisi ke-${versi}). Silakan dibuka lagi.`
    : `Slip ${snapshot.periodeLabel} sudah disetujui. Kamu bisa membukanya di tab Slip Gaji.`);
}

/* Tarik otorisasi — slip hilang dari layar karyawan, dokumennya tetap ada
   beserta snapshot terakhirnya sebagai jejak. */
async function tarik(empId, periode) {
  if (!db) throw new Error('Belum tersambung ke server');
  const lama = status(empId, periode);
  const ref = fsMod.doc(db, 'klinik', KLINIK_ID, 'slip', idSlip(empId, periode));
  await fsMod.updateDoc(ref, { status: 'ditarik', ditarikMs: Date.now() });

  const label = (lama && lama.data && lama.data.periodeLabel) || periode;
  await kabari(empId, lama && lama.authUid,
    `Slip ${label} sementara ditarik untuk diperiksa ulang. Nanti saya kirim lagi setelah diperbaiki.`);
}

/* Catatan otomatis ke ruang chat karyawan, supaya slip yang muncul atau
   menghilang dari layarnya selalu ada penjelasannya. Kegagalan di sini
   tidak boleh membatalkan otorisasi yang sudah tersimpan — karena itu
   galatnya hanya dicatat, tidak dilempar. */
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
    console.warn('Kabar otomatis gagal (otorisasi tetap tersimpan):', e);
  }
}

window.SlipTerbit = {
  siap: () => Boolean(db),
  status, semua, setujui, tarik,
};
