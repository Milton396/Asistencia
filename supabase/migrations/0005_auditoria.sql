-- Registro de auditoría de acciones administrativas (crear/editar/eliminar
-- empleados, cambios de turnos/ubicación, CRUD de usuarios admin). Solo se
-- escribe desde la Edge Function (service role), nunca desde el cliente.
create table auditoria (
  id          bigint generated always as identity primary key,
  fecha       timestamptz not null default now(),
  admin_email text not null,
  admin_nombre text not null,
  accion      text not null,
  detalle     jsonb
);
create index auditoria_fecha_idx on auditoria (fecha desc);

alter table auditoria enable row level security;
-- Sin políticas para "anon"/"authenticated": solo la Edge Function
-- (service role) la usa, igual que kiosco_limite.
