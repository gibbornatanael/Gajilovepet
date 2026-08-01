/* =========================================================================
   LOVE Pet Clinic — Aplikasi Gaji & Slip Gaji
   data.js : struktur data, tarif default, dan data awal (Januari–Juli 2026)
   Sumber   : "slip gaji love pet 2026.numbers" + "Juli 2026.numbers"
   ========================================================================= */

const APP = {
  storageKey: 'lovepet-payroll-v1',
  version: 4,
};

/* ---------- Identitas klinik (bisa diubah di Kelola → Pengaturan) ---------- */
const DEFAULT_PROFIL = {
  nama: 'LOVE Pet Clinic',
  subjudul: 'Klinik Hewan & Petshop',
  alamat: '',
  kota: '',
  telp: '',
  penandatangan: 'Natanael Montolalu',
  jabatanPenandatangan: 'Manager',
};

/* ---------- Cabang ----------
   Kunci 'mdo' & 'tmh' dipakai di data; namanya bisa diganti di Pengaturan.  */
const CABANG = ['mdo', 'tmh'];
const DEFAULT_CABANG = { mdo: 'Manado', tmh: 'Tomohon' };

/* ---------- Komponen bonus ----------
   Menambah jenis bonus baru cukup menambah satu baris di sini —
   halaman input, slip, rekap, dan tarif otomatis ikut menyesuaikan.
     id     : kunci penyimpanan
     label  : nama pendek (halaman input & pengaturan)
     slip   : nama di slip gaji
     satuan : nama satuan yang dihitung
     peran  : batasi ke posisi tertentu (kosong = semua posisi)
     laporSendiri : true bila karyawan boleh melaporkan sendiri lewat
                    halaman "Performance Bonus" (lapor.html) — sekali
                    per hari, dengan foto bukti.                        */
const KOMPONEN = [
  { id: 'clients', label: 'Clients',     slip: 'Bonus Clients',     satuan: 'client'  },
  { id: 'jaga',    label: 'Jaga minggu', slip: 'Bonus Jaga Minggu', satuan: 'jaga'    },
  { id: 'lembur',  label: 'Lembur',      slip: 'Bonus Lembur',      satuan: 'lembur',   laporSendiri: true, ikon: '🕒' },
  { id: 'rawat',   label: 'Rawat inap',  slip: 'Bonus Rawat Inap',  satuan: 'hari',     laporSendiri: true, ikon: '🐾' },
  { id: 'styling', label: 'Styling',     slip: 'Bonus Styling',     satuan: 'styling',  laporSendiri: true, ikon: '✂️' },
  { id: 'operasi', label: 'Operasi',     slip: 'Bonus Operasi',     satuan: 'operasi',  laporSendiri: true, ikon: '🩺', peran: ['Dokter'] },
];

/* Komponen yang boleh dilaporkan sendiri oleh karyawan */
function komponenLaporSendiri(role) {
  return KOMPONEN.filter((k) => k.laporSendiri && (!k.peran || k.peran.includes(role)));
}

/* ---------- Tarif default per posisi (rupiah per satuan) ----------
   Nilai per Juli 2026.                                                */
const DEFAULT_TARIF = {
  Manager: { clients: 0,     jaga: 0,      lembur: 0,      rawat: 0,     styling: 0,     operasi: 0,     makan: 0      },
  Admin:   { clients: 3500,  jaga: 30000,  lembur: 50000,  rawat: 10000, styling: 25000, operasi: 0,     makan: 450000 },
  Dokter:  { clients: 10000, jaga: 100000, lembur: 100000, rawat: 15000, styling: 25000, operasi: 50000, makan: 450000 },
  Groomer: { clients: 10000, jaga: 30000,  lembur: 50000,  rawat: 10000, styling: 25000, operasi: 0,     makan: 450000 },
  Helper:  { clients: 10000, jaga: 30000,  lembur: 50000,  rawat: 10000, styling: 25000, operasi: 0,     makan: 450000 },
};

const ROLES = ['Manager', 'Dokter', 'Admin', 'Groomer', 'Helper'];

/* ---------- Master karyawan (nama & angka sesuai file Juli 2026) ----------
   cabang           : cabang "rumah" karyawan (mdo/tmh) — jadi pilihan awal
                       saat mereka melapor lewat lapor.html, bisa diganti
                       sendiri saat lapor kalau sedang di cabang lain.
   username/authUid : diisi otomatis saat Anda membuat akun login karyawan
                       di Kelola → Karyawan. Kosong = karyawan itu belum
                       bisa login ke lapor.html.                          */
