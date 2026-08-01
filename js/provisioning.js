/* =========================================================================
   provisioning.js — membuat / mengganti akun login karyawan
   -------------------------------------------------------------------------
   Dipanggil dari Kelola → Karyawan (app.js). Hanya aktif kalau Firebase
   sudah dikonfigurasi (lihat firebase-config.js).

   Kenapa perlu app Firebase KEDUA:
   Membuat akun baru lewat Firebase Auth (createUserWithEmailAndPassword)
   otomatis MASUK sebagai akun baru itu di sesi yang dipakai — kalau dipakai
   di app utama, pemilik akan otomatis ter-logout dari akunnya sendiri.
   Instance kedua ini terpisah total, jadi sesi pemilik di app utama sama
   sekali tidak tersentuh.

   Username karyawan diubah menjadi email palsu (…@karyawan.lovepet.app)
   semata agar bisa dipakai Firebase Auth — karyawan tidak perlu tahu ini,
   mereka cukup mengetik "nama pengguna" di lapor.html.
   ========================================================================= */

const emailDariUsername = window.emailDariUsername;

let appKedua = null, authKedua = null, fsMod = null;

async function siapkanAppKedua() {
  if (appKedua) return;
  const CFG = window.FIREBASE_CONFIG || {};
  if (!CFG.apiKey) throw new Error('Firebase belum dikonfigurasi.');
  const V = 'https://www.gstatic.com/firebasejs/10.12.2';
  const [{ initializeApp }, authM, fsM] = await Promise.all([
    import(`${V}/firebase-app.js`),
    import(`${V}/firebase-auth.js`),
    import(`${V}/firebase-firestore.js`),
  ]);
  appKedua = initializeApp(CFG, 'provisioning');
  authKedua = authM.getAuth(appKedua);
  fsMod = fsM;
  window.__provisioningAuthMod = authM;
}

/* Membuat akun baru untuk karyawan (atau mengganti kalau sebelumnya sudah
   ada — akun lama ditinggalkan begitu saja, tidak menimbulkan biaya apa
   pun, hanya sudah tidak dipakai lagi karena tidak ada yang menunjuk ke
   uid-nya). Mengembalikan { username, authUid }.                         */
async function buatAkunKaryawan(username, sandi) {
  await siapkanAppKedua();
  const authM = window.__provisioningAuthMod;
  const email = emailDariUsername(username);
  if (!/^.+@/.test(email) || email === '@' + window.DOMAIN_KARYAWAN) {
    throw new Error('Nama pengguna tidak boleh kosong.');
  }
  if (!sandi || sandi.length < 6) throw new Error('Kata sandi minimal 6 karakter.');

  const cred = await authM.createUserWithEmailAndPassword(authKedua, email, sandi);
  const uid = cred.user.uid;
  await authM.signOut(authKedua);   // bersihkan sesi di app kedua, tidak memengaruhi app utama
  return { username: username.trim(), authUid: uid };
}

window.Provisioning = { buatAkunKaryawan };
