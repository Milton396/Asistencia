// Sesión de usuario: login, almacenamiento del token y enrutamiento entre
// la pantalla de login, el kiosco y el panel de administración según el rol.
const Auth = (() => {
  const el = (id) => document.getElementById(id);

  function sesion() {
    const raw = sessionStorage.getItem('sesion');
    return raw ? JSON.parse(raw) : null;
  }

  function token() {
    const s = sesion();
    return s ? s.token : null;
  }

  function rol() {
    const s = sesion();
    return s ? s.rol : null;
  }

  function guardarSesion(s) {
    sessionStorage.setItem('sesion', JSON.stringify(s));
  }

  function limpiarSesion() {
    sessionStorage.removeItem('sesion');
  }

  function mostrarLogin() {
    el('vista-login').classList.remove('hidden');
    el('vista-kiosko').classList.add('hidden');
    el('vista-admin').classList.add('hidden');
    el('btn-abrir-admin').classList.add('hidden');
    el('btn-cerrar-sesion').classList.add('hidden');
    el('input-login-password').value = '';
    el('input-login-usuario').focus();
  }

  async function mostrarAppSegunSesion() {
    const s = sesion();
    if (!s) {
      mostrarLogin();
      return;
    }
    el('vista-login').classList.add('hidden');
    el('vista-admin').classList.add('hidden');
    el('vista-kiosko').classList.remove('hidden');
    el('btn-abrir-admin').classList.toggle('hidden', s.rol !== 'administrador');
    el('btn-cerrar-sesion').classList.remove('hidden');
    await Kiosko.mostrar();
  }

  async function hacerLogin() {
    const username = el('input-login-usuario').value.trim();
    const password = el('input-login-password').value;
    if (!username || !password) {
      Utils.toast('Ingrese usuario y contraseña', 'error');
      return;
    }
    try {
      const data = await Api.post('login', { username, password });
      guardarSesion({ token: data.token, rol: data.rol, nombre: data.nombre, username: data.username });
      await mostrarAppSegunSesion();
    } catch (err) {
      Utils.toast(err.message, 'error');
    }
  }

  function cerrarSesion() {
    limpiarSesion();
    mostrarLogin();
  }

  function init() {
    el('btn-login').addEventListener('click', hacerLogin);
    el('input-login-usuario').addEventListener('keydown', (e) => { if (e.key === 'Enter') hacerLogin(); });
    el('input-login-password').addEventListener('keydown', (e) => { if (e.key === 'Enter') hacerLogin(); });
    el('btn-cerrar-sesion').addEventListener('click', cerrarSesion);
    mostrarAppSegunSesion();
  }

  return { init, token, rol, cerrarSesion };
})();

document.addEventListener('DOMContentLoaded', () => {
  Kiosko.init();
  Admin.init();
  Auth.init();
});
