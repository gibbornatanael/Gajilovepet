/* =========================================================================
   chat.js — Chat Karyawan (sisi pemilik)
   -------------------------------------------------------------------------
   Percakapan pribadi satu lawan satu dengan tiap karyawan, tampilan gelembung
   seperti WhatsApp. Karyawan memakai layar kembarannya di lapor.html.

   Struktur di Firestore:
     klinik/lovepet/chat/{empId}              ← ringkasan ruang (pesan terakhir,
                                                jumlah yang belum dibaca)
     klinik/lovepet/chat/{empId}/pesan/{id}   ← tiap gelembung

   empId dipakai sebagai id ruang supaya firestore.rules bisa memeriksa izin
   lewat jalur dokumen — lihat catatan di berkas aturan.

   Pesan tidak bisa disunting atau dihapus oleh karyawan (dijaga di aturan
   Firestore), karena percakapan ini menyangkut uang: apa yang sudah terkirim
   harus tetap bisa dibaca ulang apa adanya oleh kedua pihak.
   ========================================================================= */

const KLINIK_ID = 'lovepet';
const BATAS_PESAN = 300;         // pesan terakhir yang dimuat per ruang

let db = null, fsMod = null;
let lepasRuang = null, lepasPesan = null;
let ruang = new Map();           // empId -> data ringkasan ruang
let dibuka = null;               // empId ruang yang sedang terbuka
let pesan = [];                  // pesan di ruang yang terbuka

const q  = (s, r = document) => r.querySelector(s);
const qq = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pesanToast = (m) => (window.LovePet && window.LovePet.toast ? window.LovePet.toast(m) : console.log(m));

/* ============================ Sambungan ============================ */
document.addEventListener('cloud-siap', mulai);

function mulai() {
  const C = window.CLOUD;
  if (!C || !C.aktif || !C.db) {
    q('#chatKosong').innerHTML =
      '<p class="muted">Chat memerlukan sambungan ke akun (Firebase). Masuk dulu lewat layar login.</p>';
    return;
  }
  db = C.db; fsMod = C.fsMod;
  dengarkanRuang();
  pasangKendali();
}

function dengarkanRuang() {
  if (lepasRuang) lepasRuang();
  lepasRuang = fsMod.onSnapshot(
    fsMod.collection(db, 'klinik', KLINIK_ID, 'chat'),
    (snap) => {
      ruang = new Map(snap.docs.map((d) => [d.id, Object.assign({ empId: d.id }, d.data())]));
      renderDaftar();
      renderLencana();
    },
    (e) => console.warn('Chat ruang:', e),
  );
}

/* ============================ Daftar ruang ============================ */
/* Daftar diambil dari master karyawan (bukan dari ruang yang sudah ada),
   supaya karyawan yang belum pernah dichat pun tetap muncul dan bisa
   dimulai percakapannya. */
function karyawanChat() {
  const semua = (window.LovePet ? window.LovePet.ambilState().karyawan : []) || [];
  return semua
    .filter((e) => e.authUid && e.aktif !== false)
    .map((e) => Object.assign({}, e, { ruang: ruang.get(e.id) || null }))
    .sort((a, b) => (b.ruang ? b.ruang.terakhirMs || 0 : 0) - (a.ruang ? a.ruang.terakhirMs || 0 : 0));
}

function belumDibacaTotal() {
  return karyawanChat().reduce((s, e) => s + (e.ruang ? Number(e.ruang.belumPemilik) || 0 : 0), 0);
}

function renderLencana() {
  const tab = q('.tabitem[data-view="chat"] .tab-badge');
  if (!tab) return;
  const n = belumDibacaTotal();
  tab.textContent = n > 99 ? '99+' : String(n);
  tab.hidden = n === 0;
}