const SEED_KARYAWAN = [
  { id: 'risa',    nama: 'Risa Tineke Runtuwene',      role: 'Admin',   pokok: 2250000, operasional: 750000,  makan: 450000, aktif: true, mulai: '2024-01-01', bank: '', norek: '', cabang: 'mdo', username: '', authUid: '' },
  { id: 'elsi',    nama: 'Drh. Elsi Enjels Sinamohina', role: 'Dokter',  pokok: 3250000, operasional: 1000000, makan: 450000, aktif: true, mulai: '2024-01-01', bank: '', norek: '', cabang: 'mdo', username: '', authUid: '' },
  { id: 'anas',    nama: 'Drh. Anastasia I.I. Bria',   role: 'Dokter',  pokok: 3250000, operasional: 1000000, makan: 450000, aktif: true, mulai: '2024-01-01', bank: '', norek: '', cabang: 'mdo', username: '', authUid: '' },
  { id: 'michiko', nama: 'Michiko Supit',              role: 'Groomer', pokok: 1300000, operasional: 700000,  makan: 450000, aktif: true, mulai: '2024-01-01', bank: '', norek: '', cabang: 'tmh', username: '', authUid: '' },
  { id: 'ayrin',   nama: 'Ayrin Kosman',               role: 'Groomer', pokok: 2000000, operasional: 0,       makan: 450000, aktif: true, mulai: '2024-01-01', bank: '', norek: '', cabang: 'mdo', username: '', authUid: '' },
  { id: 'gracia',  nama: 'Gracia Rumengan',            role: 'Groomer', pokok: 1300000, operasional: 0,       makan: 450000, aktif: true, mulai: '2026-06-01', bank: '', norek: '', cabang: 'mdo', username: '', authUid: '' },
];

/* ID klinik tetap — dipakai sebagai jalur koleksi Firestore bersama
   antara aplikasi pemilik (index.html) dan aplikasi karyawan (lapor.html). */
const KLINIK_ID = 'lovepet';

/* Karyawan login pakai "nama pengguna" biasa, tapi Firebase Auth perlu
   email — jadi diam-diam diubah jadi email palsu di domain ini.
   window.* dipakai supaya bisa diakses dari script <module> juga
   (provisioning.js dan lapor.js), tak hanya dari script biasa. */
const DOMAIN_KARYAWAN = 'karyawan.lovepet.app';
function emailDariUsername(u) {
  return String(u).trim().toLowerCase().replace(/[^a-z0-9._-]/g, '') + '@' + DOMAIN_KARYAWAN;
}
window.DOMAIN_KARYAWAN = DOMAIN_KARYAWAN;
window.emailDariUsername = emailDariUsername;

/* ---------- Membuat baris gaji kosong untuk seorang karyawan ---------- */
function barisBaruUntuk(emp, tarif) {
  const t = (tarif || DEFAULT_TARIF)[emp.role] || DEFAULT_TARIF.Helper;
  const qty = {}, rate = {};
  KOMPONEN.forEach((k) => {
    qty[k.id] = { mdo: 0, tmh: 0 };
    rate[k.id] = t[k.id] || 0;
  });
  return {
    empId: emp.id, nama: emp.nama, role: emp.role,
    pokok: +emp.pokok || 0,
    operasional: +emp.operasional || 0,
    qty, rate,
    makan: +emp.makan || 0,
    tunjLain: 0, denda: 0, hutang: 0, catatan: '',
  };
}

/* ---------- Ambil jumlah total sebuah komponen (gabungan cabang) ---------- */
function qtyTotal(row, id) {
  const q = (row.qty || {})[id] || {};
  return CABANG.reduce((s, c) => s + (Number(q[c]) || 0), 0);
}

