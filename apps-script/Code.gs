/**
 * Backend de Registro de Asistencia sobre Google Sheets.
 * Pegar este código en el editor de Apps Script (Extensiones > Apps Script)
 * de la hoja de cálculo, y desplegarlo como Web App (ver README.md).
 */

var SHEET_REGISTRO = 'REGISTRO';
var SHEET_EMPLEADOS = 'EMPLEADOS';
var SHEET_CONFIG = 'CONFIG';
var SHEET_USUARIOS = 'USUARIOS';
var TIMEZONE = 'America/Guayaquil';
var FOLDER_NAME = 'ASISTENCIA_FOTOS';
var TOKEN_DURACION_MS = 8 * 60 * 60 * 1000; // 8 horas
var PASSWORD_DEFECTO = 'admin123';
var CACHE_TTL_SEGUNDOS = 120; // 2 minutos
var NOMBRE_EMPRESA = 'Bodega Arupos Telconet';
var CORREO_COPIA_HORAS_EXTRA = 'mguanulema@telconet.ec';
var MARGEN_PRECISION_MAX = 50; // metros; tope al margen de error GPS que se acepta
var LOGIN_MAX_INTENTOS = 3;
var LOGIN_BLOQUEO_SEGUNDOS = 900; // 15 minutos
var KIOSCO_LIMITE_INTENTOS = 30; // solicitudes de registro (ingreso+salida)
var KIOSCO_LIMITE_VENTANA_SEGUNDOS = 60; // por minuto

// ==================== ENTRADAS HTTP ====================

function doGet(e) {
  try {
    var action = e.parameter.action;
    var data;
    switch (action) {
      case 'empleados':
        data = listarEmpleados();
        break;
      case 'config':
        data = obtenerConfigPublica();
        break;
      default:
        throw new Error('Acción GET no reconocida: ' + action);
    }
    return jsonResponse({ ok: true, data: data });
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message });
  }
}

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    var action = body.action;
    var data;
    switch (action) {
      case 'login':
        data = login(body.username, body.password);
        break;
      case 'registrarIngreso':
        data = conBloqueo(function () { return registrarIngreso(body); });
        break;
      case 'registrarSalida':
        data = conBloqueo(function () { return registrarSalida(body); });
        break;
      case 'empleadoGuardar':
        requireAdmin(body.token);
        data = conBloqueo(function () { return empleadoGuardar(body); });
        break;
      case 'empleadoEliminar':
        requireAdmin(body.token);
        data = conBloqueo(function () { return empleadoEliminar(body.codigo); });
        break;
      case 'turnosGuardar':
        requireAdmin(body.token);
        data = conBloqueo(function () { return turnosGuardar(body.turnos); });
        break;
      case 'configGuardar':
        requireAdmin(body.token);
        data = conBloqueo(function () { return configGuardar(body); });
        break;
      case 'passwordCambiar':
        data = conBloqueo(function () { return passwordCambiar(body.token, body.nuevaPassword); });
        break;
      case 'informe':
        requireAdmin(body.token);
        data = generarInforme(body.fecha);
        break;
      case 'usuarios':
        requireAdmin(body.token);
        data = listarUsuarios();
        break;
      case 'usuarioGuardar':
        requireAdmin(body.token);
        data = conBloqueo(function () { return usuarioGuardar(body); });
        break;
      case 'usuarioEliminar':
        requireAdmin(body.token);
        data = conBloqueo(function () { return usuarioEliminar(body.username); });
        break;
      default:
        throw new Error('Acción POST no reconocida: ' + action);
    }
    return jsonResponse({ ok: true, data: data });
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message });
  }
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// Serializa las operaciones de lectura-y-escritura (evita que dos peticiones
// simultáneas pisen la misma fila, p. ej. dos ingresos calculando la misma
// "última fila" al mismo tiempo).
function conBloqueo(fn) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (e) {
    throw new Error('El servidor está ocupado, intente de nuevo en unos segundos.');
  }
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

// ==================== CONFIG (hoja CONFIG, clave/valor) ====================

function getSpreadsheet() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function getSheet(nombre) {
  var sh = getSpreadsheet().getSheetByName(nombre);
  if (!sh) throw new Error('No existe la hoja "' + nombre + '"');
  return sh;
}

function ensureConfigSheet() {
  var ss = getSpreadsheet();
  var sh = ss.getSheetByName(SHEET_CONFIG);
  if (!sh) {
    sh = ss.insertSheet(SHEET_CONFIG);
    sh.appendRow(['CLAVE', 'VALOR']);
    var secret = Utilities.getUuid();
    var defaults = [
      ['LAT', ''],
      ['LNG', ''],
      ['RADIO_METROS', '5'],
      ['TURNOS', '07:00,08:00,09:00'],
      ['SECRET_KEY', secret]
    ];
    defaults.forEach(function (row) { sh.appendRow(row); });
  }
  return sh;
}

