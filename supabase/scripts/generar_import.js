// Lee los CSV exportados de la Sheet copiada (supabase/data/, no
// versionado) y genera supabase/data/import.sql con las sentencias
// para cargar los datos en Supabase. No se conecta a nada: el archivo
// generado se revisa y se corre a mano en el SQL Editor.
//
// Uso: node supabase/scripts/generar_import.js

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const OUT_FILE = path.join(DATA_DIR, 'import.sql');
const OUT_ADMIN_FILE = path.join(DATA_DIR, 'perfiles_admin.sql');

// Correo asignado a cada USERNAME de USUARIOS.csv para su cuenta de
// Supabase Auth. Los de @telconet.ec se tomaron de EMPLEADOS.csv
// (mismo username = parte local del correo); "montty" no tenía
// empleado correspondiente y se definió aparte con el usuario.
const CORREO_POR_USERNAME = {
  montty: 'milos77c@gmail.com',
  rimbaquingo: 'rimbaquingo@telconet.ec',
  mguanulema: 'mguanulema@telconet.ec',
  wherrera: 'wherrera@telconet.ec'
};

// ---------- CSV parsing (soporta campos con comillas y comas embebidas) ----------
function parseCSV(content) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  content = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  for (let i = 0; i < content.length; i++) {
    const c = content[i];
    if (inQuotes) {
      if (c === '"') {
        if (content[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n') {
      row.push(field); rows.push(row); row = []; field = '';
    } else {
      field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function leerCsvObjetos(nombreArchivo) {
  const ruta = path.join(DATA_DIR, nombreArchivo);
  if (!fs.existsSync(ruta)) {
    console.warn(`Aviso: no existe ${nombreArchivo}, se omite.`);
    return [];
  }
  const rows = parseCSV(fs.readFileSync(ruta, 'utf8'));
  if (rows.length === 0) return [];
  const headers = rows[0].map((h) => h.trim());
  return rows.slice(1)
    .filter((r) => r.some((v) => (v || '').trim() !== ''))
    .map((r) => {
      const obj = {};
      headers.forEach((h, i) => { obj[h] = (r[i] ?? '').trim(); });
      return obj;
    });
}

// ---------- utilidades SQL ----------
function sqlStr(v) {
  if (v === null || v === undefined || v === '') return 'null';
  return `'${String(v).replace(/'/g, "''")}'`;
}
function sqlNum(v) {
  if (v === null || v === undefined || v === '') return 'null';
  const n = Number(v);
  return isNaN(n) ? 'null' : String(n);
}

// ---------- normaliza los 4 formatos de TURNO vistos en REGISTRO.csv ----------
function normalizarTurno(raw) {
  raw = (raw || '').trim();
  if (!raw) return null;
  if (raw.toUpperCase() === 'VACACIONES') return 'VACACIONES';

  let m = raw.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (m) return `${m[1].padStart(2, '0')}:${m[2]}:${m[3] || '00'}`;

  m = raw.match(/^(\d{1,2}):(\d{2}):(\d{2})\s*([ap])\.?\s*m\.?$/i);
  if (m) {
    let h = parseInt(m[1], 10);
    const ampm = m[4].toLowerCase();
    if (ampm === 'p' && h !== 12) h += 12;
    if (ampm === 'a' && h === 12) h = 0;
    return `${String(h).padStart(2, '0')}:${m[2]}:${m[3]}`;
  }

  const num = Number(raw);
  if (!isNaN(num) && num >= 0 && num < 1) {
    const totalSeg = Math.round(num * 24 * 3600);
    const h = Math.floor(totalSeg / 3600);
    const mi = Math.floor((totalSeg % 3600) / 60);
    const s = totalSeg % 60;
    return `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  console.warn(`Aviso: TURNO no reconocido "${raw}", se deja tal cual.`);
  return raw;
}

const normalizarNombre = (n) => (n || '').trim().toUpperCase().replace(/\s+/g, ' ');

// ============================================================
const out = [];
out.push('-- Generado por supabase/scripts/generar_import.js — revisar antes de correr.');
out.push('begin;');
out.push('');

// ---------- EMPLEADOS + HORARIOS (proceso) ----------
const empleados = leerCsvObjetos('EMPLEADOS.csv');
const horarios = leerCsvObjetos('HORARIOS.csv');

const procesoPorNombre = new Map(); // último valor gana si hay nombres repetidos
const duplicados = new Map();
horarios.forEach((h) => {
  const clave = normalizarNombre(h.EMPLEADO);
  const anterior = procesoPorNombre.get(clave);
  // Solo se avisa si el PROCESO realmente cambia; si el nombre se repite
  // con el mismo PROCESO (y solo cambia el horario, que no se migra), no
  // hay ninguna ambigüedad que revisar.
  if (anterior !== undefined && anterior !== h.PROCESO) {
    if (!duplicados.has(clave)) duplicados.set(clave, [anterior]);
    duplicados.get(clave).push(h.PROCESO);
  }
  procesoPorNombre.set(clave, h.PROCESO);
});

if (duplicados.size) {
  out.push('-- AVISO: nombres repetidos en HORARIOS.csv con distinto PROCESO;');
  out.push('-- se usó el último valor de cada uno. Revisar si corresponde:');
  duplicados.forEach((valores, nombre) => {
    out.push(`--   ${nombre}: ${valores.join(' -> ')}`);
  });
  out.push('');
}

const codigosConocidos = new Set(empleados.map((e) => e.CODIGO));

out.push('-- ---------- empleados ----------');
empleados.forEach((e) => {
  const proceso = procesoPorNombre.get(normalizarNombre(e.NOMBRE)) || null;
  out.push(
    `insert into empleados (codigo, nombre, cargo, turno, correo, proceso) values ` +
    `(${sqlStr(e.CODIGO)}, ${sqlStr(e.NOMBRE)}, ${sqlStr(e.CARGO)}, ${sqlStr(e.TURNO)}::time, ${sqlStr(e.CORREO)}, ${sqlStr(proceso)}) ` +
    `on conflict (codigo) do nothing;`
  );
});

// ---------- REGISTRO: detectar códigos huérfanos (no están en EMPLEADOS.csv) ----------
const registro = leerCsvObjetos('REGISTRO.csv');
const huerfanos = new Map(); // codigo -> {nombre, cargo, turnos:Set}
registro.forEach((r) => {
  if (!codigosConocidos.has(r.CODIGO)) {
    if (!huerfanos.has(r.CODIGO)) huerfanos.set(r.CODIGO, { nombre: r.NOMBRE, cargo: r.CARGO, turnos: new Map() });
    const info = huerfanos.get(r.CODIGO);
    const t = normalizarTurno(r.TURNO);
    if (t && t !== 'VACACIONES') info.turnos.set(t, (info.turnos.get(t) || 0) + 1);
  }
});

if (huerfanos.size) {
  out.push('');
  out.push('-- AVISO: códigos con historial en REGISTRO.csv pero que ya no existen');
  out.push('-- en EMPLEADOS.csv (empleados dados de baja). Se reconstruyen aquí con');
  out.push('-- los datos de su propio historial para no perder esas filas —');
  out.push('-- revisar si conviene borrarlos después de la migración.');
  huerfanos.forEach((info, codigo) => {
    const turnoMasComun = [...info.turnos.entries()].sort((a, b) => b[1] - a[1])[0];
    const turno = turnoMasComun ? turnoMasComun[0] : '07:00:00';
    out.push(
      `insert into empleados (codigo, nombre, cargo, turno) values ` +
      `(${sqlStr(codigo)}, ${sqlStr(info.nombre)}, ${sqlStr(info.cargo)}, ${sqlStr(turno)}::time) ` +
      `on conflict (codigo) do nothing;`
    );
  });
  out.push('');
}

// ---------- registro ----------
// "do update" (no "do nothing"): este script también se usa para la
// sincronización final antes del corte a producción (Fase 6), donde una
// fila ya migrada puede haber cambiado en la Sheet real desde entonces
// (ej. se agregó la salida de un ingreso que ya estaba). empleados/
// externos sí se quedan en "do nothing" para no pisar ediciones hechas
// directamente en Supabase durante las pruebas (Fase 4/5).
out.push('-- ---------- registro ----------');
registro.forEach((r) => {
  out.push(
    `insert into registro (codigo, turno, fecha, hora_ingreso, imagen1_url, hora_salida, imagen2_url, observacion, estado_ingreso, estado_salida) values ` +
    `(${sqlStr(r.CODIGO)}, ${sqlStr(normalizarTurno(r.TURNO))}, ${sqlStr(r.FECHA)}::date, ` +
    `${sqlStr(r['HORA INGRESO'])}::time, ${sqlStr(r.IMAGEN1)}, ${sqlStr(r['HORA SALIDA'])}::time, ` +
    `${sqlStr(r.IMAGEN2)}, ${sqlStr(r.OBSERVACION)}, ${sqlStr(r['ESTADO INGRESO'])}, ${sqlStr(r['ESTADO SALIDA'])}) ` +
    `on conflict (codigo, fecha) do update set ` +
    `turno = excluded.turno, hora_ingreso = excluded.hora_ingreso, imagen1_url = excluded.imagen1_url, ` +
    `hora_salida = excluded.hora_salida, imagen2_url = excluded.imagen2_url, observacion = excluded.observacion, ` +
    `estado_ingreso = excluded.estado_ingreso, estado_salida = excluded.estado_salida;`
  );
});

// ---------- externos / registro_externos (vacíos hoy; se migran igual si algún día tienen filas) ----------
const externos = leerCsvObjetos('EXTERNOS.csv');
if (externos.length) {
  out.push('');
  out.push('-- ---------- externos ----------');
  externos.forEach((e) => {
    out.push(
      `insert into externos (cedula, nombre, departamento_proveedor) values ` +
      `(${sqlStr(e.CEDULA)}, ${sqlStr(e.NOMBRE)}, ${sqlStr(e.DEPARTAMENTO_PROVEEDOR)}) ` +
      `on conflict (cedula) do nothing;`
    );
  });
}

const registroExternos = leerCsvObjetos('REGISTRO_EXTERNOS.csv');
if (registroExternos.length) {
  out.push('');
  out.push('-- ---------- registro_externos ----------');
  registroExternos.forEach((r) => {
    out.push(
      `insert into registro_externos (cedula, fecha, motivo, hora_ingreso, imagen1_url, hora_salida, observacion) values ` +
      `(${sqlStr(r.CEDULA)}, ${sqlStr(r.FECHA)}::date, ${sqlStr(r.MOTIVO)}, ${sqlStr(r['HORA INGRESO'])}::time, ` +
      `${sqlStr(r.IMAGEN1)}, ${sqlStr(r['HORA SALIDA'])}::time, ${sqlStr(r.OBSERVACION)}) ` +
      `on conflict (cedula, fecha) do update set ` +
      `motivo = excluded.motivo, hora_ingreso = excluded.hora_ingreso, imagen1_url = excluded.imagen1_url, ` +
      `hora_salida = excluded.hora_salida, observacion = excluded.observacion;`
    );
  });
}

// ---------- config ----------
const config = leerCsvObjetos('CONFIG.csv');
const cfg = {};
config.forEach((c) => { cfg[c.CLAVE] = c.VALOR; });
out.push('');
out.push('-- ---------- config ----------');
out.push('-- (se omiten ADMIN_PASSWORD_HASH y SECRET_KEY: no se usan en Supabase)');
const turnosArray = (cfg.TURNOS || '').split(',').map((t) => t.trim()).filter(Boolean);
const turnosLiteral = `array[${turnosArray.map(sqlStr).join(',')}]`;
out.push(
  `update config set lat = ${sqlNum(cfg.LAT)}, lng = ${sqlNum(cfg.LNG)}, ` +
  `radio_metros = ${sqlNum(cfg.RADIO_METROS)}, turnos = ${turnosLiteral}, updated_at = now() ` +
  `where id = true;`
);

out.push('');
out.push('commit;');

fs.writeFileSync(OUT_FILE, out.join('\n') + '\n', 'utf8');

// ---------- USUARIOS (administradores) ----------
// No se puede insertar directo: primero hay que crear cada cuenta en
// Supabase Auth (Authentication -> Users -> Add user) con su correo y
// una contraseña nueva. Recién después de eso se puede enlazar el
// perfil (nombre/rol) buscando el id por correo.
const usuarios = leerCsvObjetos('USUARIOS.csv');
const outAdmin = [];
outAdmin.push('-- Correr DESPUÉS de crear cada cuenta en Supabase Auth');
outAdmin.push('-- (Authentication -> Users -> Add user), con estos correos:');
usuarios.forEach((u) => {
  const correo = CORREO_POR_USERNAME[u.USERNAME];
  outAdmin.push(`--   ${u.USERNAME} (${u.NOMBRE}) -> ${correo || 'FALTA DEFINIR CORREO'}`);
});
outAdmin.push('');
usuarios.forEach((u) => {
  const correo = CORREO_POR_USERNAME[u.USERNAME];
  if (!correo) {
    outAdmin.push(`-- FALTA correo para ${u.USERNAME} (${u.NOMBRE}), no se genera su insert.`);
    return;
  }
  outAdmin.push(
    `insert into perfiles_admin (user_id, nombre, rol) ` +
    `select id, ${sqlStr(u.NOMBRE)}, ${sqlStr(u.ROL)} from auth.users where email = ${sqlStr(correo)} ` +
    `on conflict (user_id) do update set nombre = excluded.nombre, rol = excluded.rol;`
  );
});
fs.writeFileSync(OUT_ADMIN_FILE, outAdmin.join('\n') + '\n', 'utf8');

// ---------- resumen en consola ----------
console.log(`Generado: ${OUT_FILE}`);
console.log(`Empleados: ${empleados.length} (+${huerfanos.size} reconstruidos desde historial)`);
console.log(`Registro: ${registro.length} filas`);
console.log(`Externos: ${externos.length} filas`);
console.log(`Registro externos: ${registroExternos.length} filas`);
if (duplicados.size) console.log(`Aviso: ${duplicados.size} nombre(s) duplicado(s) en HORARIOS.csv (ver comentarios en import.sql)`);
console.log(`Generado: ${OUT_ADMIN_FILE} (${usuarios.length} administradores; correr después de crearlos en Supabase Auth)`);
