/* =========================================================================
   slip-render.js — satu-satunya tempat bentuk slip gaji digambar
   -------------------------------------------------------------------------
   Dipakai oleh DUA halaman:
     • index.html (pemilik)  — pratinjau sebelum & sesudah disetujui
     • lapor.html (karyawan) — slip yang sudah disetujui, untuk diunduh PNG

   Karena karyawan TIDAK boleh membaca `pengguna/{uid}` (di sanalah seluruh
   data gaji semua orang berada), slip yang disetujui disimpan sebagai
   SNAPSHOT: angka jadi, sudah dihitung, di dokumen tersendiri milik
   karyawan itu. Berkas ini menggambar snapshot tersebut — sehingga apa yang
   dilihat pemilik dan apa yang diunduh karyawan dijamin persis sama.

   Snapshot dibuat oleh `snapshotSlip()` di app.js. Bentuknya:
     { periode, periodeLabel, nama, role, tanggal, klinik:{…}, bank, norek,
       bergabung, pendapatan:[{label,nilai,ket}], potonganList:[…],
       bruto, potongan, total, terbilang, catatan }

   Dimuat sebagai <script> biasa (bukan module) supaya kedua halaman bisa
   memakainya tanpa impor; semuanya dibungkus IIFE agar tidak menabrak
   nama `esc` yang sudah ada di app.js maupun lapor.js.
   ========================================================================= */
(function () {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const uang = (v) => (typeof rp === 'function'
    ? rp(v)
    : 'Rp ' + Math.round(Number(v) || 0).toLocaleString('id-ID'));

  function baris(list) {
    const isi = (list || []).filter((x) => x.nilai).map((x) =>
      `<tr><td>${esc(x.label)}${x.ket ? `<div class="ket">${esc(x.ket)}</div>` : ''}</td>` +
      `<td class="r">${uang(x.nilai)}</td></tr>`).join('');
    return isi || '<tr><td colspan="2" style="color:#999">—</td></tr>';
  }

  /* Gambar satu slip. `s` adalah snapshot; `opsi.cap` menempelkan cap kecil
     di pojok (mis. "Revisi ke-2") supaya versi lama tidak tertukar. */
  function gambar(s, opsi) {
    if (!s) return '';
    const k = s.klinik || {};
    const cap = (opsi && opsi.cap) || '';

    return `<div class="slip">
    <div class="slip-head">
      <div class="slip-logo">🐾</div>
      <div>
        <h2>${esc(k.nama)}</h2>
        <div class="sub">${esc(k.subjudul)}${k.alamat ? ' • ' + esc(k.alamat) : ''}${k.kota ? ', ' + esc(k.kota) : ''}${k.telp ? ' • ' + esc(k.telp) : ''}</div>
      </div>
      <div class="slip-title">
        <div class="t">Slip Gaji</div>
        <div class="p">${esc(s.periodeLabel)}</div>
        ${cap ? `<div class="slip-cap">${esc(cap)}</div>` : ''}
      </div>
    </div>

    <div class="slip-meta">
      <div><span>Nama</span><b>${esc(s.nama)}</b></div>
      <div><span>Periode</span><b>${esc(s.periodeLabel)}</b></div>
      <div><span>Posisi</span><b>${esc(s.role)}</b></div>
      <div><span>Tanggal</span><b>${esc(s.tanggal)}</b></div>
      ${s.bank ? `<div><span>Bank</span><b>${esc(s.bank)} ${esc(s.norek || '')}</b></div>` : ''}
      ${s.bergabung ? `<div><span>Bergabung</span><b>${esc(s.bergabung)}</b></div>` : ''}
    </div>

    <div class="slip-cols">
      <div>
        <table>
          <thead><tr><th>Pendapatan</th><th class="r">Jumlah</th></tr></thead>
          <tbody>${baris(s.pendapatan)}
            <tr class="sum"><td>Total Pendapatan</td><td class="r">${uang(s.bruto)}</td></tr>
          </tbody>
        </table>
      </div>
      <div>
        <table>
          <thead><tr><th>Potongan</th><th class="r">Jumlah</th></tr></thead>
          <tbody>${baris(s.potonganList)}
            <tr class="sum"><td>Total Potongan</td><td class="r">${uang(s.potongan)}</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="slip-total">
      <div class="lbl">Gaji Diterima</div>
      <div class="val">${uang(s.total)}</div>
    </div>
    <div class="slip-terbilang">Terbilang: ${esc(s.terbilang)}</div>
    ${s.catatan ? `<div class="slip-note">${esc(s.catatan)}</div>` : ''}

    <div class="slip-sign">
      <div><div>Diterima oleh,</div><div class="line">${esc(s.nama)}</div></div>
      <div><div>${esc(k.kota || 'Hormat kami')},</div><div class="line">${esc(k.penandatangan)}<br><span style="font-weight:400;font-size:.75rem">${esc(k.jabatan)}</span></div></div>
    </div>

    <div class="slip-foot">Dokumen ini dicetak dari aplikasi penggajian ${esc(k.nama)} — bersifat rahasia.</div>
  </div>`;
  }

  window.SlipRender = { gambar };
})();
