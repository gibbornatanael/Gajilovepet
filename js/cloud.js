/* =========================================================================
   cloud.js — sinkronisasi opsional lewat Firebase (Auth + Firestore)
   -------------------------------------------------------------------------
   Prinsip:
   • Aplikasi TETAP bekerja penuh tanpa Firebase. Kalau firebase-config.js
     belum diisi, berkas ini tidak melakukan apa-apa selain menandai
     "Mode lokal" di layar.
   • Kalau dikonfigurasi: seluruh data disimpan sebagai SATU dokumen
     Firestore (`pengguna/{uid}`). Ukurannya hanya beberapa KB, jadi ini
     jauh lebih sederhana dan lebih aman dari konflik dibanding memecahnya
     per bulan.
   • Firestore menyimpan cache offline sendiri, jadi aplikasi tetap bisa
     dipakai tanpa sinyal dan menyusul sinkron saat online lagi.

   Rencana ke depan (karyawan ikut memakai aplikasi untuk absen & performa):
   dokumen pemilik tetap di `pengguna/{uid}`, sedangkan data yang diisi
   karyawan sebaiknya ditaruh di koleksi terpisah, mis.
   `klinik/{klinikId}/performa/{periode}` — supaya aturan aksesnya bisa
   dibedakan per peran tanpa membongkar struktur ini.
   ========================================================================= */

const CFG = window.FIREBASE_CONFIG || {};
const AKTIF = Boolean(CFG.apiKey && CFG.projectId);

/* ID perangkat — dipakai agar perubahan dari perangkat sendiri
   tidak dipantulkan balik dan menimpa ketikan yang sedang berjalan. */
const ID_PERANGKAT = (() => {
  try {
    let v = localStorage.getItem('lovepet-device');
    if (!v) { v = Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem('lovepet-device', v); }
    return v;
  } catch { return 'sementara-' + Math.random().toString(36).slice(2); }
})();

let db = null, auth = null, uid = null, docRef = null;
let lepasLangganan = null;
let jedaKirim = null;
let sedangMenerima = false;

/* ------------------------------ Status UI ------------------------------ */
function setStatus(teks, jenis) {
  const el = document.getElementById('cloudStatus');
  if (!el) return;
  el.textContent = teks;
  el.className = 'cloud-status ' + (jenis || '');
  el.hidden = false;
}

function tampilkanLogin(tampil, pesan) {
  const ov = document.getElementById('loginOverlay');
  if (!ov) return;
  ov.hidden = !tampil;
  const err = document.getElementById('loginError');
  if (err) { err.textContent = pesan || ''; err.hidden = !pesan; }
}

/* ------------------------------ Mode lokal ------------------------------ */
if (!AKTIF) {
  setStatus('Mode lokal — data hanya di perangkat ini', 'lokal');
  window.CLOUD = { aktif: false, push() {}, keluar() {} };
} else {
  mulai();
}

/* ------------------------------- Firebase ------------------------------- */
async function mulai() {
  setStatus('Menghubungkan…', 'sibuk');
  try {
    const V = 'https://www.gstatic.com/firebasejs/10.12.2';
    const [{ initializeApp }, authMod, fsMod] = await Promise.all([
      import(`${V}/firebase-app.js`),
      import(`${V}/firebase-auth.js`),
      import(`${V}/firebase-firestore.js`),
    ]);

    const app = initializeApp(CFG);
    auth = authMod.getAuth(app);

    // Cache offline supaya aplikasi tetap jalan tanpa internet
    try {
      db = fsMod.initializeFirestore(app, {
        localCache: fsMod.persistentLocalCache({ tabManager: fsMod.persistentMultipleTabManager() }),
      });
    } catch {
      db = fsMod.getFirestore(app);
    }

    window.CLOUD = {
      aktif: true,
      db, fsMod, auth,               // dipakai app.js untuk roster karyawan & tarik laporan
      push: (data) => kirim(fsMod, data),
      keluar: () => authMod.signOut(auth),
      masuk: (email, sandi) => authMod.signInWithEmailAndPassword(auth, email, sandi),
      daftar: (email, sandi) => authMod.createUserWithEmailAndPassword(auth, email, sandi),
      resetSandi: (email) => authMod.sendPasswordResetEmail(auth, email),
    };

    pasangFormLogin();

    authMod.onAuthStateChanged(auth, (user) => {
      if (!user) {
        uid = null; docRef = null;
        if (lepasLangganan) { lepasLangganan(); lepasLangganan = null; }
        setStatus('Belum masuk', 'lokal');
        tampilkanLogin(true);
        return;
      }
      uid = user.uid;
      docRef = fsMod.doc(db, 'pengguna', uid);
      tampilkanLogin(false);
      setStatus(user.email || 'Tersinkron', 'ok');
      dengarkan(fsMod);
      document.dispatchEvent(new CustomEvent('cloud-siap'));
    });
  } catch (e) {
    console.error('Firebase gagal dimuat:', e);
    setStatus('Gagal terhubung — jalan dalam mode lokal', 'galat');
    window.CLOUD = { aktif: false, push() {}, keluar() {} };
    tampilkanLogin(false);
  }
}

