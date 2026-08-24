/* =========================================================================
   jurnal.js — layar "Jurnal" (sisi pemilik)
   -------------------------------------------------------------------------
   Kenapa fitur ini ada: sebagian pengeluaran klinik itu-itu lagi tiap bulan
   (sewa, listrik, cicilan). Di intajo tiap kali harus buka menu Accounting →
   Journal → Create, cari kodenya di dropdown panjang, isi tanggal, lalu isi
   nominal DUA kali (baris debit dan baris kredit) supaya "Difference" nol.
   Untuk transaksi yang isinya sudah pasti, itu pekerjaan yang seharusnya
   satu ketukan.

   Yang SENGAJA tidak dilakukan di sini: menebak ledger. Ledger tetap
   ditentukan oleh Transaction List di intajo — pemilik yang memilih kodenya
   saat membuat preset, persis seperti kalau mengisi di intajo langsung.
   Aplikasi ini cuma "remote control" yang lebih enak dipakai, bukan
   pengambil keputusan akuntansi.

   Nominal debit & kredit diisi dari SATU angka di preset, jadi Difference
   dijamin nol — satu sumber kesalahan hilang dengan sendirinya.

   Alur data:
     preset  → klinik/lovepet/jurnalPreset/{id}   (dibuat & dibaca browser)
     kiriman → POST /api/jurnal-buat              (Worker yang menulis ke intajo)
     riwayat → klinik/lovepet/jurnalKirim/{id}    (dicatat SESUDAH sukses)

   Riwayat itu catatan "apa yang sudah dikirim bulan ini", bukan sumber
   kebenaran pembukuan — yang sungguhan tetap di intajo.
   ========================================================================= */

const KLINIK_ID = 'lovepet';
const CABANG = { manado: 'Manado', tomohon: 'Tomohon' };

let db = null, fsMod = null;
let refPreset = null, refKirim = null, refDraft = null, refNota = null;
let daftarPreset = [];
let daftarKirim = [];
let daftarDraft = [];        // klinik/lovepet/jurnalDraft — lihat functions/api/telegram.js buatDraftJurnal()
let telusurTerakhir = null;
let daftarTransaksi = [];   // Transaction List intajo (lihat muatTransaksi)

/* Bulan yang sedang ditampilkan di Riwayat kiriman, format "YYYY-MM".
   Disinkronkan dengan dropdown bulan/tahun di kop aplikasi (app.js
   memanggil window.Jurnal.segarkan(periode) tiap kali dropdown itu
   berubah atau tab Jurnal dibuka) — supaya riwayatnya tidak menumpuk
   panjang ke bawah selama bertahun-tahun pemakaian. null = tampilkan
   semua bulan. */
let periodeFilter = null;

const q = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rp = (n) => 'Rp ' + (Math.round(Number(n) || 0)).toLocaleString('id-ID');

/* Tanggal WITA — sama seperti neraca.js. Jangan pakai tanggal UTC: lewat
   jam 8 pagi WITA keduanya masih sama, tapi dini hari bisa mundur sehari. */
function tanggalWita() {
  const d = new Date(Date.now() + 8 * 60 * 60 * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}
const NAMA_BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
function labelPeriodeBulan(ym) {
  const [y, m] = String(ym || '').split('-');
  return m ? `${NAMA_BULAN[Number(m) - 1]} ${y}` : '';
}
/* Deskripsi preset boleh memakai {bulan} dan {tahun} supaya "Sewa bulan
   Agustus 2026" tidak perlu diketik ulang tiap bulan. */
function isiPola(teks, tanggal) {
  const [y, m] = String(tanggal || tanggalWita()).split('-');
  return String(teks || '')
    .replace(/\{bulan\}/gi, NAMA_BULAN[Number(m) - 1] || '')
    .replace(/\{tahun\}/gi, y || '');
}

/* ======================= Jadwal berulang =======================
   Preset bukan sekadar "formulir tersimpan" — ia punya jadwal, seperti
   recurring payment pada umumnya: mulai kapan, berulang tiap berapa
   bulan, dan berakhir kapan (boleh kosong = tanpa batas).

   Yang dilacak BUKAN "sudah dikirim bulan ini", melainkan "tanggal jatuh
   tempo mana yang belum terpenuhi". Bedanya terasa untuk yang tidak
   bulanan: preset 3-bulanan tidak boleh dianggap terlambat di bulan-bulan
   antaranya. Tiap kiriman menyimpan `periode` = tanggal jatuh tempo yang
   ia penuhi, jadi mengirim lebih awal atau terlambat tetap terhitung
   benar. */
const INTERVAL = [
  { bulan: 1, label: 'Tiap bulan' },
  { bulan: 3, label: 'Tiap 3 bulan' },
  { bulan: 6, label: 'Tiap 6 bulan' },
  { bulan: 12, label: 'Tiap tahun' },
];

/* Tambah n bulan ke YYYY-MM-DD. Tanggal yang tidak ada di bulan tujuan
   dimundurkan ke hari terakhir — 31 Januari + 1 bulan = 28/29 Februari,
   bukan melompat ke 3 Maret seperti kalau Date dibiarkan meluap. */
function tambahBulan(ymd, n) {
  const [y, m, d] = String(ymd).split('-').map(Number);
  const totalBulan = (y * 12) + (m - 1) + n;
  const yBaru = Math.floor(totalBulan / 12);
  const mBaru = (totalBulan % 12) + 1;
  const hariMaks = new Date(Date.UTC(yBaru, mBaru, 0)).getUTCDate();
  return `${yBaru}-${String(mBaru).padStart(2, '0')}-${String(Math.min(d, hariMaks)).padStart(2, '0')}`;
}

const NAMA_BULAN_SINGKAT = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
function tanggalPendek(t) {
  const [y, m, d] = String(t || '').split('-');
  return m ? `${Number(d)} ${NAMA_BULAN_SINGKAT[Number(m) - 1]} ${y}` : '—';
}

const selisihHari = (a, b) =>
  Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);

/* Jatuh tempo pertama yang BELUM ada kirimannya. Batas 400 putaran cuma
   pengaman kalau tanggal mulainya diisi jauh di masa lalu. */
function jadwal(p) {
  if (!p.tanggalMulai) return { tanpaJadwal: true };
  const interval = Number(p.intervalBulan) || 1;
  const hariIni = tanggalWita();

  let jt = p.tanggalMulai;
  for (let i = 0; i < 400; i++) {
    if (p.tanggalBerakhir && jt > p.tanggalBerakhir) return { selesai: true };
    const sudah = daftarKirim.find((k) => k.presetId === p.id && k.periode === jt);
    if (!sudah) return { jatuhTempo: jt, selisih: selisihHari(hariIni, jt) };
    jt = tambahBulan(jt, interval);
  }
  return { tanpaJadwal: true };
}

/* ============================ Mulai ============================ */
document.addEventListener('cloud-siap', mulai);

function mulai() {
  const C = window.CLOUD;
  if (!C || !C.aktif || !C.db) return;
  db = C.db; fsMod = C.fsMod;
  refPreset = fsMod.collection(db, 'klinik', KLINIK_ID, 'jurnalPreset');
  refKirim = fsMod.collection(db, 'klinik', KLINIK_ID, 'jurnalKirim');
  refDraft = fsMod.collection(db, 'klinik', KLINIK_ID, 'jurnalDraft');
  refNota = fsMod.collection(db, 'klinik', KLINIK_ID, 'nota');

  q('#btnTambahPreset')?.addEventListener('click', () => bukaEditor(null));
  q('#btnCatatManual')?.addEventListener('click', () => bukaManual());
  q('#btnTelusuriJurnal')?.addEventListener('click', (e) => telusuri(e.currentTarget));
  q('#btnSalinTelusur')?.addEventListener('click', salinHasil);
  q('#jurnalPreset')?.addEventListener('click', klikPreset);
  q('#jurnalDraftList')?.addEventListener('click', klikDraft);
  q('#jurnalRiwayat')?.addEventListener('click', (e) => {
    if (e.target.closest('[data-aksi="semua-bulan"]')) { periodeFilter = null; gambarRiwayat(); }
  });

  daftarTransaksi = transaksiTersimpan() || [];
  if (!periodeFilter) periodeFilter = tanggalWita().slice(0, 7);
  pantau();
}

