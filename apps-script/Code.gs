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

// ==================== ENTRADAS HTTP ====================

function doGet(e) {
  try {
    var action = e.parameter.action;
    var data;
    switch (action) {
      case 'empleados':
        requireAuth(e.parameter.token);
        data = listarEmpleados();
        break;
      case 'config':
        requireAdmin(e.parameter.token);
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
        requireAuth(body.token);
        data = registrarIngreso(body);
        break;
      case 'registrarSalida':
        requireAuth(body.token);
        data = registrarSalida(body);
        break;
      case 'empleadoGuardar':
        requireAdmin(body.token);
        data = empleadoGuardar(body);
        break;
      case 'empleadoEliminar':
        requireAdmin(body.token);
        data = empleadoEliminar(body.codigo);
        break;
      case 'turnosGuardar':
        requireAdmin(body.token);
        data = turnosGuardar(body.turnos);
        break;
      case 'configGuardar':
        requireAdmin(body.token);
        data = configGuardar(body);
        break;
      case 'passwordCambiar':
        data = passwordCambiar(body.token, body.nuevaPassword);
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
        data = usuarioGuardar(body);
        break;
      case 'usuarioEliminar':
        requireAdmin(body.token);
        data = usuarioEliminar(body.username);
        break;
      case 'usuarioBloquear':
        requireAdmin(body.token);
        data = usuarioBloquear(body.username, !!body.bloqueado);
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
  var sh = ensureConfigSheet();
  var values = sh.getDataRange().getValues();
  var cfg = {};
  for (var i = 1; i < values.length; i++) {
    cfg[values[i][0]] = values[i][1];
  }
  return cfg;
}

function setConfigValue(clave, valor) {
  var sh = ensureConfigSheet();
  var values = sh.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    if (values[i][0] === clave) {
      sh.getRange(i + 1, 2).setValue(valor);
      return;
    }
  }
  sh.appendRow([clave, valor]);
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

// ==================== USUARIOS Y AUTENTICACIÓN ====================
// Dos roles: "administrador" (acceso total) y "usuario" (solo kiosco de
// registro). Las credenciales viven en la hoja USUARIOS; el token de sesión
// codifica usuario+rol+expiración y va firmado con SECRET_KEY (hoja CONFIG).

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
    sh.appendRow(['USERNAME', 'PASSWORD_HASH', 'ROL', 'NOMBRE', 'BLOQUEADO']);
    sh.getRange(2, 1).setNumberFormat('@');
    sh.appendRow(['admin', sha256Hex(PASSWORD_DEFECTO), 'administrador', 'Administrador', '']);
  } else if (!sh.getRange(1, 5).getValue()) {
    sh.getRange(1, 5).setValue('BLOQUEADO'); // migración: hojas creadas antes de esta columna
  }
  return sh;
}

function esBloqueado(valor) {
  return valor === 'SI' || valor === true;
}

function listarUsuarios() {
  var sh = ensureUsuariosSheet();
  var values = sh.getDataRange().getValues();
  var out = [];
  for (var i = 1; i < values.length; i++) {
    if (!values[i][0]) continue;
    out.push({ username: String(values[i][0]), rol: values[i][2], nombre: values[i][3], bloqueado: esBloqueado(values[i][4]) });
  }
  return out;
}

function contarAdministradores() {
  return listarUsuarios().filter(function (u) { return u.rol === 'administrador'; }).length;
}

function buscarUsuarioInterno(username) {
  var sh = ensureUsuariosSheet();
  var values = sh.getDataRange().getValues();
  username = String(username || '').trim().toLowerCase();
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0]).trim().toLowerCase() === username) {
      return {
        rowIndex: i + 1, username: String(values[i][0]),
        passwordHash: values[i][1], rol: values[i][2], nombre: values[i][3],
        bloqueado: esBloqueado(values[i][4])
      };
    }
  }
  return null;
}

