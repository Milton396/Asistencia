-- La política RLS "lectura publica empleados" (using (true)) permite a
-- cualquiera con la anon key leer la fila completa de "empleados" por
-- REST directo (/rest/v1/empleados?select=*), sin pasar por la Edge
-- Function. RLS controla filas, no columnas, así que aunque la acción
-- pública "empleados" del backend ya no devuelve "correo" (ver
-- listarEmpleados en index.ts), seguía expuesto por esa vía directa.
-- Se revoca el acceso a nivel de columna para anon/authenticated:
-- el panel de Administración sigue viendo "correo" porque la Edge
-- Function lee con la service role key, que no pasa por estos GRANTs.
revoke select (correo, proceso, created_at) on empleados from anon, authenticated;
