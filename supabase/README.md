# Migración a Supabase — notas de trabajo

Esta carpeta y la rama `migracion-supabase` son el ambiente de pruebas para
migrar el backend de Google Sheets/Apps Script a Supabase, sin afectar la
app en producción (rama `main`).

## Ambiente de pruebas

- **Rama**: `migracion-supabase` (aislada de `main`).
- **Sheet copiada** (solo para migrar datos, no se escribe en producción):
  `1vuN-ZTqOfnGmgGHnlQt_dxn3774q12hy-ATtbgSrKQM`
- **Proyecto de Supabase**: pendiente de crear (gratis, en supabase.com) —
  una vez creado, se necesita la URL del proyecto y las API keys (anon y
  service role) para continuar.

## Decisiones de diseño tomadas en el esquema (`schema.sql`)

1. **Autenticación de administradores**: se recomienda pasar de la tabla
   `USUARIOS` (hash+sal propio) a **Supabase Auth** (correo + contraseña),
   con una tabla `perfiles_admin` para nombre/rol enlazada a `auth.users`.
   Implica que cada administrador necesita un correo y se le debe asignar
   contraseña nueva una vez migrado (no se puede portar el hash actual).
2. **Camino de escritura**: todas las escrituras (registrar ingreso/salida,
   autoregistro de externos, CRUD de administración) se sirven desde
   **Edge Functions** con la service role key, no desde el cliente con RLS
   abierto. Así se reutiliza tal cual la lógica de negocio que ya existe en
   `Code.gs` (límite de intentos del kiosco, validación de ubicación GPS,
   validación de cédula, duplicados por día, etc.) en vez de tener que
   reimplementarla como políticas RLS/triggers.
3. Las únicas lecturas públicas (rol `anon`, sin login) son `empleados` y
   `config` — equivalentes a las acciones GET públicas que ya existen hoy.

Si alguna de estas decisiones no es la que se quiere, avisar antes de
avanzar a la Fase 3 (Edge Functions), porque cambia bastante el trabajo.

## Estado de las fases

- [x] Fase 0 — Ambiente de pruebas (rama + Sheet copiada)
- [x] Fase 1 — Esquema de tablas (`schema.sql`)
- [ ] Fase 2 — Migrar datos de la Sheet copiada a las tablas
- [ ] Fase 3 — Edge Functions (backend)
- [ ] Fase 4 — Frontend (`js/api.js` con `supabase-js`)
- [ ] Fase 5 — Pruebas end-to-end
- [ ] Fase 6 — Corte a producción

## Próximo paso

Crear el proyecto de Supabase y correr `schema.sql` en el SQL Editor.