function usuarioBloquear(username, bloqueado) {
  var existente = buscarUsuarioInterno(username);
  if (!existente) throw new Error('Usuario no encontrado');
  if (existente.rol === 'administrador') throw new Error('No se puede bloquear a un administrador');
  var sh = ensureUsuariosSheet();
  sh.getRange(existente.rowIndex, 5).setValue(bloqueado ? 'SI' : '');
  return { bloqueado: !!bloqueado };
}

function usuarioGuardar(body) {
  var username = String(body.username || '').trim();
  if (!username) throw new Error('El usuario es obligatorio');
  if (!body.nombre) throw new Error('El nombre es obligatorio');
  if (body.rol !== 'administrador' && body.rol !== 'usuario') {
    throw new Error('Rol inválido');
  }
  var sh = ensureUsuariosSheet();
  var usernameOriginal = body.usernameOriginal ? String(body.usernameOriginal).trim() : null;
  var existente = usernameOriginal ? buscarUsuarioInterno(usernameOriginal) : null;
  if (usernameOriginal && !existente) throw new Error('Usuario no encontrado');

  var duplicado = buscarUsuarioInterno(username);
  if (duplicado && (!existente || duplicado.rowIndex !== existente.rowIndex)) {
    throw new Error('Ya existe un usuario con ese nombre');
  }

  if (existente) {
    if (existente.rol === 'administrador' && body.rol !== 'administrador' && contarAdministradores() <= 1) {
      throw new Error('Debe existir al menos un administrador');
    }
    var hash = body.password ? sha256Hex(body.password) : existente.passwordHash;
    sh.getRange(existente.rowIndex, 1).setNumberFormat('@');
    sh.getRange(existente.rowIndex, 1, 1, 4).setValues([[username, hash, body.rol, body.nombre]]);
    return { actualizado: true };
  }
  if (!body.password) throw new Error('La contraseña es obligatoria');
  var fila = sh.getLastRow() + 1;
  sh.getRange(fila, 1).setNumberFormat('@');
  sh.getRange(fila, 1, 1, 4).setValues([[username, sha256Hex(body.password), body.rol, body.nombre]]);
  return { creado: true };
}

function usuarioEliminar(username) {
  var existente = buscarUsuarioInterno(username);
  if (!existente) throw new Error('Usuario no encontrado');
  if (existente.rol === 'administrador' && contarAdministradores() <= 1) {
    throw new Error('Debe existir al menos un administrador');
  }
  var sh = ensureUsuariosSheet();
  sh.deleteRow(existente.rowIndex);
  return { eliminado: true };
}

function login(username, password) {
  var user = buscarUsuarioInterno(username);
  if (!user || sha256Hex(password || '') !== user.passwordHash) {
    throw new Error('Usuario o contraseña incorrectos');
  }
  if (user.bloqueado) throw new Error('Cuenta bloqueada. Contacte al administrador.');
  var cfg = getConfig();
  var expiry = Date.now() + TOKEN_DURACION_MS;
  var payload = Utilities.base64EncodeWebSafe(JSON.stringify({ u: user.username, r: user.rol, e: expiry }));
  var firma = sha256Hex(payload + cfg.SECRET_KEY);
  return { token: payload + '.' + firma, rol: user.rol, nombre: user.nombre, username: user.username };
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
  if (user.bloqueado) throw new Error('Cuenta bloqueada. Contacte al administrador.');
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
  return { ok: true };
}

// ==================== EMPLEADOS ====================

function listarEmpleados() {
  var sh = getSheet(SHEET_EMPLEADOS);
  var values = sh.getDataRange().getValues();
  var out = [];
  for (var i = 1; i < values.length; i++) {
    if (!values[i][0]) continue;
    out.push({
      codigo: String(values[i][0]),
      nombre: values[i][1],
      cargo: values[i][2],
      turno: formatoHora(values[i][3], 'HH:mm')
    });
  }
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
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0]) === codigo) {
      sh.getRange(i + 1, 1).setNumberFormat('@');
      sh.getRange(i + 1, 4).setNumberFormat('@');
      sh.getRange(i + 1, 1, 1, 4).setValues([[codigo, body.nombre, body.cargo || '', body.turno]]);
      return { actualizado: true };
    }
  }
  var fila = sh.getLastRow() + 1;
  sh.getRange(fila, 1).setNumberFormat('@');
  sh.getRange(fila, 4).setNumberFormat('@');
  sh.getRange(fila, 1, 1, 4).setValues([[codigo, body.nombre, body.cargo || '', body.turno]]);
  return { creado: true };
}