function getConfig() {
  var cache = CacheService.getScriptCache();
  var cacheado = cache.get('config');
  if (cacheado) return JSON.parse(cacheado);

  var sh = ensureConfigSheet();
  var values = sh.getDataRange().getValues();
  var cfg = {};
  for (var i = 1; i < values.length; i++) {
    cfg[values[i][0]] = values[i][1];
  }
  cache.put('config', JSON.stringify(cfg), CACHE_TTL_SEGUNDOS);
  return cfg;
}

function setConfigValue(clave, valor) {
  var sh = ensureConfigSheet();
  var values = sh.getDataRange().getValues();
  var fila = -1;
  for (var i = 1; i < values.length; i++) {
    if (values[i][0] === clave) {
      fila = i + 1;
      break;
    }
  }
  if (fila > 0) {
    sh.getRange(fila, 2).setValue(valor);
  } else {
    sh.appendRow([clave, valor]);
  }
  CacheService.getScriptCache().remove('config');
}

function obtenerConfigPublica() {
  var cfg = getConfig();
  return {
    lat: cfg.LAT ? Number(cfg.LAT) : null,
    lng: cfg.LNG ? Number(cfg.LNG) : null,
    radio: Number(cfg.RADIO_METROS || 5),
    turnos: (cfg.TURNOS || '').split(',').filter(function (t) { return t; })
  };
}

// ==================== USUARIOS Y AUTENTICACIÓN (panel Administración) ====================
// El kiosco de registro es público (sin login). Solo el panel de
// Administración exige credenciales. Las cuentas viven en la hoja
// USUARIOS; el token de sesión codifica usuario+expiración y va firmado
// con SECRET_KEY (hoja CONFIG).

function sha256Hex(texto) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(texto), Utilities.Charset.UTF_8);
  return bytes.map(function (b) {
    var v = (b < 0 ? b + 256 : b).toString(16);
    return v.length === 1 ? '0' + v : v;
  }).join('');
}

function ensureUsuariosSheet() {
  var ss = getSpreadsheet();
  var sh = ss.getSheetByName(SHEET_USUARIOS);
  if (!sh) {
    sh = ss.insertSheet(SHEET_USUARIOS);
    sh.appendRow(['USERNAME', 'PASSWORD_HASH', 'ROL', 'NOMBRE']);
    sh.getRange(2, 1).setNumberFormat('@');
    sh.appendRow(['admin', sha256Hex(PASSWORD_DEFECTO), 'administrador', 'Administrador']);
  }
  return sh;
}

// Lee la hoja USUARIOS una vez y la cachea; buscarUsuarioInterno() y
// listarUsuarios() reutilizan este mismo resultado. Se invalida en cada
// escritura (usuarioGuardar/usuarioEliminar/passwordCambiar).
function obtenerFilasUsuarios() {
  var cache = CacheService.getScriptCache();
  var cacheado = cache.get('usuarios');
  if (cacheado) return JSON.parse(cacheado);

  var sh = ensureUsuariosSheet();
  var values = sh.getDataRange().getValues();
  var out = [];
  for (var i = 1; i < values.length; i++) {
    if (!values[i][0]) continue;
    out.push({
      rowIndex: i + 1, username: String(values[i][0]),
      passwordHash: values[i][1], rol: values[i][2], nombre: values[i][3]
    });
  }
  cache.put('usuarios', JSON.stringify(out), CACHE_TTL_SEGUNDOS);
  return out;
}

function invalidarCacheUsuarios() {
  CacheService.getScriptCache().remove('usuarios');
}

function listarUsuarios() {
  return obtenerFilasUsuarios().map(function (u) {
    return { username: u.username, rol: u.rol, nombre: u.nombre };
  });
}

function contarAdministradores() {
  return listarUsuarios().filter(function (u) { return u.rol === 'administrador'; }).length;
}

function buscarUsuarioInterno(username) {
  username = String(username || '').trim().toLowerCase();
  var filas = obtenerFilasUsuarios();
  for (var i = 0; i < filas.length; i++) {
    if (filas[i].username.trim().toLowerCase() === username) return filas[i];
  }
  return null;
}

