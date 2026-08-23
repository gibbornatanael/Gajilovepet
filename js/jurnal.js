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
let refPreset = null, refKirim = null;
let daftarPreset = [];
let daftarKirim = [];
let telusurTerakhir = null;
let daftarTransaksi = [];   // Transaction List intajo (lihat muatTransaksi)

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

  q('#btnTambahPreset')?.addEventListener('click', () => bukaEditor(null));
  q('#btnTelusuriJurnal')?.addEventListener('click', (e) => telusuri(e.currentTarget));
  q('#btnSalinTelusur')?.addEventListener('click', salinHasil);
  q('#jurnalPreset')?.addEventListener('click', klikPreset);

  daftarTransaksi = transaksiTersimpan() || [];
  pantau();
}

/* Dua langganan realtime, sama pola dengan nota.js — layar ikut berubah
   sendiri kalau preset diubah dari perangkat lain. */
function pantau() {
  fsMod.onSnapshot(refPreset, (snap) => {
    daftarPreset = snap.docs.map((d) => Object.assign({ id: d.id }, d.data()));
    daftarPreset.sort((a, b) => (a.nama || '').localeCompare(b.nama || ''));
    gambarPreset();
  }, (e) => {
    console.error('preset:', e);
    q('#jurnalPreset').innerHTML = '<p class="muted">Gagal memuat preset.</p>';
  });

  fsMod.onSnapshot(fsMod.query(refKirim, fsMod.orderBy('waktu', 'desc'), fsMod.limit(30)), (snap) => {
    daftarKirim = snap.docs.map((d) => Object.assign({ id: d.id }, d.data()));
    gambarPreset();
    gambarRiwayat();
  }, (e) => console.error('riwayat jurnal:', e));
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
      <div class="jurnal-kartu" data-id="${esc(p.id)}">
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
  if (!wadah) return;
  if (!daftarKirim.length) {
    wadah.innerHTML = '<p class="muted">Belum ada jurnal yang dikirim dari aplikasi ini.</p>';
    return;
  }
  wadah.innerHTML = `<table class="tbl"><thead><tr>
      <th>Tanggal</th><th>Preset</th><th>Kode</th><th>Cabang</th><th>Nominal</th><th>No. jurnal</th>
    </tr></thead><tbody>` + daftarKirim.map((k) => `
      <tr>
        <td>${esc(k.tanggal || '')}</td>
        <td>${esc(k.nama || '')}</td>
        <td>${esc(k.kode || '')}</td>
        <td>${esc(CABANG[k.cabang] || k.cabang || '')}</td>
        <td>${rp(k.nominal)}</td>
        <td>${esc(k.nomor || '—')}</td>
      </tr>`).join('') + '</tbody></table>';
}

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

