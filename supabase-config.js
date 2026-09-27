const SUPABASE_URL = 'https://vmpwraqosoiofpinxszg.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_9nULge3GJGr960eJm46nlA_nQWRhhAf';

window.supabaseClient = null;
if (window.supabase && typeof window.supabase.createClient === 'function' && SUPABASE_URL && SUPABASE_ANON_KEY) {
  window.supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      storage: window.sessionStorage,
      storageKey: 'my-dream-auth'
    }
  });
}
