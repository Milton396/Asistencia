# Registro de Asistencia

Aplicación web (HTML/CSS/JS) para registrar entrada y salida de empleados con
foto, usando tu Google Sheet
(`17_nIu0LmHeu_S0uJgkPo1gHhqQT0xP3VqGPCiEVY6M0`) como base de datos a través
de un backend en Google Apps Script.

Acceso con dos roles (ver hoja **USUARIOS**, se crea sola):

- **Administrador**: acceso completo (empleados, ubicación, informe, usuarios, cuenta).
- **Usuario**: solo ve la pantalla de registro de entrada/salida.

Toda la app, incluida la pantalla de registro, requiere iniciar sesión.

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
   hoja y a Drive, para guardar las fotos).
7. Copia la **URL de la aplicación web** (termina en `/exec`).

La primera vez que el script se ejecuta, crea automáticamente:

- Hoja **CONFIG**: radio de ubicación permitido (5 m por defecto — ver
  nota sobre precisión GPS más abajo), turnos (`07:00, 08:00, 09:00`) y
  una clave secreta para firmar las sesiones.
- Hoja **USUARIOS**: una cuenta administradora por defecto —
  usuario `admin`, contraseña **`admin123`** ⚠️ **Cámbiala de inmediato**
  (inicia sesión con ella y usa el botón **Mi cuenta** del encabezado), y
  crea en Administración → pestaña **Usuarios** una cuenta para cada
  administrador/usuario real.

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

1. Abre la app → pantalla de login → ingresa con usuario `admin` y
   contraseña `admin123`.
2. Pestaña **Usuarios**: crea una cuenta real por cada administrador (rol
   **Administrador**) y por cada persona que solo deba usar el kiosco (rol
   **Usuario**). Puedes eliminar la cuenta `admin` de fábrica una vez que
   exista al menos otro administrador.
3. Botón **Mi cuenta** (encabezado, visible con cualquier rol): cambia tu
   propia contraseña.
4. Pestaña **Ubicación**: párate en el sitio exacto donde debe registrarse
   la asistencia y pulsa **Usar mi ubicación actual**, define el radio
   permitido (ver nota de precisión GPS abajo) y **Guardar ubicación**.
5. Pestaña **Empleados**: agrega/edita/elimina empleados y su turno
   asignado (también puedes seguir editando la hoja **EMPLEADOS**
   directamente en Sheets; la app siempre lee el estado actual).
6. Vuelve al registro (**← Volver al registro**) y prueba una entrada y
   una salida.

## Cómo funciona el registro

- Toda la app requiere iniciar sesión, incluida la pantalla de registro.
  Un rol **Usuario** solo ve esa pantalla; un **Administrador** además ve
  el botón **Administración**.
- **Entrada**: el empleado ingresa su código → aparece su nombre/turno →
  la app valida que esté dentro del radio configurado de la ubicación de
  referencia (si no lo está, no deja continuar a la cámara) → toma una
  foto (IMAGEN1) → se guarda `HORA INGRESO` y `ESTADO` (`A TIEMPO` si la
  hora es ≤ hora del turno, `ATRASADO` si es posterior).
- **Salida**: mismo flujo (ubicación + foto IMAGEN2) → se guarda
  `HORA SALIDA` y `ESTADO` cambia a `FIN DE JORNADA`.
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

## Precisión GPS y el radio permitido

El registro exige que el empleado esté dentro de un radio (en metros) de
la ubicación de referencia configurada en Administración → **Ubicación**.
La API de geolocalización del navegador (`navigator.geolocation`) depende
del GPS del dispositivo, que en la práctica suele tener una precisión de
5–30 m al aire libre y bastante peor en interiores. Si configuras un radio
muy ajustado (por ejemplo 2 m), es probable que alguien parado exactamente
en el sitio correcto sea rechazado por el margen de error del propio GPS,
no por estar realmente fuera de lugar — la app muestra la precisión
reportada por el dispositivo junto al resultado para ayudar a diagnosticar
esto. Si da problemas en la práctica, prueba con un radio mayor (5–10 m).

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
│   └── auth.js                 (login, sesión, enrutamiento por rol)
├── apps-script/Code.gs   (backend a pegar en Apps Script)
└── README.md
```
