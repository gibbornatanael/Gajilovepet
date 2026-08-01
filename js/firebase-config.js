/* =========================================================================
   KONFIGURASI FIREBASE
   -------------------------------------------------------------------------
   Selama masih kosong, aplikasi berjalan dalam MODE LOKAL — data hanya
   tersimpan di perangkat ini, persis seperti sebelumnya. Aplikasi tetap
   berfungsi penuh.

   Untuk mengaktifkan sinkronisasi iPhone ⇄ MacBook, isi nilai di bawah ini
   dengan konfigurasi project Firebase Anda. Panduan langkah demi langkah ada
   di file PANDUAN-DEPLOY.md.

   Catatan keamanan: nilai-nilai di bawah ini memang dirancang untuk publik —
   yang mengamankan data Anda adalah Firestore Security Rules + login, bukan
   kerahasiaan kunci ini.
   ========================================================================= */

window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyDCLiQefpHFIh7nkfnymChQ69VCDcaJcJs",
  authDomain: "gajilovepet.firebaseapp.com",
  projectId: "gajilovepet",
  storageBucket: "gajilovepet.firebasestorage.app",
  messagingSenderId: "603897232201",
  appId: "1:603897232201:web:69c76efd1aaba34374f898"
};