/* Tiga langganan realtime (preset, kirim, draft) — layar ikut berubah
   sendiri kalau ada yang berubah dari perangkat lain, atau dari draft
   baru yang baru saja dibuat bot Telegram.

   Batas kirim dinaikkan dari yang semula 30: dengan Riwayat sekarang
   difilter per bulan (lihat periodeFilter), 30 dokumen TERBARU bisa saja
   sudah tidak menyentuh bulan yang sedang dilihat sama sekali kalau
   preset-nya jarang dikirim. jadwal() di atas juga menelusuri daftarKirim
   untuk tiap preset, jadi daftarnya perlu cukup panjang supaya jatuh
   tempo lama tidak salah dikira "belum pernah dikirim". */
function pantau() {
  fsMod.onSnapshot(refPreset, (snap) => {
    daftarPreset = snap.docs.map((d) => Object.assign({ id: d.id }, d.data()));
    daftarPreset.sort((a, b) => (a.nama || '').localeCompare(b.nama || ''));
    gambarPreset();
  }, (e) => {
    console.error('preset:', e);
    q('#jurnalPreset').innerHTML = '<p class="muted">Gagal memuat preset.</p>';
  });

  fsMod.onSnapshot(fsMod.query(refKirim, fsMod.orderBy('waktu', 'desc'), fsMod.limit(500)), (snap) => {
    daftarKirim = snap.docs.map((d) => Object.assign({ id: d.id }, d.data()));
    gambarPreset();
    gambarRiwayat();
  }, (e) => console.error('riwayat jurnal:', e));

  fsMod.onSnapshot(fsMod.query(refDraft, fsMod.orderBy('dibuat', 'desc')), (snap) => {
    daftarDraft = snap.docs.map((d) => Object.assign({ id: d.id }, d.data()));
    gambarDraft();
  }, (e) => console.error('draft jurnal:', e));
}

/* ============================ Draft dari Nota ============================
   Sejak tab Nota dihapus, Telegram satu-satunya jalan nota masuk — dan
   SETIAP nota dari sana langsung jadi draft di sini (lihat buatDraftJurnal
   di functions/api/telegram.js), tidak perlu ditandai apa-apa dulu. Bot
   bahkan sudah menanyakan cabang & kode transaksinya lewat tombol chat;
   yang tersisa untuk diisi di sini biasanya cuma baris ledger & nominal.

   Kartu di sini murni ANTREAN KERJA, bukan riwayat: begitu dikirim atau
   dibuang, dokumennya hilang dari koleksi jurnalDraft. */
function gambarDraft() {
  const kartu = q('#cardDraftJurnal');
  const wadah = q('#jurnalDraftList');
  if (!kartu || !wadah) return;
  kartu.hidden = daftarDraft.length === 0;
  if (!daftarDraft.length) return;

  wadah.innerHTML = '<div class="jurnal-grid">' + daftarDraft.map((dr) => {
    const s = dr.sumberNota || {};
    return `
      <div class="jurnal-kartu jurnal-kartu-draft" data-id="${esc(dr.id)}">
        <h3>${esc(s.toko || dr.nama || 'Nota')}</h3>
        <small class="muted">${esc(s.kategori || 'Tanpa kategori')} · ${esc(tanggalPendek(s.tanggal || dr.tanggal))}</small>
        <span class="jurnal-nominal">${rp(s.total)}</span>
        ${s.catatan ? `<small class="muted">${esc(s.catatan)}</small>` : ''}
        <div class="jurnal-aksi">
          <button class="btn" data-aksi="isi" type="button">Isi &amp; Kirim</button>
          ${dr.notaId ? '<button class="btn ghost" data-aksi="lihat-foto" type="button">📷</button>' : ''}
          <button class="btn ghost" data-aksi="buang" type="button">Buang</button>
        </div>
      </div>`;
  }).join('') + '</div>';
}

function klikDraft(e) {
  const tombol = e.target.closest('button[data-aksi]');
  if (!tombol) return;
  const id = tombol.closest('.jurnal-kartu')?.dataset.id;
  const draft = daftarDraft.find((x) => x.id === id);
  if (!draft) return;
  if (tombol.dataset.aksi === 'isi') bukaDraftEditor(draft);
  else if (tombol.dataset.aksi === 'lihat-foto') lihatFotoNota(draft.notaId, tombol);
  else buangDraft(draft);
}

async function buangDraft(draft) {
  if (!confirm('Buang draft ini? Nota aslinya tidak ikut terhapus — hanya draft jurnalnya.')) return;
  try {
    await fsMod.deleteDoc(fsMod.doc(refDraft, draft.id));
  } catch (e) { alert('Gagal membuang draft: ' + e.message); }
}

/* Foto nota diambil ON-DEMAND dari dokumen nota-nya sendiri, bukan
   disalin ke jurnalDraft/jurnalKirim — sekali diminta baru diunduh,
   supaya daftar kartu tidak perlu memuat puluhan foto sekaligus.

   Jendela baru dibuka SEBELUM permintaan async dimulai (bukan sesudah)
   supaya tidak diblokir pop-up blocker — sebagian browser hanya
   mengizinkan window.open() kalau dipanggil langsung dari klik pengguna,
   bukan dari dalam .then()/await yang menyusul. */
