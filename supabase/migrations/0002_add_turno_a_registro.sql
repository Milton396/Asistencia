-- Agrega la columna "turno" a registro: foto del turno del empleado al
-- momento del ingreso (Code.gs la copia así en cada fila). Se guarda como
-- texto porque en la data real también aparece el valor "VACACIONES" en
-- vez de una hora. schema.sql ya la incluye para instalaciones nuevas;
-- este archivo aplica el cambio a un proyecto que ya había corrido
-- schema.sql antes de este ajuste.
alter table registro add column if not exists turno text;
