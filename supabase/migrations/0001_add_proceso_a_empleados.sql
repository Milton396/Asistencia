-- Agrega la columna "proceso" a empleados (dato que en la Sheet vive en
-- la hoja HORARIOS, columna PROCESO, identificando al empleado por
-- NOMBRE en vez de CODIGO). schema.sql ya la incluye para instalaciones
-- nuevas; este archivo es para aplicar el cambio a un proyecto de
-- Supabase que ya corrió schema.sql antes de este ajuste.
alter table empleados add column if not exists proceso text;