async function lihatFotoNota(notaId, tombol) {
  if (!notaId || !refNota) return;
  const w = window.open('', '_blank');
  const semula = tombol.textContent;
  tombol.disabled = true; tombol.textContent = '…';
  try {
    const snap = await fsMod.getDoc(fsMod.doc(refNota, notaId));
    const foto = snap.exists() && snap.data().foto;
    if (!foto) {
      if (w) w.close();
      alert('Foto tidak tersimpan untuk nota ini.');
      return;
    }
    // "foto" tersimpan sebagai data URL utuh ("data:image/jpeg;base64,…").
    // Diubah dulu jadi Blob supaya bisa dibuka lewat blob: URL — beberapa
    // browser menolak menavigasi tab baru langsung ke data: URL.
    const [meta, b64] = String(foto).split(',');
    const mime = (meta.match(/data:([^;]+)/) || [])[1] || 'image/jpeg';
    const biner = atob(b64 || '');
    const bytes = new Uint8Array(biner.length);
    for (let i = 0; i < biner.length; i++) bytes[i] = biner.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
    if (w) w.location.href = url;
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (e) {
    if (w) w.close();
    alert('Gagal mengambil foto: ' + e.message);
  } finally {
    tombol.disabled = false; tombol.textContent = semula;
  }
}

/* Sama persis dengan bukaManual() (editor baris + kirim langsung), bedanya
   dialog ini SUDAH TAHU nota asalnya: nama/tanggal terisi dari situ,
   ringkasan nota ditampilkan sebagai pengingat (dengan tombol untuk
   melihat fotonya — diambil dari dokumen nota sendiri, tidak disalin ke
   draft, supaya tidak menggandakan penyimpanan), dan setelah terkirim
   draft-nya dihapus + nota asal ditandai `jurnalWaktu` supaya kelihatan
   pengeluaran ini sudah tercatat di intajo. */
function bukaDraftEditor(draft) {
  bufferBaris = draft.baris || [];
  const s = draft.sumberNota || {};

  const pilihanTransaksi = daftarTransaksi.length
    ? `<select name="transaksi" required>
         <option value="">— pilih —</option>
         ${daftarTransaksi.map((t) =>
           `<option value="${esc(t.value)}"${t.value === draft.transaksi ? ' selected' : ''}>${esc(t.label)}</option>`).join('')}
       </select>`
    : `<p class="muted">Daftar transaksi belum dimuat. Buka salah satu preset dan tekan
        "Muat daftar dari intajo" dulu, lalu buka draft ini lagi.</p>`;

  const d = bukaDialog('Isi & kirim draft', `
    <div class="jurnal-draft-sumber">
      <p class="muted">Dari nota: <strong>${esc(s.toko || '—')}</strong> ·
        ${esc(tanggalPendek(s.tanggal))} · ${rp(s.total)} · ${esc(s.kategori || '—')}
        ${s.metode ? ' · ' + esc(s.metode) : ''}
        ${draft.notaId ? ' · <button class="btn ghost btn-kecil" type="button" data-aksi="lihat-foto">📷 Lihat foto</button>' : ''}</p>
      ${s.catatan ? `<p class="muted">${esc(s.catatan)}</p>` : ''}
    </div>
    <form class="jurnal-form" id="formDraft">
      <label><span>Catatan (untuk Anda sendiri)</span>
        <input name="nama" value="${esc(draft.nama || s.toko || '')}"></label>

      <label><span>Transaksi di intajo</span>${pilihanTransaksi}</label>
      <p class="muted" style="margin:-6px 0 10px;font-size:.76rem">
        Ledger debit &amp; kredit ikut apa yang sudah Anda atur di Transaction List intajo.
        <button class="btn ghost btn-kecil" type="button" data-aksi="muat-transaksi">${daftarTransaksi.length ? 'Muat ulang daftar' : 'Muat daftar dari intajo'}</button>
        <span id="pesanTransaksi"></span></p>
      <div id="jurnalBaris" class="jurnal-ledger"><p class="muted">Pilih transaksi dulu.</p></div>

      <label><span>Cabang</span>
        <select name="cabang">
          ${Object.entries(CABANG).map(([k, v]) =>
            `<option value="${k}"${(draft.cabang || 'manado') === k ? ' selected' : ''}>${esc(v)}</option>`).join('')}
        </select></label>

      <label><span>Tanggal jurnal</span>
        <input name="tanggal" type="date" required value="${esc(draft.tanggal || s.tanggal || tanggalWita())}"></label>

      <button class="btn" type="submit">Kirim jurnal</button>
      <p id="kirimPesan" class="muted"></p>
    </form>`);

  q('[data-aksi="lihat-foto"]', d)?.addEventListener('click', (e) => lihatFotoNota(draft.notaId, e.currentTarget));

  const selTransaksi = q('[name="transaksi"]', d);
  if (selTransaksi) {
    selTransaksi.addEventListener('change', () => muatLedger(d));
    q('[name="cabang"]', d)?.addEventListener('change', () => muatLedger(d));
    pasangPemicuBaris(d);
    if (selTransaksi.value) muatLedger(d);
  }

  q('[data-aksi="muat-transaksi"]', d)?.addEventListener('click', async (e) => {
    const tombol = e.currentTarget, pesan = q('#pesanTransaksi', d);
    const cabang = q('[name="cabang"]', d)?.value || 'manado';
    tombol.disabled = true; pesan.textContent = ' Mengambil dari intajo…';
    try {
      await muatTransaksi(cabang);
      // Simpan isian yang sempat diketik, gambar ulang dialog yang sama
      // dengan draft yang sama supaya konteks nota-nya tidak hilang.
      const kini = Object.fromEntries(new FormData(q('#formDraft', d)));
      bukaDraftEditor(Object.assign({}, draft, {
        nama: kini.nama, cabang: kini.cabang, tanggal: kini.tanggal,
      }));
    } catch (err) {
      pesan.textContent = ' Gagal: ' + err.message;
      tombol.disabled = false;
    }
  });

  q('#formDraft', d).addEventListener('submit', async (e) => {
    e.preventDefault();
    const kirimBaris = bacaBaris(d);
    if (!kirimBaris.length) return alert('Pilih transaksi dulu, lalu isi baris debit/kreditnya.');

    const tombol = q('button[type="submit"]', e.target);
    const pesan = q('#kirimPesan', e.target);
    const f = new FormData(e.target);
    const nama = (f.get('nama') || '').trim() || s.toko || 'Manual';
    const cabang = f.get('cabang') || 'manado';
    const tgl = f.get('tanggal');
    const transaksi = f.get('transaksi');

    const jml = (sisi) => kirimBaris.filter((x) => x.bal === sisi).reduce((t, x) => t + x.nom, 0);
    const total = jml('D');
    if (total <= 0 || jml('D') !== jml('C')) {
      return alert('Debit dan kredit harus sama, dan lebih dari nol.');
    }
    if (!confirm(`Kirim jurnal ${transaksi.split('|')[0]} sebesar ${rp(total)} ke intajo (${CABANG[cabang]})?\n\nJurnal tidak mudah dihapus di intajo.`)) return;

    const auth = window.CLOUD && window.CLOUD.auth;
    if (!auth || !auth.currentUser) return alert('Masuk dulu sebagai pemilik.');

    tombol.disabled = true; tombol.textContent = 'Mengirim…';
    pesan.textContent = '';
    try {
      const idToken = await auth.currentUser.getIdToken();
      const res = await fetch('/api/jurnal-buat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken, cabang, transaksi, tanggal: tgl, baris: kirimBaris }),
      });
      const jj = await res.json().catch(() => ({}));
      if (!res.ok || !jj.ok) throw new Error(jj.error || 'Gagal (' + res.status + ')');

      await fsMod.addDoc(refKirim, {
        presetId: null, notaId: draft.notaId || null, nama, kode: transaksi.split('|')[0], cabang,
        periode: null, tanggal: tgl, nominal: total, baris: kirimBaris,
        nomor: jj.nomor || '', waktu: Date.now(),
      });
      // Draft selesai tugasnya — dihapus supaya tidak menumpuk sebagai
      // pekerjaan yang kelihatannya masih menunggu.
      await fsMod.deleteDoc(fsMod.doc(refDraft, draft.id));
      // Penanda di nota asal bersifat pelengkap: kalau gagal (mis. nota
      // sudah dihapus duluan), jurnal yang sudah terkirim TIDAK dibatalkan
      // — makanya ini ditangkap terpisah, bukan menggagalkan alur utama.
      if (draft.notaId) {
        fsMod.updateDoc(fsMod.doc(refNota, draft.notaId), {
          jurnalWaktu: Date.now(), jurnalNomor: jj.nomor || '',
        }).catch((err) => console.warn('tandai nota sudah dijurnal:', err));
      }
      tutupDialog();
      alert('Jurnal terkirim ke intajo.');
    } catch (err) {
      console.error('kirim draft jurnal:', err);
      pesan.textContent = 'Gagal: ' + err.message;
      tombol.disabled = false; tombol.textContent = 'Kirim jurnal';
    }
  });
}

/* ============================ Daftar preset ============================ */

/* Lencana status di kartu — bagian yang intajo tidak bisa beritahu, dan
   alasan utama preset disimpan di sini. */
function statusJadwal(p) {
  const j = jadwal(p);
  if (j.selesai) return { teks: 'Selesai — sudah lewat masa berlakunya', kelas: 'muted' };
  if (j.tanpaJadwal) return { teks: 'Tanpa jadwal', kelas: 'muted' };
  if (j.selisih < 0) return { teks: `Terlambat ${-j.selisih} hari — jatuh tempo ${tanggalPendek(j.jatuhTempo)}`, kelas: 'telat' };
  if (j.selisih === 0) return { teks: `Jatuh tempo hari ini`, kelas: 'telat' };
  return { teks: `Jatuh tempo ${tanggalPendek(j.jatuhTempo)} — ${j.selisih} hari lagi`, kelas: 'muted' };
}

