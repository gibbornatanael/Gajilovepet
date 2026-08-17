/* =========================================================================
   functions/_lib/gemini.js — pembacaan foto nota oleh AI
   -------------------------------------------------------------------------
   Dipakai bersama oleh dua endpoint:
     • functions/api/nota.js      → tombol "Unggah nota" di aplikasi
     • functions/api/telegram.js  → foto yang di-forward ke grup Telegram

   Kuncinya (GEMINI_API_KEY) hanya ada di sini — di server Cloudflare —
   sehingga tidak pernah ikut terkirim ke browser atau ke Telegram.
   ========================================================================= */

export const KATEGORI = ['Obat & Vaksin', 'Pakan', 'Alat Medis', 'Operasional',
  'Kebersihan', 'Perlengkapan', 'Lain-lain'];

const MODEL = 'gemini-flash-latest';

const PETUNJUK = `Kamu membaca foto nota/struk belanja sebuah klinik hewan di Indonesia.
Keluarkan datanya sebagai JSON.

Aturan:
- "tanggal": tanggal yang tertera di nota, format YYYY-MM-DD. Kalau tidak
  tertera atau tidak terbaca, isi string kosong.
- "toko": nama toko/penjual/apotek di kepala nota. Kalau tidak ada, string kosong.
- "total": angka total akhir yang dibayar, bilangan bulat rupiah TANPA titik,
  koma, atau "Rp". Ambil total setelah diskon/pajak kalau ada. Kalau tidak
  terbaca, isi 0.
- "kategori": pilih SATU yang paling cocok dari daftar ini: ${KATEGORI.join(', ')}.
  Kalau ragu, pakai "Lain-lain".
- "metode": cara bayar kalau tertulis (Tunai, Transfer, QRIS, Debit, Kredit).
  Kalau tidak tertulis, string kosong.
- "items": SEMUA baris barang yang terbaca, berapa pun banyaknya — jangan
  diringkas dan jangan dipotong. Tiap baris: "nama" (nama barang apa adanya),
  "qty" (jumlah beserta satuannya kalau ada, mis. "2 botol"), "harga" (harga
  satuan sebagai bilangan bulat, 0 kalau tidak ada), "subtotal" (jumlah baris
  sebagai bilangan bulat, 0 kalau tidak ada). Kalau nota tidak merinci barang,
  kembalikan array kosong.
- "catatan": hal penting lain yang tertulis (nomor nota, nama pembeli, dsb).
  Kosongkan kalau tidak ada.

Jangan mengarang. Yang tidak terbaca dikosongkan (string kosong atau 0),
bukan ditebak.`;

const SKEMA = {
  type: 'OBJECT',
  properties: {
    tanggal:  { type: 'STRING' },
    toko:     { type: 'STRING' },
    total:    { type: 'INTEGER' },
    kategori: { type: 'STRING', enum: KATEGORI },
    metode:   { type: 'STRING' },
    catatan:  { type: 'STRING' },
    items: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          nama:     { type: 'STRING' },
          qty:      { type: 'STRING' },
          harga:    { type: 'INTEGER' },
          subtotal: { type: 'INTEGER' },
        },
        propertyOrdering: ['nama', 'qty', 'harga', 'subtotal'],
      },
    },
  },
  propertyOrdering: ['tanggal', 'toko', 'total', 'kategori', 'metode', 'items', 'catatan'],
  required: ['tanggal', 'toko', 'total', 'kategori', 'metode', 'items', 'catatan'],
};

/**
 * Baca nota dari gambar.
 * @param {string} base64  isi gambar (tanpa awalan "data:...;base64,")
 * @param {string} mime    mis. "image/jpeg"
 * @param {string} apiKey  GEMINI_API_KEY
 * @returns {Promise<object>} data nota yang sudah dibersihkan
 */
export async function bacaNota(base64, mime, apiKey) {
  if (!apiKey) throw new Error('GEMINI_API_KEY belum diatur di Cloudflare');

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      contents: [{
        parts: [
          { text: PETUNJUK },
          { inline_data: { mime_type: mime || 'image/jpeg', data: base64 } },
        ],
      }],
      generationConfig: {
        temperature: 0,
        responseMimeType: 'application/json',
        responseSchema: SKEMA,
      },
    }),
  });

  if (!res.ok) {
    const teks = await res.text();
    throw new Error(`Gemini ${res.status}: ${teks.slice(0, 300)}`);
  }

  const j = await res.json();
  const teks = j?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!teks) throw new Error('Gemini tidak mengembalikan isi');

  return bersihkan(JSON.parse(teks));
}

/* Angka dari AI kadang datang sebagai string berformat ("1.250.000") —
   dirapikan di sini supaya aplikasi selalu menerima bilangan. */
function angka(v) {
  if (typeof v === 'number') return Math.round(v);
  const n = parseInt(String(v || '').replace(/[^\d]/g, ''), 10);
  return Number.isFinite(n) ? n : 0;
}

/* Nota Indonesia lazim menulis 02/08/2026 (hari dulu). Kalau AI meneruskan
   bentuk itu apa adanya, tanggalnya diterjemahkan di sini daripada dibuang. */
function normalTanggal(v) {
  const t = String(v || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;

  const m = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2}|\d{4})$/.exec(t);
  if (!m) return '';
  const hari = Number(m[1]), bulan = Number(m[2]);
  let tahun = Number(m[3]);
  if (tahun < 100) tahun += 2000;
  if (hari < 1 || hari > 31 || bulan < 1 || bulan > 12) return '';
  return `${tahun}-${String(bulan).padStart(2, '0')}-${String(hari).padStart(2, '0')}`;
}

function bersihkan(d) {
  return {
    tanggal: normalTanggal(d?.tanggal),
    toko: String(d?.toko || '').trim(),
    total: angka(d?.total),
    kategori: KATEGORI.includes(d?.kategori) ? d.kategori : '',
    metode: String(d?.metode || '').trim(),
    catatan: String(d?.catatan || '').trim(),
    items: (Array.isArray(d?.items) ? d.items : [])
      .map((it) => ({
        nama: String(it?.nama || '').trim(),
        qty: String(it?.qty || '').trim(),
        harga: angka(it?.harga),
        subtotal: angka(it?.subtotal),
      }))
      .filter((it) => it.nama || it.subtotal),
  };
}

/** Pisahkan "data:image/jpeg;base64,AAAA" menjadi { mime, base64 }. */
export function uraikanDataUrl(dataUrl) {
  const m = /^data:([^;,]+);base64,(.+)$/s.exec(String(dataUrl || ''));
  if (!m) throw new Error('Format gambar tidak dikenali');
  return { mime: m[1], base64: m[2] };
}