/* ---------- Perhitungan satu baris gaji ---------- */
function hitung(row) {
  const n = (v) => Number(v) || 0;

  const bonus = {};
  let totalBonus = 0;
  const barisBonus = KOMPONEN.map((k) => {
    const q = qtyTotal(row, k.id);
    const r = n((row.rate || {})[k.id]);
    const nilai = q * r;
    bonus[k.id] = nilai;
    totalBonus += nilai;
    return { label: k.slip, nilai, ket: q ? `${q} ${k.satuan} × ${rp(r)}` : '' };
  });

  const pendapatan = [
    { label: 'Gaji Pokok',            nilai: n(row.pokok) },
    { label: 'Tunjangan Operasional', nilai: n(row.operasional) },
    ...barisBonus,
    { label: 'Tunjangan Makan',       nilai: n(row.makan) },
    { label: 'Tunjangan Lain',        nilai: n(row.tunjLain) },
  ];

  const potonganList = [
    { label: 'Denda / Absen', nilai: n(row.denda) },
    { label: 'Potongan Hutang / Kasbon', nilai: n(row.hutang) },
  ];

  const bruto    = pendapatan.reduce((s, p) => s + p.nilai, 0);
  const potongan = potonganList.reduce((s, p) => s + p.nilai, 0);

  return {
    bonus, totalBonus, pendapatan, potonganList,
    tetap: n(row.pokok) + n(row.operasional) + n(row.makan) + n(row.tunjLain),
    bruto, potongan, total: bruto - potongan,
  };
}

/* ---------- Komponen yang berlaku untuk sebuah posisi ---------- */
function komponenUntuk(role) {
  return KOMPONEN.filter((k) => !k.peran || k.peran.includes(role));
}

/* =========================================================================
   DATA HISTORIS JANUARI – JULI 2026
   Ditulis ulang dari file Numbers. Catatan:
   • Jan–Mei : gaji pokok belum dipecah jadi pokok + operasional.
   • Juni    : mulai dipecah + tunjangan makan.
   • Juli    : nama bonus berganti (Clients, Jaga minggu), Styling ditambahkan,
               beberapa tarif naik, dan jumlahnya dipisah per cabang.
   • Untuk Jan–Juni yang belum ada pemisahan cabang, angkanya ditaruh di
     kolom Manado. Laporan memakai totalnya, jadi hasil akhirnya sama.
   • Manager (Natanael Montolalu) tidak disertakan.
   ========================================================================= */
