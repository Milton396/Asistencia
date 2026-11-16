-- La política RLS "lectura publica empleados" (using (true)) permite a
-- cualquiera con la anon key leer la fila completa de "empleados" por
-- REST directo (/rest/v1/empleados?select=*), sin pasar por la Edge
-- Function. RLS controla filas, no columnas, así que aunque la acción
-- pública "empleados" del backend ya no devuelve "correo" (ver
-- listarEmpleados en index.ts), seguía expuesto por esa vía directa.
--
-- "revoke select (columnas) on tabla" no funcionó (el permiso original
-- es a nivel de tabla completa y Postgres no lo recorta por columna en
-- este caso): se revoca todo el SELECT y se vuelve a otorgar solo para
-- las columnas públicas. El panel de Administración sigue viendo
-- "correo" porque la Edge Function lee con la service role key, que no
-- pasa por estos GRANTs.
revoke select on empleados from anon, authenticated;
grant select (codigo, nombre, cargo, turno) on empleados to anon, authenticated;
notify pgrst, 'reload schema';