function usuarioGuardar(body) {
  var username = String(body.username || '').trim();
  if (!username) throw new Error('El usuario es obligatorio');
  if (!body.nombre) throw new Error('El nombre es obligatorio');
  var sh = ensureUsuariosSheet();
  var usernameOriginal = body.usernameOriginal ? String(body.usernameOriginal).trim() : null;
  var existente = usernameOriginal ? buscarUsuarioInterno(usernameOriginal) : null;
  if (usernameOriginal && !existente) throw new Error('Usuario no encontrado');

  var duplicado = buscarUsuarioInterno(username);
  if (duplicado && (!existente || duplicado.rowIndex !== existente.rowIndex)) {
    throw new Error('Ya existe un usuario con ese nombre');
  }

  if (existente) {
    var hash = body.password ? sha256Hex(body.password) : existente.passwordHash;
    sh.getRange(existente.rowIndex, 1).setNumberFormat('@');
    sh.getRange(existente.rowIndex, 1, 1, 4).setValues([[username, hash, 'administrador', body.nombre]]);
    invalidarCacheUsuarios();
    return { actualizado: true };
  }
  if (!body.password) throw new Error('La contraseña es obligatoria');
  var fila = sh.getLastRow() + 1;
  sh.getRange(fila, 1).setNumberFormat('@');
  sh.getRange(fila, 1, 1, 4).setValues([[username, sha256Hex(body.password), 'administrador', body.nombre]]);
  invalidarCacheUsuarios();
  return { creado: true };
}

function usuarioEliminar(username) {
  var existente = buscarUsuarioInterno(username);
  if (!existente) throw new Error('Usuario no encontrado');
  if (contarAdministradores() <= 1) {
    throw new Error('Debe existir al menos un administrador');
  }
  var sh = ensureUsuariosSheet();
  sh.deleteRow(existente.rowIndex);
  invalidarCacheUsuarios();
  return { eliminado: true };
}

function loginIntentosClave(username) {
  return 'login_intentos_' + String(username || '').trim().toLowerCase();
}

// Bloquea un usuario (no la IP: Apps Script no la expone) tras varios
// intentos fallidos seguidos, por un rato, para dificultar la fuerza bruta
// de contraseñas. Se resetea solo al expirar la caché o al iniciar sesión bien.
function login(username, password) {
  var cache = CacheService.getScriptCache();
  var clave = loginIntentosClave(username);
  var intentos = Number(cache.get(clave) || 0);
  if (intentos >= LOGIN_MAX_INTENTOS) {
    throw new Error('Demasiados intentos fallidos. Espere unos minutos e intente de nuevo.');
  }

  var user = buscarUsuarioInterno(username);
  if (!user || sha256Hex(password || '') !== user.passwordHash) {
    cache.put(clave, String(intentos + 1), LOGIN_BLOQUEO_SEGUNDOS);
    throw new Error('Usuario o contraseña incorrectos');
  }
  if (user.rol !== 'administrador') throw new Error('Esta cuenta no tiene acceso de administrador.');

  cache.remove(clave);
  var cfg = getConfig();
  var expiry = Date.now() + TOKEN_DURACION_MS;
  var payload = Utilities.base64EncodeWebSafe(JSON.stringify({ u: user.username, r: user.rol, e: expiry }));
  var firma = sha256Hex(payload + cfg.SECRET_KEY);
  return { token: payload + '.' + firma, nombre: user.nombre, username: user.username };
}

function requireAuth(token) {
  var cfg = getConfig();
  if (!token) throw new Error('No autorizado. Inicie sesión.');
  var partes = token.split('.');
  if (partes.length !== 2) throw new Error('Token inválido');
  var esperada = sha256Hex(partes[0] + cfg.SECRET_KEY);
  if (partes[1] !== esperada) throw new Error('Token inválido');
  var payload;
  try {
    payload = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(partes[0])).getDataAsString());
  } catch (err) {
    throw new Error('Token inválido');
  }
  if (!payload.e || Date.now() > payload.e) throw new Error('Sesión expirada. Vuelva a iniciar sesión.');
  var user = buscarUsuarioInterno(payload.u);
  if (!user) throw new Error('Sesión expirada. Vuelva a iniciar sesión.');
  return { username: payload.u, rol: payload.r };
}

function requireAdmin(token) {
  var sesion = requireAuth(token);
  if (sesion.rol !== 'administrador') throw new Error('Requiere permisos de administrador.');
  return sesion;
}

function passwordCambiar(token, nuevaPassword) {
  var sesion = requireAuth(token);
  if (!nuevaPassword || nuevaPassword.length < 4) {
    throw new Error('La nueva contraseña debe tener al menos 4 caracteres');
  }
  var user = buscarUsuarioInterno(sesion.username);
  if (!user) throw new Error('Usuario no encontrado');
  var sh = ensureUsuariosSheet();
  sh.getRange(user.rowIndex, 2).setValue(sha256Hex(nuevaPassword));
  invalidarCacheUsuarios();
  return { ok: true };
}

// ==================== EMPLEADOS ====================