/* ---------------------- Editor preset ---------------------- */
function bukaEditor(preset) {
  const p = preset || {
    nama: '', kode: '', cabang: 'manado', nominal: 0, deskripsi: '',
    intervalBulan: 1, tanggalMulai: tanggalWita(), tanggalBerakhir: '',
  };

  /* Kalau daftar transaksi sudah ada → dropdown. Kalau belum → tetap
     boleh diketik manual, supaya preset masih bisa dibuat walau intajo
     sedang tidak bisa dihubungi. */
  const pilihanKode = daftarTransaksi.length
    ? `<select name="kode" required>
         ${daftarTransaksi.some((t) => t.kode === p.kode) ? '' : `<option value="${esc(p.kode)}">${esc(p.kode || '— pilih —')}</option>`}
         ${daftarTransaksi.map((t) =>
           `<option value="${esc(t.kode)}"${t.kode === p.kode ? ' selected' : ''}>${esc(t.label)}</option>`).join('')}
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
      kode: (f.get('kode') || '').trim().toUpperCase(),
      cabang: f.get('cabang') || 'manado',
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
   Tetap ada layar konfirmasi meski semuanya sudah terisi: yang terjadi
   sesudah tombol ini adalah tulisan ke pembukuan sungguhan, dan jurnal
   tidak semudah itu dihapus di intajo. */
function bukaKirim(preset) {
  const j = jadwal(preset);
  /* Tanggal jurnal default = tanggal JATUH TEMPO, bukan hari ini —
     supaya beban jatuh di periode yang benar walau baru sempat dikirim
     beberapa hari kemudian. Masih bisa diubah. */
  const tanggal = j.jatuhTempo || tanggalWita();
  const periode = j.jatuhTempo || '';

  const d = bukaDialog('Kirim ke intajo', `
    <form class="jurnal-form" id="formKirim">
      <p><strong>${esc(preset.nama)}</strong><br>
        <small class="muted">${esc(preset.kode)} · ${esc(CABANG[preset.cabang] || preset.cabang)}</small></p>
      ${periode ? `<p class="muted">Memenuhi jatuh tempo <strong>${esc(tanggalPendek(periode))}</strong>.</p>`
                : '<p class="muted">Preset ini tanpa jadwal — kiriman tidak dihitung sebagai pemenuhan jatuh tempo.</p>'}
      <label><span>Tanggal jurnal</span>
        <input name="tanggal" type="date" required value="${esc(tanggal)}"></label>
      <label><span>Nominal</span>
        <input name="nominal" type="number" min="1" step="1" required value="${Number(preset.nominal) || 0}"></label>
      <label><span>Deskripsi</span>
        <input name="deskripsi" value="${esc(isiPola(preset.deskripsi, tanggal))}"></label>
      <p class="muted" style="font-size:.76rem">Nominal yang sama dipakai untuk baris debit dan kredit,
        jadi selisihnya pasti nol.</p>
      <button class="btn" type="submit">Kirim jurnal</button>
      <p id="kirimPesan" class="muted"></p>
    </form>`);

  // Deskripsi ikut berubah kalau tanggalnya diganti — {bulan} mengacu ke
  // tanggal jurnal, bukan tanggal hari ini.
  const inpTanggal = q('[name="tanggal"]', d), inpDesk = q('[name="deskripsi"]', d);
  inpTanggal.addEventListener('change', () => {
    inpDesk.value = isiPola(preset.deskripsi, inpTanggal.value);
  });

  q('#formKirim', d).addEventListener('submit', async (e) => {
    e.preventDefault();
    const tombol = q('button[type="submit"]', e.target);
    const pesan = q('#kirimPesan', e.target);
    const f = new FormData(e.target);
    const kiriman = {
      tanggal: f.get('tanggal'),
      nominal: Number(f.get('nominal')) || 0,
      deskripsi: (f.get('deskripsi') || '').trim(),
    };
    if (kiriman.nominal <= 0) return alert('Nominal harus lebih dari nol.');

    const auth = window.CLOUD && window.CLOUD.auth;
    if (!auth || !auth.currentUser) return alert('Masuk dulu sebagai pemilik.');

    tombol.disabled = true; tombol.textContent = 'Mengirim…';
    pesan.textContent = '';
    try {
      const idToken = await auth.currentUser.getIdToken();
      const res = await fetch('/api/jurnal-buat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.assign({ idToken, cabang: preset.cabang, kode: preset.kode }, kiriman)),
      });
      const jj = await res.json().catch(() => ({}));
      if (!res.ok || !jj.ok) throw new Error(jj.error || 'Gagal (' + res.status + ')');

      /* Riwayat ditulis SESUDAH intajo menerima — kalau ditulis lebih dulu,
         kegagalan kirim akan meninggalkan catatan palsu "sudah dikirim",
         dan jatuh tempo itu ikut terlewat diam-diam. */
      await fsMod.addDoc(refKirim, {
        presetId: preset.id, nama: preset.nama, kode: preset.kode, cabang: preset.cabang,
        periode, tanggal: kiriman.tanggal, nominal: kiriman.nominal, deskripsi: kiriman.deskripsi,
        nomor: jj.nomor || '', waktu: Date.now(),
      });
      tutupDialog();
      alert('Jurnal terkirim' + (jj.nomor ? ' — nomor ' + jj.nomor : '') + '.');
    } catch (err) {
      console.error('kirim jurnal:', err);
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
    wadah.innerHTML = `<p class="muted">Tidak ada halaman berbau jurnal yang ketemu dari menu ${esc(j.cabang)}.
      Calon tautan: ${esc((j.calonDitemukan || []).join(', ')) || '(tidak ada)'}</p>`;
    return;
  }
  wadah.innerHTML = `<p class="muted">Cabang ${esc(j.cabang)} — ${halaman.length} halaman diperiksa.</p>` +
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
