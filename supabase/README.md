# Migración a Supabase — notas de trabajo

Esta carpeta y la rama `migracion-supabase` son el ambiente de pruebas para
migrar el backend de Google Sheets/Apps Script a Supabase, sin afectar la
app en producción (rama `main`).

## Ambiente de pruebas

- **Rama**: `migracion-supabase` (aislada de `main`).
- **Sheet copiada** (solo para migrar datos, no se escribe en producción):
  `1vuN-ZTqOfnGmgGHnlQt_dxn3774q12hy-ATtbgSrKQM`
- **Proyecto de Supabase**: creado — `Asistencia`, proyecto
  `uquodnqaxqfnyialqlkp`. `schema.sql` ya está corrido (las 6 tablas
  existen en Table Editor). Las API keys y la contraseña de la base
  quedaron en `supabase/.env` (ignorado por git, no se sube).

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
4. **`empleados.proceso`**: columna agregada (ver
   `migrations/0001_add_proceso_a_empleados.sql`) para los datos de la
   hoja **HORARIOS** de la Sheet (columnas EMPLEADO/PROCESO/HORARIOS),
   que no era parte del modelo original de la app. Esa hoja identifica al
   empleado por **nombre**, no por código, así que al migrar los datos se
   empareja por nombre para completar `proceso`. La columna `HORARIOS` de
   esa hoja (el turno) no se migra aparte porque ya existe como
   `empleados.turno`, alimentado por la hoja EMPLEADOS real de la app.
5. **Fotos**: bucket de Supabase Storage `fotos`, creado **público**
   (cualquiera con el link puede verla) — mismo nivel de privacidad que
   hoy con Google Drive (`ANYONE_WITH_LINK`). Avisar si en algún momento
   se prefiere que las fotos queden privadas (requeriría URLs firmadas
   en vez de públicas, y tocar cómo el frontend/informe las muestra).

Si alguna de estas decisiones no es la que se quiere, avisar antes de
avanzar a la Fase 3 (Edge Functions), porque cambia bastante el trabajo.

## Estado de las fases

- [x] Fase 0 — Ambiente de pruebas (rama + Sheet copiada)
- [x] Fase 1 — Esquema de tablas (`schema.sql`, proyecto Supabase creado y corrido)
- [x] Fase 2 — Migrar datos de la Sheet copiada a las tablas
      (39 empleados, 1081 registros, config, y los 4 administradores
      vinculados en `perfiles_admin` vía Supabase Auth: `montty`,
      `rimbaquingo`, `mguanulema`, `wherrera`)
- [x] Fase 3 — Edge Functions (backend). Todas las acciones de
      `Code.gs` portadas a la función `api` (una sola, enruta por
      `action`) y probadas de punta a punta contra el proyecto real:
      - **Públicas**: `empleados`, `config`, `empleadosHoy`,
        `externosHoy`, `externoBuscar`.
      - **Kiosco**: `registrarIngreso`/`registrarSalida` (GPS, foto,
        horas extra, límite de intentos), `externoRegistrarIngreso`/
        `externoRegistrarSalida` (cédula ecuatoriana, autoregistro).
      - **Admin** (`requireAdmin()`, equivalente al de Code.gs pero con
        access_token real de Supabase Auth): `perfil`, `informe` (por
        rango de fechas), `empleadoGuardar`/`empleadoEliminar`,
        `turnosGuardar`, `configGuardar`, `usuarios`/`usuarioGuardar`/
        `usuarioEliminar` (ahora gestionan cuentas de Supabase Auth,
        no filas de una hoja).
      - Login y cambio de contraseña ya no son acciones propias: los
        hace `supabase-js` directo contra Supabase Auth (Fase 4).
      - Nueva infraestructura: tabla `kiosco_limite` +
        `incrementar_limite_kiosco()` (reemplaza CacheService), bucket
        de Storage `fotos` público (reemplaza Drive).
      - Diferencia deliberada de comportamiento: `empleadoEliminar`
        ahora **rechaza** borrar un empleado con historial de
        asistencia (FK), en vez de dejarlo huérfano en silencio como
        hacía la Sheet — encontramos un caso real así al migrar
        (código 11750).