/* Ambang 5 hari: masih lama → hijau, sudah dekat (termasuk yang sudah
   lewat) → merah. Preset yang selesai atau tanpa jadwal tidak diwarnai —
   warnanya soal "kapan harus dikirim", dan keduanya tidak punya jadwal
   yang perlu dikejar. */
const AMBANG_MENDEKATI_HARI = 5;
function warnaKartu(j) {
  if (j.selesai || j.tanpaJadwal) return '';
  return j.selisih <= AMBANG_MENDEKATI_HARI ? ' jurnal-kartu-merah' : ' jurnal-kartu-hijau';
}

function gambarPreset() {
  const wadah = q('#jurnalPreset');
  if (!wadah) return;
  if (!daftarPreset.length) {
    wadah.innerHTML = `<p class="muted">Belum ada preset. Buat satu untuk pengeluaran yang berulang —
      mis. sewa klinik tiap bulan — lalu cukup satu ketukan tiap jatuh tempo.</p>`;
    return;
  }

  wadah.innerHTML = '<div class="jurnal-grid">' + daftarPreset.map((p) => {
    const st = statusJadwal(p);
    const j = jadwal(p);
    return `
      <div class="jurnal-kartu${warnaKartu(j)}" data-id="${esc(p.id)}">
        <h3>${esc(p.nama || '(tanpa nama)')}</h3>
        <small class="muted">${esc(p.kode || '?')} · ${esc(CABANG[p.cabang] || p.cabang || '?')}
          · ${esc((INTERVAL.find((i) => i.bulan === Number(p.intervalBulan)) || {}).label || 'sekali')}</small>
        <span class="jurnal-nominal">${rp(p.nominal)}</span>
        <small class="jurnal-status ${st.kelas}">${esc(st.teks)}</small>
        <div class="jurnal-aksi">
          <button class="btn" data-aksi="kirim" type="button"${j.selesai ? ' disabled' : ''}>Kirim</button>
          <button class="btn ghost" data-aksi="sunting" type="button">Ubah</button>
        </div>
      </div>`;
  }).join('') + '</div>';
}

function klikPreset(e) {
  const tombol = e.target.closest('button[data-aksi]');
  if (!tombol) return;
  const id = tombol.closest('.jurnal-kartu')?.dataset.id;
  const preset = daftarPreset.find((p) => p.id === id);
  if (!preset) return;
  if (tombol.dataset.aksi === 'kirim') bukaKirim(preset);
  else bukaEditor(preset);
}

function gambarRiwayat() {
  const wadah = q('#jurnalRiwayat');
  const ket = q('#jurnalRiwayatKet');
  if (!wadah) return;

  const terfilter = periodeFilter
    ? daftarKirim.filter((k) => String(k.tanggal || '').slice(0, 7) === periodeFilter)
    : daftarKirim;

  if (ket) {
    ket.innerHTML = periodeFilter
      ? `Menampilkan kiriman <strong>${esc(labelPeriodeBulan(periodeFilter))}</strong> —
         disinkronkan dengan bulan/tahun di atas.
         <button class="btn ghost btn-kecil" type="button" data-aksi="semua-bulan">Lihat semua bulan</button>`
      : 'Menampilkan SEMUA bulan. Yang tercatat di sini hanya kiriman dari aplikasi ini — pembukuan sungguhan tetap di intajo.';
  }

  if (!terfilter.length) {
    wadah.innerHTML = periodeFilter
      ? `<p class="muted">Belum ada jurnal yang dikirim untuk ${esc(labelPeriodeBulan(periodeFilter))}.</p>`
      : '<p class="muted">Belum ada jurnal yang dikirim dari aplikasi ini.</p>';
    return;
  }
  wadah.innerHTML = `<table class="tbl"><thead><tr>
      <th>Tanggal</th><th>Preset</th><th>Kode</th><th>Cabang</th><th>Nominal</th><th>No. jurnal</th><th></th>
    </tr></thead><tbody>` + terfilter.map((k, i) => `
      <tr data-i="${i}">
        <td>${esc(k.tanggal || '')}</td>
        <td>${esc(k.nama || '')}</td>
        <td>${esc(k.kode || '')}</td>
        <td>${esc(CABANG[k.cabang] || k.cabang || '')}</td>
        <td>${rp(k.nominal)}</td>
        <td>${esc(k.nomor || '—')}</td>
        <td>${k.notaId ? '<button class="btn ghost btn-kecil" type="button" data-aksi="lihat-foto">📷</button>' : ''}</td>
      </tr>`).join('') + '</tbody></table>';

  wadah.querySelectorAll('button[data-aksi="lihat-foto"]').forEach((btn) => {
    const i = Number(btn.closest('tr').dataset.i);
    btn.addEventListener('click', () => lihatFotoNota(terfilter[i].notaId, btn));
  });
}

/* Dipanggil app.js tiap kali dropdown bulan/tahun di kop aplikasi berubah,
   atau saat tab Jurnal dibuka — lihat render() di app.js. */
window.Jurnal = {
  segarkan(periodeBaru) {
    if (periodeBaru) periodeFilter = periodeBaru;
    gambarRiwayat();
  },
};

/* ============================ Popup ============================ */
function tutupDialog() {
  const d = q('#jurnalDialog');
  d.hidden = true; d.innerHTML = '';
}

function bukaDialog(judul, isiHtml) {
  const d = q('#jurnalDialog');
  d.innerHTML = `
    <div class="neraca-dialog-card jurnal-dialog-card">
      <div class="card-head">
        <h2>${esc(judul)}</h2>
        <button class="btn ghost" data-aksi="tutup" type="button">Tutup</button>
      </div>
      ${isiHtml}
    </div>`;
  d.hidden = false;
  d.onclick = (e) => {
    if (e.target === d || e.target.closest('[data-aksi="tutup"]')) tutupDialog();
  };
  return d;
}

/* ------------- Daftar Transaction List dari intajo -------------
   Supaya kode transaksi bisa DIPILIH, bukan diketik dari ingatan.
   Disimpan di localStorage sesudah sekali berhasil: daftarnya jarang
   berubah, dan menariknya butuh beberapa detik karena Worker harus login
   ke intajo dulu. Tombol "Muat ulang" ada di editor untuk menyegarkan
   setelah Anda merapikan Transaction List di intajo. */
const KUNCI_SIMPAN = 'lovepet-jurnal-transaksi';

function transaksiTersimpan() {
  try { return JSON.parse(localStorage.getItem(KUNCI_SIMPAN) || 'null'); } catch { return null; }
}

async function muatTransaksi(cabang) {
  const auth = window.CLOUD && window.CLOUD.auth;
  if (!auth || !auth.currentUser) throw new Error('Masuk dulu sebagai pemilik.');
  const idToken = await auth.currentUser.getIdToken();
  const res = await fetch('/api/jurnal-transaksi', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken, cabang }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.ok) throw new Error(j.error || 'Gagal (' + res.status + ')');
  daftarTransaksi = j.transaksi || [];
  try { localStorage.setItem(KUNCI_SIMPAN, JSON.stringify(daftarTransaksi)); } catch { /* kuota penuh — tidak fatal */ }
  return daftarTransaksi;
}

/* ==================== Baris jurnal di preset ====================
   Preset menyimpan SELURUH barisnya, bukan cuma kode transaksi. Sebabnya
   intajo punya tiga macam transaksi (lihat intajoJurnal.js): ada yang
   ledger debit/kreditnya cuma satu pilihan, ada yang harus dipilih, dan
   ada yang barisnya bebas ditambah. Dengan menyimpan barisnya, ketiganya
   tertangani dengan satu bentuk yang sama — Anda menentukannya sekali
   saat membuat preset, lalu tiap jatuh tempo tinggal diputar ulang. */