function listarEmpleados() {
  var cache = CacheService.getScriptCache();
  var cacheado = cache.get('empleados');
  if (cacheado) return JSON.parse(cacheado);

  var sh = getSheet(SHEET_EMPLEADOS);
  if (!sh.getRange(1, 5).getValue()) {
    sh.getRange(1, 5).setValue('CORREO'); // migración: hojas creadas antes de esta columna
  }
  var values = sh.getDataRange().getValues();
  var out = [];
  for (var i = 1; i < values.length; i++) {
    if (!values[i][0]) continue;
    out.push({
      codigo: String(values[i][0]),
      nombre: values[i][1],
      cargo: values[i][2],
      turno: formatoHora(values[i][3], 'HH:mm'),
      correo: values[i][4] || ''
    });
  }
  cache.put('empleados', JSON.stringify(out), CACHE_TTL_SEGUNDOS);
  return out;
}

function buscarEmpleado(codigo) {
  var empleados = listarEmpleados();
  for (var i = 0; i < empleados.length; i++) {
    if (empleados[i].codigo === String(codigo)) return empleados[i];
  }
  return null;
}

function empleadoGuardar(body) {
  var codigo = String(body.codigo || '').trim();
  if (!codigo) throw new Error('El código es obligatorio');
  if (!body.nombre) throw new Error('El nombre es obligatorio');
  if (!body.turno) throw new Error('El turno es obligatorio');

  var sh = getSheet(SHEET_EMPLEADOS);
  var values = sh.getDataRange().getValues();
  var resultado;
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0]) === codigo) {
      sh.getRange(i + 1, 1).setNumberFormat('@');
      sh.getRange(i + 1, 4).setNumberFormat('@');
      sh.getRange(i + 1, 1, 1, 5).setValues([[codigo, body.nombre, body.cargo || '', body.turno, body.correo || '']]);
      resultado = { actualizado: true };
      break;
    }
  }
  if (!resultado) {
    var fila = sh.getLastRow() + 1;
    sh.getRange(fila, 1).setNumberFormat('@');
    sh.getRange(fila, 4).setNumberFormat('@');
    sh.getRange(fila, 1, 1, 5).setValues([[codigo, body.nombre, body.cargo || '', body.turno, body.correo || '']]);
    resultado = { creado: true };
  }
  CacheService.getScriptCache().remove('empleados');
  return resultado;
}

function empleadoEliminar(codigo) {
  codigo = String(codigo);
  var sh = getSheet(SHEET_EMPLEADOS);
  var values = sh.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0]) === codigo) {
      sh.deleteRow(i + 1);
      CacheService.getScriptCache().remove('empleados');
      return { eliminado: true };
    }
  }
  throw new Error('Empleado no encontrado');
}

// ==================== TURNOS ====================

function turnosGuardar(turnos) {
  if (!Array.isArray(turnos) || turnos.length === 0) {
    throw new Error('Debe haber al menos un turno');
  }
  var re = /^\d{2}:\d{2}$/;
  turnos.forEach(function (t) {
    if (!re.test(t)) throw new Error('Formato de turno inválido: ' + t + ' (use HH:mm)');
  });
  setConfigValue('TURNOS', turnos.join(','));
  return { ok: true };
}

// ==================== UBICACIÓN ====================

function configGuardar(body) {
  if (typeof body.lat !== 'number' || typeof body.lng !== 'number') {
    throw new Error('Latitud y longitud son obligatorias');
  }
  setConfigValue('LAT', body.lat);
  setConfigValue('LNG', body.lng);
  if (body.radio) setConfigValue('RADIO_METROS', body.radio);
  return { ok: true };
}