function seedPayroll() {
  /* Pintasan penulisan: c(qtyMdo, qtyTmh, tarif) */
  const c = (mdo, tmh, tarif) => ({ q: { mdo: mdo || 0, tmh: tmh || 0 }, r: tarif || 0 });

  const mk = (empId, o) => {
    const emp = SEED_KARYAWAN.find((e) => e.id === empId);
    const row = barisBaruUntuk(emp);
    row.pokok = o.pokok || 0;
    row.operasional = o.operasional || 0;
    row.makan = o.makan || 0;
    row.denda = o.denda || 0;
    row.hutang = o.hutang || 0;
    KOMPONEN.forEach((k) => {
      const v = o[k.id];
      if (v) { row.qty[k.id] = v.q; row.rate[k.id] = v.r; }
      else { row.rate[k.id] = 0; }
    });
    return row;
  };

  return {
    '2026-01': [
      mk('risa',    { pokok: 3000000, clients: c(127, 0, 3500),  lembur: c(5, 0, 50000) }),
      mk('elsi',    { pokok: 4250000, clients: c(42, 0, 10000),  jaga: c(1, 0, 100000), lembur: c(3, 0, 100000) }),
      mk('anas',    { pokok: 4250000, clients: c(61, 0, 10000),  jaga: c(2, 0, 100000), lembur: c(4, 0, 100000) }),
      mk('michiko', { pokok: 2000000, clients: c(35, 0, 10000),  lembur: c(3, 0, 50000) }),
      mk('ayrin',   { pokok: 2000000, clients: c(18, 0, 10000),  lembur: c(1, 0, 50000), hutang: 880000 }),
    ],
    '2026-02': [
      mk('risa',    { pokok: 3000000, clients: c(131, 0, 3500),  lembur: c(1, 0, 50000) }),
      mk('elsi',    { pokok: 4250000, clients: c(67, 0, 10000),  jaga: c(1, 0, 100000), lembur: c(2, 0, 100000) }),
      mk('anas',    { pokok: 4250000, clients: c(83, 0, 10000),  jaga: c(2, 0, 100000), lembur: c(1, 0, 100000) }),
      mk('michiko', { pokok: 2000000, clients: c(11, 0, 10000),  lembur: c(1, 0, 50000) }),
      mk('ayrin',   { pokok: 2000000, clients: c(28, 0, 10000),  lembur: c(1, 0, 50000), hutang: 880000 }),
    ],
    '2026-03': [
      mk('risa',    { pokok: 3000000, clients: c(142, 0, 3500),  lembur: c(2, 0, 50000) }),
      mk('elsi',    { pokok: 4250000, clients: c(69, 0, 10000),  jaga: c(2, 0, 100000), lembur: c(2, 0, 100000) }),
      mk('anas',    { pokok: 4250000, clients: c(83, 0, 10000),  jaga: c(3, 0, 100000) }),
      mk('michiko', { pokok: 2000000, clients: c(29, 0, 10000),  lembur: c(4, 0, 50000) }),
      mk('ayrin',   { pokok: 2000000, clients: c(20, 0, 10000),  lembur: c(1, 0, 50000), hutang: 880000 }),
    ],
    '2026-04': [
      mk('risa',    { pokok: 3000000, clients: c(133, 0, 3500),  lembur: c(1, 0, 50000) }),
      mk('elsi',    { pokok: 4250000, clients: c(62, 0, 10000),  jaga: c(2, 0, 100000), operasi: c(5, 0, 50000) }),
      mk('anas',    { pokok: 4250000, clients: c(69, 0, 10000),  jaga: c(3, 0, 100000), operasi: c(6, 0, 50000) }),
      mk('michiko', { pokok: 2000000, clients: c(11, 0, 10000),  rawat: c(10, 0, 5000) }),
      mk('ayrin',   { pokok: 2000000, clients: c(35, 0, 10000),  lembur: c(1, 0, 50000), rawat: c(30, 0, 5000), hutang: 880000 }),
    ],
    '2026-05': [
      mk('risa',    { pokok: 3000000, clients: c(115, 0, 3500) }),
      mk('elsi',    { pokok: 4250000, clients: c(59, 0, 10000),  jaga: c(2, 0, 100000), lembur: c(5, 0, 100000), operasi: c(2, 0, 50000) }),
      mk('anas',    { pokok: 4250000, clients: c(73, 0, 10000),  jaga: c(2, 0, 100000), operasi: c(4, 0, 50000) }),
      mk('michiko', { pokok: 2000000, clients: c(23, 0, 10000),  rawat: c(4, 0, 5000) }),
      mk('ayrin',   { pokok: 2000000, clients: c(0, 0, 10000),   hutang: 880000 }),
    ],
    '2026-06': [
      mk('risa',    { pokok: 1750000, operasional: 1250000, makan: 450000, hutang: 500000,
                      clients: c(105, 0, 3500), lembur: c(2, 0, 25000) }),
      mk('elsi',    { pokok: 3000000, operasional: 1250000, makan: 450000,
                      clients: c(96, 0, 10000), jaga: c(2, 0, 100000), lembur: c(3, 0, 100000), rawat: c(2, 0, 10000), operasi: c(3, 0, 50000) }),
      mk('anas',    { pokok: 3000000, operasional: 1250000, makan: 450000,
                      clients: c(64, 0, 10000), jaga: c(2, 0, 100000), lembur: c(3, 0, 100000), rawat: c(3, 0, 10000), operasi: c(6, 0, 50000) }),
      mk('michiko', { pokok: 1300000, operasional: 700000,  makan: 450000,
                      clients: c(19, 0, 10000), rawat: c(1, 0, 5000) }),
      mk('ayrin',   { pokok: 2000000, makan: 450000, hutang: 880000, clients: c(0, 0, 10000) }),
      mk('gracia',  { pokok: 1300000, makan: 400000, clients: c(0, 0, 10000) }),
    ],
    /* --- Juli 2026: struktur baru, jumlah dipisah Manado / Tomohon --- */
    '2026-07': [
      mk('risa',    { pokok: 2250000, operasional: 750000, makan: 450000, hutang: 500000,
                      clients: c(104, 0, 3500), jaga: c(0, 0, 30000), lembur: c(0, 0, 50000),
                      rawat: c(0, 0, 10000), styling: c(0, 0, 25000) }),
      mk('elsi',    { pokok: 3250000, operasional: 1000000, makan: 450000,
                      clients: c(35, 17, 10000), jaga: c(2, 0, 100000), lembur: c(0, 0, 100000),
                      rawat: c(2, 0, 15000), styling: c(0, 0, 25000), operasi: c(0, 3, 50000) }),
      mk('anas',    { pokok: 3250000, operasional: 1000000, makan: 450000,
                      clients: c(42, 21, 10000), jaga: c(2, 0, 100000), lembur: c(0, 0, 100000),
                      rawat: c(14, 4, 15000), styling: c(0, 0, 25000), operasi: c(2, 1, 50000) }),
      mk('michiko', { pokok: 1300000, operasional: 700000, makan: 450000,
                      clients: c(0, 24, 10000), jaga: c(0, 0, 30000), lembur: c(0, 0, 50000),
                      rawat: c(0, 4, 10000), styling: c(0, 0, 25000) }),
      mk('ayrin',   { pokok: 2000000, makan: 450000, hutang: 880000,
                      clients: c(0, 0, 10000), jaga: c(0, 0, 30000), lembur: c(0, 0, 50000),
                      rawat: c(0, 0, 10000), styling: c(0, 0, 25000) }),
      mk('gracia',  { pokok: 1300000, makan: 450000,
                      clients: c(0, 0, 10000), jaga: c(0, 0, 30000), lembur: c(0, 0, 50000),
                      rawat: c(0, 0, 10000), styling: c(0, 0, 25000) }),
    ],
  };
}

