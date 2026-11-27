/** Reduce una foto de la cámara (puede pesar varios MB) a JPEG de máx. `maxSide` px; si el navegador no puede decodificarla, devuelve el original. */
export async function resizeImage(file: Blob, maxSide = 1280, quality = 0.82): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas'); canvas.width = Math.round(bmp.width * scale); canvas.height = Math.round(bmp.height * scale);
    const ctx = canvas.getContext('2d'); if (!ctx) return file;
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height); bmp.close?.();
    return await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b ?? file), 'image/jpeg', quality));
  } catch { return file; }
}