function haversine(lat1, lng1, lat2, lng2) {
  var R = 6371000;
  var toRad = function (v) { return (v * Math.PI) / 180; };
  var dLat = toRad(lat2 - lat1);
  var dLng = toRad(lng2 - lng1);
  var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function validarUbicacion(lat, lng, accuracy) {
  var cfg = getConfig();
  if (!cfg.LAT || !cfg.LNG) {
    throw new Error('La ubicación de referencia no está configurada. Contacte al administrador.');
  }
  if (typeof lat !== 'number' || typeof lng !== 'number') {
    throw new Error('No se pudo obtener su ubicación GPS.');
  }
  var distancia = haversine(lat, lng, Number(cfg.LAT), Number(cfg.LNG));
  var radio = Number(cfg.RADIO_METROS || 5);
  // Se amplía el radio con el margen de error que reportó el dispositivo
  // (topado), igual que en el frontend, para no rechazar en falso a
  // celulares/tablets con GPS menos preciso.
  var margen = Math.min(Number(accuracy) || 0, MARGEN_PRECISION_MAX);
  var radioEfectivo = radio + margen;
  if (distancia > radioEfectivo) {
    throw new Error('Fuera de la ubicación permitida. Distancia: ' + distancia.toFixed(1) + ' m (máx ' + radio + ' m)');
  }
  return distancia;
}

// ==================== FOTOS (Drive) ====================

function getOrCreateFolder(nombre) {
  var folders = DriveApp.getFoldersByName(nombre);
  if (folders.hasNext()) return folders.next();
  return DriveApp.createFolder(nombre);
}

function guardarFoto(base64Data, prefijo, codigo) {
  if (!base64Data) throw new Error('Falta la foto');
  var partes = base64Data.split(',');
  var datos = partes.length > 1 ? partes[1] : partes[0];
  var bytes = Utilities.base64Decode(datos);
  var nombreArchivo = prefijo + '_' + codigo + '_' + Date.now() + '.jpg';
  var blob = Utilities.newBlob(bytes, 'image/jpeg', nombreArchivo);
  var folder = getOrCreateFolder(FOLDER_NAME);
  var file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return file.getUrl();
}

// ==================== REGISTRO DE ASISTENCIA ====================

function hoy() {
  return Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd');
}

function horaActual() {
  return Utilities.formatDate(new Date(), TIMEZONE, 'HH:mm:ss');
}

function encabezadosRegistro() {
  return ['CODIGO', 'NOMBRE', 'CARGO', 'TURNO', 'FECHA', 'HORA INGRESO', 'IMAGEN1', 'HORA SALIDA', 'IMAGEN2', 'OBSERVACION', 'ESTADO INGRESO', 'ESTADO SALIDA'];
}

// Google Sheets autoconvierte texto con forma de fecha/hora ("2026-08-04", "07:00:00")
// a valores de Fecha/Hora internos si la celda no está formateada como texto.
// Esto rompe las comparaciones de cadenas que usa este script, así que forzamos
// formato de texto ('@') ANTES de escribir en esas columnas.
function formatearColumnasTexto(sh, fila) {
  sh.getRange(fila, 1).setNumberFormat('@'); // CODIGO
  sh.getRange(fila, 4).setNumberFormat('@'); // TURNO
  sh.getRange(fila, 5).setNumberFormat('@'); // FECHA
  sh.getRange(fila, 6).setNumberFormat('@'); // HORA INGRESO
  sh.getRange(fila, 8).setNumberFormat('@'); // HORA SALIDA
}

// Si una celda quedó guardada como Fecha/Hora (por autoconversión previa de
// Sheets), la devolvemos como texto legible en vez del objeto Date crudo
// (que de otro modo se serializa como "1899-12-30T07:14:00.000Z").
function formatoHora(valor, patron) {
  if (Object.prototype.toString.call(valor) === '[object Date]') {
    return Utilities.formatDate(valor, TIMEZONE, patron);
  }
  // Refuerzo: si una fórmula (ej. un BUSCARV hacia otra hoja) trae una hora
  // pero pierde el formato al llegar a la celda, Sheets entrega un número
  // crudo (fracción del día: 0.3333... = 08:00) en vez de un Date o un
  // texto "HH:mm". Sin esto, ese número pasaba intacto y rompía en
  // silencio calcularEstadoIngreso/calcularHorasExtras (comparaciones de
  // texto contra un número dan siempre falso). Solo aplica a columnas de
  // hora (patrón que empieza con "HH"); FECHA usa "yyyy-MM-dd" y no debe
  // interpretarse como fracción de día.
  if (typeof valor === 'number' && isFinite(valor) && /^HH/.test(patron)) {
    var totalSegundos = Math.round(((valor % 1) + 1) % 1 * 24 * 3600);
    var horas = Math.floor(totalSegundos / 3600);
    var minutos = Math.floor((totalSegundos % 3600) / 60);
    var segundos = totalSegundos % 60;
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    var horaCompleta = pad(horas) + ':' + pad(minutos) + ':' + pad(segundos);
    return patron === 'HH:mm' ? horaCompleta.substring(0, 5) : horaCompleta;
  }
  return valor;
}

function buscarFilaRegistro(codigo, fecha) {
  var sh = getSheet(SHEET_REGISTRO);
  var values = sh.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    var filaFecha = formatoHora(values[i][4], 'yyyy-MM-dd');
    if (String(values[i][0]) === String(codigo) && filaFecha === fecha) {
      return {
        rowIndex: i + 1,
        codigo: values[i][0], nombre: values[i][1], cargo: values[i][2],
        turno: formatoHora(values[i][3], 'HH:mm'),
        fecha: filaFecha,
        horaIngreso: formatoHora(values[i][5], 'HH:mm:ss'), imagen1: values[i][6],
        horaSalida: formatoHora(values[i][7], 'HH:mm:ss'), imagen2: values[i][8],
        observacion: values[i][9],
        estadoIngreso: values[i][10], estadoSalida: values[i][11]
      };
    }
  }
  return null;
}