/* ---------- Util format ---------- */
function rp(v) {
  return 'Rp ' + Math.round(Number(v) || 0).toLocaleString('id-ID');
}
function rpShort(v) {
  const n = Number(v) || 0;
  if (Math.abs(n) >= 1e9) return 'Rp ' + (n / 1e9).toFixed(1).replace('.', ',') + ' M';
  if (Math.abs(n) >= 1e6) return 'Rp ' + (n / 1e6).toFixed(1).replace('.', ',') + ' jt';
  if (Math.abs(n) >= 1e3) return 'Rp ' + Math.round(n / 1e3) + ' rb';
  return 'Rp ' + n;
}

const NAMA_BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

function labelPeriode(key) {
  const [y, m] = key.split('-');
  return `${NAMA_BULAN[Number(m) - 1]} ${y}`;
}

/* ---------- Kompresi foto bukti (dipakai di lapor.html) ----------
   Diperkecil ke lebar maksimum 480px & kualitas rendah supaya jadi
   sekitar 20–60 KB — aman jauh di bawah batas 1 MB per dokumen
   Firestore, dan tetap gratis (paket Spark, tanpa Firebase Storage). */
function kompresGambar(file, opsi) {
  const lebarMaks = (opsi && opsi.lebarMaks) || 480;
  const kualitas = (opsi && opsi.kualitas) || 0.55;
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const skala = Math.min(1, lebarMaks / img.width);
      const w = Math.max(1, Math.round(img.width * skala));
      const h = Math.max(1, Math.round(img.height * skala));
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', kualitas));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Gagal membaca foto')); };
    img.src = url;
  });
}

function tanggalISO(d) {
  d = d || new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function periodeDariTanggal(iso) { return iso.slice(0, 7); }

/* ---------- Terbilang (Bahasa Indonesia) ---------- */
function terbilang(x) {
  x = Math.floor(Math.abs(Number(x) || 0));
  const satuan = ['', 'satu', 'dua', 'tiga', 'empat', 'lima', 'enam', 'tujuh', 'delapan', 'sembilan', 'sepuluh', 'sebelas'];
  function konv(n) {
    if (n < 12) return satuan[n];
    if (n < 20) return konv(n - 10) + ' belas';
    if (n < 100) return konv(Math.floor(n / 10)) + ' puluh' + (n % 10 ? ' ' + konv(n % 10) : '');
    if (n < 200) return 'seratus' + (n % 100 ? ' ' + konv(n % 100) : '');
    if (n < 1000) return konv(Math.floor(n / 100)) + ' ratus' + (n % 100 ? ' ' + konv(n % 100) : '');
    if (n < 2000) return 'seribu' + (n % 1000 ? ' ' + konv(n % 1000) : '');
    if (n < 1e6) return konv(Math.floor(n / 1000)) + ' ribu' + (n % 1000 ? ' ' + konv(n % 1000) : '');
    if (n < 1e9) return konv(Math.floor(n / 1e6)) + ' juta' + (n % 1e6 ? ' ' + konv(n % 1e6) : '');
    return konv(Math.floor(n / 1e9)) + ' miliar' + (n % 1e9 ? ' ' + konv(n % 1e9) : '');
  }
  if (x === 0) return 'Nol rupiah';
  const s = konv(x).replace(/\s+/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1) + ' rupiah';
}
