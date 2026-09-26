-- Reemplaza CacheService (Apps Script) para el límite de intentos del
-- kiosco público: una fila por ventana de tiempo (minuto), con el conteo
-- de solicitudes. incrementar_limite_kiosco() hace el incremento y la
-- lectura en una sola sentencia atómica (evita condiciones de carrera
-- entre solicitudes simultáneas).
create table kiosco_limite (
  ventana  bigint primary key,
  intentos int not null default 0
);

alter table kiosco_limite enable row level security;
-- Sin políticas para "anon"/"authenticated": solo la Edge Function
-- (service role) la usa.

create or replace function incrementar_limite_kiosco(p_ventana bigint)
returns int
language sql
as $$
  insert into kiosco_limite (ventana, intentos)
  values (p_ventana, 1)
  on conflict (ventana) do update set intentos = kiosco_limite.intentos + 1
  returning intentos;
$$;
