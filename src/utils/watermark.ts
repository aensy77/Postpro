import type { WatermarkPosition, WatermarkSettings } from '../types';

export function formatWatermarkLabel(userText: string, placeText: string): string {
  const u = userText.trim();
  const p = placeText.trim();
  if (u && p) return `${u} · ${p}`;
  return u || p;
}

export const WATERMARK_POSITION_LABELS: Record<WatermarkPosition, string> = {
  'bottom-right': 'Esquina inferior derecha',
  'bottom-left': 'Esquina inferior izquierda',
  'top-right': 'Esquina superior derecha',
  'top-left': 'Esquina superior izquierda',
  center: 'Centro de la imagen',
  tiled: 'Mosaico diagonal',
};

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('No se pudo cargar la imagen para aplicar la marca de agua.'));
    img.src = src;
  });
}

export async function applyWatermarkToDataUrl(
  dataUrl: string,
  settings: WatermarkSettings
): Promise<string> {
  const text = formatWatermarkLabel(settings.userText, settings.placeText);
  if (!text) return dataUrl;

  if (!dataUrl.startsWith('data:image/') || dataUrl.startsWith('data:image/svg+xml')) {
    return dataUrl;
  }

  const img = await loadImageElement(dataUrl);
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  if (!w || !h) return dataUrl;

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return dataUrl;

  ctx.drawImage(img, 0, 0, w, h);

  const scaleFactor =
    settings.scale === 'sm' ? 0.025 : settings.scale === 'lg' ? 0.048 : 0.035;
  const fontSize = Math.max(13, Math.min(64, Math.round(Math.min(w, h) * scaleFactor)));
  const opacity = Math.max(0.1, Math.min(1, settings.opacity || 0.8));

  ctx.save();
  ctx.font = `700 ${fontSize}px "Plus Jakarta Sans", "Segoe UI", system-ui, sans-serif`;
  ctx.textBaseline = 'middle';

  const textWidth = ctx.measureText(text).width;
  const padX = Math.round(fontSize * 0.6);
  const padY = Math.round(fontSize * 0.38);
  const boxW = textWidth + padX * 2;
  const boxH = fontSize + padY * 2;
  const margin = Math.max(10, Math.round(Math.min(w, h) * 0.03));

  if (settings.position === 'tiled') {
    ctx.globalAlpha = Math.max(0.12, opacity * 0.52);
    ctx.fillStyle = settings.color || '#ffffff';
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.72)';
    ctx.lineWidth = Math.max(2, fontSize * 0.12);
    ctx.textAlign = 'center';

    const stepX = Math.max(boxW + fontSize * 2, w * 0.36);
    const stepY = Math.max(boxH + fontSize * 2.4, h * 0.28);

    ctx.translate(w / 2, h / 2);
    ctx.rotate(-Math.PI / 7);
    for (let y = -h; y <= h; y += stepY) {
      for (let x = -w; x <= w; x += stepX) {
        const offsetX = Math.round(y / stepY) % 2 === 0 ? 0 : stepX * 0.5;
        ctx.strokeText(text, x + offsetX, y);
        ctx.fillText(text, x + offsetX, y);
      }
    }
  } else {
    let x = w - margin - boxW;
    let y = h - margin - boxH;

    if (settings.position === 'bottom-left') {
      x = margin;
      y = h - margin - boxH;
    } else if (settings.position === 'top-right') {
      x = w - margin - boxW;
      y = margin;
    } else if (settings.position === 'top-left') {
      x = margin;
      y = margin;
    } else if (settings.position === 'center') {
      x = (w - boxW) / 2;
      y = (h - boxH) / 2;
    }

    x = Math.max(6, Math.min(w - boxW - 6, x));
    y = Math.max(6, Math.min(h - boxH - 6, y));

    ctx.globalAlpha = opacity;

    // Subtle dark scrim badge behind watermark text for contrast on bright/dark areas
    const radius = Math.min(10, Math.round(boxH * 0.3));
    ctx.fillStyle = 'rgba(7, 9, 13, 0.62)';
    ctx.beginPath();
    ctx.roundRect(x, y, boxW, boxH, radius);
    ctx.fill();

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
    ctx.shadowBlur = Math.max(3, Math.round(fontSize * 0.2));
    ctx.fillStyle = settings.color || '#ffffff';
    ctx.textAlign = 'left';
    ctx.fillText(text, x + padX, y + boxH / 2 + 1);
  }

  ctx.restore();

  const isPng = dataUrl.startsWith('data:image/png');
  return canvas.toDataURL(isPng ? 'image/png' : 'image/jpeg', 0.92);
}
