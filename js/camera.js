// Manejo de cámara: obtiene un stream, muestra preview y captura una foto en base64 (JPEG comprimido).
const Camera = (() => {
  let stream = null;

  async function iniciar(videoEl) {
    detener();
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false
    });
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
