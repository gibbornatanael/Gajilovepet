/* =========================================================================
   functions/_lib/firestoreAdmin.js — tulis ke Firestore dari Worker
   -------------------------------------------------------------------------
   Tidak ada Cloud Functions di proyek ini (sengaja, supaya tetap gratis),
   jadi Worker yang jalan sendiri lewat Cron Trigger tidak bisa memakai
   Firebase Auth biasa seperti browser. Sebagai gantinya, ia login sebagai
   service account Google Cloud lewat REST API biasa: tanda tangani JWT
   dengan Web Crypto (RS256), tukar ke access token, lalu panggil Firestore
   REST API langsung — semua lewat fetch(), tanpa firebase-admin/Node SDK.

   env.FIREBASE_SERVICE_ACCOUNT_JSON = isi mentah file JSON service account
   (Firebase Console → Project Settings → Service Accounts → Generate new
   private key). Simpan sebagai secret, JANGAN taruh di kode.
   ========================================================================= */

const SCOPE = 'https://www.googleapis.com/auth/datastore';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

async function ambilAccessToken(serviceAccountJson) {
  const sa = JSON.parse(serviceAccountJson);
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: sa.client_email,
    scope: SCOPE,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  };
  const enc = (obj) => base64url(new TextEncoder().encode(JSON.stringify(obj)));
  const isi = `${enc(header)}.${enc(claim)}`;

  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemKeDer(sa.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const tanda = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(isi));
  const jwt = `${isi}.${base64url(new Uint8Array(tanda))}`;

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${encodeURIComponent(jwt)}`,
  });
  const j = await res.json();
  if (!res.ok || !j.access_token) throw new Error('Gagal ambil access token Google: ' + JSON.stringify(j));
  return { accessToken: j.access_token, projectId: sa.project_id };
}

function pemKeDer(pem) {
  const isi = pem.replace(/-----BEGIN PRIVATE KEY-----/, '').replace(/-----END PRIVATE KEY-----/, '').replace(/\s+/g, '');
  const bin = atob(isi);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}
function base64url(bytes) {
  let bin = '';
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/* Ubah nilai JS biasa ke format "Value" Firestore REST. Cuma dukung
   string/number/object polos/array — cukup untuk dokumen ringkasan ini. */
function keFirestoreValue(v) {
  if (v == null) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(keFirestoreValue) } };
  if (typeof v === 'object') {
    const fields = {};
    for (const k of Object.keys(v)) fields[k] = keFirestoreValue(v[k]);
    return { mapValue: { fields } };
  }
  return { stringValue: String(v) };
}

/* Timpa (bukan gabung) satu dokumen Firestore lewat REST API. */
export async function tulisDokumen(env, pathSegmen, data) {
  const { accessToken, projectId } = await ambilAccessToken(env.FIREBASE_SERVICE_ACCOUNT_JSON);
  const nama = pathSegmen.join('/');
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${nama}`;

  const fields = {};
  for (const k of Object.keys(data)) fields[k] = keFirestoreValue(data[k]);

  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) throw new Error('Firestore menolak tulis (' + res.status + '): ' + (await res.text()));
  return res.json();
}