function calcularEstadoIngreso(horaStr, turnoStr) {
  var horaTurno = turnoStr.length === 5 ? turnoStr + ':00' : turnoStr;
  return horaStr <= horaTurno ? 'A TIEMPO' : 'ATRASADO';
}

// ==================== HORAS EXTRA ====================
// Entre semana, la hora extra empieza 9h01s después del inicio del turno
// (jornada de 8h + 1h de almuerzo). Fines de semana, toda la jornada
// trabajada cuenta como hora extra. En ambos casos, el exceso se redondea
// al medio hora más cercano: <30 min → 0, 30-44 min → 30 min, 45-59 min →
// hora completa (se repite por cada hora de exceso).

function horaASegundos(horaStr) {
  if (!horaStr) return null;
  var partes = String(horaStr).split(':').map(Number);
  return (partes[0] || 0) * 3600 + (partes[1] || 0) * 60 + (partes[2] || 0);
}

function redondearAMediaHora(totalSegundos) {
  if (totalSegundos <= 0) return 0;
  var horas = Math.floor(totalSegundos / 3600);
  var restoSegundos = totalSegundos % 3600;
  var minutosExtra;
  if (restoSegundos < 30 * 60) {
    minutosExtra = 0;
  } else if (restoSegundos < 45 * 60) {
    minutosExtra = 30;
  } else {
    horas += 1;
    minutosExtra = 0;
  }
  return horas * 60 + minutosExtra;
}

function formatoHorasMinutos(totalMinutos) {
  var horas = Math.floor(totalMinutos / 60);
  var minutos = totalMinutos % 60;
  return horas + ':' + (minutos < 10 ? '0' : '') + minutos;
}

function esFinDeSemana(fecha) {
  var partes = fecha.split('-').map(Number);
  var dia = new Date(partes[0], partes[1] - 1, partes[2]).getDay();
  return dia === 0 || dia === 6;
}

function calcularHorasExtras(fecha, turnoStr, horaIngresoStr, horaSalidaStr) {
  if (!horaSalidaStr) return null;
  var salidaSeg = horaASegundos(horaSalidaStr);
  var totalSegundos;
  if (esFinDeSemana(fecha)) {
    var ingresoSeg = horaASegundos(horaIngresoStr);
    totalSegundos = ingresoSeg == null ? 0 : salidaSeg - ingresoSeg;
  } else {
    var turnoSeg = horaASegundos(turnoStr.length === 5 ? turnoStr + ':00' : turnoStr);
    var umbral = turnoSeg + 9 * 3600 + 1;
    totalSegundos = salidaSeg - umbral;
  }
  return formatoHorasMinutos(redondearAMediaHora(totalSegundos));
}

// Arma el HTML (para clientes que lo soportan) y el texto plano de respaldo
// del correo de confirmación de horas extra. Arial/Helvetica a propósito:
// Gmail/Outlook ignoran fuentes personalizadas en el HTML de un correo.
function construirCorreoHorasExtras(empleado, fecha, horaIngreso, horaSalida, horasExtras) {
  var filas = [
    ['Código', empleado.codigo],
    ['Cargo', empleado.cargo || '-'],
    ['Turno asignado', empleado.turno],
    ['Hora de ingreso', horaIngreso],
    ['Hora de salida', horaSalida]
  ].map(function (f) {
    return '<tr>' +
      '<td style="padding:9px 4px;border-bottom:1px solid #e6e9ee;color:#5f6368;width:44%;">' + f[0] + '</td>' +
      '<td style="padding:9px 4px;border-bottom:1px solid #e6e9ee;color:#202124;font-weight:600;text-align:right;">' + f[1] + '</td>' +
      '</tr>';
  }).join('');

  var filaDestacada = '<tr>' +
    '<td style="padding-top:14px;color:#1f6b3a;font-weight:700;">Horas extra generadas</td>' +
    '<td style="padding-top:14px;color:#1f6b3a;font-weight:800;font-size:16px;text-align:right;">' + horasExtras + '</td>' +
    '</tr>';

  var html =
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f5;padding:28px 20px;">' +
      '<tr><td align="center">' +
        '<table role="presentation" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;background:#ffffff;border-radius:8px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;">' +
          '<tr><td style="background:#103a70;padding:22px 28px;">' +
            '<div style="color:#ffffff;font-size:15px;font-weight:700;">' + NOMBRE_EMPRESA + '</div>' +
            '<div style="color:#9fc0ea;font-size:12px;margin-top:3px;">Registro de Asistencia</div>' +
          '</td></tr>' +
          '<tr><td style="padding:28px;color:#202124;font-size:14px;line-height:1.6;">' +
            '<p style="margin:0 0 14px;">Hola <strong>' + empleado.nombre + '</strong>,</p>' +
            '<p style="margin:0 0 14px;">Se registró tu salida del <strong>' + fecha + '</strong> con el siguiente detalle:</p>' +
            '<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:6px 0 20px;font-size:13.5px;">' +
              filas + filaDestacada +
            '</table>' +
            '<p style="margin:0;color:#5f6368;font-size:12.5px;">Este es un mensaje automático, por favor no responder.</p>' +
          '</td></tr>' +
          '<tr><td style="padding:16px 28px 24px;font-size:11.5px;color:#8a93a2;border-top:1px solid #eef1f5;">' + NOMBRE_EMPRESA + ' · Registro de Asistencia</td></tr>' +
        '</table>' +
      '</td></tr>' +
    '</table>';

  var texto = 'Hola ' + empleado.nombre + ',\n\n' +
    'Se registró tu salida del ' + fecha + ' con el siguiente detalle:\n\n' +
    'Código: ' + empleado.codigo + '\n' +
    'Cargo: ' + (empleado.cargo || '-') + '\n' +
    'Turno asignado: ' + empleado.turno + '\n' +
    'Hora de ingreso: ' + horaIngreso + '\n' +
    'Hora de salida: ' + horaSalida + '\n' +
    'Horas extra generadas: ' + horasExtras + '\n\n' +
    'Este es un mensaje automático, por favor no responder.';

  return { html: html, texto: texto };
}