let ledgerTerakhir = null;   // { tipe, bebasTambahBaris, debit:[], kredit:[] }

async function muatLedger(d) {
  const wadah = q('#jurnalBaris', d);
  const transaksi = q('[name="transaksi"]', d)?.value;
  const cabang = q('[name="cabang"]', d)?.value || 'manado';
  if (!wadah) return;
  if (!transaksi) { wadah.innerHTML = '<p class="muted">Pilih transaksi dulu.</p>'; ledgerTerakhir = null; return; }

  wadah.innerHTML = '<p class="muted">Mengambil pilihan ledger dari intajo…</p>';
  try {
    const auth = window.CLOUD && window.CLOUD.auth;
    const idToken = await auth.currentUser.getIdToken();
    const res = await fetch('/api/jurnal-ledger', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken, cabang, transaksi }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.ok) throw new Error(j.error || 'Gagal (' + res.status + ')');
    ledgerTerakhir = j;
    gambarBaris(d, barisAwal(j, d));
  } catch (e) {
    ledgerTerakhir = null;
    wadah.innerHTML = `<p class="muted">Gagal mengambil ledger: ${esc(e.message)}</p>`;
  }
}

/* Baris pembuka. Untuk transaksi bukan-"M", intajo sendiri selalu membuat
   tepat satu baris Debit dan satu Credit — ditiru di sini. Baris preset
   yang sudah tersimpan dipakai kalau ledgernya masih ada di daftar. */
function barisAwal(led, d) {
  const tersimpan = (bufferBaris || []).filter((b) =>
    (b.bal === 'D' ? led.debit : led.kredit).some((o) => o.id === b.led));
  if (tersimpan.length >= 2) return tersimpan;
  return [
    { bal: 'D', led: led.debit[0]?.id || '', des: '', nom: 0 },
    { bal: 'C', led: led.kredit[0]?.id || '', des: '', nom: 0 },
  ];
}

let bufferBaris = [];   // baris yang sedang disunting di editor

function gambarBaris(d, baris) {
  bufferBaris = baris;
  const led = ledgerTerakhir;
  const wadah = q('#jurnalBaris', d);
  if (!wadah || !led) return;

  const opsi = (sisi, terpilih) => (sisi === 'D' ? led.debit : led.kredit)
    .map((o) => `<option value="${esc(o.id)}"${o.id === terpilih ? ' selected' : ''}>${esc(o.nama)}</option>`).join('')
    || '<option value="">(tidak ada pilihan)</option>';

  wadah.innerHTML = `
    <table class="tbl jurnal-baris-tbl">
      <colgroup><col class="col-bal"><col><col><col class="col-nom"><col class="col-x"></colgroup>
      <thead><tr>
      <th>Bal</th><th>Ledger</th><th>Deskripsi</th><th>Nominal</th><th></th>
    </tr></thead><tbody>
      ${baris.map((b, i) => `
        <tr data-i="${i}">
          <td>${led.bebasTambahBaris
            ? `<select data-f="bal">
                 <option value="D"${b.bal === 'D' ? ' selected' : ''}>Debit</option>
                 <option value="C"${b.bal === 'C' ? ' selected' : ''}>Credit</option>
               </select>`
            : `<span>${b.bal === 'D' ? 'Debit' : 'Credit'}</span>`}</td>
          <td><select data-f="led">${opsi(b.bal, b.led)}</select></td>
          <td><input data-f="des" value="${esc(b.des || '')}" placeholder="Keterangan baris"></td>
          <td><input data-f="nom" type="number" min="0" step="1" value="${Number(b.nom) || 0}"></td>
          <td>${led.bebasTambahBaris && baris.length > 2
            ? '<button type="button" class="btn ghost btn-kecil" data-aksi="hapus-baris">×</button>' : ''}</td>
        </tr>`).join('')}
    </tbody></table>
    ${led.bebasTambahBaris
      ? '<button type="button" class="btn ghost btn-kecil" data-aksi="tambah-baris">+ Baris</button>' : ''}
    <p class="muted" id="jurnalSelisih"></p>`;

  hitungSelisih(d);
}

function bacaBaris(d) {
  return [...q('#jurnalBaris', d).querySelectorAll('tbody tr')].map((tr) => ({
    bal: q('[data-f="bal"]', tr)?.value
      || (tr.querySelector('td span')?.textContent.trim().startsWith('Debit') ? 'D' : 'C'),
    led: q('[data-f="led"]', tr)?.value || '',
    des: q('[data-f="des"]', tr)?.value || '',
    nom: Number(q('[data-f="nom"]', tr)?.value) || 0,
  }));
}

/* intajo menolak jurnal yang debit dan kreditnya tidak sama; selisihnya
   ditampilkan di sini supaya ketahuan sebelum tombol Kirim ditekan. */
function hitungSelisih(d) {
  const p = q('#jurnalSelisih', d);
  if (!p) return;
  const baris = bacaBaris(d);
  const jml = (s) => baris.filter((b) => b.bal === s).reduce((t, b) => t + b.nom, 0);
  const selisih = jml('D') - jml('C');
  p.textContent = selisih === 0
    ? `Debit ${rp(jml('D'))} = Kredit ${rp(jml('C'))} — seimbang.`
    : `Selisih ${rp(Math.abs(selisih))} — intajo akan menolak.`;
  p.className = selisih === 0 ? 'muted' : 'jurnal-status telat';
}

function pasangPemicuBaris(d) {
  const wadah = q('#jurnalBaris', d);
  wadah.addEventListener('input', () => hitungSelisih(d));
  wadah.addEventListener('change', (e) => {
    // Ganti sisi D/C berarti daftar ledgernya ikut berganti.
    if (e.target.matches('[data-f="bal"]')) gambarBaris(d, bacaBaris(d));
    else hitungSelisih(d);
  });
  wadah.addEventListener('click', (e) => {
    const t = e.target.closest('[data-aksi]');
    if (!t) return;
    const baris = bacaBaris(d);
    if (t.dataset.aksi === 'tambah-baris') {
      baris.push({ bal: 'D', led: ledgerTerakhir?.debit[0]?.id || '', des: '', nom: 0 });
    } else if (t.dataset.aksi === 'hapus-baris') {
      baris.splice(Number(t.closest('tr').dataset.i), 1);
    } else return;
    gambarBaris(d, baris);
  });
}

