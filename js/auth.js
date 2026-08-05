// Login y sesión del panel de administración. El kiosco de registro es
// público (no requiere iniciar sesión); solo entrar a "Administración" pide
// usuario y contraseña.
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

  function guardarSesion(s) {
    sessionStorage.setItem('sesion', JSON.stringify(s));
  }

  function limpiarSesion() {
    sessionStorage.removeItem('sesion');
  }

  function estaLogueado() {
    return !!sesion();
  }

  function abrirLoginOAdmin() {
    if (estaLogueado()) {
      Admin.mostrarVistaAdmin();
    } else {
      el('input-admin-usuario').value = '';
      el('input-admin-password').value = '';
      el('modal-admin-login').classList.remove('hidden');
      el('input-admin-usuario').focus();
    }
  }

  async function hacerLogin() {
    const username = el('input-admin-usuario').value.trim();
    const password = el('input-admin-password').value;
    if (!username || !password) {
      Utils.toast('Ingrese usuario y contraseña', 'error');
      return;
    }
    try {
      const data = await Api.post('login', { username, password });
      guardarSesion({ token: data.token, nombre: data.nombre, username: data.username });
      el('modal-admin-login').classList.add('hidden');
      Admin.mostrarVistaAdmin();
    } catch (err) {
      Utils.toast(err.message, 'error');
    }
  }

  function cerrarSesion() {
    limpiarSesion();
    el('vista-admin').classList.add('hidden');
    el('vista-kiosko').classList.remove('hidden');
    Kiosko.reiniciarFlujo();
  }

  function abrirModalCuenta() {
    el('input-cuenta-nueva-password').value = '';
    el('input-cuenta-confirmar-password').value = '';
    el('modal-cuenta').classList.remove('hidden');
  }

  async function guardarPasswordPropia() {
    const p1 = el('input-cuenta-nueva-password').value;
    const p2 = el('input-cuenta-confirmar-password').value;
    if (p1.length < 4) { Utils.toast('Mínimo 4 caracteres', 'error'); return; }
    if (p1 !== p2) { Utils.toast('Las contraseñas no coinciden', 'error'); return; }
    try {
      await Api.post('passwordCambiar', { token: token(), nuevaPassword: p1 });
      el('modal-cuenta').classList.add('hidden');
      Utils.toast('Contraseña actualizada', 'ok');
    } catch (err) {
      Utils.toast(err.message, 'error');
    }
  }

  function init() {
    el('btn-abrir-admin').addEventListener('click', abrirLoginOAdmin);
    el('btn-cerrar-login').addEventListener('click', () => el('modal-admin-login').classList.add('hidden'));
    el('btn-admin-login').addEventListener('click', hacerLogin);
    el('input-admin-usuario').addEventListener('keydown', (e) => { if (e.key === 'Enter') hacerLogin(); });
    el('input-admin-password').addEventListener('keydown', (e) => { if (e.key === 'Enter') hacerLogin(); });
    el('btn-cerrar-sesion').addEventListener('click', cerrarSesion);
    el('btn-mi-cuenta').addEventListener('click', abrirModalCuenta);
    el('btn-cancelar-cuenta').addEventListener('click', () => el('modal-cuenta').classList.add('hidden'));
    el('btn-guardar-cuenta-password').addEventListener('click', guardarPasswordPropia);
  }

  return { init, token, cerrarSesion, estaLogueado };
})();

document.addEventListener('DOMContentLoaded', () => {
  Kiosko.init();
  Kiosko.mostrar();
  Admin.init();
  Auth.init();
});
