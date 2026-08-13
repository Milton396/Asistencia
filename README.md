# Registro de Asistencia

Aplicación web (HTML/CSS/JS) para registrar entrada y salida de empleados con
foto, usando tu Google Sheet
(`17_nIu0LmHeu_S0uJgkPo1gHhqQT0xP3VqGPCiEVY6M0`) como base de datos a través
de un backend en Google Apps Script.

La pantalla de registro de entrada/salida es **pública** (sin login) — el
personal marca su asistencia libremente. Solo el botón **Administración**
pide usuario y contraseña (cuentas en la hoja **USUARIOS**, se crea sola).

## 1. Desplegar el backend (Apps Script)

1. Abre la hoja de cálculo en Google Sheets.
2. Menú **Extensiones → Apps Script**.
3. Borra el contenido de `Code.gs` y pega el contenido de
   `apps-script/Code.gs` de este proyecto.
4. Guarda (icono de disco).
5. Clic en **Desplegar → Nueva implementación**.
   - Tipo: **Aplicación web**.
   - Ejecutar como: **Yo (tu cuenta)**.
   - Quién tiene acceso: **Cualquier usuario**.
6. Clic en **Implementar** y autoriza los permisos que pida (acceso a la
   hoja, a Drive para guardar las fotos, y a enviar correo para las
   notificaciones de horas extra).
7. Copia la **URL de la aplicación web** (termina en `/exec`).

La primera vez que el script se ejecuta, crea automáticamente:

- Hoja **CONFIG**: radio de ubicación permitido (5 m por defecto — ver
  nota sobre precisión GPS más abajo), turnos (`07:00, 08:00, 09:00`) y
  una clave secreta para firmar las sesiones.
- Hoja **USUARIOS**: una cuenta administradora por defecto —
  usuario `admin`, contraseña **`admin123`** ⚠️ **Cámbiala de inmediato**
  (inicia sesión con ella y usa el botón **Mi cuenta** dentro de
  Administración), y crea en la pestaña **Usuarios** una cuenta para cada
  persona que vaya a administrar la app.

## 2. Conectar el frontend

Edita `js/config.js` y reemplaza `APPS_SCRIPT_URL` con la URL copiada en el
paso anterior:

```js
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/XXXXXXXX/exec';
```

## 3. Servir la aplicación

**Local (WAMP):** la carpeta ya está en `C:\wamp64\www\asistencia`, así que
con WAMP activo puedes abrirla en:

```
http://localhost/asistencia/
```

Nota: los navegadores solo permiten acceder a la cámara y GPS
(`getUserMedia` / `geolocation`) desde `localhost` o **HTTPS**. En
`http://` sobre una IP de red (celular conectándose a tu WAMP local) no
funcionará la cámara ni la ubicación.

**GitHub Pages (recomendado para compartirla):** al ser un sitio 100%
estático (sin build, sin dependencias de servidor), GitHub Pages sirve
directo con HTTPS y es gratis. Pasos:

1. Crea un repositorio en GitHub (público, o privado si tu plan lo
   permite) y sube el contenido de esta carpeta:

   ```bash
   git init
   git add .
   git commit -m "Registro de asistencia"
   git branch -M main
   git remote add origin https://github.com/<usuario>/<repo>.git
   git push -u origin main
   ```

2. En GitHub: **Settings → Pages → Source** → rama `main`, carpeta `/root`.
3. Espera un minuto y abre la URL que GitHub asigna
   (`https://<usuario>.github.io/<repo>/`).

Como es una carpeta estática, cualquier otro host similar (Netlify,
Vercel, Cloudflare Pages) funciona igual de bien — no hay ventaja real de
uno sobre otro para este proyecto.

## 4. Primeros pasos en la app

1. Abre la app → botón **Administración** (arriba a la derecha) → ingresa
   con usuario `admin` y contraseña `admin123`.
2. Pestaña **Usuarios**: crea una cuenta real para cada persona que vaya a
   administrar la app. Puedes eliminar la cuenta `admin` de fábrica una
   vez que exista al menos otra cuenta.
3. Botón **Mi cuenta**: cambia tu propia contraseña.
4. Pestaña **Ubicación**: párate en el sitio exacto donde debe registrarse
   la asistencia y pulsa **Usar mi ubicación actual**, define el radio
   permitido (ver nota de precisión GPS abajo) y **Guardar ubicación**.
5. Pestaña **Empleados**: agrega/edita/elimina empleados y su turno
   asignado (también puedes seguir editando la hoja **EMPLEADOS**
   directamente en Sheets; la app siempre lee el estado actual).
