-- Permite que un usuario autenticado lea su propia fila de perfiles_admin
-- (nombre, rol) — hoy la tabla tiene RLS activado pero sin políticas, así
-- que nadie (ni el propio dueño) puede leerla desde el cliente.
create policy "cada quien lee su propio perfil" on perfiles_admin
  for select using (auth.uid() = user_id);