/* --------------------- Dengarkan perubahan dari cloud --------------------- */
function dengarkan(fsMod) {
  if (lepasLangganan) lepasLangganan();
  lepasLangganan = fsMod.onSnapshot(docRef, (snap) => {
    if (!snap.exists()) {                    // pertama kali login → unggah data lokal
      kirim(fsMod, window.LovePet.ambilState());
      return;
    }
    const jauh = snap.data();
    if (!jauh || !jauh.state) return;
    if (jauh.perangkat === ID_PERANGKAT) return;          // gema dari diri sendiri

    const lokal = window.LovePet.ambilState();
    if ((jauh.diubah || 0) <= (lokal.updatedAt || 0)) return;   // punya kita lebih baru

    sedangMenerima = true;
    try { window.LovePet.terapkanState(JSON.parse(jauh.state)); }
    finally { sedangMenerima = false; }
    setStatus('Diperbarui dari perangkat lain', 'ok');
  }, (e) => {
    console.warn('Firestore:', e);
    setStatus('Sinkron terhenti — data tetap aman di perangkat', 'galat');
  });
}

/* ------------------------- Kirim perubahan ke cloud ------------------------- */
function kirim(fsMod, data) {
  if (!docRef || sedangMenerima) return;
  clearTimeout(jedaKirim);
  jedaKirim = setTimeout(async () => {
    try {
      setStatus('Menyimpan…', 'sibuk');
      await fsMod.setDoc(docRef, {
        state: JSON.stringify(data),
        diubah: data.updatedAt || Date.now(),
        perangkat: ID_PERANGKAT,
      });
      setStatus((auth.currentUser && auth.currentUser.email) || 'Tersinkron', 'ok');
    } catch (e) {
      console.warn('Gagal mengirim:', e);
      setStatus('Belum tersinkron — akan dicoba lagi', 'galat');
    }
  }, 1200);
}

/* ------------------------------ Form login ------------------------------ */
function pasangFormLogin() {
  const form = document.getElementById('loginForm');
  if (!form || form.dataset.siap) return;
  form.dataset.siap = '1';

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('loginEmail').value.trim();
    const sandi = document.getElementById('loginSandi').value;
    const tombol = document.getElementById('loginSubmit');
    tombol.disabled = true; tombol.textContent = 'Memproses…';
    try {
      await window.CLOUD.masuk(email, sandi);
    } catch (err) {
      tampilkanLogin(true, pesanGalat(err));
    } finally {
      tombol.disabled = false; tombol.textContent = 'Masuk';
    }
  });

  document.getElementById('loginDaftar').addEventListener('click', async () => {
    const email = document.getElementById('loginEmail').value.trim();
    const sandi = document.getElementById('loginSandi').value;
    if (!email || sandi.length < 6) {
      tampilkanLogin(true, 'Isi email dan kata sandi minimal 6 karakter.');
      return;
    }
    try { await window.CLOUD.daftar(email, sandi); }
    catch (err) { tampilkanLogin(true, pesanGalat(err)); }
  });

  document.getElementById('loginLupa').addEventListener('click', async () => {
    const email = document.getElementById('loginEmail').value.trim();
    if (!email) { tampilkanLogin(true, 'Isi email dulu, lalu tekan tautan ini lagi.'); return; }
    try {
      await window.CLOUD.resetSandi(email);
      tampilkanLogin(true, 'Tautan atur ulang kata sandi sudah dikirim ke email Anda.');
    } catch (err) { tampilkanLogin(true, pesanGalat(err)); }
  });

  document.getElementById('loginLokal').addEventListener('click', () => {
    tampilkanLogin(false);
    setStatus('Mode lokal — belum masuk', 'lokal');
  });
}

function pesanGalat(err) {
  const kode = (err && err.code) || '';
  if (kode.includes('invalid-credential') || kode.includes('wrong-password')) return 'Email atau kata sandi salah.';
  if (kode.includes('user-not-found')) return 'Akun belum ada. Tekan “Buat akun baru”.';
  if (kode.includes('email-already-in-use')) return 'Email ini sudah terdaftar — langsung tekan “Masuk”.';
  if (kode.includes('weak-password')) return 'Kata sandi minimal 6 karakter.';
  if (kode.includes('invalid-email')) return 'Format email tidak benar.';
  if (kode.includes('too-many-requests')) return 'Terlalu banyak percobaan. Coba lagi beberapa menit.';
  if (kode.includes('network')) return 'Tidak ada koneksi. Anda tetap bisa memakai aplikasi secara lokal.';
  return 'Gagal: ' + (err && err.message ? err.message : kode || 'tidak diketahui');
}

/* ------------------------- Tombol keluar di Kelola ------------------------- */
document.addEventListener('click', (e) => {
  if (!e.target.closest('#btnKeluar')) return;
  if (!window.CLOUD || !window.CLOUD.aktif) { alert('Belum terhubung ke Firebase.'); return; }
  if (confirm('Keluar dari akun? Data yang sudah tersinkron tetap aman.')) window.CLOUD.keluar();
});