// Envía la confirmación de horas extra por correo. No debe interrumpir el
// registro de salida si falla (dirección inválida, cuota de MailApp, etc.).
function enviarCorreoHorasExtras(empleado, fecha, horaIngreso, horaSalida, horasExtras) {
  if (!empleado.correo) return;
  try {
    var asunto = NOMBRE_EMPRESA + ' — Confirmación de horas extra (' + fecha + ')';
    var correo = construirCorreoHorasExtras(empleado, fecha, horaIngreso, horaSalida, horasExtras);
    MailApp.sendEmail({
      to: empleado.correo,
      cc: CORREO_COPIA_HORAS_EXTRA,
      subject: asunto,
      body: correo.texto,
      htmlBody: correo.html
    });
  } catch (err) {
    // Silencioso: el registro de salida ya se guardó correctamente.
  }
}

// Límite de velocidad del kiosco público (sin login): sin esto, cualquiera
// con la URL podría spamear registros falsos con un script fuera del
// navegador (CORS no protege contra eso) y agotar la cuota de Drive/correo.
// Ventana fija por minuto, compartida entre ingreso y salida; no distingue
// por IP porque Apps Script no la expone en el evento del Web App.
function verificarLimiteKiosco() {
  var cache = CacheService.getScriptCache();
  var ventana = Math.floor(Date.now() / (KIOSCO_LIMITE_VENTANA_SEGUNDOS * 1000));
  var clave = 'kiosco_limite_' + ventana;
  var intentos = Number(cache.get(clave) || 0);
  if (intentos >= KIOSCO_LIMITE_INTENTOS) {
    throw new Error('Demasiadas solicitudes en poco tiempo. Espere un momento e intente de nuevo.');
  }
  cache.put(clave, String(intentos + 1), KIOSCO_LIMITE_VENTANA_SEGUNDOS + 10);
}

// El ingreso y la salida comparten una sola columna OBSERVACION: si ambos
// traen texto (p. ej. una nota al entrar y otra distinta al salir), se
// concatenan en vez de que la segunda pise a la primera. Se recorta a 200
// caracteres también aquí por si alguien llama a la API sin pasar por el
// formulario (el maxlength del textarea no protege al servidor).
function combinarObservacion(actual, nueva) {
  actual = (actual || '').toString();
  nueva = (nueva || '').toString().trim().slice(0, 200);
  if (!nueva) return actual;
  return actual ? (actual + ' / ' + nueva) : nueva;
}

