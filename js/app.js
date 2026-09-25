// Lógica del kiosco de registro de asistencia (entrada / salida).
const Kiosko = (() => {
  const MARGEN_PRECISION_MAX = 50; // metros; tope al margen de error GPS que se acepta

  let modo = 'ingreso';
  let tabActivo = 'empleados'; // 'empleados' | 'externos' | 'registro'
  let empleados = [];
  let empleadoActual = null;
  let externoActual = null; // { cedula, nombre, departamento, nuevo, motivo? }
  let ubicacion = null;
  let fotoBase64 = null;
  // Se incrementa en cada reinicio de flujo o nueva verificación de ubicación,
  // para poder descartar respuestas de GPS que lleguen tarde (de un intento
  // anterior) y no pisen el estado de un ciclo más nuevo.
  let tokenUbicacion = 0;

  const el = (id) => document.getElementById(id);

  function init() {
    el('btn-kiosko-empleados').addEventListener('click', () => seleccionarTab('empleados'));
    el('btn-kiosko-externos').addEventListener('click', () => seleccionarTab('externos'));
    el('btn-kiosko-registro').addEventListener('click', () => seleccionarTab('registro'));
    el('btn-modo-ingreso').addEventListener('click', () => seleccionarModo('ingreso'));
    el('btn-modo-salida').addEventListener('click', () => seleccionarModo('salida'));
    el('input-codigo').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') buscarEmpleado();
    });
    // Respaldo del Enter: en varias tablets el teclado numérico
    // (inputmode="numeric") no muestra tecla Enter/Done.
    el('btn-buscar-codigo').addEventListener('click', buscarEmpleado);
    el('input-cedula').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') buscarExterno();
    });
    el('btn-buscar-cedula').addEventListener('click', buscarExterno);
    el('input-externo-nombre').addEventListener('input', actualizarBotonContinuarExterno);
    el('input-externo-departamento').addEventListener('input', actualizarBotonContinuarExterno);
    el('select-externo-motivo').addEventListener('change', actualizarBotonContinuarExterno);
    el('btn-externo-continuar').addEventListener('click', continuarExterno);
    el('btn-verificar-ubicacion').addEventListener('click', verificarUbicacion);
    el('btn-capturar').addEventListener('click', capturarFoto);
    el('btn-reintentar').addEventListener('click', reintentarFoto);
    el('btn-confirmar').addEventListener('click', confirmarRegistro);
  }

  async function mostrar() {
    reiniciarFlujo();
    await refrescarEmpleados();
  }

  function seleccionarModo(m) {
    modo = m;
    el('btn-modo-ingreso').classList.toggle('active', m === 'ingreso');
    el('btn-modo-salida').classList.toggle('active', m === 'salida');
    reiniciarFlujo();
  }

  function seleccionarTab(tab) {
    tabActivo = tab;
    el('btn-kiosko-empleados').classList.toggle('active', tab === 'empleados');
    el('btn-kiosko-externos').classList.toggle('active', tab === 'externos');
    el('btn-kiosko-registro').classList.toggle('active', tab === 'registro');
    el('panel-kiosko-empleados').classList.toggle('hidden', tab !== 'empleados');
    el('panel-kiosko-externos').classList.toggle('hidden', tab !== 'externos');
    el('panel-kiosko-registro').classList.toggle('hidden', tab !== 'registro');
    el('modo-selector').classList.toggle('hidden', tab === 'registro');
    reiniciarFlujo();
    if (tab === 'registro') {
      cargarRegistroEmpleadosHoy();
      cargarRegistroExternosHoy();
    }
  }

  function reiniciarFlujo() {
    tokenUbicacion++; // invalida cualquier verificación de ubicación del ciclo anterior que siga en curso
    empleadoActual = null;
    externoActual = null;
    ubicacion = null;
    fotoBase64 = null;
    Camera.detener();
    el('input-codigo').value = '';
    el('empleado-card').classList.add('hidden');
    el('input-cedula').value = '';
    el('externo-card').classList.add('hidden');
    el('externo-form').classList.add('hidden');
    el('externo-campos-nuevo').classList.add('hidden');
    el('input-externo-nombre').value = '';
    el('input-externo-departamento').value = '';
    el('select-externo-motivo').value = '';
    el('btn-externo-continuar').disabled = true;
    el('paso-observacion').classList.add('hidden');
    el('paso-ubicacion').classList.add('hidden');
    el('paso-camara').classList.add('hidden');
    el('paso-confirmar').classList.add('hidden');
    el('foto-preview').classList.remove('hidden');
    el('btn-reintentar').classList.remove('hidden');
    el('resultado').classList.add('hidden');
    el('input-observacion').value = '';
    // En varios navegadores/tablets móviles, pedir el foco justo al ocultar
    // o mostrar elementos no reabre el teclado; un pequeño retraso lo hace confiable.
    // La pestaña Registro no tiene campo que enfocar.
    const idFoco = tabActivo === 'empleados' ? 'input-codigo' : tabActivo === 'externos' ? 'input-cedula' : null;
    if (idFoco) setTimeout(() => el(idFoco).focus(), 50);
  }

  async function refrescarEmpleados() {
    try {
      empleados = await Api.get('empleados');
    } catch (err) {
      Utils.toast('No se pudo conectar con el servidor: ' + err.message, 'error', 8000);
    }
  }

  function buscarEmpleado() {
    const codigo = el('input-codigo').value.trim();
    if (!codigo) return;
    const emp = empleados.find((e) => String(e.codigo) === codigo);
    const card = el('empleado-card');
    if (!emp) {
      card.classList.remove('hidden');
      card.innerHTML = `<p class="error">Código no encontrado</p>`;
      empleadoActual = null;
      return;
    }
    empleadoActual = emp;
    card.classList.remove('hidden');
    card.innerHTML = `<p><strong>${Utils.escapeHtml(emp.nombre)}</strong></p><p>${Utils.escapeHtml(emp.cargo || '')} · Turno ${Utils.escapeHtml(Utils.formatoHora(emp.turno))}</p>`;
    el('paso-observacion').classList.remove('hidden');
    el('paso-ubicacion').classList.remove('hidden');
    el('paso-camara').classList.add('hidden');
    el('paso-confirmar').classList.add('hidden');
    verificarUbicacion();
  }

  // Autoregistro libre: cualquiera puede escribir su cédula. Si ya se
  // registró antes con esa cédula, se recuperan nombre y departamento/proveedor
  // guardados (no hace falta volver a escribirlos); si es la primera vez,
  // se piden y quedan guardados para la próxima visita. El motivo del
  // ingreso, en cambio, se pide siempre en modo Entrada (cambia cada visita)
  // y no se vuelve a pedir en modo Salida.
  async function buscarExterno() {
    const cedula = el('input-cedula').value.trim();
    const card = el('externo-card');
    const form = el('externo-form');
    card.classList.add('hidden');
    form.classList.add('hidden');
    el('externo-campos-nuevo').classList.add('hidden');
    el('paso-observacion').classList.add('hidden');
    el('paso-ubicacion').classList.add('hidden');
    el('paso-camara').classList.add('hidden');
    el('paso-confirmar').classList.add('hidden');
    externoActual = null;
    if (!cedula) return;
    if (!Utils.validarCedulaEcuatoriana(cedula)) {
      card.classList.remove('hidden');
      card.innerHTML = `<p class="error">Cédula inválida</p>`;
      return;
    }
    try {
      const encontrado = await Api.get('externoBuscar', { cedula });
      if (!encontrado && modo === 'salida') {
        card.classList.remove('hidden');
        card.innerHTML = `<p class="error">Cédula no encontrada. Debe registrar el ingreso primero.</p>`;
        return;
      }
      externoActual = encontrado
        ? { cedula, nombre: encontrado.nombre, departamento: encontrado.departamento, nuevo: false }
        : { cedula, nombre: '', departamento: '', nuevo: true };
      if (encontrado) {
        card.classList.remove('hidden');
        card.innerHTML = `<p><strong>${Utils.escapeHtml(encontrado.nombre)}</strong></p><p>${Utils.escapeHtml(encontrado.departamento)}</p>`;
      }
      form.classList.remove('hidden');
      if (modo === 'ingreso') {
        el('externo-campos-nuevo').classList.toggle('hidden', !externoActual.nuevo);
        el('campo-externo-motivo').classList.remove('hidden');
      } else {
        el('externo-campos-nuevo').classList.add('hidden');
        el('campo-externo-motivo').classList.add('hidden');
      }
      actualizarBotonContinuarExterno();
    } catch (err) {
      card.classList.remove('hidden');
      card.innerHTML = `<p class="error">${Utils.escapeHtml(err.message)}</p>`;
    }
  }

  function actualizarBotonContinuarExterno() {
    const btn = el('btn-externo-continuar');
    if (!externoActual) { btn.disabled = true; return; }
    if (modo === 'salida') { btn.disabled = false; return; } // ya se validó que existe
    const motivo = el('select-externo-motivo').value;
    let listo = !!motivo;
    if (externoActual.nuevo) {
      listo = listo && !!el('input-externo-nombre').value.trim() && !!el('input-externo-departamento').value.trim();
    }
    btn.disabled = !listo;
  }

  // A diferencia de Empleados, Externos no verifica ubicación (se asume que
  // el registro ocurre siempre en recepción, frente al dispositivo). La foto
  // solo se toma en el ingreso de cada visita; en la salida se confirma
  // directo, sin cámara.
  function continuarExterno() {
    if (!externoActual) return;
    el('paso-observacion').classList.remove('hidden');
    if (modo === 'ingreso') {
      if (externoActual.nuevo) {
        externoActual.nombre = el('input-externo-nombre').value.trim();
        externoActual.departamento = el('input-externo-departamento').value.trim();
      }
      externoActual.motivo = el('select-externo-motivo').value;
      fotoBase64 = null;
      el('paso-camara').classList.remove('hidden');
      el('paso-confirmar').classList.add('hidden');
      Camera.iniciar(el('video-preview')).catch((err) => Utils.toast(err.message, 'error', 6000));
    } else {
      fotoBase64 = null;
      el('paso-camara').classList.add('hidden');
      mostrarConfirmarSinFoto();
    }
  }

  function mostrarConfirmarSinFoto() {
    el('foto-preview').classList.add('hidden');
    el('btn-reintentar').classList.add('hidden');
    el('paso-confirmar').classList.remove('hidden');
  }

  function filaExterno(r) {
    return `
      <tr>
        <td>${Utils.escapeHtml(r.cedula)}</td>
        <td>${Utils.escapeHtml(r.nombre)}</td>
        <td>${Utils.escapeHtml(r.departamento)}</td>
        <td>${Utils.escapeHtml(r.motivo)}</td>
        <td>${Utils.escapeHtml(r.horaIngreso)}</td>
        <td>${Utils.escapeHtml(r.horaSalida || '-')}</td>
        <td>${Utils.escapeHtml(r.observacion || '-')}</td>
      </tr>
    `;
  }

  // "En Bodega": registraron ingreso hoy y todavía no marcan salida.
  // "Salieron": ya marcaron salida hoy. A diferencia de Empleados, aquí no
  // se muestra un listado aparte de "todos los del día" — con
  // visitantes/proveedores lo relevante es separar quién sigue físicamente
  // en la bodega de quién ya se fue.
  async function cargarRegistroExternosHoy() {
    const tbodyEnBodega = el('tabla-externos-en-bodega').querySelector('tbody');
    const tbodySalieron = el('tabla-externos-salieron').querySelector('tbody');
    try {
      const filas = await Api.get('externosHoy');
      const enBodega = filas.filter((r) => !r.horaSalida);
      const salieron = filas.filter((r) => r.horaSalida);
      el('conteo-externos-en-bodega').textContent = enBodega.length;
      tbodyEnBodega.innerHTML = enBodega.map(filaExterno).join('');
      el('conteo-externos-salieron').textContent = salieron.length;
      tbodySalieron.innerHTML = salieron.map(filaExterno).join('');
    } catch (err) {
      el('conteo-externos-en-bodega').textContent = '-';
      el('conteo-externos-salieron').textContent = '-';
      tbodyEnBodega.innerHTML = `<tr><td colspan="7" class="error">${Utils.escapeHtml(err.message)}</td></tr>`;
      tbodySalieron.innerHTML = '';
    }
  }

  async function cargarRegistroEmpleadosHoy() {
    const tbodyReg = el('tabla-registro-empleados').querySelector('tbody');
    const tbodyNoReg = el('tabla-no-registrado-empleados').querySelector('tbody');
    try {
      const { registrados, noRegistrados } = await Api.get('empleadosHoy');
      el('conteo-empleados-registrados').textContent = registrados.length;
      tbodyReg.innerHTML = registrados.map((r) => `
        <tr>
          <td>${Utils.escapeHtml(r.codigo)}</td>
          <td>${Utils.escapeHtml(r.nombre)}</td>
          <td>${Utils.escapeHtml(r.cargo || '')}</td>
          <td>${Utils.escapeHtml(Utils.formatoHora(r.turno))}</td>
          <td>${Utils.escapeHtml(r.horaIngreso)}</td>
          <td>${Utils.escapeHtml(r.horaSalida || '-')}</td>
          <td>${Utils.escapeHtml(r.estadoIngreso || '-')}</td>
          <td>${Utils.escapeHtml(r.estadoSalida || '-')}</td>
          <td>${Utils.escapeHtml(r.observacion || '-')}</td>
        </tr>
      `).join('');

      el('conteo-empleados-no-registrados').textContent = noRegistrados.length;
      tbodyNoReg.innerHTML = noRegistrados.map((r) => `
        <tr>
          <td>${Utils.escapeHtml(r.codigo)}</td>
          <td>${Utils.escapeHtml(r.nombre)}</td>
          <td>${Utils.escapeHtml(r.cargo || '')}</td>
          <td>${Utils.escapeHtml(Utils.formatoHora(r.turno))}</td>
        </tr>
      `).join('');
    } catch (err) {
      el('conteo-empleados-registrados').textContent = '-';
      el('conteo-empleados-no-registrados').textContent = '-';
      tbodyReg.innerHTML = `<tr><td colspan="9" class="error">${Utils.escapeHtml(err.message)}</td></tr>`;
      tbodyNoReg.innerHTML = '';
    }
  }

  async function verificarUbicacion() {
    // Cada llamada invalida cualquier verificación anterior todavía en
    // curso (p. ej. si el usuario tocó "Reintentar" antes de que la
    // primera lectura de GPS respondiera). Sin esto, una respuesta vieja
    // y lenta (fallback por red) podía llegar después y pisar el estado
    // de una lectura más nueva y más precisa, con resultados inconsistentes
    // entre lo que se mostraba en pantalla y lo que finalmente se enviaba
    // al servidor al confirmar el registro.
    const miToken = ++tokenUbicacion;
    const estadoEl = el('ubicacion-estado');
    const btnReintentar = el('btn-verificar-ubicacion');
    estadoEl.textContent = 'Verificando ubicación...';
    estadoEl.className = '';
    el('paso-camara').classList.add('hidden');
    btnReintentar.disabled = true;
    try {
      // Se consulta fresca en cada intento (no una sola vez al cargar la
      // página), para que un cambio de radio/ubicación desde Administración
      // se aplique de inmediato sin tener que recargar el kiosco.
      const config = await Api.get('config');
      if (miToken !== tokenUbicacion) return; // ya no es la verificación vigente
      if (!config || !config.lat || !config.lng) {
        throw new Error('La ubicación de referencia no está configurada. Contacte al administrador.');
      }
      const pos = await Utils.getUbicacionActual();
      if (miToken !== tokenUbicacion) return; // ya no es la verificación vigente
      ubicacion = pos;
      const distancia = Utils.haversine(ubicacion.lat, ubicacion.lng, config.lat, config.lng);
      // El radio configurado se amplía con el margen de error que reporta
      // el propio dispositivo (topado), para no rechazar en falso a
      // celulares/tablets con GPS menos preciso.
      const margen = Math.min(ubicacion.accuracy || 0, MARGEN_PRECISION_MAX);
      const radioEfectivo = config.radio + margen;
      const dentro = distancia <= radioEfectivo;
      estadoEl.className = dentro ? 'ok' : 'error';
      estadoEl.innerHTML = dentro
        ? `✅ Dentro del rango permitido (distancia: ${distancia.toFixed(1)} m)`
        : `❌ Fuera del rango permitido. Distancia: ${distancia.toFixed(1)} m ` +
          `(máx ${radioEfectivo.toFixed(1)} m: radio ${config.radio} m + margen GPS ${margen.toFixed(0)} m)`;
      if (margen > 0) {
        estadoEl.innerHTML += `<br><small>Precisión GPS del dispositivo: ±${ubicacion.accuracy.toFixed(0)} m (se considera al validar, hasta ±${MARGEN_PRECISION_MAX} m). En espacios cerrados la precisión puede ser menor.</small>`;
      }
      if (dentro) {
        el('paso-camara').classList.remove('hidden');
        await Camera.iniciar(el('video-preview'));
      }
    } catch (err) {
      if (miToken !== tokenUbicacion) return; // ya no es la verificación vigente
      estadoEl.className = 'error';
      estadoEl.textContent = '❌ ' + err.message;
    } finally {
      if (miToken === tokenUbicacion) btnReintentar.disabled = false;
    }
  }

  function capturarFoto() {
    fotoBase64 = Camera.capturar(el('video-preview'));
    Camera.detener();
    el('foto-preview').src = fotoBase64;
    el('foto-preview').classList.remove('hidden');
    el('btn-reintentar').classList.remove('hidden');
    el('paso-camara').classList.add('hidden');
    el('paso-confirmar').classList.remove('hidden');
  }

  async function reintentarFoto() {
    fotoBase64 = null;
    el('paso-confirmar').classList.add('hidden');
    el('paso-camara').classList.remove('hidden');
    await Camera.iniciar(el('video-preview'));
  }

  async function confirmarRegistro() {
    const identidadLista = tabActivo === 'empleados' ? !!empleadoActual : !!externoActual;
    // Empleados siempre necesita ubicación y foto. Externos no verifica
    // ubicación, y solo necesita foto en el ingreso (no en la salida).
    const necesitaUbicacion = tabActivo === 'empleados';
    const necesitaFoto = tabActivo === 'empleados' || modo === 'ingreso';
    if (!identidadLista) return;
    if (necesitaUbicacion && !ubicacion) return;
    if (necesitaFoto && !fotoBase64) return;
    const btn = el('btn-confirmar');
    btn.disabled = true;
    btn.textContent = 'Enviando...';
    try {
      let data;
      const observacion = el('input-observacion').value.trim().slice(0, 200);
      if (tabActivo === 'empleados') {
        const accion = modo === 'ingreso' ? 'registrarIngreso' : 'registrarSalida';
        data = await Api.post(accion, {
          codigo: empleadoActual.codigo,
          imagenBase64: fotoBase64,
          lat: ubicacion.lat,
          lng: ubicacion.lng,
          accuracy: ubicacion.accuracy,
          observacion
        });
        if (data.esUltimoTurno && modo === 'ingreso') {
          Admin.notificarUltimoTurno();
        }
        refrescarEmpleados();
      } else {
        const accion = modo === 'ingreso' ? 'externoRegistrarIngreso' : 'externoRegistrarSalida';
        const payload = { cedula: externoActual.cedula, observacion };
        if (modo === 'ingreso') {
          payload.imagenBase64 = fotoBase64;
          payload.nombre = externoActual.nombre;
          payload.departamento = externoActual.departamento;
          payload.motivo = externoActual.motivo;
        }
        data = await Api.post(accion, payload);
      }
      mostrarResultado(true, `${data.nombre} — ${data.estado} (${data.hora})`);
    } catch (err) {
      mostrarResultado(false, err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Confirmar registro';
      setTimeout(reiniciarFlujo, 3500);
    }
  }

  function mostrarResultado(ok, msg) {
    const r = el('resultado');
    r.className = 'resultado ' + (ok ? 'ok' : 'error');
    r.textContent = msg;
    r.classList.remove('hidden');
    el('paso-confirmar').classList.add('hidden');
  }

  return { init, mostrar, reiniciarFlujo };
})();
