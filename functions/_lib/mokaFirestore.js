/* =========================================================================
   functions/_lib/mokaFirestore.js — tulis transaksi ke MokaFamilyOS
   -------------------------------------------------------------------------
   MokaFamilyOS itu proyek Firebase TERPISAH ("mokafamilyos", bukan proyek
   Firebase aplikasi ini). Seluruh data satu keluarga — termasuk semua
   dompet & transaksi — disimpan sebagai array di DALAM SATU dokumen:
   moka_families/main_family (kadang di-gzip di field "_gzb" kalau sudah
   besar). Jadi menulis satu transaksi baru berarti: baca dokumen itu,
   sisipkan ke array transactions, sesuaikan saldo dompetnya, tulis lagi
   utuh — dan itu WAJIB lewat Firestore transaction (bukan get-lalu-set
   biasa) karena aplikasi MokaFamilyOS dipakai aktif dan bisa saja ada
   yang sedang menyimpan dari HP-nya di saat yang sama.

   Port dari worker/firestoreRest.js milik MokaFamilyOS sendiri (mereka
   sudah punya pola ini untuk Worker-nya sendiri), dipangkas ke bagian yang
   dipakai di sini saja: accessToken, mapping value REST, gzip, dan
   transaksi baca-ubah-tulis. env.MOKA_FIREBASE_SERVICE_ACCOUNT_JSON WAJIB
   punya project_id "mokafamilyos" — service account ini beda dari
   FIREBASE_SERVICE_ACCOUNT_JSON yang sudah ada (itu untuk proyek Firebase
   aplikasi ini sendiri, "gajilovepet").
   ========================================================================= */

const FAMILY_DOC_PATH = 'moka_families/main_family';
const RAW_DOC_LIMIT = 650000; // samakan dengan RAW_DOC_LIMIT di index.html MokaFamilyOS
const SCOPE = 'https://www.googleapis.com/auth/datastore';

function b64url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlStr(str) { return b64url(new TextEncoder().encode(str)); }