/* ---------------------- Editor preset ---------------------- */
function bukaEditor(preset) {
  bufferBaris = (preset && preset.baris) || [];
  const p = preset || {
    nama: '', kode: '', cabang: 'manado', nominal: 0, deskripsi: '',
    intervalBulan: 1, tanggalMulai: tanggalWita(), tanggalBerakhir: '',
  };

  /* Kalau daftar transaksi sudah ada → dropdown. Kalau belum → tetap
     boleh diketik manual, supaya preset masih bisa dibuat walau intajo
     sedang tidak bisa dihubungi. */
  /* Yang disimpan adalah value PENUH dari intajo ("KEB|S|<uuid>"), bukan
     cuma "KEB" — uuid di dalamnya yang dipakai untuk mengambil ledger dan
     nanti untuk mengirim jurnal. Kodenya tetap disimpan terpisah supaya
     kartu preset tetap terbaca walau daftar transaksi belum dimuat. */
  const pilihanKode = daftarTransaksi.length
    ? `<select name="transaksi" required>
         <option value="">— pilih —</option>
         ${daftarTransaksi.map((t) =>
           `<option value="${esc(t.value)}"${t.kode === p.kode ? ' selected' : ''}>${esc(t.label)}</option>`).join('')}
       </select>`
    : `<input name="kode" required value="${esc(p.kode)}" placeholder="SEW">`;

  const d = bukaDialog(preset ? 'Ubah preset' : 'Preset baru', `
    <form class="jurnal-form" id="formPreset">
      <label><span>Nama (untuk Anda sendiri)</span>
        <input name="nama" required value="${esc(p.nama)}" placeholder="Sewa klinik Tomohon"></label>

      <label><span>Transaksi di intajo</span>${pilihanKode}</label>
      <p class="muted" style="margin:-6px 0 10px;font-size:.76rem">
        Ledger debit &amp; kredit ikut apa yang sudah Anda atur di Transaction List intajo — aplikasi ini tidak menentukannya.
        <button class="btn ghost btn-kecil" type="button" data-aksi="muat-transaksi">${daftarTransaksi.length ? 'Muat ulang daftar' : 'Muat daftar dari intajo'}</button>
        <span id="pesanTransaksi"></span></p>
      <div id="jurnalBaris" class="jurnal-ledger"><p class="muted">Pilih transaksi dulu.</p></div>

      <label><span>Cabang</span>
        <select name="cabang">
          ${Object.entries(CABANG).map(([k, v]) =>
            `<option value="${k}"${p.cabang === k ? ' selected' : ''}>${esc(v)}</option>`).join('')}
        </select></label>

      <label><span>Nominal</span>
        <input name="nominal" type="number" min="0" step="1" required value="${Number(p.nominal) || 0}"></label>

      <label><span>Deskripsi</span>
        <input name="deskripsi" value="${esc(p.deskripsi)}" placeholder="Sewa bulan {bulan} {tahun}"></label>
      <p class="muted" style="margin:-6px 0 12px;font-size:.76rem">
        <code>{bulan}</code> dan <code>{tahun}</code> diisi otomatis sesuai tanggal jurnal.</p>

      <fieldset class="jurnal-jadwal">
        <legend>Jadwal berulang</legend>
        <label><span>Jatuh tempo pertama</span>
          <input name="tanggalMulai" type="date" required value="${esc(p.tanggalMulai || tanggalWita())}"></label>
        <label><span>Berulang</span>
          <select name="intervalBulan">
            ${INTERVAL.map((i) =>
              `<option value="${i.bulan}"${Number(p.intervalBulan) === i.bulan ? ' selected' : ''}>${i.label}</option>`).join('')}
          </select></label>
        <label><span>Berakhir</span>
          <input name="tanggalBerakhir" type="date" value="${esc(p.tanggalBerakhir || '')}"></label>
        <p class="muted" style="font-size:.76rem;margin:0">Kosongkan kalau berjalan terus tanpa batas.</p>
      </fieldset>

      <div class="jurnal-aksi">
        <button class="btn" type="submit">Simpan</button>
        ${preset ? '<button class="btn ghost" type="button" data-aksi="hapus">Hapus</button>' : ''}
      </div>
    </form>`);

  const selTransaksi = q('[name="transaksi"]', d);
  if (selTransaksi) {
    selTransaksi.addEventListener('change', () => muatLedger(d));
    /* Cabang ikut memicu: daftar transaksi intajo bisa berbeda per cabang,
       jadi kode yang sama belum tentu tersedia di cabang lain. */
    q('[name="cabang"]', d)?.addEventListener('change', () => muatLedger(d));
    pasangPemicuBaris(d);
    if (selTransaksi.value) muatLedger(d);
  }

  q('[data-aksi="muat-transaksi"]', d).addEventListener('click', async (e) => {
    const tombol = e.currentTarget, pesan = q('#pesanTransaksi', d);
    const cabang = q('[name="cabang"]', d).value;
    tombol.disabled = true; pesan.textContent = ' Mengambil dari intajo…';
    try {
      await muatTransaksi(cabang);
      // Gambar ulang editor supaya field kode berubah jadi dropdown,
      // dengan isian yang sedang diketik ikut terbawa.
      const kini = Object.fromEntries(new FormData(q('#formPreset', d)));
      bukaEditor(Object.assign({}, p, kini, preset ? { id: preset.id } : {}));
    } catch (err) {
      pesan.textContent = ' Gagal: ' + err.message;
      tombol.disabled = false;
    }
  });

  q('#formPreset', d).addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const isian = {
      nama: (f.get('nama') || '').trim(),
      transaksi: (f.get('transaksi') || p.transaksi || '').trim(),
      kode: ((f.get('transaksi') || '').split('|')[0] || f.get('kode') || '').trim().toUpperCase(),
      cabang: f.get('cabang') || 'manado',
      baris: q('#jurnalBaris', d) && ledgerTerakhir ? bacaBaris(d) : (p.baris || []),
      nominal: Number(f.get('nominal')) || 0,
      deskripsi: (f.get('deskripsi') || '').trim(),
      intervalBulan: Number(f.get('intervalBulan')) || 1,
      tanggalMulai: f.get('tanggalMulai') || '',
      tanggalBerakhir: f.get('tanggalBerakhir') || '',
      diubah: Date.now(),
    };
    if (isian.tanggalBerakhir && isian.tanggalBerakhir < isian.tanggalMulai) {
      return alert('Tanggal berakhir tidak boleh sebelum jatuh tempo pertama.');
    }
    try {
      if (preset) await fsMod.updateDoc(fsMod.doc(refPreset, preset.id), isian);
      else await fsMod.addDoc(refPreset, Object.assign(isian, { dibuat: Date.now() }));
      tutupDialog();
    } catch (err) {
      console.error('simpan preset:', err);
      alert('Gagal menyimpan: ' + err.message);
    }
  });

  q('[data-aksi="hapus"]', d)?.addEventListener('click', async () => {
    if (!confirm(`Hapus preset "${p.nama}"? Jurnal yang sudah terkirim ke intajo tidak ikut terhapus.`)) return;
    try {
      await fsMod.deleteDoc(fsMod.doc(refPreset, preset.id));
      tutupDialog();
    } catch (err) { alert('Gagal menghapus: ' + err.message); }
  });
}

/* ---------------------- Kirim jurnal ----------------------
   Tetap ada layar konfirmasi meski semuanya sudah terisi: sesudah tombol
   ini, jurnal benar-benar masuk ke pembukuan, dan tidak semudah itu
   dihapus di intajo.

   Barisnya ditampilkan lengkap dan nominalnya bisa disesuaikan — untuk
   cicilan (pokok + bunga) atau tagihan yang berubah tiap bulan, angkanya
   memang jarang persis sama. */
