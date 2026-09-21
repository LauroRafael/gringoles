/** Redimensiona/comprime imagens antes de salvar no localStorage (cota ~5MB).
 * Preserva transparência: PNG com alpha sai em PNG; imagem opaca sai em JPEG menor. */
export function compressImage(file: File, maxDim = 800, quality = 0.8): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        URL.revokeObjectURL(url);
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) throw new Error('sem canvas 2d');
        ctx.drawImage(img, 0, 0, w, h);
        if (hasAlpha(ctx, w, h)) {
          resolve(canvas.toDataURL('image/png'));
        } else {
          // Opaca: JPEG com fundo branco (caso o original tivesse fundo transparente sólido)
          const flat = document.createElement('canvas');
          flat.width = w;
          flat.height = h;
          const fctx = flat.getContext('2d');
          if (!fctx) throw new Error('sem canvas 2d');
          fctx.fillStyle = '#ffffff';
          fctx.fillRect(0, 0, w, h);
          fctx.drawImage(canvas, 0, 0);
          resolve(flat.toDataURL('image/jpeg', quality));
        }
      } catch (e) {
        reject(e);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('imagem inválida'));
    };
    img.src = url;
  });
}

/** Detecta pixel semi/transparente (amostragem para não pesar em foto grande). */
function hasAlpha(ctx: CanvasRenderingContext2D, w: number, h: number): boolean {
  try {
    const step = Math.max(1, Math.floor(Math.max(w, h) / 200));
    for (let y = 0; y < h; y += step) {
      const row = ctx.getImageData(0, y, w, 1).data;
      for (let x = 3; x < row.length; x += 4 * step) {
        if (row[x] < 250) return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

export function storageUsage(): { usedKB: number; quotaKB: number; pct: number } {
  let used = 0;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      const v = localStorage.getItem(k) ?? '';
      used += (k.length + v.length) * 2; // UTF-16 ≈ 2 bytes/char
    }
  } catch { /* noop */ }
  const quotaKB = 5 * 1024;
  const usedKB = Math.round(used / 1024);
  return { usedKB, quotaKB, pct: Math.min(100, Math.round((usedKB / quotaKB) * 100)) };
}