function pemKeDer(pem) {
  const isi = String(pem)
    .replace(/-----BEGIN [^-]+-----/, '').replace(/-----END [^-]+-----/, '')
    .replace(/\\n/g, '').replace(/\s+/g, '');
  const bin = atob(isi);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bacaAkun(env) {
  const raw = env.MOKA_FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('MOKA_FIREBASE_SERVICE_ACCOUNT_JSON belum diatur di Worker');
  return JSON.parse(raw);
}

async function accessToken(env) {
  const sa = bacaAkun(env);
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = { iss: sa.client_email, scope: SCOPE, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 };
  const isi = `${b64urlStr(JSON.stringify(header))}.${b64urlStr(JSON.stringify(claim))}`;

  const key = await crypto.subtle.importKey('pkcs8', pemKeDer(sa.private_key), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const tanda = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(isi));
  const jwt = `${isi}.${b64url(new Uint8Array(tanda))}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
  });
  const j = await res.json();
  if (!res.ok || !j.access_token) throw new Error('Gagal ambil access token Google (Moka): ' + JSON.stringify(j));
  return { accessToken: j.access_token, projectId: sa.project_id };
}

/* Mapping JS <-> Firestore REST. integerValue datang sebagai STRING dari
   Firestore, jadi dikembalikan lewat Number(). */
function keValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(keValue) } };
  if (typeof v === 'object') return { mapValue: { fields: keFields(v) } };
  throw new Error('Tipe tidak didukung untuk Firestore: ' + typeof v);
}
function dariValue(v) {
  if (!v || typeof v !== 'object') return null;
  if ('nullValue' in v) return null;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('stringValue' in v) return v.stringValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(dariValue);
  if ('mapValue' in v) return dariFields(v.mapValue.fields || {});
  return null;
}
function keFields(obj) {
  const fields = {};
  for (const [k, v] of Object.entries(obj || {})) { if (v !== undefined) fields[k] = keValue(v); }
  return fields;
}
function dariFields(fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields || {})) out[k] = dariValue(v);
  return out;
}

/* gzip lewat Web Streams — tidak ada modul zlib di Cloudflare Workers. */
async function gunzipKeString(bytes) {
  const ds = new DecompressionStream('gzip');
  const w = ds.writable.getWriter();
  w.write(bytes); w.close();
  return new Response(ds.readable).text();
}
async function gzipDariString(str) {
  const cs = new CompressionStream('gzip');
  const w = cs.writable.getWriter();
  w.write(new TextEncoder().encode(str)); w.close();
  return new Uint8Array(await new Response(cs.readable).arrayBuffer());
}
async function bacaPayload(obj) {
  if (obj && obj._gzb) return JSON.parse(await gunzipKeString(obj._gzb));
  return obj;
}
async function tulisPayload(stateObj) {
  const json = JSON.stringify(stateObj);
  if (json.length <= RAW_DOC_LIMIT) return JSON.parse(json);
  return { _gzb: await gzipDariString(json) };
}

/* ID 7 karakter base36 — sama dengan uid() di index.html MokaFamilyOS,
   supaya id transaksi dari sini tidak beda gaya dari yang dibuat manual
   lewat aplikasinya. */
function idTransaksi() {
  return Math.random().toString(36).slice(2, 9);
}

/* Tanggal WITA (Asia/Makassar, UTC+8) format YYYY-MM-DD — cocok dengan
   witaDateISO() di MokaFamilyOS, supaya transaksi ini masuk hitungan hari
   yang benar di ritual "tutup hari" mereka. */
function tanggalWitaHariIni() {
  const d = new Date(Date.now() + 8 * 60 * 60 * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/* Baca-ubah-tulis di dalam Firestore transaction sungguhan (bukan
   get-lalu-set) — supaya tidak pernah bentrok dengan simpanan dari HP
   siapa pun yang sedang membuka MokaFamilyOS di saat yang sama. Retry
   kalau Firestore melaporkan ABORTED (ada tulisan lain yang beriringan). */
async function transaksiKeluarga(env, mutator, { percobaan = 3 } = {}) {
  const { accessToken: token, projectId } = await accessToken(env);
  const base = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
  const docName = `projects/${projectId}/databases/(default)/documents/${FAMILY_DOC_PATH}`;
  const panggil = (path, init = {}) => fetch(`${base}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });

  let errTerakhir;
  for (let i = 1; i <= percobaan; i++) {
    const mulai = await (await panggil(':beginTransaction', { method: 'POST', body: JSON.stringify({ options: { readWrite: {} } }) })).json();
    const tx = mulai.transaction;
    try {
      const resDoc = await panggil(`/${FAMILY_DOC_PATH}?transaction=${encodeURIComponent(tx)}`);
      if (resDoc.status === 404) throw new Error('Dokumen keluarga Moka belum ada — buka aplikasi MokaFamilyOS sekali dulu.');
      if (!resDoc.ok) throw new Error('Gagal baca dokumen Moka (' + resDoc.status + '): ' + (await resDoc.text()).slice(0, 500));
      const doc = await resDoc.json();
      const state = await bacaPayload(dariFields(doc.fields || {}));

      const hasil = await mutator(state);

      const payload = await tulisPayload(state);
      const resCommit = await panggil(':commit', {
        method: 'POST',
        body: JSON.stringify({ transaction: tx, writes: [{ update: { name: docName, fields: keFields(payload) } }] }),
      });
      if (!resCommit.ok) {
        const body = await resCommit.text();
        const err = new Error('Gagal commit ke Moka (' + resCommit.status + '): ' + body.slice(0, 500));
        err.status = resCommit.status;
        err.abortedRetry = resCommit.status === 409 || /ABORTED/i.test(body);
        throw err;
      }
      return hasil;
    } catch (err) {
      errTerakhir = err;
      await panggil(':rollback', { method: 'POST', body: JSON.stringify({ transaction: tx }) }).catch(() => {});
      if (!err.abortedRetry) throw err;
      await new Promise((r) => setTimeout(r, 150 * i));
    }
  }
  throw errTerakhir;
}

/* Fungsi utama dipakai dari luar: catat satu transaksi ke dompet bernama
   namaDompet (dicocokkan tanpa peduli besar/kecil huruf — dompetnya harus
   sudah ada, dibuat manual lewat aplikasi MokaFamilyOS). */
export async function catatTransaksiMoka(env, { namaDompet, kind, jumlah, kategori, catatan }) {
  return transaksiKeluarga(env, async (state) => {
    const dompet = (state.wallets || []).find(
      (w) => String(w.name || '').trim().toUpperCase() === namaDompet.trim().toUpperCase()
    );
    if (!dompet) throw new Error(`Dompet "${namaDompet}" tidak ditemukan di MokaFamilyOS`);

    const transaksi = {
      id: idTransaksi(), walletId: dompet.id, kind,
      category: kategori, amount: Math.abs(jumlah),
      date: tanggalWitaHariIni(), note: catatan,
    };
    state.transactions = state.transactions || [];
    state.transactions.push(transaksi);
    dompet.balance = (dompet.balance || 0) + (kind === 'income' ? Math.abs(jumlah) : -Math.abs(jumlah));

    return { transaksi, saldoDompetSesudah: dompet.balance };
  });
}
