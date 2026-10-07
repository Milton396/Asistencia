// Funciones puras (sin I/O, sin dependencias de Deno/Supabase) usadas por
// index.ts. Separadas en este módulo para poder probarlas con Node
// (logica.test.ts) sin necesitar el runtime de Deno ni una base de datos:
// index.ts no se puede importar directo porque además de estas funciones
// trae imports de Deno ('npm:...') y arranca un servidor al cargarse.

// ==================== FECHAS ====================

export function sumarDias(fechaStr: string, dias: number): string {
  const [y, m, d] = fechaStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + dias);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

export function esFinDeSemana(fecha: string): boolean {
  const [y, m, d] = fecha.split('-').map(Number);
  const dia = new Date(y, m - 1, d).getDay();
  return dia === 0 || dia === 6;
}

// ==================== UBICACIÓN (GPS) ====================

export function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (v: number) => (v * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// ==================== HORAS EXTRA ====================
// Entre semana, la hora extra empieza 9h01s después del inicio del turno
// (jornada de 8h + 1h de almuerzo); fines de semana, toda la jornada
// trabajada cuenta como hora extra. El exceso se redondea al medio hora
// más cercano.

export function horaASegundos(horaStr: string | null | undefined): number | null {
  if (!horaStr) return null;
  const partes = String(horaStr).split(':').map(Number);
  return (partes[0] || 0) * 3600 + (partes[1] || 0) * 60 + (partes[2] || 0);
}

export function redondearAMediaHora(totalSegundos: number): number {
  if (totalSegundos <= 0) return 0;
  let horas = Math.floor(totalSegundos / 3600);
  const restoSegundos = totalSegundos % 3600;
  let minutosExtra: number;
  if (restoSegundos < 30 * 60) minutosExtra = 0;
  else if (restoSegundos < 45 * 60) minutosExtra = 30;
  else { horas += 1; minutosExtra = 0; }
  return horas * 60 + minutosExtra;
}

export function formatoHorasMinutos(totalMinutos: number): string {
  const horas = Math.floor(totalMinutos / 60);
  const minutos = totalMinutos % 60;
  return `${horas}:${minutos < 10 ? '0' : ''}${minutos}`;
}

export function calcularEstadoIngreso(horaStr: string, turnoStr: string): string {
  const horaTurno = turnoStr.length === 5 ? turnoStr + ':00' : turnoStr;
  return horaStr <= horaTurno ? 'A TIEMPO' : 'ATRASADO';
}

export function calcularHorasExtras(
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

export function combinarObservacion(actual: string | null | undefined, nueva: unknown): string {
  const a = (actual || '').toString();
  const n = (nueva || '').toString().trim().slice(0, 200);
  if (!n) return a;
  return a ? `${a} / ${n}` : n;
}

// ==================== FOTOS (Supabase Storage) ====================
// `registro.imagen1_url`/`imagen2_url` acumulan 3 formatos distintos según
// cuándo se guardó la fila:
//  1. Nombre de archivo solo (formato actual, bucket privado).
//  2. URL pública completa de Supabase Storage (bucket era público antes
//     del 2026-10-07) — igual se puede extraer el nombre y firmarla.
//  3. URL de Google Drive, migrada desde la Sheet antes del corte a
//     producción (2026-09-26) — no vive en este bucket, no se puede firmar.
// Devuelve el nombre de archivo a firmar, o null si es una URL ajena (caso 3).
export function rutaStorageDesdeValor(valor: string, bucket: string): string | null {
  if (!valor) return null;
  const marcador = `/storage/v1/object/public/${bucket}/`;
  const idx = valor.indexOf(marcador);
  if (idx !== -1) return decodeURIComponent(valor.slice(idx + marcador.length));
  if (!/^https?:\/\//i.test(valor)) return valor;
  return null;
}

// ==================== EXTERNOS (cédula ecuatoriana) ====================

export function validarCedulaEcuatoriana(cedula: string): boolean {
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