function renderDaftar() {
  const kotak = q('#chatDaftar');
  if (!kotak) return;
  const daftar = karyawanChat();

  q('#chatKosong').innerHTML = daftar.length ? '' :
    '<div class="empty">Belum ada karyawan yang punya akun login. ' +
    'Buatkan dulu di Kelola → Karyawan, baru mereka bisa dichat.</div>';

  kotak.innerHTML = daftar.map((e) => {
    const r = e.ruang;
    const belum = r ? Number(r.belumPemilik) || 0 : 0;
    const cuplik = r && r.terakhirTeks
      ? (r.terakhirDari === 'pemilik' ? 'Anda: ' : '') + r.terakhirTeks
      : 'Belum ada pesan';
    return `<button type="button" class="chat-item${belum ? ' is-belum' : ''}" data-emp="${esc(e.id)}">
      <span class="chat-avatar">${esc(inisialNama(e.nama))}</span>
      <span class="chat-item-isi">
        <span class="chat-item-atas">
          <b>${esc(e.nama)}</b>
          <small>${r && r.terakhirMs ? jamRingkas(r.terakhirMs) : ''}</small>
        </span>
        <span class="chat-item-bawah">
          <span class="cuplikan">${esc(cuplik)}</span>
          ${belum ? `<span class="chat-hitung">${belum > 99 ? '99+' : belum}</span>` : ''}
        </span>
      </span>
    </button>`;
  }).join('');

  qq('#chatDaftar .chat-item').forEach((b) =>
    b.addEventListener('click', () => bukaRuang(b.dataset.emp)));

  // Ruang yang sedang terbuka ikut memperbarui judulnya kalau ada perubahan
  if (dibuka) tandaiJudul();
}

function inisialNama(n) {
  return String(n || '?').replace(/^Drh\.?\s*/i, '').split(/\s+/).slice(0, 2)
    .map((w) => w[0] || '').join('').toUpperCase();
}

/* ============================ Ruang terbuka ============================ */
function bukaRuang(empId) {
  dibuka = empId;
  pesan = [];
  q('#view-chat').classList.add('chat-terbuka');
  tandaiJudul();
  q('#chatPesan').innerHTML = '<div class="chat-sibuk">Memuat percakapan…</div>';
  dengarkanPesan(empId);
  tandaiTerbaca(empId);
}

function tutupRuang() {
  dibuka = null;
  if (lepasPesan) { lepasPesan(); lepasPesan = null; }
  q('#view-chat').classList.remove('chat-terbuka');
}

function tandaiJudul() {
  const e = (window.LovePet.ambilState().karyawan || []).find((x) => x.id === dibuka);
  if (!e) return;
  q('#chatJudulNama').textContent = e.nama;
  q('#chatJudulRole').textContent = e.role || '';
  q('#chatAvatarBesar').textContent = inisialNama(e.nama);
}

function dengarkanPesan(empId) {
  if (lepasPesan) lepasPesan();
  const kueri = fsMod.query(
    fsMod.collection(db, 'klinik', KLINIK_ID, 'chat', empId, 'pesan'),
    fsMod.orderBy('ms', 'desc'), fsMod.limit(BATAS_PESAN),
  );
  lepasPesan = fsMod.onSnapshot(kueri, (snap) => {
    if (dibuka !== empId) return;
    pesan = snap.docs.map((d) => Object.assign({ id: d.id }, d.data())).reverse();
    renderPesan();
    tandaiTerbaca(empId);
  }, (e) => {
    console.warn('Chat pesan:', e);
    q('#chatPesan').innerHTML = '<div class="chat-sibuk">Gagal memuat percakapan.</div>';
  });
}

function renderPesan() {
  const kotak = q('#chatPesan');
  if (!pesan.length) {
    kotak.innerHTML = '<div class="chat-sibuk">Belum ada pesan. Sapa dia duluan.</div>';
    return;
  }
  let hariTerakhir = '';
  kotak.innerHTML = pesan.map((p) => {
    const hari = tanggalHari(p.ms);
    const pemisah = hari !== hariTerakhir ? `<div class="chat-hari"><span>${esc(hari)}</span></div>` : '';
    hariTerakhir = hari;
    return pemisah + gelembung(p);
  }).join('');
  kotak.scrollTop = kotak.scrollHeight;
}

/* Satu gelembung. Pesan bertipe 'revisi' diberi kepala kecil berisi bulan
   slipnya, supaya jelas protesnya menyangkut slip yang mana. */
