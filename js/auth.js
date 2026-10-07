// Login y sesión del panel de administración. El kiosco de registro es
// público (no requiere iniciar sesión); solo entrar a "Administración" pide
// usuario y contraseña — que ahora es el CORREO de la cuenta de Supabase
// Auth (ver supabase/README.md), no un username corto como antes. La
// sesión la maneja SUPABASE_CLIENT (js/config.js) con sessionStorage: se
// cierra sola al cerrar la pestaña/navegador, igual que el token propio
// de antes.
const Auth = (() => {
  const el = (id) => document.getElementById(id);

  let sesionActual = null; // sesión de Supabase Auth (access_token, etc.)
  let perfilActual = null; // { nombre, rol, email } vía la acción "perfil"
  // true cuando el modal "Mi cuenta" se abrió desde un enlace de
  // recuperación de contraseña (no desde el botón normal estando ya
  // logueado) — al guardar, hay que llevar al usuario al panel de
  // Administración en vez de solo cerrar el modal.
  let recuperandoPassword = false;

  function token() {
    return sesionActual ? sesionActual.access_token : null;
  }

  function estaLogueado() {
    return !!sesionActual;
  }

  function nombre() {
    return perfilActual ? perfilActual.nombre : '';
  }

  // "perfil" confirma además que la cuenta tiene acceso de administrador
  // (perfilActual queda null si no lo tiene o si el token ya no es válido).
  async function cargarPerfil() {
    try {
      perfilActual = await Api.post('perfil', { token: token() });
    } catch (err) {
      perfilActual = null;
    }
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
    const email = el('input-admin-usuario').value.trim();
    const password = el('input-admin-password').value;
    if (!email || !password) {
      Utils.toast('Ingrese usuario y contraseña', 'error');
      return;
    }
    try {
      const { data, error } = await SUPABASE_CLIENT.auth.signInWithPassword({ email, password });
      if (error) throw new Error('Usuario o contraseña incorrectos');
      sesionActual = data.session;
      await cargarPerfil();
      if (!perfilActual) {
        await SUPABASE_CLIENT.auth.signOut();
        sesionActual = null;
        throw new Error('Esta cuenta no tiene acceso de administrador.');
      }
      el('modal-admin-login').classList.add('hidden');
      Admin.mostrarVistaAdmin();
    } catch (err) {
      Utils.toast(err.message, 'error');
    }
  }

  async function cerrarSesion() {
    await SUPABASE_CLIENT.auth.signOut();
    sesionActual = null;
    perfilActual = null;
    el('vista-admin').classList.add('hidden');
    el('vista-kiosko').classList.remove('hidden');
    Kiosko.reiniciarFlujo();
  }

  function abrirModalRecuperar() {
    el('modal-admin-login').classList.add('hidden');
    el('input-recuperar-correo').value = el('input-admin-usuario').value.trim();
    el('modal-recuperar').classList.remove('hidden');
    el('input-recuperar-correo').focus();
  }

  async function enviarEnlaceRecuperacion() {
    const email = el('input-recuperar-correo').value.trim();
    if (!email) {
      Utils.toast('Ingrese su correo', 'error');
      return;
    }
    try {
      const { error } = await SUPABASE_CLIENT.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + window.location.pathname
      });
      if (error) throw new Error(error.message);
      el('modal-recuperar').classList.add('hidden');
      Utils.toast('Si el correo existe, se envió un enlace para restablecer la contraseña', 'ok', 6000);
    } catch (err) {
      Utils.toast(err.message, 'error');
    }
  }

  function abrirModalCuenta() {
    el('modal-cuenta-titulo').textContent = 'Mi cuenta';
    el('input-cuenta-nueva-password').value = '';
    el('input-cuenta-confirmar-password').value = '';
    el('modal-cuenta').classList.remove('hidden');
  }

  // Se abre sola cuando el usuario llega desde el enlace de recuperación
  // del correo (ver el listener de onAuthStateChange en init()).
  function abrirModalCuentaParaRecuperar() {
    recuperandoPassword = true;
    el('modal-cuenta-titulo').textContent = 'Restablecer contraseña';
    el('input-cuenta-nueva-password').value = '';
    el('input-cuenta-confirmar-password').value = '';
    el('modal-admin-login').classList.add('hidden');
    el('modal-recuperar').classList.add('hidden');
    el('modal-cuenta').classList.remove('hidden');
  }

  async function guardarPasswordPropia() {
    const p1 = el('input-cuenta-nueva-password').value;
    const p2 = el('input-cuenta-confirmar-password').value;
    if (p1.length < 4) { Utils.toast('Mínimo 4 caracteres', 'error'); return; }
    if (p1 !== p2) { Utils.toast('Las contraseñas no coinciden', 'error'); return; }
    try {
      const { error } = await SUPABASE_CLIENT.auth.updateUser({ password: p1 });
      if (error) throw new Error(error.message);
      el('modal-cuenta').classList.add('hidden');
      Utils.toast('Contraseña actualizada', 'ok');
      if (recuperandoPassword) {
        // La sesión de recuperación ya es una sesión válida de Supabase
        // Auth: se aprovecha para entrar directo, en vez de pedir que
        // vuelva a iniciar sesión con la contraseña que recién puso.
        recuperandoPassword = false;
        await cargarPerfil();
        if (perfilActual) Admin.mostrarVistaAdmin();
      }
    } catch (err) {
      Utils.toast(err.message, 'error');
    }
  }

  async function init() {
    el('btn-abrir-admin').addEventListener('click', abrirLoginOAdmin);
    el('btn-cerrar-login').addEventListener('click', () => el('modal-admin-login').classList.add('hidden'));
    el('btn-admin-login').addEventListener('click', hacerLogin);
    el('input-admin-usuario').addEventListener('keydown', (e) => { if (e.key === 'Enter') hacerLogin(); });
    el('input-admin-password').addEventListener('keydown', (e) => { if (e.key === 'Enter') hacerLogin(); });
    el('link-olvide-password').addEventListener('click', (e) => { e.preventDefault(); abrirModalRecuperar(); });
    el('btn-cancelar-recuperar').addEventListener('click', () => el('modal-recuperar').classList.add('hidden'));
    el('btn-enviar-recuperar').addEventListener('click', enviarEnlaceRecuperacion);
    el('input-recuperar-correo').addEventListener('keydown', (e) => { if (e.key === 'Enter') enviarEnlaceRecuperacion(); });
    el('btn-cerrar-sesion').addEventListener('click', cerrarSesion);
    el('btn-mi-cuenta').addEventListener('click', abrirModalCuenta);
    el('btn-cancelar-cuenta').addEventListener('click', () => el('modal-cuenta').classList.add('hidden'));
    el('btn-guardar-cuenta-password').addEventListener('click', guardarPasswordPropia);

    // Cuando el usuario llega desde el enlace de "recuperar contraseña"
    // del correo, Supabase detecta el token en la URL al cargar la
    // página y dispara este evento con una sesión temporal válida.
    SUPABASE_CLIENT.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        sesionActual = session;
        abrirModalCuentaParaRecuperar();
      }
    });

    // Restaura la sesión guardada en sessionStorage (ej. al recargar la
    // página estando logueado) antes de que el resto de la app pregunte
    // por Auth.estaLogueado()/Auth.token().
    const { data } = await SUPABASE_CLIENT.auth.getSession();
    if (data.session) {
      sesionActual = data.session;
      await cargarPerfil();
    }
  }

  return { init, token, cerrarSesion, estaLogueado, nombre };
})();

document.addEventListener('DOMContentLoaded', () => {
  Kiosko.init();
  Kiosko.mostrar();
  Admin.init();
  Auth.init();
});
