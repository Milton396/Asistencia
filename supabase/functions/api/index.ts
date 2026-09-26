// Edge Function única que enruta por "action", igual que el switch de
// doGet/doPost en apps-script/Code.gs. Objetivo: que js/api.js necesite
// cambiar lo mínimo posible en la Fase 4 (misma forma de llamar, mismo
// contrato de respuesta { ok, data } / { ok, error }).
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Todas las lecturas/escrituras se hacen con la service role key (nunca
// expuesta al cliente): el control de acceso lo decide esta función, no
// RLS. Ver supabase/README.md, decisión de diseño #2.
function supabaseAdmin() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );
}

// ==================== AUTENTICACIÓN (equivalente a requireAdmin en Code.gs) ====================
// El login en sí ya no pasa por aquí: lo hace supabase-js directo contra
// Supabase Auth (Fase 4). Esta función valida el access_token de esa
// sesión y confirma que la cuenta es administrador, antes de cualquier
// acción protegida. Los mensajes son los mismos que ya usa Code.gs,
// porque js/api.js cierra sesión automáticamente al ver alguno de ellos
// (ver ERRORES_SESION en js/api.js) — no cambiar el texto sin revisar eso.
async function requireAdmin(req: Request) {
  const auth = req.headers.get('Authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (!token) throw new Error('No autorizado. Inicie sesión.');

  const { data: userData, error: userError } = await supabaseAdmin().auth.getUser(token);
  if (userError || !userData?.user) throw new Error('Sesión expirada. Vuelva a iniciar sesión.');

  const { data: perfil, error: perfilError } = await supabaseAdmin()
    .from('perfiles_admin')
    .select('nombre, rol')
    .eq('user_id', userData.user.id)
    .maybeSingle();
  if (perfilError) throw new Error(perfilError.message);
  if (!perfil || perfil.rol !== 'administrador') {
    throw new Error('Requiere permisos de administrador.');
  }

  return { userId: userData.user.id, email: userData.user.email, nombre: perfil.nombre, rol: perfil.rol };
}

// ==================== ACCIONES PÚBLICAS (sin login) ====================
// Equivalentes a listarEmpleados()/obtenerConfigPublica() en Code.gs.

async function listarEmpleados() {
  const { data, error } = await supabaseAdmin()
    .from('empleados')
    .select('codigo, nombre, cargo, turno, correo')
    .order('nombre');
  if (error) throw new Error(error.message);
  return data.map((e) => ({
    codigo: e.codigo,
    nombre: e.nombre,
    cargo: e.cargo,
    turno: e.turno,
    correo: e.correo || '',
  }));
}

async function obtenerConfigPublica() {
  const { data, error } = await supabaseAdmin()
    .from('config')
    .select('lat, lng, radio_metros, turnos')
    .single();
  if (error) throw new Error(error.message);
  return {
    lat: data.lat,
    lng: data.lng,
    radio: Number(data.radio_metros || 5),
    turnos: data.turnos || [],
  };
}

// ==================== FECHA/HORA (America/Guayaquil) ====================

const TIMEZONE = 'America/Guayaquil';
const MARGEN_PRECISION_MAX = 50; // metros; tope al margen de error GPS que se acepta
const KIOSCO_LIMITE_INTENTOS = 30; // solicitudes de registro (ingreso+salida) por minuto
const KIOSCO_LIMITE_VENTANA_SEGUNDOS = 60;
const BUCKET_FOTOS = 'fotos';
const MOTIVOS_EXTERNOS = ['RETIRO PEDIDO/DEVOLUCION', 'ENTREGA OC', 'TRANSPORTE MATERIAL', 'VISITA'];

function hoy(): string {
  // en-CA formatea como YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE }).format(new Date());
}

function horaActual(): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TIMEZONE, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(new Date());
}

function sumarDias(fechaStr: string, dias: number): string {
  const [y, m, d] = fechaStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + dias);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