6. Vuelve al registro (**← Volver al registro**) y prueba una entrada y
   una salida.

## Cómo funciona el registro

- La pantalla de registro es pública, sin login — cualquiera puede marcar
  entrada/salida. Solo **Administración** pide credenciales.
- **Entrada**: el empleado ingresa su código → aparece su nombre/turno →
  la app valida que esté dentro del radio configurado de la ubicación de
  referencia (si no lo está, no deja continuar a la cámara) → toma una
  foto (IMAGEN1) → se guarda `HORA INGRESO` y `ESTADO` (`A TIEMPO` si la
  hora es ≤ hora del turno, `ATRASADO` si es posterior).
- **Salida**: mismo flujo (ubicación + foto IMAGEN2) → se guarda
  `HORA SALIDA` y `ESTADO` cambia a `FIN DE JORNADA`.
- Antes de confirmar el registro (tanto entrada como salida), el empleado
  puede escribir una **observación** opcional (texto libre, máximo 200
  caracteres) que se guarda en la columna `OBSERVACION` de `REGISTRO`. Si
  se ingresa una nota al entrar y otra distinta al salir, se concatenan
  (separadas por " / ") en vez de que la segunda borre a la primera.
- Las fotos se guardan en una carpeta de Google Drive llamada
  `ASISTENCIA_FOTOS` (se crea sola) y el enlace se guarda en las columnas
  `IMAGEN1`/`IMAGEN2` de la hoja `REGISTRO`. El enlace queda visible para
  cualquiera que lo tenga (necesario para poder verlo desde la hoja);
  avísame si prefieres que las fotos queden privadas y solo accesibles
  desde el script.
- Cuando alguien registra la entrada del **último turno configurado**
  (el de hora más tardía, ej. 09:00), si quien está usando el navegador
  tiene sesión de **administrador**, se abre automáticamente el informe
  del día (registrados / no registrados).
- El informe también se puede generar en cualquier momento desde
  Administración → pestaña **Informe**, eligiendo la fecha, filtrando por
  nombre/código/estado, y exportarse a Excel (.xlsx) con dos hojas:
  Registrados y No registrados (respeta el filtro aplicado).
- La tabla de **Registrados** incluye **Horas extras** (formato `H:MM`).
  Entre semana empieza a contar 9h01s después del inicio del turno
  asignado (ej. turno 07:00 → desde las 16:00:01); sábado y domingo
  cuenta toda la jornada trabajada. El excedente se redondea al medio
  hora más cercano (<30 min → 0, 30-44 min → 30 min, 45-59 min → hora
  completa, repitiéndose por cada hora). Si aún no hay hora de salida
  registrada, se muestra "-".
- Si el empleado generó horas extra ese día y tiene un **correo**
  cargado en su ficha (pestaña Empleados, campo opcional), al registrar
  la salida se le envía automáticamente un correo de confirmación con el
  detalle (turno, hora de ingreso/salida, horas extra). Se envía con
  `MailApp` desde la cuenta de Google dueña del script — no requiere
  configuración adicional, pero sí que autorices el permiso de correo la
  próxima vez que despliegues (ver siguiente sección). Si el envío falla
  por cualquier motivo, el registro de salida igual se guarda con
  normalidad. Cada envío va con copia (CC) fija a
  `mguanulema@telconet.ec` (constante `CORREO_COPIA_HORAS_EXTRA` en
  `Code.gs`, editable ahí si cambia el destinatario).

## Concurrencia y rendimiento

- **Bloqueo de escrituras (`LockService`)**: las operaciones que leen y
  luego escriben una fila (registrar entrada/salida, guardar/eliminar
  empleados o usuarios, cambiar contraseña, guardar turnos/ubicación) se
  serializan con un lock de script. Sin esto, dos peticiones casi
  simultáneas podían calcular la misma "última fila" y una pisaba el
  registro de la otra. Si el servidor está muy ocupado (cola de más de
  10 s), la petición falla con un mensaje para reintentar en vez de
  arriesgar datos corruptos.
- **Caché de lecturas (`CacheService`)**: `empleados`, `config` (turnos,
  ubicación, radio) y la lista de `usuarios` se cachean por 2 minutos en
  vez de releer la hoja completa en cada petición — esto incluye
  `requireAuth`, que antes releía USUARIOS y CONFIG en cada acción del
  panel de administración. La caché se invalida de inmediato en cuanto
  se guarda un cambio, así que nunca se sirven datos obsoletos por más
  de una escritura de diferencia.

## Seguridad

