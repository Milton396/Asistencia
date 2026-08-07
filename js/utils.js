const Utils = (() => {
  function haversine(lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const toRad = (v) => (v * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  // Mensajes propios en vez del err.message crudo del navegador, que varía
  // de texto (y hasta de idioma) según el dispositivo y confunde al usuario.
  function errorUbicacionLegible(err) {
    const mensajes = {
      1: 'Permiso de ubicación denegado. Actívalo desde los ajustes de permisos de este sitio en tu navegador (o en los ajustes de privacidad del teléfono) y vuelve a intentar.',
      2: 'No se pudo determinar la ubicación de este dispositivo (sin señal de GPS/red). Prueba cerca de una ventana o al aire libre.',
      3: 'Se agotó el tiempo esperando la ubicación. Verifica que el GPS esté activado e intenta de nuevo.'
    };
    const e = new Error(mensajes[err.code] || ('No se pudo obtener la ubicación: ' + err.message));
    e.code = err.code;
    return e;
  }

  function intentarUbicacion(altaPrecision) {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('Este dispositivo o navegador no soporta ubicación GPS.'));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy
        }),
        (err) => reject(errorUbicacionLegible(err)),
        { enableHighAccuracy: altaPrecision, timeout: altaPrecision ? 8000 : 15000, maximumAge: 0 }
      );
    });
  }

  // Muchas tablets/celulares sin GPS real fallan o se agotan en alta
  // precisión; reintenta una vez con ubicación por red (menos exacta, pero
  // funciona en más dispositivos) antes de rendirse.
  async function getUbicacionActual() {
    try {
      return await intentarUbicacion(true);
    } catch (err) {
      if (err.code === 2 || err.code === 3) {
        return await intentarUbicacion(false);
      }
      throw err;
    }
  }

  function hoyISO() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function formatoHora(valor) {
    if (!valor) return '';
    const str = String(valor);
    // Fecha/hora ISO (p. ej. "1899-12-30T14:14:00.000Z") que Sheets guardó
    // como valor de tipo hora: se interpreta y se muestra en hora local.
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(str)) {
      const d = new Date(str);
      if (!isNaN(d)) {
        const pad = (n) => String(n).padStart(2, '0');
        return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
      }
    }
    // Ya viene como "HH:mm" o "HH:mm:ss".
    const m = str.match(/^(\d{1,2}):(\d{2})/);
    if (m) return `${m[1].padStart(2, '0')}:${m[2]}`;
    return str;
  }

  function toast(msg, tipo = 'info', ms = 4000) {
    const cont = document.getElementById('toast-container');
    const el = document.createElement('div');
    el.className = `toast toast-${tipo}`;
    el.textContent = msg;
    cont.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => el.remove(), 300);
    }, ms);
  }

  return { haversine, getUbicacionActual, hoyISO, toast, formatoHora };
})();
