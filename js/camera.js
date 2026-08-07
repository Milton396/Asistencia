// Manejo de cámara: obtiene un stream, muestra preview y captura una foto en base64 (JPEG comprimido).
const Camera = (() => {
  let stream = null;

  // Mensajes propios en vez del err.message crudo del navegador (a menudo
  // vacío o en inglés según el dispositivo).
  function errorCamaraLegible(err) {
    const mensajes = {
      NotAllowedError: 'Permiso de cámara denegado. Actívalo desde los ajustes de permisos de este sitio en tu navegador (o en los ajustes de privacidad del teléfono) y vuelve a intentar.',
      PermissionDeniedError: 'Permiso de cámara denegado. Actívalo desde los ajustes de permisos de este sitio en tu navegador (o en los ajustes de privacidad del teléfono) y vuelve a intentar.',
      NotFoundError: 'No se encontró ninguna cámara en este dispositivo.',
      NotReadableError: 'La cámara está siendo usada por otra aplicación. Ciérrala e intenta de nuevo.',
      OverconstrainedError: 'La cámara de este dispositivo no cumple los requisitos solicitados.'
    };
    return new Error(mensajes[err.name] || ('No se pudo acceder a la cámara: ' + (err.message || err.name || 'error desconocido')));
  }

  async function iniciar(videoEl) {
    detener();
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('Este dispositivo o navegador no soporta acceso a la cámara.');
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false
      });
    } catch (err) {
      throw errorCamaraLegible(err);
    }
    videoEl.srcObject = stream;
    await videoEl.play();
  }

  function capturar(videoEl, maxAncho = 480, calidad = 0.6) {
    const escala = Math.min(1, maxAncho / videoEl.videoWidth);
    const canvas = document.createElement('canvas');
    canvas.width = videoEl.videoWidth * escala;
    canvas.height = videoEl.videoHeight * escala;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', calidad);
  }

  function detener() {
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      stream = null;
    }
  }

  return { iniciar, capturar, detener };
})();