- **Límite de intentos de login**: tras 3 contraseñas incorrectas
  seguidas para un mismo usuario, se bloquea ese usuario por 15 minutos
  (constantes `LOGIN_MAX_INTENTOS`/`LOGIN_BLOQUEO_SEGUNDOS`). Se
  resetea solo al iniciar sesión con éxito o al expirar el bloqueo. No
  se bloquea por IP porque Apps Script no la expone en el evento del
  Web App.
- **Límite de velocidad del kiosco público** (`registrarIngreso`/
  `registrarSalida`, que no piden login): máximo 30 solicitudes por
  minuto en total, compartidas entre ambas acciones (constantes
  `KIOSCO_LIMITE_INTENTOS`/`KIOSCO_LIMITE_VENTANA_SEGUNDOS`). Evita que
  alguien con la URL pueda spamear registros falsos con un script fuera
  del navegador y agotar la cuota de Drive o de correo — CORS no
  protege contra eso, solo restringe JavaScript de otros sitios web
  corriendo en un navegador.
- Ambos límites usan `CacheService`, así que se reinician solos si el
  script se vuelve a desplegar.
- **Escape de HTML**: todos los datos que vienen de la hoja de cálculo
  (nombre, cargo, correo, usuario) pasan por `Utils.escapeHtml` antes de
  insertarse en el DOM (tablas de Empleados/Usuarios/Informe, ficha del
  kiosco). Sin esto, un valor con HTML/JS incrustado se ejecutaría en el
  navegador de quien viera esa pantalla — incluido el kiosco público, que
  no requiere login.
- **Contraseñas con sal**: cada cuenta de la hoja USUARIOS tiene una sal
  aleatoria (columna `SALT`) que se combina con la contraseña antes de
  aplicar SHA-256. Así, si alguien llegara a leer esa hoja, no puede
  atacar todas las cuentas a la vez con una tabla precalculada (rainbow
  table) — tiene que romper cada hash por separado. Las cuentas creadas
  antes de este cambio se migran solas, de forma transparente, la
  próxima vez que ese usuario inicia sesión con éxito.

## Precisión GPS y el radio permitido

El registro exige que el empleado esté dentro de un radio (en metros) de
la ubicación de referencia configurada en Administración → **Ubicación**.
La API de geolocalización del navegador (`navigator.geolocation`) depende
del GPS del dispositivo, que en la práctica suele tener una precisión de
5–30 m al aire libre y bastante peor en interiores.

Para no rechazar en falso a alguien que sí está en el sitio correcto pero
cuyo dispositivo tiene poco GPS, la validación **considera el margen de
error que reporta el propio dispositivo**: se acepta el registro si
`distancia ≤ radio configurado + margen de error` (el margen se topa en
50 m — constante `MARGEN_PRECISION_MAX`, tanto en `js/app.js` como en
`Code.gs` — para que un dispositivo con precisión realmente mala, ej.
±500 m, no vuelva inútil el control). Esto se valida igual en el
navegador (para no dejar avanzar a la cámara) y en el servidor (por si
alguien intenta saltarse el frontend), así que ambos deben coincidir. La
app siempre muestra la distancia calculada y la precisión GPS reportada,
para diagnosticar si un rechazo es por estar realmente lejos o por poca
precisión. Si sigue dando problemas en la práctica, prueba con un radio
base mayor (Administración → Ubicación).

### "Permiso denegado" en cámara o ubicación

El navegador del equipo ya quedó marcado como "bloqueado" para ese
permiso, normalmente porque alguien lo rechazó una vez. Se soluciona
desde el propio dispositivo, no desde la app: hay que activar Cámara o
Ubicación para este sitio en los ajustes de permisos del navegador y
recargar la página. La app muestra este mensaje en español, en vez del
texto crudo (y a veces en inglés) que devuelve el navegador, pero sin
detallar la ruta exacta porque varía por navegador/SO:

- **Chrome/Android**: ícono de candado junto a la dirección web →
  Permisos.
- **Safari/iPhone**: ícono "aA" en la barra de direcciones →
  Configuración del sitio web, o Ajustes del iPhone → Safari →
  Cámara/Ubicación.

## Estructura del proyecto

```
asistencia/
├── index.html
├── css/style.css
├── js/
│   ├── config.js     (URL del Apps Script)
│   ├── api.js         (fetch al backend)
│   ├── utils.js        (formateo de horas, geolocalización, toasts)
│   ├── camera.js         (captura de foto)
│   ├── app.js              (flujo de registro / kiosco)
│   ├── admin.js              (CRUD empleados, turnos, ubicación, informe, usuarios)
│   └── auth.js                 (login y sesión del panel de administración)
├── apps-script/Code.gs   (backend a pegar en Apps Script)
└── README.md
```