function empleadoEliminar(codigo) {
  codigo = String(codigo);
  var sh = getSheet(SHEET_EMPLEADOS);
  var values = sh.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0]) === codigo) {
      sh.deleteRow(i + 1);
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
  return ['CODIGO', 'NOMBRE', 'CARGO', 'TURNO', 'FECHA', 'HORA INGRESO', 'IMAGEN1', 'HORA SALIDA', 'IMAGEN2', 'OBSERVACION', 'ESTADO'];
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
        observacion: values[i][9], estado: values[i][10]
      };
    }
  }
  return null;
}

function calcularEstadoIngreso(horaStr, turnoStr) {
  var horaTurno = turnoStr.length === 5 ? turnoStr + ':00' : turnoStr;
  return horaStr <= horaTurno ? 'A TIEMPO' : 'ATRASADO';
}

function registrarIngreso(body) {
  var empleado = buscarEmpleado(body.codigo);
  if (!empleado) throw new Error('Código no encontrado');

  var fecha = hoy();
  var existente = buscarFilaRegistro(empleado.codigo, fecha);
  if (existente && existente.horaIngreso) {
    throw new Error('Ya se registró el ingreso de hoy para ' + empleado.nombre);
  }

  var hora = horaActual();
  var urlFoto = guardarFoto(body.imagenBase64, 'INGRESO', empleado.codigo);
  var estado = calcularEstadoIngreso(hora, empleado.turno);

  var sh = getSheet(SHEET_REGISTRO);
  var filaDestino = existente ? existente.rowIndex : sh.getLastRow() + 1;
  formatearColumnasTexto(sh, filaDestino);
  sh.getRange(filaDestino, 1, 1, 11).setValues([[
    empleado.codigo, empleado.nombre, empleado.cargo, empleado.turno, fecha, hora, urlFoto,
    existente ? (existente.horaSalida || '') : '',
    existente ? (existente.imagen2 || '') : '',
    existente ? (existente.observacion || '') : '',
    estado
  ]]);

  var cfg = obtenerConfigPublica();
  var ultimoTurno = cfg.turnos.slice().sort()[cfg.turnos.length - 1];

  return {
    nombre: empleado.nombre, cargo: empleado.cargo, turno: empleado.turno,
    hora: hora, estado: estado,
    esUltimoTurno: empleado.turno === ultimoTurno
  };
}

function registrarSalida(body) {
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
  var estado = 'FIN DE JORNADA';

  var sh = getSheet(SHEET_REGISTRO);
  formatearColumnasTexto(sh, existente.rowIndex);
  sh.getRange(existente.rowIndex, 8, 1, 1).setValue(hora);       // HORA SALIDA
  sh.getRange(existente.rowIndex, 9, 1, 1).setValue(urlFoto);     // IMAGEN2
  sh.getRange(existente.rowIndex, 11, 1, 1).setValue(estado);     // ESTADO

  return {
    nombre: empleado.nombre, cargo: empleado.cargo, turno: empleado.turno,
    hora: hora, estado: estado
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
        estado: values[i][10]
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
        horaIngreso: reg.horaIngreso, horaSalida: reg.horaSalida || '', estado: reg.estado
      });
    } else {
      noRegistrados.push({ codigo: emp.codigo, nombre: emp.nombre, cargo: emp.cargo, turno: emp.turno });
    }
  });

  return { fecha: fecha, registrados: registrados, noRegistrados: noRegistrados };
}