function bukaKirim(preset) {
  const j = jadwal(preset);
  /* Tanggal jurnal default = tanggal JATUH TEMPO, bukan hari ini —
     supaya bebannya jatuh di periode yang benar walau baru sempat
     dikirim beberapa hari kemudian. Masih bisa diubah. */
  const tanggal = j.jatuhTempo || tanggalWita();
  const periode = j.jatuhTempo || '';
  const baris = (preset.baris || []).map((b) => Object.assign({}, b));

  if (!baris.length) {
    return bukaDialog('Belum bisa dikirim', `<p class="muted">Preset ini belum punya baris jurnal.
      Buka <strong>Ubah</strong>, pilih transaksinya, lalu tentukan baris debit &amp; kreditnya.</p>`);
  }

  const d = bukaDialog('Kirim ke intajo', `
    <form class="jurnal-form" id="formKirim">
      <p><strong>${esc(preset.nama)}</strong><br>
        <small class="muted">${esc(preset.kode)} · ${esc(CABANG[preset.cabang] || preset.cabang)}</small></p>
      ${periode ? `<p class="muted">Memenuhi jatuh tempo <strong>${esc(tanggalPendek(periode))}</strong>.</p>`
                : '<p class="muted">Preset ini tanpa jadwal — kiriman tidak dihitung sebagai pemenuhan jatuh tempo.</p>'}
      <label><span>Tanggal jurnal</span>
        <input name="tanggal" type="date" required value="${esc(tanggal)}"></label>

      <table class="tbl jurnal-baris-tbl">
        <colgroup><col class="col-bal"><col><col class="col-nom"></colgroup>
        <thead><tr>
        <th>Bal</th><th>Deskripsi</th><th>Nominal</th>
      </tr></thead><tbody>
        ${baris.map((b, i) => `
          <tr data-i="${i}">
            <td>${b.bal === 'D' ? 'Debit' : 'Credit'}</td>
            <td><input data-f="des" value="${esc(isiPola(b.des, tanggal))}" required></td>
            <td><input data-f="nom" type="number" min="0" step="1" value="${Number(b.nom) || 0}"></td>
          </tr>`).join('')}
      </tbody></table>
      <p class="muted" id="kirimSelisih"></p>

      <button class="btn" type="submit">Kirim jurnal</button>
      <p id="kirimPesan" class="muted"></p>
    </form>`);

  const bacaKirim = () => [...d.querySelectorAll('tbody tr')].map((tr, i) => ({
    bal: baris[i].bal,
    led: baris[i].led,
    des: q('[data-f="des"]', tr).value,
    nom: Number(q('[data-f="nom"]', tr).value) || 0,
  }));

  const segarSelisih = () => {
    const b = bacaKirim();
    const jml = (s2) => b.filter((x) => x.bal === s2).reduce((t, x) => t + x.nom, 0);
    const selisih = jml('D') - jml('C');
    const p = q('#kirimSelisih', d);
    p.textContent = selisih === 0
      ? `Debit ${rp(jml('D'))} = Kredit ${rp(jml('C'))} — seimbang.`
      : `Selisih ${rp(Math.abs(selisih))} — intajo akan menolak.`;
    p.className = selisih === 0 ? 'muted' : 'jurnal-status telat';
  };
  d.addEventListener('input', segarSelisih);
  segarSelisih();

  // Deskripsi ikut disegarkan kalau tanggalnya diganti — {bulan} mengacu
  // ke tanggal jurnal, bukan tanggal hari ini.
  q('[name="tanggal"]', d).addEventListener('change', (e) => {
    d.querySelectorAll('[data-f="des"]').forEach((inp, i) => {
      inp.value = isiPola(baris[i].des, e.target.value);
    });
  });

  q('#formKirim', d).addEventListener('submit', async (e) => {
    e.preventDefault();
    const tombol = q('button[type="submit"]', e.target);
    const pesan = q('#kirimPesan', e.target);
    const tgl = q('[name="tanggal"]', d).value;
    const kirimBaris = bacaKirim();

    const auth = window.CLOUD && window.CLOUD.auth;
    if (!auth || !auth.currentUser) return alert('Masuk dulu sebagai pemilik.');

    const total = kirimBaris.filter((b) => b.bal === 'D').reduce((t, b) => t + b.nom, 0);
    if (!confirm(`Kirim jurnal ${preset.kode} sebesar ${rp(total)} ke intajo (${CABANG[preset.cabang]})?\n\nJurnal tidak mudah dihapus di intajo.`)) return;

    tombol.disabled = true; tombol.textContent = 'Mengirim…';
    pesan.textContent = '';
    try {
      const idToken = await auth.currentUser.getIdToken();
      const res = await fetch('/api/jurnal-buat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idToken, cabang: preset.cabang, transaksi: preset.transaksi,
          tanggal: tgl, baris: kirimBaris,
        }),
      });
      const jj = await res.json().catch(() => ({}));
      if (!res.ok || !jj.ok) throw new Error(jj.error || 'Gagal (' + res.status + ')');

      /* Riwayat ditulis SESUDAH intajo menerima — kalau ditulis lebih dulu,
         kegagalan kirim akan meninggalkan catatan palsu "sudah dikirim",
         dan jatuh tempo itu ikut terlewat diam-diam. */
      await fsMod.addDoc(refKirim, {
        presetId: preset.id, nama: preset.nama, kode: preset.kode, cabang: preset.cabang,
        periode, tanggal: tgl, nominal: total, baris: kirimBaris,
        nomor: jj.nomor || '', waktu: Date.now(),
      });
      tutupDialog();
      alert('Jurnal terkirim ke intajo.');
    } catch (err) {
      console.error('kirim jurnal:', err);
      pesan.textContent = 'Gagal: ' + err.message;
      tombol.disabled = false; tombol.textContent = 'Kirim jurnal';
    }
  });
}

/* ---------------------- Catat jurnal sekali (bukan rutin) ----------------------
   "Jurnal rutin" di atas untuk yang berulang. Untuk yang sekali saja —
   mis. beli tabung oksigen bulan ini — tidak masuk akal dibuatkan
   preset+jadwal yang tidak akan pernah dipakai lagi. Dialog ini memakai
   editor baris yang SAMA (muatLedger/gambarBaris/pasangPemicuBaris) tapi
   kirim langsung tanpa menyimpan preset apa pun; riwayatnya tetap masuk
   ke koleksi yang sama supaya muncul di tabel Riwayat kiriman, dengan
   presetId kosong menandai ia bukan bagian dari jadwal siapa pun. */
