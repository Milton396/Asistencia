-- El login de administradores pasa de pedir el correo de la cuenta de
-- Supabase Auth a pedir un usuario corto. perfiles_admin.nombre (que ya
-- guardaba un nombre para mostrar, nunca usado en la UI) se renombra a
-- "usuario" y pasa a ser el identificador real de login — la Edge
-- Function resuelve usuario -> correo antes de signInWithPassword (ver
-- acción "loginEmail" en index.ts). El correo de Supabase Auth se
-- mantiene intacto y ahora se usa solo para recuperar la contraseña.
alter table perfiles_admin rename column nombre to usuario;

update perfiles_admin set usuario = 'mcajas' where usuario = 'montty';
update perfiles_admin set usuario = 'rimbaquingo' where usuario = 'Rosario Imbaquingo';
update perfiles_admin set usuario = 'mguanulema' where usuario = 'Miguel Guanulema';
update perfiles_admin set usuario = 'wherrera' where usuario = 'William Herrera';

alter table perfiles_admin add constraint perfiles_admin_usuario_key unique (usuario);
