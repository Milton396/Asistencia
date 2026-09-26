// Capa de comunicación con el backend (Supabase Edge Functions).
const Api = (() => {
  const FUNCTIONS_URL = `${SUPABASE_URL}/functions/v1/api`;

  // A diferencia de Apps Script (que no pedía nada), Supabase exige un
  // Authorization: Bearer en toda solicitud. Se usa la anon key para las
  // acciones públicas, y el access_token de la sesión de administrador
  // (pasado como "token" en params/payload, igual que antes) para las
  // que lo necesitan — la Edge Function decide con ese token si hay
  // permiso de administrador (ver requireAdmin en supabase/functions/api).
  async function get(action, params = {}) {
    const url = new URL(FUNCTIONS_URL);
    url.searchParams.set('action', action);
    const token = params.token || SUPABASE_ANON_KEY;
    Object.entries(params).forEach(([k, v]) => {
      if (k !== 'token') url.searchParams.set(k, v);
    });
    const resp = await fetch(url.toString(), {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` }
    });
    return parse(resp);
  }

  async function post(action, payload = {}) {
    const token = payload.token || SUPABASE_ANON_KEY;
    const resp = await fetch(FUNCTIONS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action, ...payload })
    });
    return parse(resp);
  }

  const ERRORES_SESION = ['No autorizado. Inicie sesión.', 'Token inválido', 'Sesión expirada. Vuelva a iniciar sesión.'];

  async function parse(resp) {
    let json;
    try {
      json = await resp.json();
    } catch (e) {
      throw new Error('Respuesta inválida del servidor');
    }
    if (!json.ok) {
      if (ERRORES_SESION.includes(json.error) && typeof Auth !== 'undefined') {
        Auth.cerrarSesion();
      }
      throw new Error(json.error || 'Error desconocido');
    }
    return json.data;
  }

  return { get, post };
})();
