// Capa de comunicación con el backend (Google Apps Script).
const Api = (() => {
  async function get(action, params = {}) {
    const url = new URL(APPS_SCRIPT_URL);
    url.searchParams.set('action', action);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    const resp = await fetch(url.toString(), { method: 'GET' });
    return parse(resp);
  }

  async function post(action, payload = {}) {
    const resp = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      // text/plain evita el preflight CORS que Apps Script no maneja bien.
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, ...payload })
    });
    return parse(resp);
  }

  const ERRORES_SESION = [
    'No autorizado. Inicie sesión.', 'Token inválido', 'Sesión expirada. Vuelva a iniciar sesión.',
    'Cuenta bloqueada. Contacte al administrador.'
  ];

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
