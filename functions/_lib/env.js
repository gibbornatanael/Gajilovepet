/* =========================================================================
   functions/_lib/env.js — membaca secret dari Cloudflare
   -------------------------------------------------------------------------
   Binding tipe "Secrets Store" muncul di `env` sebagai OBJEK dengan method
   `.get()` (async) — bukan langsung string seperti Environment Variable
   biasa. Fungsi ini menyamakan keduanya supaya kode lain tinggal memakai
   `env.NAMA` sebagai string, tidak peduli dipasang lewat Secrets Store,
   Environment Variable biasa, atau `.dev.vars` saat `wrangler dev` lokal.
   ========================================================================= */
export async function bacaEnv(env, namaDaftar) {
  const hasil = {};
  for (const nama of namaDaftar) {
    const v = env[nama];
    hasil[nama] = (v && typeof v.get === 'function') ? await v.get() : String(v || '');
  }
  return Object.assign({}, env, hasil);
}