function gelembung(p) {
  // Kabar otomatis saat slip disetujui / ditarik — bukan ucapan siapa-siapa,
  // jadi ditaruh di tengah tanpa gelembung, seperti pesan sistem di WhatsApp.
  if (p.tipe === 'sistem') {
    return `<div class="chat-sistem">${esc(p.teks)} <small>${jam(p.ms)}</small></div>`;
  }
  const milikku = p.dari === 'pemilik';
  const kepala = p.tipe === 'revisi'
    ? `<span class="bubble-tag">📄 Minta revisi — ${esc(p.periodeLabel || p.periode || '')}</span>`
    : '';
  return `<div class="bubble-row ${milikku ? 'kanan' : 'kiri'}">
    <div class="bubble${p.tipe === 'revisi' ? ' is-revisi' : ''}">
      ${kepala}
      <span class="bubble-teks">${esc(p.teks)}</span>
      <span class="bubble-jam">${jam(p.ms)}</span>
    </div>
  </div>`;
}

/* ============================ Kirim & baca ============================ */
function pasangKendali() {
  q('#chatKembali').addEventListener('click', tutupRuang);

  const form = q('#chatForm');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = q('#chatInput');
    const teks = input.value.trim();
    if (!teks || !dibuka) return;
    input.value = '';
    aturTinggiInput();
    try {
      await kirimPesan(dibuka, teks);
    } catch (err) {
      console.error(err);
      pesanToast('Gagal mengirim: ' + (err.message || err));
      input.value = teks;
    }
  });

  // Enter mengirim, Shift+Enter membuat baris baru — kebiasaan aplikasi chat.
  q('#chatInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); q('#chatForm').requestSubmit(); }
  });
  q('#chatInput').addEventListener('input', aturTinggiInput);
}

function aturTinggiInput() {
  const t = q('#chatInput');
  t.style.height = 'auto';
  t.style.height = Math.min(120, t.scrollHeight) + 'px';
}

async function kirimPesan(empId, teks) {
  const e = (window.LovePet.ambilState().karyawan || []).find((x) => x.id === empId);
  if (!e || !e.authUid) throw new Error('Karyawan ini belum punya akun login');

  const now = Date.now();
  const ruangRef = fsMod.doc(db, 'klinik', KLINIK_ID, 'chat', empId);

  await fsMod.addDoc(fsMod.collection(ruangRef, 'pesan'), {
    dari: 'pemilik', teks, ms: now, empId, authUid: e.authUid, tipe: 'teks',
  });
  await fsMod.setDoc(ruangRef, {
    empId, authUid: e.authUid, nama: e.nama,
    terakhirTeks: teks.slice(0, 120), terakhirMs: now, terakhirDari: 'pemilik',
    belumPemilik: 0,
    belumKaryawan: fsMod.increment(1),
  }, { merge: true });
}

async function tandaiTerbaca(empId) {
  const r = ruang.get(empId);
  if (!r || !(Number(r.belumPemilik) || 0)) return;
  try {
    await fsMod.setDoc(fsMod.doc(db, 'klinik', KLINIK_ID, 'chat', empId),
      { belumPemilik: 0 }, { merge: true });
  } catch (e) { console.warn('Tandai terbaca:', e); }
}

/* ============================ Format waktu ============================ */
function jam(ms) {
  const d = new Date(Number(ms) || 0);
  return `${String(d.getHours()).padStart(2, '0')}.${String(d.getMinutes()).padStart(2, '0')}`;
}
function tanggalHari(ms) {
  const d = new Date(Number(ms) || 0);
  const hariIni = new Date();
  const kemarin = new Date(Date.now() - 86400000);
  const sama = (a, b) => a.toDateString() === b.toDateString();
  if (sama(d, hariIni)) return 'Hari ini';
  if (sama(d, kemarin)) return 'Kemarin';
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
}
/* Kolom kanan di daftar ruang: jam kalau hari ini, selain itu tanggal. */
function jamRingkas(ms) {
  const d = new Date(Number(ms) || 0);
  if (d.toDateString() === new Date().toDateString()) return jam(ms);
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
}

/* Dipakai app.js saat berpindah ke tab Chat */
window.ChatPemilik = {
  segarkan() { renderDaftar(); renderLencana(); },
};