function registrarIngreso(body) {
  verificarLimiteKiosco();
  var distancia = validarUbicacion(body.lat, body.lng, body.accuracy);
  var empleado = buscarEmpleado(body.codigo);
  if (!empleado) throw new Error('Código no encontrado');

  var fecha = hoy();
  var existente = buscarFilaRegistro(empleado.codigo, fecha);
  if (existente && existente.horaIngreso) {
    throw new Error('Ya se registró el ingreso de hoy para ' + empleado.nombre);
  }

  var hora = horaActual();
  var urlFoto = guardarFoto(body.imagenBase64, 'INGRESO', empleado.codigo);
  var estadoIngreso = calcularEstadoIngreso(hora, empleado.turno);

  var sh = getSheet(SHEET_REGISTRO);
  var filaDestino = existente ? existente.rowIndex : sh.getLastRow() + 1;
  formatearColumnasTexto(sh, filaDestino);
  sh.getRange(filaDestino, 1, 1, 12).setValues([[
    empleado.codigo, empleado.nombre, empleado.cargo, empleado.turno, fecha, hora, urlFoto,
    existente ? (existente.horaSalida || '') : '',
    existente ? (existente.imagen2 || '') : '',
    combinarObservacion(existente ? existente.observacion : '', body.observacion),
    estadoIngreso,
    existente ? (existente.estadoSalida || '') : ''
  ]]);

  var cfg = obtenerConfigPublica();
  var ultimoTurno = cfg.turnos.slice().sort()[cfg.turnos.length - 1];

  return {
    nombre: empleado.nombre, cargo: empleado.cargo, turno: empleado.turno,
    hora: hora, estado: estadoIngreso, distancia: Math.round(distancia * 10) / 10,
    esUltimoTurno: empleado.turno === ultimoTurno
  };
}

function registrarSalida(body) {
  verificarLimiteKiosco();
  var distancia = validarUbicacion(body.lat, body.lng, body.accuracy);
  var empleado = buscarEmpleado(body.codigo);
  if (!empleado) throw new Error('Código no encontrado');

  var fecha = hoy();
  var existente = buscarFilaRegistro(empleado.codigo, fecha);
  if (!existente || !existente.horaIngreso) {
    throw new Error('Debe registrar el ingreso antes de la salida');
  }
  if (existente.horaSalida) {
    throw new Error('Ya se registró la salida de hoy para ' + empleado.nombre);
  }

  var hora = horaActual();
  var urlFoto = guardarFoto(body.imagenBase64, 'SALIDA', empleado.codigo);
  var estadoSalida = 'FIN DE JORNADA';

  var sh = getSheet(SHEET_REGISTRO);
  formatearColumnasTexto(sh, existente.rowIndex);
  sh.getRange(existente.rowIndex, 8, 1, 1).setValue(hora);          // HORA SALIDA
  sh.getRange(existente.rowIndex, 9, 1, 1).setValue(urlFoto);       // IMAGEN2
  sh.getRange(existente.rowIndex, 10, 1, 1).setValue(combinarObservacion(existente.observacion, body.observacion)); // OBSERVACION
  // Columna 12 = ESTADO SALIDA. La columna 11 (ESTADO INGRESO), con el
  // A TIEMPO/ATRASADO calculado al momento del ingreso, ya NO se toca aquí
  // (antes se sobrescribía con "FIN DE JORNADA" y se perdía ese dato).
  sh.getRange(existente.rowIndex, 12, 1, 1).setValue(estadoSalida);

  var horasExtras = calcularHorasExtras(fecha, empleado.turno, existente.horaIngreso, hora);
  if (horasExtras && horasExtras !== '0:00') {
    enviarCorreoHorasExtras(empleado, fecha, existente.horaIngreso, hora, horasExtras);
  }

  return {
    nombre: empleado.nombre, cargo: empleado.cargo, turno: empleado.turno,
    hora: hora, estado: estadoSalida, distancia: Math.round(distancia * 10) / 10,
    horasExtras: horasExtras
  };
}

// ==================== INFORME ====================

function generarInforme(fecha) {
  fecha = fecha || hoy();
  var empleados = listarEmpleados();
  var sh = getSheet(SHEET_REGISTRO);
  var values = sh.getDataRange().getValues();
  var registrosDelDia = {};
  for (var i = 1; i < values.length; i++) {
    if (formatoHora(values[i][4], 'yyyy-MM-dd') === fecha) {
      registrosDelDia[String(values[i][0])] = {
        horaIngreso: formatoHora(values[i][5], 'HH:mm:ss'),
        horaSalida: formatoHora(values[i][7], 'HH:mm:ss'),
        estadoIngreso: values[i][10],
        estadoSalida: values[i][11]
      };
    }
  }

  var registrados = [];
  var noRegistrados = [];
  empleados.forEach(function (emp) {
    var reg = registrosDelDia[emp.codigo];
    if (reg && reg.horaIngreso) {
      registrados.push({
        codigo: emp.codigo, nombre: emp.nombre, cargo: emp.cargo, turno: emp.turno,
        horaIngreso: reg.horaIngreso, horaSalida: reg.horaSalida || '',
        estadoIngreso: reg.estadoIngreso, estadoSalida: reg.estadoSalida || '',
        horasExtras: calcularHorasExtras(fecha, emp.turno, reg.horaIngreso, reg.horaSalida)
      });
    } else {
      noRegistrados.push({ codigo: emp.codigo, nombre: emp.nombre, cargo: emp.cargo, turno: emp.turno });
    }
  });

  return { fecha: fecha, registrados: registrados, noRegistrados: noRegistrados };
}