// ==================== LÍMITE DE INTENTOS DEL KIOSCO ====================
// Reemplaza CacheService (Apps Script): sin esto, cualquiera con la URL
// podría spamear registros falsos y agotar la cuota de Storage.
async function verificarLimiteKiosco() {
  const ventana = Math.floor(Date.now() / (KIOSCO_LIMITE_VENTANA_SEGUNDOS * 1000));
  const { data, error } = await supabaseAdmin().rpc('incrementar_limite_kiosco', { p_ventana: ventana });
  if (error) throw new Error(error.message);
  if ((data as number) > KIOSCO_LIMITE_INTENTOS) {
    throw new Error('Demasiadas solicitudes en poco tiempo. Espere un momento e intente de nuevo.');
  }
}

// ==================== UBICACIÓN (GPS) ====================

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (v: number) => (v * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

async function validarUbicacion(lat: unknown, lng: unknown, accuracy: unknown): Promise<number> {
  const { data: cfg, error } = await supabaseAdmin().from('config').select('lat, lng, radio_metros').single();
  if (error) throw new Error(error.message);
  if (cfg.lat == null || cfg.lng == null) {
    throw new Error('La ubicación de referencia no está configurada. Contacte al administrador.');
  }
  if (typeof lat !== 'number' || typeof lng !== 'number') {
    throw new Error('No se pudo obtener su ubicación GPS.');
  }
  const distancia = haversine(lat, lng, Number(cfg.lat), Number(cfg.lng));
  const radio = Number(cfg.radio_metros || 5);
  const margen = Math.min(Number(accuracy) || 0, MARGEN_PRECISION_MAX);
  const radioEfectivo = radio + margen;
  if (distancia > radioEfectivo) {
    throw new Error(
      `Fuera de la ubicación permitida. Distancia: ${distancia.toFixed(1)} m ` +
      `(máx ${radioEfectivo.toFixed(1)} m: radio ${radio} m + margen GPS ${margen.toFixed(0)} m)`
    );
  }
  return distancia;
}

// ==================== FOTOS (Supabase Storage) ====================

async function guardarFoto(base64Data: string | undefined, prefijo: string, codigo: string): Promise<string> {
  if (!base64Data) throw new Error('Falta la foto');
  const base64 = base64Data.includes(',') ? base64Data.split(',')[1] : base64Data;
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const nombreArchivo = `${prefijo}_${codigo}_${Date.now()}.jpg`;
  const { error } = await supabaseAdmin().storage.from(BUCKET_FOTOS).upload(nombreArchivo, bytes, {
    contentType: 'image/jpeg',
  });
  if (error) throw new Error(error.message);
  return supabaseAdmin().storage.from(BUCKET_FOTOS).getPublicUrl(nombreArchivo).data.publicUrl;
}

// ==================== HORAS EXTRA ====================
// Mismas reglas que Code.gs: entre semana, la hora extra empieza 9h01s
// después del inicio del turno (jornada de 8h + 1h de almuerzo); fines de
// semana, toda la jornada trabajada cuenta como hora extra. El exceso se
// redondea al medio hora más cercano.

function horaASegundos(horaStr: string | null | undefined): number | null {
  if (!horaStr) return null;
  const partes = String(horaStr).split(':').map(Number);
  return (partes[0] || 0) * 3600 + (partes[1] || 0) * 60 + (partes[2] || 0);
}

function redondearAMediaHora(totalSegundos: number): number {
  if (totalSegundos <= 0) return 0;
  let horas = Math.floor(totalSegundos / 3600);
  const restoSegundos = totalSegundos % 3600;
  let minutosExtra: number;
  if (restoSegundos < 30 * 60) minutosExtra = 0;
  else if (restoSegundos < 45 * 60) minutosExtra = 30;
  else { horas += 1; minutosExtra = 0; }
  return horas * 60 + minutosExtra;
}

function formatoHorasMinutos(totalMinutos: number): string {
  const horas = Math.floor(totalMinutos / 60);
  const minutos = totalMinutos % 60;
  return `${horas}:${minutos < 10 ? '0' : ''}${minutos}`;
}

function esFinDeSemana(fecha: string): boolean {
  const [y, m, d] = fecha.split('-').map(Number);
  const dia = new Date(y, m - 1, d).getDay();
  return dia === 0 || dia === 6;
}

function calcularEstadoIngreso(horaStr: string, turnoStr: string): string {
  const horaTurno = turnoStr.length === 5 ? turnoStr + ':00' : turnoStr;
  return horaStr <= horaTurno ? 'A TIEMPO' : 'ATRASADO';
}

function calcularHorasExtras(
  fecha: string, turnoStr: string, horaIngresoStr: string | null, horaSalidaStr: string | null | undefined
): string | null {
  if (!horaSalidaStr) return null;
  const salidaSeg = horaASegundos(horaSalidaStr)!;
  let totalSegundos: number;
  if (esFinDeSemana(fecha)) {
    const ingresoSeg = horaASegundos(horaIngresoStr);
    totalSegundos = ingresoSeg == null ? 0 : salidaSeg - ingresoSeg;
  } else {
    const turnoSeg = horaASegundos(turnoStr.length === 5 ? turnoStr + ':00' : turnoStr)!;
    const umbral = turnoSeg + 9 * 3600 + 1;
    totalSegundos = salidaSeg - umbral;
  }
  return formatoHorasMinutos(redondearAMediaHora(totalSegundos));
}

function combinarObservacion(actual: string | null | undefined, nueva: unknown): string {
  const a = (actual || '').toString();
  const n = (nueva || '').toString().trim().slice(0, 200);
  if (!n) return a;
  return a ? `${a} / ${n}` : n;
}

// ==================== EMPLEADOS: registrar ingreso/salida ====================

async function buscarEmpleado(codigo: string) {
  const { data, error } = await supabaseAdmin()
    .from('empleados').select('codigo, nombre, cargo, turno, correo')
    .eq('codigo', codigo).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

async function buscarFilaRegistro(codigo: string, fecha: string) {
  const { data, error } = await supabaseAdmin()
    .from('registro').select('*')
    .eq('codigo', codigo).eq('fecha', fecha).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

async function registrarIngreso(body: Record<string, unknown>) {
  await verificarLimiteKiosco();
  const distancia = await validarUbicacion(body.lat, body.lng, body.accuracy);
  const empleado = await buscarEmpleado(String(body.codigo ?? ''));
  if (!empleado) throw new Error('Código no encontrado');

  const fecha = hoy();
  const existente = await buscarFilaRegistro(empleado.codigo, fecha);
  if (existente && existente.hora_ingreso) {
    throw new Error(`Ya se registró el ingreso de hoy para ${empleado.nombre}`);
  }

  const hora = horaActual();
  const urlFoto = await guardarFoto(body.imagenBase64 as string | undefined, 'INGRESO', empleado.codigo);
  const estadoIngreso = calcularEstadoIngreso(hora, empleado.turno);

  const { error } = await supabaseAdmin().from('registro').upsert({
    codigo: empleado.codigo,
    turno: empleado.turno,
    fecha,
    hora_ingreso: hora,
    imagen1_url: urlFoto,
    hora_salida: existente ? existente.hora_salida : null,
    imagen2_url: existente ? existente.imagen2_url : null,
    observacion: combinarObservacion(existente ? existente.observacion : null, body.observacion),
    estado_ingreso: estadoIngreso,
    estado_salida: existente ? existente.estado_salida : null,
  }, { onConflict: 'codigo,fecha' });
  if (error) throw new Error(error.message);

  const cfgTurnos = await obtenerConfigPublica();
  const ultimoTurno = [...cfgTurnos.turnos].sort().at(-1);
  const turnoCorto = String(empleado.turno).slice(0, 5);

  return {
    nombre: empleado.nombre, cargo: empleado.cargo, turno: empleado.turno,
    hora, estado: estadoIngreso, distancia: Math.round(distancia * 10) / 10,
    esUltimoTurno: turnoCorto === ultimoTurno,
  };
}

async function registrarSalida(body: Record<string, unknown>) {
  await verificarLimiteKiosco();
  const distancia = await validarUbicacion(body.lat, body.lng, body.accuracy);
  const empleado = await buscarEmpleado(String(body.codigo ?? ''));
  if (!empleado) throw new Error('Código no encontrado');

  const fecha = hoy();
  const existente = await buscarFilaRegistro(empleado.codigo, fecha);
  if (!existente || !existente.hora_ingreso) {
    throw new Error('Debe registrar el ingreso antes de la salida');
  }
  if (existente.hora_salida) {
    throw new Error(`Ya se registró la salida de hoy para ${empleado.nombre}`);
  }

  const hora = horaActual();
  const urlFoto = await guardarFoto(body.imagenBase64 as string | undefined, 'SALIDA', empleado.codigo);
  const estadoSalida = 'FIN DE JORNADA';

  const { error } = await supabaseAdmin().from('registro').update({
    hora_salida: hora,
    imagen2_url: urlFoto,
    observacion: combinarObservacion(existente.observacion, body.observacion),
    estado_salida: estadoSalida,
  }).eq('codigo', empleado.codigo).eq('fecha', fecha);
  if (error) throw new Error(error.message);

  const horasExtras = calcularHorasExtras(fecha, empleado.turno, existente.hora_ingreso, hora);

  return {
    nombre: empleado.nombre, cargo: empleado.cargo, turno: empleado.turno,
    hora, estado: estadoSalida, distancia: Math.round(distancia * 10) / 10,
    horasExtras,
  };
}

// ==================== EXTERNOS (autoregistro por cédula) ====================

function validarCedulaEcuatoriana(cedula: string): boolean {
  cedula = (cedula || '').trim();
  if (!/^\d{10}$/.test(cedula)) return false;
  const provincia = Number(cedula.substring(0, 2));
  if (provincia < 1 || provincia > 24) return false;
  const tercerDigito = Number(cedula.charAt(2));
  if (tercerDigito > 5) return false;
  const coeficientes = [2, 1, 2, 1, 2, 1, 2, 1, 2];
  let suma = 0;
  for (let i = 0; i < 9; i++) {
    let producto = Number(cedula.charAt(i)) * coeficientes[i];
    if (producto >= 10) producto -= 9;
    suma += producto;
  }
  const digitoVerificador = (10 - (suma % 10)) % 10;
  return digitoVerificador === Number(cedula.charAt(9));
}

async function buscarExterno(cedula: string) {
  cedula = (cedula || '').trim();
  if (!cedula) return null;
  const { data, error } = await supabaseAdmin()
    .from('externos').select('cedula, nombre, departamento_proveedor')
    .eq('cedula', cedula).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return { cedula: data.cedula, nombre: data.nombre, departamento: data.departamento_proveedor };
}

async function guardarExterno(cedula: string, nombre: string, departamento: string) {
  const { error } = await supabaseAdmin().from('externos').upsert(
    { cedula, nombre, departamento_proveedor: departamento },
    { onConflict: 'cedula' }
  );
  if (error) throw new Error(error.message);
}

// Trae también nombre/departamento de "externos" (join por FK): a
// diferencia de REGISTRO_EXTERNOS en la Sheet, esta tabla no los duplica.
async function buscarFilaRegistroExterno(cedula: string, fecha: string) {
  const { data, error } = await supabaseAdmin()
    .from('registro_externos')
    .select('*, externos(nombre, departamento_proveedor)')
    .eq('cedula', cedula).eq('fecha', fecha).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

async function externoRegistrarIngreso(body: Record<string, unknown>) {
  await verificarLimiteKiosco();
  const cedula = String(body.cedula ?? '').trim();
  if (!validarCedulaEcuatoriana(cedula)) throw new Error('Cédula inválida');
  const nombre = String(body.nombre ?? '').trim();
  const departamento = String(body.departamento ?? '').trim();
  if (!nombre) throw new Error('El nombre es obligatorio');
  if (!departamento) throw new Error('El departamento o proveedor es obligatorio');
  const motivo = String(body.motivo ?? '').trim();
  if (!MOTIVOS_EXTERNOS.includes(motivo)) throw new Error('Motivo de ingreso inválido');

  const fecha = hoy();
  const existente = await buscarFilaRegistroExterno(cedula, fecha);
  if (existente && existente.hora_ingreso) {
    throw new Error(`Ya se registró el ingreso de hoy para ${nombre}`);
  }

  await guardarExterno(cedula, nombre, departamento);

  const hora = horaActual();
  const urlFoto = await guardarFoto(body.imagenBase64 as string | undefined, 'INGRESO_EXT', cedula);

  const { error } = await supabaseAdmin().from('registro_externos').upsert({
    cedula, fecha, motivo,
    hora_ingreso: hora,
    imagen1_url: urlFoto,
    hora_salida: existente ? existente.hora_salida : null,
    observacion: combinarObservacion(existente ? existente.observacion : null, body.observacion),
  }, { onConflict: 'cedula,fecha' });
  if (error) throw new Error(error.message);

  return { nombre, departamento, hora, estado: 'INGRESO REGISTRADO' };
}

async function externoRegistrarSalida(body: Record<string, unknown>) {
  await verificarLimiteKiosco();
  const cedula = String(body.cedula ?? '').trim();
  if (!validarCedulaEcuatoriana(cedula)) throw new Error('Cédula inválida');

  const fecha = hoy();
  const existente = await buscarFilaRegistroExterno(cedula, fecha);
  if (!existente || !existente.hora_ingreso) {
    throw new Error('Debe registrar el ingreso antes de la salida');
  }
  if (existente.hora_salida) {
    throw new Error(`Ya se registró la salida de hoy para ${existente.externos?.nombre ?? ''}`);
  }

  const hora = horaActual();

  const { error } = await supabaseAdmin().from('registro_externos').update({
    hora_salida: hora,
    observacion: combinarObservacion(existente.observacion, body.observacion),
  }).eq('cedula', cedula).eq('fecha', fecha);
  if (error) throw new Error(error.message);

  return {
    nombre: existente.externos?.nombre,
    departamento: existente.externos?.departamento_proveedor,
    hora,
    estado: 'SALIDA REGISTRADA',
  };
}

// ==================== INFORME (por rango de fechas) ====================
// Reutilizado por dos acciones: "informe" (Administración, admin-only,
// cualquier rango) y "empleadosHoy" (pública, pestaña Registro del
// kiosco, siempre hoy-a-hoy) — igual que hoy hace Code.gs.

interface FilaInformeRegistro {
  codigo: string; fecha: string; hora_ingreso: string | null; hora_salida: string | null;
  observacion: string | null; estado_ingreso: string | null; estado_salida: string | null;
}

async function generarInforme(fechaDesdeIn?: string, fechaHastaIn?: string) {
  const hoyStr = hoy();
  let fechaDesde = fechaDesdeIn;
  let fechaHasta = fechaHastaIn;

  if (!fechaDesde && !fechaHasta) {
    fechaDesde = fechaHasta = hoyStr;
  } else if (!fechaHasta) {
    fechaHasta = hoyStr;
  } else if (!fechaDesde) {
    // Sin límite inferior explícito: se usa la fecha del registro más antiguo.
    const { data: minRow, error: minError } = await supabaseAdmin()
      .from('registro').select('fecha').order('fecha', { ascending: true }).limit(1).maybeSingle();
    if (minError) throw new Error(minError.message);
    fechaDesde = minRow?.fecha || fechaHasta;
  }
  if (fechaHasta! > hoyStr) fechaHasta = hoyStr;
  if (fechaDesde! > fechaHasta!) fechaDesde = fechaHasta;

  const { data: empleados, error: empError } = await supabaseAdmin()
    .from('empleados').select('codigo, nombre, cargo, turno').order('nombre');
  if (empError) throw new Error(empError.message);

  const { data: filas, error: regError } = await supabaseAdmin()
    .from('registro')
    .select('codigo, fecha, hora_ingreso, hora_salida, observacion, estado_ingreso, estado_salida')
    .gte('fecha', fechaDesde!).lte('fecha', fechaHasta!);
  if (regError) throw new Error(regError.message);

  const registrosPorFecha = new Map<string, Map<string, FilaInformeRegistro>>();
  for (const f of (filas as FilaInformeRegistro[])) {
    if (!registrosPorFecha.has(f.fecha)) registrosPorFecha.set(f.fecha, new Map());
    registrosPorFecha.get(f.fecha)!.set(f.codigo, f);
  }

  const registrados: unknown[] = [];
  const noRegistrados: unknown[] = [];
  for (let fecha = fechaDesde!; fecha <= fechaHasta!; fecha = sumarDias(fecha, 1)) {
    const registrosDelDia = registrosPorFecha.get(fecha);
    for (const emp of empleados) {
      const reg = registrosDelDia?.get(emp.codigo);
      if (reg && reg.hora_ingreso) {
        registrados.push({
          fecha, codigo: emp.codigo, nombre: emp.nombre, cargo: emp.cargo, turno: emp.turno,
          horaIngreso: reg.hora_ingreso, horaSalida: reg.hora_salida || '',
          estadoIngreso: reg.estado_ingreso, estadoSalida: reg.estado_salida || '',
          observacion: reg.observacion || '',
          horasExtras: calcularHorasExtras(fecha, emp.turno, reg.hora_ingreso, reg.hora_salida),
        });
      } else {
        noRegistrados.push({ fecha, codigo: emp.codigo, nombre: emp.nombre, cargo: emp.cargo, turno: emp.turno });
      }
    }
  }

  return { fechaDesde, fechaHasta, registrados, noRegistrados };
}

// ==================== "REGISTRO" DEL KIOSCO (públicas, sin login) ====================

async function externosHoy() {
  const fecha = hoy();
  const { data, error } = await supabaseAdmin()
    .from('registro_externos')
    .select('cedula, motivo, hora_ingreso, hora_salida, observacion, externos(nombre, departamento_proveedor)')
    .eq('fecha', fecha)
    .order('hora_ingreso', { ascending: false });
  if (error) throw new Error(error.message);
  return data.map((r) => ({
    cedula: r.cedula,
    // deno-lint-ignore no-explicit-any
    nombre: (r.externos as any)?.nombre,
    // deno-lint-ignore no-explicit-any
    departamento: (r.externos as any)?.departamento_proveedor,
    motivo: r.motivo,
    horaIngreso: r.hora_ingreso,
    horaSalida: r.hora_salida,
    observacion: r.observacion,
  }));
}

// ==================== CRUD: EMPLEADOS ====================

async function empleadoGuardar(body: Record<string, unknown>) {
  const codigo = String(body.codigo ?? '').trim();
  if (!codigo) throw new Error('El código es obligatorio');
  if (!body.nombre) throw new Error('El nombre es obligatorio');
  if (!body.turno) throw new Error('El turno es obligatorio');

  const { data: existente, error: buscarError } = await supabaseAdmin()
    .from('empleados').select('codigo').eq('codigo', codigo).maybeSingle();
  if (buscarError) throw new Error(buscarError.message);

  const { error } = await supabaseAdmin().from('empleados').upsert({
    codigo,
    nombre: body.nombre,
    cargo: body.cargo || '',
    turno: body.turno,
    correo: body.correo || '',
  }, { onConflict: 'codigo' });
  if (error) throw new Error(error.message);

  return existente ? { actualizado: true } : { creado: true };
}

async function empleadoEliminar(codigo: string) {
  codigo = String(codigo);
  const { data, error } = await supabaseAdmin().from('empleados').delete().eq('codigo', codigo).select('codigo');
  if (error) {
    // 23503 = foreign_key_violation. A diferencia de la Sheet (sin
    // integridad referencial, dejaba filas de REGISTRO huérfanas —
    // encontramos un caso real así al migrar), Postgres protege el
    // historial de asistencia en vez de dejarlo huérfano en silencio.
    if (error.code === '23503') {
      throw new Error('No se puede eliminar: el empleado tiene registros de asistencia históricos.');
    }
    throw new Error(error.message);
  }
  if (!data || data.length === 0) throw new Error('Empleado no encontrado');
  return { eliminado: true };
}

// ==================== TURNOS Y UBICACIÓN (config) ====================

async function turnosGuardar(turnos: unknown) {
  if (!Array.isArray(turnos) || turnos.length === 0) throw new Error('Debe haber al menos un turno');
  const re = /^\d{2}:\d{2}$/;
  for (const t of turnos) {
    if (typeof t !== 'string' || !re.test(t)) throw new Error(`Formato de turno inválido: ${t} (use HH:mm)`);
  }
  const { error } = await supabaseAdmin().from('config')
    .update({ turnos, updated_at: new Date().toISOString() }).eq('id', true);
  if (error) throw new Error(error.message);
  return { ok: true };
}

async function configGuardar(body: Record<string, unknown>) {
  if (typeof body.lat !== 'number' || typeof body.lng !== 'number') {
    throw new Error('Latitud y longitud son obligatorias');
  }
  const update: Record<string, unknown> = { lat: body.lat, lng: body.lng, updated_at: new Date().toISOString() };
  if (body.radio) update.radio_metros = body.radio;
  const { error } = await supabaseAdmin().from('config').update(update).eq('id', true);
  if (error) throw new Error(error.message);
  return { ok: true };
}

// ==================== CRUD: ADMINISTRADORES (Supabase Auth) ====================
// A diferencia de la hoja USUARIOS, aquí el "username" pasa a ser el
// correo de la cuenta de Supabase Auth — es el identificador real de
// login ahora. passwordCambiar ya no existe como acción propia: el
// frontend usa supabase.auth.updateUser({ password }) directo (Fase 4).

async function listarUsuarios() {
  const { data: perfiles, error } = await supabaseAdmin().from('perfiles_admin').select('user_id, nombre, rol');
  if (error) throw new Error(error.message);
  const { data: usersList, error: usersError } = await supabaseAdmin().auth.admin.listUsers();
  if (usersError) throw new Error(usersError.message);
  const emailPorId = new Map(usersList.users.map((u) => [u.id, u.email]));
  return perfiles.map((p) => ({ username: emailPorId.get(p.user_id) || '', rol: p.rol, nombre: p.nombre }));
}

async function usuarioGuardar(body: Record<string, unknown>) {
  const email = String(body.username ?? '').trim();
  if (!email) throw new Error('El usuario es obligatorio');
  if (!body.nombre) throw new Error('El nombre es obligatorio');
  const emailOriginal = body.usernameOriginal ? String(body.usernameOriginal).trim() : null;

  const { data: usersList, error: usersError } = await supabaseAdmin().auth.admin.listUsers();
  if (usersError) throw new Error(usersError.message);

  if (emailOriginal) {
    const existente = usersList.users.find((u) => u.email === emailOriginal);
    if (!existente) throw new Error('Usuario no encontrado');

    const duplicado = usersList.users.find((u) => u.email === email && u.id !== existente.id);
    if (duplicado) throw new Error('Ya existe un usuario con ese correo');

    const updates: Record<string, unknown> = {};
    if (email !== emailOriginal) updates.email = email;
    if (body.password) updates.password = body.password;
    if (Object.keys(updates).length > 0) {
      const { error } = await supabaseAdmin().auth.admin.updateUserById(existente.id, updates);
      if (error) throw new Error(error.message);
    }
    const { error: perfilError } = await supabaseAdmin()
      .from('perfiles_admin').update({ nombre: body.nombre }).eq('user_id', existente.id);
    if (perfilError) throw new Error(perfilError.message);
    return { actualizado: true };
  }

  const duplicado = usersList.users.find((u) => u.email === email);
  if (duplicado) throw new Error('Ya existe un usuario con ese correo');
  if (!body.password) throw new Error('La contraseña es obligatoria');

  const { data: creado, error: createError } = await supabaseAdmin().auth.admin.createUser({
    email, password: body.password as string, email_confirm: true,
  });
  if (createError) throw new Error(createError.message);
  const { error: perfilError } = await supabaseAdmin()
    .from('perfiles_admin').insert({ user_id: creado.user!.id, nombre: body.nombre, rol: 'administrador' });
  if (perfilError) throw new Error(perfilError.message);
  return { creado: true };
}

async function usuarioEliminar(username: string) {
  const email = String(username ?? '').trim();
  const { data: usersList, error: usersError } = await supabaseAdmin().auth.admin.listUsers();
  if (usersError) throw new Error(usersError.message);
  const existente = usersList.users.find((u) => u.email === email);
  if (!existente) throw new Error('Usuario no encontrado');

  const { count, error: countError } = await supabaseAdmin()
    .from('perfiles_admin').select('*', { count: 'exact', head: true }).eq('rol', 'administrador');
  if (countError) throw new Error(countError.message);
  if ((count ?? 0) <= 1) throw new Error('Debe existir al menos un administrador');

  const { error } = await supabaseAdmin().auth.admin.deleteUser(existente.id);
  if (error) throw new Error(error.message);
  // perfiles_admin tiene "on delete cascade" desde auth.users: se borra solo.
  return { eliminado: true };
}

// ==================== ROUTER ====================

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    let action: string | null = null;
    let body: Record<string, unknown> = {};

    if (req.method === 'GET') {
      const url = new URL(req.url);
      action = url.searchParams.get('action');
      body = Object.fromEntries(url.searchParams.entries());
    } else if (req.method === 'POST') {
      body = await req.json().catch(() => ({}));
      action = (body.action as string | undefined) ?? null;
    } else {
      throw new Error(`Método no soportado: ${req.method}`);
    }

    let data: unknown;
    switch (action) {
      case 'empleados':
        data = await listarEmpleados();
        break;
      case 'config':
        data = await obtenerConfigPublica();
        break;
      case 'perfil': {
        // Con Supabase Auth, el login ya no devuelve "nombre" (eso vivía
        // en la tabla USUARIOS). El frontend llama a esto justo después
        // de iniciar sesión para mostrar el nombre del administrador.
        const sesion = await requireAdmin(req);
        data = { nombre: sesion.nombre, rol: sesion.rol, email: sesion.email };
        break;
      }
      case 'registrarIngreso':
        data = await registrarIngreso(body);
        break;
      case 'registrarSalida':
        data = await registrarSalida(body);
        break;
      case 'externoBuscar':
        data = await buscarExterno(String(body.cedula ?? ''));
        break;
      case 'externoRegistrarIngreso':
        data = await externoRegistrarIngreso(body);
        break;
      case 'externoRegistrarSalida':
        data = await externoRegistrarSalida(body);
        break;
      case 'informe': {
        await requireAdmin(req);
        data = await generarInforme(body.fechaDesde as string | undefined, body.fechaHasta as string | undefined);
        break;
      }
      case 'empleadosHoy':
        data = await generarInforme(hoy(), hoy());
        break;
      case 'externosHoy':
        data = await externosHoy();
        break;
      case 'empleadoGuardar':
        await requireAdmin(req);
        data = await empleadoGuardar(body);
        break;
      case 'empleadoEliminar':
        await requireAdmin(req);
        data = await empleadoEliminar(String(body.codigo ?? ''));
        break;
      case 'turnosGuardar':
        await requireAdmin(req);
        data = await turnosGuardar(body.turnos);
        break;
      case 'configGuardar':
        await requireAdmin(req);
        data = await configGuardar(body);
        break;
      case 'usuarios':
        await requireAdmin(req);
        data = await listarUsuarios();
        break;
      case 'usuarioGuardar':
        await requireAdmin(req);
        data = await usuarioGuardar(body);
        break;
      case 'usuarioEliminar':
        await requireAdmin(req);
        data = await usuarioEliminar(String(body.username ?? ''));
        break;
      default:
        throw new Error(`Acción ${req.method} no reconocida: ${action}`);
    }

    return jsonResponse({ ok: true, data });
  } catch (err) {
    return jsonResponse({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});
