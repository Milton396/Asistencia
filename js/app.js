// Lógica del kiosco de registro de asistencia (entrada / salida).
const Kiosko = (() => {
  const MARGEN_PRECISION_MAX = 50; // metros; tope al margen de error GPS que se acepta

  let modo = 'ingreso';
  let empleados = [];
  let empleadoActual = null;
  let ubicacion = null;
  let fotoBase64 = null;

  const el = (id) => document.getElementById(id);

  function init() {
    el('btn-modo-ingreso').addEventListener('click', () => seleccionarModo('ingreso'));
    el('btn-modo-salida').addEventListener('click', () => seleccionarModo('salida'));
    el('input-codigo').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') buscarEmpleado();
    });
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

  function reiniciarFlujo() {
    empleadoActual = null;
    ubicacion = null;
    fotoBase64 = null;
    Camera.detener();
    el('input-codigo').value = '';
    el('empleado-card').classList.add('hidden');
    el('paso-ubicacion').classList.add('hidden');
    el('paso-camara').classList.add('hidden');
    el('paso-confirmar').classList.add('hidden');
    el('resultado').classList.add('hidden');
    el('input-codigo').focus();
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
    card.innerHTML = `<p><strong>${emp.nombre}</strong></p><p>${emp.cargo || ''} · Turno ${Utils.formatoHora(emp.turno)}</p>`;
    el('paso-ubicacion').classList.remove('hidden');
    el('paso-camara').classList.add('hidden');
    el('paso-confirmar').classList.add('hidden');
    verificarUbicacion();
  }

  async function verificarUbicacion() {
    const estadoEl = el('ubicacion-estado');
    estadoEl.textContent = 'Verificando ubicación...';
    estadoEl.className = '';
    el('paso-camara').classList.add('hidden');
    try {
      // Se consulta fresca en cada intento (no una sola vez al cargar la
      // página), para que un cambio de radio/ubicación desde Administración
      // se aplique de inmediato sin tener que recargar el kiosco.
      const config = await Api.get('config');
      if (!config || !config.lat || !config.lng) {
        throw new Error('La ubicación de referencia no está configurada. Contacte al administrador.');
      }
      ubicacion = await Utils.getUbicacionActual();
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
        : `❌ Fuera del rango permitido. Distancia: ${distancia.toFixed(1)} m (máx ${config.radio} m)`;
      if (margen > 0) {
        estadoEl.innerHTML += `<br><small>Precisión GPS del dispositivo: ±${ubicacion.accuracy.toFixed(0)} m (se considera al validar, hasta ±${MARGEN_PRECISION_MAX} m). En espacios cerrados la precisión puede ser menor.</small>`;
      }
      if (dentro) {
        el('paso-camara').classList.remove('hidden');
        await Camera.iniciar(el('video-preview'));
      }
    } catch (err) {
      estadoEl.className = 'error';
      estadoEl.textContent = '❌ ' + err.message;
    }
  }

  function capturarFoto() {
    fotoBase64 = Camera.capturar(el('video-preview'));
    Camera.detener();
    el('foto-preview').src = fotoBase64;
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
    if (!empleadoActual || !ubicacion || !fotoBase64) return;
    const btn = el('btn-confirmar');
    btn.disabled = true;
    btn.textContent = 'Enviando...';
    try {
      const accion = modo === 'ingreso' ? 'registrarIngreso' : 'registrarSalida';
      const data = await Api.post(accion, {
        codigo: empleadoActual.codigo,
        imagenBase64: fotoBase64,
        lat: ubicacion.lat,
        lng: ubicacion.lng,
        accuracy: ubicacion.accuracy
      });
      mostrarResultado(true, `${data.nombre} — ${data.estado} (${data.hora})`);
      if (data.esUltimoTurno && modo === 'ingreso') {
        Admin.notificarUltimoTurno();
      }
      refrescarEmpleados();
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