function bukaManual() {
  bufferBaris = [];
  const tanggal = tanggalWita();

  const pilihanTransaksi = daftarTransaksi.length
    ? `<select name="transaksi" required>
         <option value="">— pilih —</option>
         ${daftarTransaksi.map((t) => `<option value="${esc(t.value)}">${esc(t.label)}</option>`).join('')}
       </select>`
    : `<p class="muted">Daftar transaksi belum dimuat. Buka salah satu preset dan tekan
        "Muat daftar dari intajo" dulu, lalu coba lagi di sini.</p>`;

  const d = bukaDialog('Catat jurnal sekali', `
    <form class="jurnal-form" id="formManual">
      <label><span>Catatan (untuk Anda sendiri)</span>
        <input name="nama" placeholder="mis. Beli tabung oksigen"></label>

      <label><span>Transaksi di intajo</span>${pilihanTransaksi}</label>
      <p class="muted" style="margin:-6px 0 10px;font-size:.76rem">
        Ledger debit &amp; kredit ikut apa yang sudah Anda atur di Transaction List intajo.
        <button class="btn ghost btn-kecil" type="button" data-aksi="muat-transaksi">${daftarTransaksi.length ? 'Muat ulang daftar' : 'Muat daftar dari intajo'}</button>
        <span id="pesanTransaksi"></span></p>
      <div id="jurnalBaris" class="jurnal-ledger"><p class="muted">Pilih transaksi dulu.</p></div>

      <label><span>Cabang</span>
        <select name="cabang">
          ${Object.entries(CABANG).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}
        </select></label>

      <label><span>Tanggal jurnal</span>
        <input name="tanggal" type="date" required value="${tanggal}"></label>

      <button class="btn" type="submit">Kirim jurnal</button>
      <p id="kirimPesan" class="muted"></p>
    </form>`);

  const selTransaksi = q('[name="transaksi"]', d);
  if (selTransaksi) {
    selTransaksi.addEventListener('change', () => muatLedger(d));
    q('[name="cabang"]', d)?.addEventListener('change', () => muatLedger(d));
    pasangPemicuBaris(d);
  }

  q('[data-aksi="muat-transaksi"]', d)?.addEventListener('click', async (e) => {
    const tombol = e.currentTarget, pesan = q('#pesanTransaksi', d);
    const cabang = q('[name="cabang"]', d)?.value || 'manado';
    tombol.disabled = true; pesan.textContent = ' Mengambil dari intajo…';
    try {
      await muatTransaksi(cabang);
      const kini = Object.fromEntries(new FormData(q('#formManual', d)));
      tutupDialog();
      bukaManual();
      // Isian yang sempat diketik ikut terbawa, kecuali "transaksi" —
      // dropdown-nya baru saja diganti isinya, biar dipilih ulang.
      const d2 = q('#jurnalDialog');
      if (kini.nama) q('[name="nama"]', d2).value = kini.nama;
      if (kini.cabang) q('[name="cabang"]', d2).value = kini.cabang;
      if (kini.tanggal) q('[name="tanggal"]', d2).value = kini.tanggal;
    } catch (err) {
      pesan.textContent = ' Gagal: ' + err.message;
      tombol.disabled = false;
    }
  });

  q('#formManual', d).addEventListener('submit', async (e) => {
    e.preventDefault();
    const kirimBaris = bacaBaris(d);
    // ledgerTerakhir mengacu ke dialog yang TERAKHIR memuat ledger — bisa
    // saja dialog editor lain, bukan dialog ini, kalau pengguna belum
    // pernah memilih transaksi di sini. Baris kosong (belum ada tabel
    // ledger tergambar) yang jadi penanda sesungguhnya, bukan variabel itu.
    if (!kirimBaris.length) return alert('Pilih transaksi dulu, lalu isi baris debit/kreditnya.');

    const tombol = q('button[type="submit"]', e.target);
    const pesan = q('#kirimPesan', e.target);
    const f = new FormData(e.target);
    const nama = (f.get('nama') || '').trim() || 'Manual';
    const cabang = f.get('cabang') || 'manado';
    const tgl = f.get('tanggal');
    const transaksi = f.get('transaksi');

    const jml = (s2) => kirimBaris.filter((x) => x.bal === s2).reduce((t, x) => t + x.nom, 0);
    const total = jml('D');
    if (total <= 0 || jml('D') !== jml('C')) {
      return alert('Debit dan kredit harus sama, dan lebih dari nol.');
    }
    if (!confirm(`Kirim jurnal ${transaksi.split('|')[0]} sebesar ${rp(total)} ke intajo (${CABANG[cabang]})?\n\nJurnal tidak mudah dihapus di intajo.`)) return;

    const auth = window.CLOUD && window.CLOUD.auth;
    if (!auth || !auth.currentUser) return alert('Masuk dulu sebagai pemilik.');

    tombol.disabled = true; tombol.textContent = 'Mengirim…';
    pesan.textContent = '';
    try {
      const idToken = await auth.currentUser.getIdToken();
      const res = await fetch('/api/jurnal-buat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken, cabang, transaksi, tanggal: tgl, baris: kirimBaris }),
      });
      const jj = await res.json().catch(() => ({}));
      if (!res.ok || !jj.ok) throw new Error(jj.error || 'Gagal (' + res.status + ')');

      await fsMod.addDoc(refKirim, {
        presetId: null, nama, kode: transaksi.split('|')[0], cabang,
        periode: null, tanggal: tgl, nominal: total, baris: kirimBaris,
        nomor: jj.nomor || '', waktu: Date.now(),
      });
      tutupDialog();
      alert('Jurnal terkirim ke intajo.');
    } catch (err) {
      console.error('kirim jurnal manual:', err);
      pesan.textContent = 'Gagal: ' + err.message;
      tombol.disabled = false; tombol.textContent = 'Kirim jurnal';
    }
  });
}

/* ==================== Alat bantu: telusuri formulir ====================
   Dipakai sekali untuk mengenali formulir Journal Create intajo (nama
   field + isi Transaction List). Murni GET, tidak mengubah apa pun. */
async function telusuri(tombol) {
  const auth = window.CLOUD && window.CLOUD.auth;
  if (!auth || !auth.currentUser) return alert('Masuk dulu sebagai pemilik.');

  const cabang = q('#jurnalCabang')?.value || 'manado';
  const wadah = q('#jurnalHasil');
  const semula = tombol.textContent;
  tombol.disabled = true; tombol.textContent = 'Menelusuri…';
  wadah.innerHTML = '<p class="muted">Membuka halaman intajo… (bisa belasan detik)</p>';
  try {
    const idToken = await auth.currentUser.getIdToken();
    const res = await fetch('/api/jurnal-telusuri', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken, cabang }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.ok) throw new Error(j.error || 'Gagal (' + res.status + ')');
    telusurTerakhir = j;
    gambarTelusur(j);
    q('#btnSalinTelusur').hidden = false;
  } catch (e) {
    console.error('telusuriJurnal:', e);
    wadah.innerHTML = `<p class="muted">Gagal: ${esc(e.message)}</p>`;
  } finally {
    tombol.disabled = false; tombol.textContent = semula;
  }
}

/* Ditampilkan apa adanya — ini alat bedah, bukan laporan. Yang paling
   dicari: select dengan pilihan terbanyak (kandidat Transaction List). */
function gambarTelusur(j) {
  const wadah = q('#jurnalHasil');
  const halaman = j.halaman || [];
  if (!halaman.length) {
    wadah.innerHTML = `<p class="muted">Tidak ada halaman berformulir yang ketemu untuk cabang ${esc(j.cabang)}.</p>
      <p class="muted">Halaman yang sempat dibuka: ${esc((j.ditemukan || j.diperiksa || []).join(', ')) || '(tidak ada)'}</p>`;
    return;
  }
  wadah.innerHTML = `<p class="muted">Cabang ${esc(j.cabang)} — ${(j.diperiksa || []).length} halaman dibuka,
      ${halaman.length} punya formulir.</p>` +
    halaman.map((h) => {
      const select = (h.select || []).map((s) => `
        <details${s.jumlahPilihan > 3 ? ' open' : ''}>
          <summary>select <code>${esc(s.nama)}</code> — ${s.jumlahPilihan} pilihan</summary>
          <table class="tbl"><tbody>${s.pilihan.map((p) =>
            `<tr><td><code>${esc(p.value)}</code></td><td>${esc(p.label)}</td></tr>`).join('')}</tbody></table>
        </details>`).join('') || '<p class="muted">Tidak ada dropdown.</p>';
      const input = (h.input || []).map((i) =>
        `<code>${esc(i.nama)}</code> <span class="muted">(${esc(i.tipe)}${i.nilai ? ' = ' + esc(i.nilai) : ''})</span>`
      ).join(', ') || '<span class="muted">tidak ada</span>';
      return `
        <div class="card">
          <div class="card-head">
            <h3>${esc(h.path)} <span class="muted">— ${h.status}</span></h3>
            <p class="muted">${esc(h.judul || '(tanpa judul)')}</p>
          </div>
          <p><strong>Form:</strong> ${(h.form || []).map((f) => `${esc(f.method)} ${esc(f.action)}`).join(' · ') || '<span class="muted">tidak ada</span>'}</p>
          <p><strong>Input:</strong> ${input}</p>
          ${(h.alamatSkrip || []).length ? `<p><strong>Alamat di skrip:</strong> ${h.alamatSkrip.map((a) => `<code>${esc(a)}</code>`).join(' ')}</p>` : ''}
          ${['skripTransactionlist', 'skripLedger'].map((k) => (h[k] || []).length ? `
            <details open><summary>${esc(k)}</summary>
              ${h[k].map((c) => `<pre class="jurnal-mentah">${esc(c)}</pre>`).join('')}
            </details>` : '').join('')}
          ${select}
        </div>`;
    }).join('');
}

function salinHasil() {
  if (!telusurTerakhir) return;
  navigator.clipboard.writeText(JSON.stringify(telusurTerakhir, null, 2))
    .then(() => alert('Hasil penelusuran disalin.'))
    .catch(() => alert('Gagal menyalin.'));
}
