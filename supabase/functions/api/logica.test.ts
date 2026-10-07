// Pruebas de la lógica pura del backend (sin red, sin base de datos).
// Se corren con el test runner nativo de Node (no requiere Deno):
//   cd supabase && npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sumarDias, esFinDeSemana, haversine, horaASegundos, redondearAMediaHora,
  formatoHorasMinutos, calcularEstadoIngreso, calcularHorasExtras,
  combinarObservacion, validarCedulaEcuatoriana,
} from './logica.ts';

test('sumarDias avanza un día normal', () => {
  assert.equal(sumarDias('2026-03-10', 1), '2026-03-11');
});

test('sumarDias cruza fin de mes y de año', () => {
  assert.equal(sumarDias('2026-01-31', 1), '2026-02-01');
  assert.equal(sumarDias('2025-12-31', 1), '2026-01-01');
});

test('esFinDeSemana reconoce sábado y domingo', () => {
  assert.equal(esFinDeSemana('2026-10-10'), true); // sábado
  assert.equal(esFinDeSemana('2026-10-11'), true); // domingo
  assert.equal(esFinDeSemana('2026-10-07'), false); // miércoles
});

test('haversine da ~0 m para el mismo punto', () => {
  assert.ok(haversine(-0.1807, -78.4678, -0.1807, -78.4678) < 0.01);
});

test('haversine da una distancia razonable entre dos puntos conocidos', () => {
  // Quito centro -> Cumbayá, ~8-10 km en línea recta.
  const d = haversine(-0.1807, -78.4678, -0.2000, -78.4333);
  assert.ok(d > 3000 && d < 12000, `distancia inesperada: ${d} m`);
});

test('horaASegundos convierte HH:mm:ss y HH:mm', () => {
  assert.equal(horaASegundos('08:30:00'), 8 * 3600 + 30 * 60);
  assert.equal(horaASegundos('08:30'), 8 * 3600 + 30 * 60);
  assert.equal(horaASegundos(null), null);
  assert.equal(horaASegundos(undefined), null);
});

test('redondearAMediaHora: menos de 30 min no suma horas extras', () => {
  assert.equal(redondearAMediaHora(20 * 60), 0);
});

test('redondearAMediaHora: entre 30 y 44 min redondea a 30', () => {
  assert.equal(redondearAMediaHora(3600 + 35 * 60), 90); // 1h35 -> 1h30
});

test('redondearAMediaHora: 45 min o más redondea a la hora siguiente', () => {
  assert.equal(redondearAMediaHora(3600 + 50 * 60), 120); // 1h50 -> 2h
});

test('redondearAMediaHora: totales negativos o cero dan 0', () => {
  assert.equal(redondearAMediaHora(0), 0);
  assert.equal(redondearAMediaHora(-100), 0);
});

test('formatoHorasMinutos da formato H:mm', () => {
  assert.equal(formatoHorasMinutos(90), '1:30');
  assert.equal(formatoHorasMinutos(0), '0:00');
  assert.equal(formatoHorasMinutos(125), '2:05');
});

test('calcularEstadoIngreso: a tiempo si llega antes o igual al turno', () => {
  assert.equal(calcularEstadoIngreso('08:00:00', '08:00'), 'A TIEMPO');
  assert.equal(calcularEstadoIngreso('07:59:00', '08:00'), 'A TIEMPO');
});

test('calcularEstadoIngreso: atrasado si llega después del turno', () => {
  assert.equal(calcularEstadoIngreso('08:00:01', '08:00'), 'ATRASADO');
});

test('calcularHorasExtras: sin hora de salida no hay horas extra', () => {
  assert.equal(calcularHorasExtras('2026-10-07', '08:00', '08:00:00', null), null);
});

test('calcularHorasExtras: entre semana, antes de 9h01 del turno no genera extra', () => {
  // Turno 08:00, salida 17:00 (9h en punto) -> todavía no pasa el umbral de 9h01.
  const horas = calcularHorasExtras('2026-10-07', '08:00', '08:00:00', '17:00:00');
  assert.equal(horas, '0:00');
});

test('calcularHorasExtras: entre semana, pasado el umbral redondea correctamente', () => {
  // Turno 08:00 -> umbral 17:00:01. Salida 18:35:00 => 1h34m59s -> redondea a 1h30.
  const horas = calcularHorasExtras('2026-10-07', '08:00', '08:00:00', '18:35:00');
  assert.equal(horas, '1:30');
});

test('calcularHorasExtras: fin de semana cuenta toda la jornada trabajada', () => {
  // Sábado: ingreso 08:00, salida 12:00 -> 4h completas son extra.
  const horas = calcularHorasExtras('2026-10-10', '08:00', '08:00:00', '12:00:00');
  assert.equal(horas, '4:00');
});

test('calcularHorasExtras usa el turno recibido, no uno fijo: regresión del bug de turno histórico', () => {
  // Mismo ingreso/salida, dos turnos distintos -> el umbral cambia con el
  // turno que tenía el empleado ESE día, no uno hardcodeado.
  const conTurno07 = calcularHorasExtras('2026-10-07', '07:00', '07:00:00', '18:00:00');
  const conTurno09 = calcularHorasExtras('2026-10-07', '09:00', '09:00:00', '18:00:00');
  assert.notEqual(conTurno07, conTurno09);
  assert.equal(conTurno07, '2:00'); // umbral 16:00:01, salida 18:00 -> 1h59m59s -> redondea a 2h
  assert.equal(conTurno09, '0:00'); // umbral 18:00:01, salida 18:00 -> aún no llega
});

test('combinarObservacion concatena solo si hay observación nueva', () => {
  assert.equal(combinarObservacion(null, ''), '');
  assert.equal(combinarObservacion(null, 'llegó tarde por tráfico'), 'llegó tarde por tráfico');
  assert.equal(combinarObservacion('ingreso ok', 'salida con permiso'), 'ingreso ok / salida con permiso');
});

test('combinarObservacion recorta a 200 caracteres', () => {
  const larga = 'x'.repeat(300);
  assert.equal(combinarObservacion(null, larga).length, 200);
});

test('validarCedulaEcuatoriana acepta cédulas válidas conocidas', () => {
  assert.equal(validarCedulaEcuatoriana('1710034065'), true);
});

test('validarCedulaEcuatoriana rechaza formato, provincia o dígito verificador inválidos', () => {
  assert.equal(validarCedulaEcuatoriana('123'), false); // longitud
  assert.equal(validarCedulaEcuatoriana('9910034065'), false); // provincia > 24
  assert.equal(validarCedulaEcuatoriana('1760034065'), false); // tercer dígito > 5
  assert.equal(validarCedulaEcuatoriana('1710034066'), false); // dígito verificador incorrecto
});
