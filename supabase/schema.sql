-- ============================================================
-- Esquema de base de datos para la migración de "Registro de
-- Asistencia" de Google Sheets/Apps Script a Supabase (Postgres).
--
-- Fuente: apps-script/Code.gs (columnas de EMPLEADOS, REGISTRO,
-- EXTERNOS, REGISTRO_EXTERNOS, CONFIG) y la Sheet copiada para
-- pruebas: 1vuN-ZTqOfnGmgGHnlQt_dxn3774q12hy-ATtbgSrKQM
--
-- Cómo usarlo: pega este archivo completo en Supabase → SQL Editor
-- → Run, en el proyecto de PRUEBA (no en producción).
-- ============================================================

-- ---------- EMPLEADOS (antes: hoja EMPLEADOS + hoja HORARIOS) ----------
-- "proceso" viene de la hoja HORARIOS (columna PROCESO), que identifica
-- al empleado por NOMBRE en vez de CODIGO; se empareja por nombre al
-- migrar los datos (ver supabase/data/, no versionado en git).
create table empleados (
  codigo      text primary key,
  nombre      text not null,
  cargo       text,
  turno       time not null,
  correo      text,
  proceso     text,
  created_at  timestamptz not null default now()
);

-- ---------- REGISTRO (antes: hoja REGISTRO) ----------
-- Un registro por empleado y día (ingreso + salida en la misma fila,
-- igual que en la Sheet actual).
create table registro (
  id              bigint generated always as identity primary key,
  codigo          text not null references empleados(codigo),
  fecha           date not null,
  hora_ingreso    time,
  imagen1_url     text,
  hora_salida     time,
  imagen2_url     text,
  observacion     text,
  estado_ingreso  text,   -- 'A TIEMPO' | 'ATRASADO'
  estado_salida   text,   -- 'FIN DE JORNADA'
  created_at      timestamptz not null default now(),
  unique (codigo, fecha)
);
create index registro_fecha_idx on registro (fecha);

-- ---------- EXTERNOS (antes: hoja EXTERNOS, maestro por cédula) ----------
create table externos (
  cedula                  text primary key,
  nombre                  text not null,
  departamento_proveedor  text not null,
  created_at              timestamptz not null default now()
);

-- ---------- REGISTRO_EXTERNOS (antes: hoja REGISTRO_EXTERNOS) ----------
create table registro_externos (
  id            bigint generated always as identity primary key,
  cedula        text not null references externos(cedula),
  fecha         date not null,
  motivo        text not null check (motivo in (
                  'RETIRO PEDIDO/DEVOLUCION', 'ENTREGA OC',
                  'TRANSPORTE MATERIAL', 'VISITA'
                )),
  hora_ingreso  time,
  imagen1_url   text,
  hora_salida   time,
  observacion   text,
  created_at    timestamptz not null default now(),
  unique (cedula, fecha)
);
create index registro_externos_fecha_idx on registro_externos (fecha);

-- ---------- CONFIG (antes: hoja CONFIG, clave/valor) ----------
-- Se modela como una sola fila con columnas con nombre (más natural en
-- Postgres que clave/valor). El check garantiza que solo exista 1 fila.
create table config (
  id                    boolean primary key default true check (id),
  lat                   double precision,
  lng                   double precision,
  radio_metros          numeric not null default 5,
  margen_precision_max  numeric not null default 50,
  turnos                text[] not null default array['07:00','08:00','09:00'],
  updated_at            timestamptz not null default now()
);
insert into config (id) values (true);

-- ---------- USUARIOS (administradores) ----------
-- Recomendado: usar Supabase Auth (auth.users) en vez de la tabla
-- USUARIOS con hash+sal propio. Esta tabla solo guarda el perfil
-- (nombre, rol) enlazado a la cuenta de Supabase Auth.
-- Nota: esto implica que cada administrador necesita un correo y se le
-- debe resetear/asignar contraseña una vez migrado (no se puede portar
-- el hash actual directo a Supabase Auth).
create table perfiles_admin (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  nombre      text not null,
  rol         text not null default 'administrador'
);

-- ============================================================
-- Row Level Security (RLS)
-- Política general: TODAS las tablas quedan con RLS activado y SIN
-- políticas de escritura para el rol "anon" (kiosco público). Las
-- escrituras (registrar ingreso/salida, crear externo, CRUD admin)
-- se hacen a través de Edge Functions usando la service role key, que
-- se salta RLS — igual que hoy todo pasa por Code.gs y nadie escribe
-- directo a la Sheet. Esto evita reimplementar en RLS/triggers toda la
-- lógica de negocio (límite de intentos, validar ubicación, cédula,
-- duplicados, etc.) que ya existe y funciona en el backend.
-- ============================================================

alter table empleados enable row level security;
alter table registro enable row level security;
alter table externos enable row level security;
alter table registro_externos enable row level security;
alter table config enable row level security;
alter table perfiles_admin enable row level security;

-- Lecturas públicas necesarias para el kiosco (equivalentes a las
-- acciones GET públicas que ya existen hoy: 'empleados', 'config').
create policy "lectura publica empleados" on empleados
  for select using (true);

create policy "lectura publica config" on config
  for select using (true);

-- El resto de lecturas/escrituras (registro, externos, registro_externos,
-- informes, CRUD admin) se sirven exclusivamente desde Edge Functions
-- con la service role key — sin políticas adicionales para "anon".
