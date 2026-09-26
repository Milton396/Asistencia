// Proyecto de Supabase (backend, reemplaza Apps Script — ver
// supabase/README.md). SUPABASE_ANON_KEY es pública a propósito: es la
// misma que usa cualquier cliente de Supabase, no una credencial secreta
// (esa es la service role key, que solo vive del lado de las Edge
// Functions y nunca se expone aquí).
const SUPABASE_URL = 'https://uquodnqaxqfnyialqlkp.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_3Kgjg7cP1lt0qWBl3trPRg_2qSAN70w';

// sessionStorage (no localStorage): la sesión de administrador se cierra
// sola al cerrar la pestaña/navegador, igual que antes con el token propio.
const SUPABASE_CLIENT = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: window.sessionStorage,
    persistSession: true,
    autoRefreshToken: true,
  },
});