- [x] Fase 4 — Frontend conectado a Supabase (`js/config.js`, `js/api.js`,
      `js/auth.js`, `index.html` con supabase-js). Login ahora es por
      correo (antes username corto); `Auth.token()`/`estaLogueado()`
      siguen siendo síncronos (variable en memoria) para no tocar los
      call sites existentes en `admin.js`/`app.js`.
- [x] Fase 5 — Pruebas end-to-end, confirmadas en el navegador real:
      kiosco público (buscar empleado, ubicación GPS real, pestaña
      Registro), login/logout, informe, CRUD de empleados (incluida la
      eliminación bloqueada por historial), Mi cuenta (cambio de
      contraseña), flujo completo de Externos por la UI, CRUD de
      administradores (Supabase Auth), turnos/ubicación, exportar a
      Excel, e ingreso/salida real con foto.
- [~] Fase 6 — Corte a producción
      - [x] Sincronizar delta: re-exportado EMPLEADOS/REGISTRO/EXTERNOS/
            REGISTRO_EXTERNOS de la Sheet real (no la copia) y re-corrido
            `generar_import.js` (ahora con `on conflict ... do update`
            para registro/registro_externos, ver el script). Verificado:
            1111 registros, 43 días, hasta 2026-09-26. Se confirmó que
            no quedó ningún dato de prueba de las Fases 4/5 mezclado con
            asistencia real (el kiosco real de los empleados corre en un
            servidor/dispositivo separado del WAMP local usado para
            probar, así que nunca hubo riesgo de contaminación cruzada).
      - [ ] Fusionar `migracion-supabase` a `main` (o copiar los
            archivos del frontend actualizados)
      - [ ] Prueba rápida en producción tras el corte
      - [ ] Avisar a los 4 administradores: ahora inician sesión con
            correo, no con el username corto de antes

## CLI de Supabase

Instalada como devDependency dentro de esta carpeta (no global — Supabase
ya no lo soporta). Se usa así:

```
cd supabase
npx supabase <comando> --workdir ..
```

**`supabase link` no funciona en este proyecto** (da `LinkAuthTokenError`
sin importar los permisos del token, incluso siendo Owner de la
organización — parece un problema de la plataforma con tokens de permisos
granulares). No hace falta: todos los comandos que lo necesitarían aceptan
`--project-ref uquodnqaxqfnyialqlkp` directo. Para desplegar funciones,
usar también `--use-api` (empaqueta sin necesitar Docker corriendo):

```
npx supabase functions deploy <nombre> --project-ref uquodnqaxqfnyialqlkp --use-api --workdir ..
```

Requiere `SUPABASE_ACCESS_TOKEN` en el entorno (está en `supabase/.env`,
token de acceso personal con permisos: Project Settings-Read, API
Keys-Read, Edge Functions-Read/Write, alcance limitado al proyecto
Asistencia).

## Pendiente para la Fase 4 (no olvidar)

Toda llamada a una Edge Function necesita el header
`Authorization: Bearer <anon key>` — a diferencia de Apps Script, que no
pedía nada. `js/api.js` va a necesitar agregarlo en `get()` y `post()`.
Para las acciones de administración, en vez de ese header fijo, se manda
el `access_token` de la sesión de Supabase Auth del usuario logueado (la
función valida con `supabase.auth.getUser(token)` y revisa que tenga fila
en `perfiles_admin`, igual que `requireAdmin()` en `Code.gs` pero con
tokens reales de Supabase en vez de uno propio).

## Próximo paso

Fase 6: corte a producción — sincronizar los registros nuevos hechos en
la app real (Apps Script/Sheet) desde que se copió la Sheet para la
migración, cambiar la configuración de producción (rama `main`) para
apuntar a Supabase, y mantener Apps Script/Sheet como respaldo por un
tiempo antes de dar de baja.
