// Panel de administración: empleados (CRUD), turnos, ubicación, informe y usuarios.
const Admin = (() => {
  const el = (id) => document.getElementById(id);
  let empleados = [];
  let turnos = [];
  let usuarios = [];
  let editandoCodigo = null;
  let editandoUsername = null;
  let ultimoInforme = null;

  function init() {
    el('btn-volver-kiosko').addEventListener('click', () => {
      el('vista-admin').classList.add('hidden');
      el('vista-kiosko').classList.remove('hidden');
      Kiosko.reiniciarFlujo();
    });

    document.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => cambiarTab(btn.dataset.tab));
    });

    el('btn-nuevo-empleado').addEventListener('click', () => abrirModalEmpleado(null));
    el('btn-cancelar-empleado').addEventListener('click', () => el('modal-empleado').classList.add('hidden'));
    el('btn-guardar-empleado').addEventListener('click', guardarEmpleado);
    el('tabla-empleados').addEventListener('click', onClickTablaEmpleados);
    el('tabla-empleados').addEventListener('change', onChangeTablaEmpleados);
    el('chk-empleados-todos').addEventListener('change', alternarTodosEmpleados);
    el('btn-asignar-turno').addEventListener('click', asignarTurnoSeleccionados);

    el('btn-agregar-turno').addEventListener('click', agregarTurno);
    el('btn-guardar-turnos').addEventListener('click', guardarTurnos);

    el('btn-usar-ubicacion-actual').addEventListener('click', usarUbicacionActual);
    el('btn-guardar-ubicacion').addEventListener('click', guardarUbicacion);

    el('input-informe-fecha').value = Utils.hoyISO();
    el('btn-generar-informe').addEventListener('click', () => generarInforme(el('input-informe-fecha').value));
    el('btn-exportar-excel').addEventListener('click', exportarExcel);
    el('input-informe-buscar').addEventListener('input', renderInformeFiltrado);
    el('select-informe-estado').addEventListener('change', renderInformeFiltrado);

    el('btn-nuevo-usuario').addEventListener('click', () => abrirModalUsuario(null));
    el('btn-cancelar-usuario').addEventListener('click', () => el('modal-usuario').classList.add('hidden'));
    el('btn-guardar-usuario').addEventListener('click', guardarUsuario);
    el('tabla-usuarios').addEventListener('click', onClickTablaUsuarios);
  }

  async function mostrarVistaAdmin() {
    el('vista-kiosko').classList.add('hidden');
    el('vista-admin').classList.remove('hidden');
    cambiarTab('empleados');
    // cargarTurnos() debe completarse antes que cargarEmpleados(): esta
    // última rellena el selector "Asignar turno" con el arreglo `turnos`,
    // que si todavía está vacío (carrera entre ambas peticiones) deja el
    // desplegable sin opciones.
    await cargarTurnos();
    await cargarEmpleados();
    cargarUbicacion();
    cargarUsuarios();
  }

  function cambiarTab(nombre) {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === nombre));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.toggle('hidden', p.id !== 'panel-' + nombre));
  }

  // ---------- EMPLEADOS ----------

  async function cargarEmpleados() {
    try {
      empleados = await Api.get('empleados', { token: Auth.token() });
      renderEmpleados();
      poblarSelectTurnos();
    } catch (err) {
      Utils.toast(err.message, 'error');
    }
  }

  function renderEmpleados() {
    const tbody = el('tabla-empleados').querySelector('tbody');
    tbody.innerHTML = empleados.map((e) => `
      <tr>
        <td><input type="checkbox" class="chk-empleado" data-codigo="${e.codigo}"></td>
        <td>${e.codigo}</td>
        <td>${e.nombre}</td>
        <td>${e.cargo || ''}</td>
        <td>${Utils.formatoHora(e.turno)}</td>
        <td>${e.correo || ''}</td>
        <td>
          <button class="btn-mini" data-accion="editar" data-codigo="${e.codigo}">Editar</button>
          <button class="btn-mini btn-danger" data-accion="eliminar" data-codigo="${e.codigo}">Eliminar</button>
        </td>
      </tr>`).join('');
    el('chk-empleados-todos').checked = false;
    actualizarBotonAsignarTurno();
  }

  function onClickTablaEmpleados(e) {
    const btn = e.target.closest('button');
    if (!btn) return;
    const codigo = btn.dataset.codigo;
    if (btn.dataset.accion === 'editar') {
      const emp = empleados.find((x) => String(x.codigo) === codigo);
      abrirModalEmpleado(emp);
    } else if (btn.dataset.accion === 'eliminar') {
      eliminarEmpleado(codigo);
    }
  }

  function onChangeTablaEmpleados(e) {
    if (e.target.classList.contains('chk-empleado')) actualizarBotonAsignarTurno();
  }

  function alternarTodosEmpleados() {
    const marcar = el('chk-empleados-todos').checked;
    el('tabla-empleados').querySelectorAll('.chk-empleado').forEach((chk) => { chk.checked = marcar; });
    actualizarBotonAsignarTurno();
  }

  function codigosSeleccionados() {
    return Array.from(el('tabla-empleados').querySelectorAll('.chk-empleado:checked')).map((chk) => chk.dataset.codigo);
  }

  function actualizarBotonAsignarTurno() {
    el('btn-asignar-turno').disabled = codigosSeleccionados().length === 0;
  }

  async function asignarTurnoSeleccionados() {
    const codigos = codigosSeleccionados();
    const turno = el('select-asignar-turno').value;
    if (!codigos.length || !turno) return;
    if (!confirm(`¿Asignar el turno ${turno} a ${codigos.length} empleado(s) seleccionado(s)?`)) return;

    el('btn-asignar-turno').disabled = true;
    let exitos = 0;
    const fallidos = [];
    for (const codigo of codigos) {
      const emp = empleados.find((x) => String(x.codigo) === codigo);
      if (!emp) continue;
      try {
        await Api.post('empleadoGuardar', {
          token: Auth.token(), codigo: emp.codigo, nombre: emp.nombre,
          cargo: emp.cargo || '', correo: emp.correo || '', turno
        });
        exitos++;
      } catch (err) {
        fallidos.push(emp.codigo);
      }
    }

    if (fallidos.length) {
      Utils.toast(`${exitos} de ${codigos.length} empleados actualizados. Fallaron: ${fallidos.join(', ')}`, 'error', 8000);
    } else {
      Utils.toast(`${exitos} empleado(s) actualizados con el turno ${turno}`, 'ok');
    }
    cargarEmpleados();
  }

  function poblarSelectTurnos() {
    [el('select-emp-turno'), el('select-asignar-turno')].forEach((select) => {
      const actual = select.value;
      select.innerHTML = turnos.map((t) => `<option value="${t}">${t}</option>`).join('');
      if (turnos.includes(actual)) select.value = actual;
    });
  }

  function abrirModalEmpleado(emp) {
    editandoCodigo = emp ? emp.codigo : null;
    el('modal-empleado-titulo').textContent = emp ? 'Editar empleado' : 'Nuevo empleado';
    el('input-emp-codigo').value = emp ? emp.codigo : '';
    el('input-emp-codigo').disabled = !!emp;
    el('input-emp-nombre').value = emp ? emp.nombre : '';
    el('input-emp-cargo').value = emp ? emp.cargo : '';
    el('input-emp-correo').value = emp ? (emp.correo || '') : '';
    poblarSelectTurnos();
    if (emp) el('select-emp-turno').value = Utils.formatoHora(emp.turno);
    el('modal-empleado').classList.remove('hidden');
  }

  async function guardarEmpleado() {
    const body = {
      token: Auth.token(),
      codigo: editandoCodigo || el('input-emp-codigo').value.trim(),
      nombre: el('input-emp-nombre').value.trim(),
      cargo: el('input-emp-cargo').value.trim(),
      correo: el('input-emp-correo').value.trim(),
      turno: el('select-emp-turno').value
    };
    if (!body.codigo || !body.nombre) {
      Utils.toast('Código y nombre son obligatorios', 'error');
      return;
    }
    try {
      await Api.post('empleadoGuardar', body);
      el('modal-empleado').classList.add('hidden');
      Utils.toast('Empleado guardado', 'ok');
      cargarEmpleados();
    } catch (err) {
      Utils.toast(err.message, 'error');
    }
  }

  async function eliminarEmpleado(codigo) {
    if (!confirm('¿Eliminar al empleado ' + codigo + '?')) return;
    try {
      await Api.post('empleadoEliminar', { token: Auth.token(), codigo });
      Utils.toast('Empleado eliminado', 'ok');
      cargarEmpleados();
    } catch (err) {
      Utils.toast(err.message, 'error');
    }
  }

  // ---------- TURNOS ----------

  async function cargarTurnos() {
    try {
      const cfg = await Api.get('config', { token: Auth.token() });
      turnos = cfg.turnos;
      renderTurnos();
      poblarSelectTurnos();
    } catch (err) {
      Utils.toast(err.message, 'error');
    }
  }

  function renderTurnos() {
    el('lista-turnos').innerHTML = turnos.map((t, i) => `
      <span class="chip">${t} <button data-i="${i}" class="chip-x">×</button></span>
    `).join('');
    el('lista-turnos').querySelectorAll('.chip-x').forEach((btn) => {
      btn.addEventListener('click', () => {
        turnos.splice(Number(btn.dataset.i), 1);
        renderTurnos();
      });
    });
  }

  function agregarTurno() {
    const val = el('input-nuevo-turno').value;
    if (!val) return;
    if (!turnos.includes(val)) {
      turnos.push(val);
      turnos.sort();
      renderTurnos();
    }
    el('input-nuevo-turno').value = '';
  }

  async function guardarTurnos() {
    try {
      await Api.post('turnosGuardar', { token: Auth.token(), turnos });
      Utils.toast('Turnos guardados', 'ok');
      poblarSelectTurnos();
    } catch (err) {
      Utils.toast(err.message, 'error');
    }
  }

  // ---------- UBICACIÓN ----------

  async function cargarUbicacion() {
    try {
      const cfg = await Api.get('config', { token: Auth.token() });
      el('input-lat').value = cfg.lat || '';
      el('input-lng').value = cfg.lng || '';
      el('input-radio').value = cfg.radio || 5;
    } catch (err) {
      Utils.toast(err.message, 'error');
    }
  }

  async function usarUbicacionActual() {
    try {
      const pos = await Utils.getUbicacionActual();
      el('input-lat').value = pos.lat.toFixed(7);
      el('input-lng').value = pos.lng.toFixed(7);
      Utils.toast(`Ubicación capturada (precisión ±${pos.accuracy.toFixed(0)} m)`, 'ok');
    } catch (err) {
      Utils.toast(err.message, 'error');
    }
  }

  async function guardarUbicacion() {
    const lat = Number(el('input-lat').value);
    const lng = Number(el('input-lng').value);
    const radio = Number(el('input-radio').value) || 5;
    if (!lat || !lng) {
      Utils.toast('Debe indicar latitud y longitud', 'error');
      return;
    }
    try {
      await Api.post('configGuardar', { token: Auth.token(), lat, lng, radio });
      Utils.toast('Ubicación guardada', 'ok');
    } catch (err) {
      Utils.toast(err.message, 'error');
    }
  }

  // ---------- INFORME ----------

  async function generarInforme(fecha) {
    try {
      ultimoInforme = await Api.post('informe', { token: Auth.token(), fecha });
      el('input-informe-buscar').value = '';
      el('select-informe-estado').value = '';
      renderInformeFiltrado();
    } catch (err) {
      Utils.toast(err.message, 'error');
    }
  }

  function informeFiltrado() {
    const termino = el('input-informe-buscar').value.trim().toLowerCase();
    const estado = el('select-informe-estado').value;
    const coincide = (r) =>
      (!termino || r.nombre.toLowerCase().includes(termino) || String(r.codigo).toLowerCase().includes(termino));

    return {
      registrados: ultimoInforme.registrados.filter((r) => coincide(r) && (!estado || r.estado === estado)),
      noRegistrados: estado ? [] : ultimoInforme.noRegistrados.filter(coincide)
    };
  }

  function renderInformeFiltrado() {
    if (!ultimoInforme) return;
    const { registrados, noRegistrados } = informeFiltrado();

    el('resumen-informe').textContent =
      `Fecha ${ultimoInforme.fecha} — Registrados: ${ultimoInforme.registrados.length} · No registrados: ${ultimoInforme.noRegistrados.length}`;

    el('tabla-registrados').querySelector('tbody').innerHTML = registrados.map((r) => `
      <tr><td>${r.codigo}</td><td>${r.nombre}</td><td>${Utils.formatoHora(r.turno)}</td><td>${r.horaIngreso}</td><td>${r.horaSalida || '-'}</td><td>${r.estado}</td><td>${r.horasExtras || '-'}</td></tr>
    `).join('');

    el('tabla-no-registrados').querySelector('tbody').innerHTML = noRegistrados.map((r) => `
      <tr><td>${r.codigo}</td><td>${r.nombre}</td><td>${r.cargo || ''}</td><td>${Utils.formatoHora(r.turno)}</td></tr>
    `).join('');
  }

  function exportarExcel() {
    if (!ultimoInforme) {
      Utils.toast('Primero genere el informe', 'error');
      return;
    }
    const { registrados, noRegistrados } = informeFiltrado();
    const wb = XLSX.utils.book_new();
    const hojaReg = XLSX.utils.json_to_sheet(registrados.map((r) => ({
      CODIGO: r.codigo, NOMBRE: r.nombre, CARGO: r.cargo, TURNO: Utils.formatoHora(r.turno),
      'HORA INGRESO': r.horaIngreso, 'HORA SALIDA': r.horaSalida, ESTADO: r.estado,
      'HORAS EXTRAS': r.horasExtras || '-'
    })));
    const hojaNoReg = XLSX.utils.json_to_sheet(noRegistrados.map((r) => ({
      CODIGO: r.codigo, NOMBRE: r.nombre, CARGO: r.cargo, TURNO: Utils.formatoHora(r.turno)
    })));
    XLSX.utils.book_append_sheet(wb, hojaReg, 'Registrados');
    XLSX.utils.book_append_sheet(wb, hojaNoReg, 'No registrados');
    XLSX.writeFile(wb, `informe_asistencia_${ultimoInforme.fecha}.xlsx`);
  }

  // ---------- USUARIOS ----------

  async function cargarUsuarios() {
    try {
      usuarios = await Api.post('usuarios', { token: Auth.token() });
      renderUsuarios();
    } catch (err) {
      Utils.toast(err.message, 'error');
    }
  }

  function renderUsuarios() {
    const tbody = el('tabla-usuarios').querySelector('tbody');
    tbody.innerHTML = usuarios.map((u) => `
      <tr>
        <td>${u.username}</td>
        <td>${u.nombre}</td>
        <td>
          <button class="btn-mini" data-accion="editar" data-username="${u.username}">Editar</button>
          <button class="btn-mini btn-danger" data-accion="eliminar" data-username="${u.username}">Eliminar</button>
        </td>
      </tr>`).join('');
  }

  function onClickTablaUsuarios(e) {
    const btn = e.target.closest('button');
    if (!btn) return;
    const username = btn.dataset.username;
    if (btn.dataset.accion === 'editar') {
      const u = usuarios.find((x) => x.username === username);
      abrirModalUsuario(u);
    } else if (btn.dataset.accion === 'eliminar') {
      eliminarUsuario(username);
    }
  }

  function abrirModalUsuario(usuario) {
    editandoUsername = usuario ? usuario.username : null;
    el('modal-usuario-titulo').textContent = usuario ? 'Editar usuario' : 'Nuevo usuario';
    el('input-usuario-username').value = usuario ? usuario.username : '';
    el('input-usuario-nombre').value = usuario ? usuario.nombre : '';
    el('input-usuario-password').value = '';
    el('input-usuario-password').placeholder = usuario ? 'Dejar en blanco para no cambiarla' : 'Contraseña';
    el('modal-usuario').classList.remove('hidden');
  }

  async function guardarUsuario() {
    const body = {
      token: Auth.token(),
      username: el('input-usuario-username').value.trim(),
      nombre: el('input-usuario-nombre').value.trim(),
      password: el('input-usuario-password').value
    };
    if (editandoUsername) body.usernameOriginal = editandoUsername;
    if (!body.username || !body.nombre) {
      Utils.toast('Usuario y nombre son obligatorios', 'error');
      return;
    }
    if (!editandoUsername && !body.password) {
      Utils.toast('La contraseña es obligatoria para un usuario nuevo', 'error');
      return;
    }
    try {
      await Api.post('usuarioGuardar', body);
      el('modal-usuario').classList.add('hidden');
      Utils.toast('Usuario guardado', 'ok');
      cargarUsuarios();
    } catch (err) {
      Utils.toast(err.message, 'error');
    }
  }

  async function eliminarUsuario(username) {
    if (!confirm('¿Eliminar al usuario ' + username + '?')) return;
    try {
      await Api.post('usuarioEliminar', { token: Auth.token(), username });
      Utils.toast('Usuario eliminado', 'ok');
      cargarUsuarios();
    } catch (err) {
      Utils.toast(err.message, 'error');
    }
  }

  // ---------- NOTIFICACIÓN DE ÚLTIMO TURNO ----------

  function notificarUltimoTurno() {
    if (!Auth.estaLogueado()) {
      Utils.toast('Se completó el ingreso del último turno. Inicie sesión como administrador para ver el informe.', 'info', 6000);
      return;
    }
    mostrarVistaAdmin();
    cambiarTab('informe');
    generarInforme(Utils.hoyISO());
  }

  return { init, mostrarVistaAdmin, notificarUltimoTurno };
})();
