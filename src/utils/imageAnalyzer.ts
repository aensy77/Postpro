import type { ImageHostProvider, MediaContext } from '../types';
import { formatBytes } from './filePicker';

export type ImageQualitySeverity = 'optimal' | 'warning' | 'critical';

export interface HostUploadPolicy {
  label: string;
  maxBytes: number;
  recommendedMaxBytes: number;
  recommendedMaxWidth: number;
  note: string;
}

export const HOST_IMAGE_POLICIES: Record<ImageHostProvider, HostUploadPolicy> = {
  imgbb: {
    label: 'ImgBB API',
    maxBytes: 32 * 1024 * 1024,
    recommendedMaxBytes: 2.5 * 1024 * 1024,
    recommendedMaxWidth: 1920,
    note: 'Límite 32 MB · Recomendado ≤ 1920px y ≤ 2.5 MB para carga rápida en foros.',
  },
  imgur: {
    label: 'Imgur v3',
    maxBytes: 20 * 1024 * 1024,
    recommendedMaxBytes: 2 * 1024 * 1024,
    recommendedMaxWidth: 1920,
    note: 'Límite 20 MB · Imgur recomprime imágenes > 5 MB automáticamente.',
  },
  freeimage: {
    label: 'Freeimage.host',
    maxBytes: 64 * 1024 * 1024,
    recommendedMaxBytes: 3 * 1024 * 1024,
    recommendedMaxWidth: 2560,
    note: 'Límite 64 MB · Recomendado ≤ 2560px y ≤ 3 MB.',
  },
  postimages: {
    label: 'Postimages',
    maxBytes: 24 * 1024 * 1024,
    recommendedMaxBytes: 2.5 * 1024 * 1024,
    recommendedMaxWidth: 1920,
    note: 'Límite 24 MB · Recomendado ≤ 1920px para previsualización fluida.',
  },
  chevereto: {
    label: 'Chevereto / Custom',
    maxBytes: 32 * 1024 * 1024,
    recommendedMaxBytes: 3 * 1024 * 1024,
    recommendedMaxWidth: 2560,
    note: 'Estándar ≤ 32 MB · Recomendado ≤ 2560px y ≤ 3 MB.',
  },
};

export interface ExtractedDocImage {
  id: string;
  slotKey: keyof MediaContext;
  slotIndex: number; // occurrence index within slot (e.g. 0, 1, 2 in capturas_bbcode)
  label: string;
  src: string;
  isLocalDataUrl: boolean;
  isSvg: boolean;
}

export interface ImageOptimizationSuggestion {
  action: 'resize-compress' | 'compress' | 'resize' | 'none';
  title: string;
  reason: string;
  targetMaxWidth: number;
  targetFormat: 'image/jpeg' | 'image/webp';
  targetQuality: number;
  estimatedSavingsPct: number;
}

export interface AnalyzedImageAsset extends ExtractedDocImage {
  width: number | null;
  height: number | null;
  sizeBytes: number | null;
  sizeLabel: string;
  format: string;
  aspectRatio: string;
  severity: ImageQualitySeverity;
  statusLabel: string;
  suggestions: string[];
  recommendedAction: ImageOptimizationSuggestion;
  loadError?: string;
}

export function extractImagesFromContext(context: MediaContext): ExtractedDocImage[] {
  const results: ExtractedDocImage[] = [];

  const pushImgsFromBb = (raw: string, slotKey: keyof MediaContext, baseLabel: string) => {
    if (!raw || !raw.trim()) return;
    const regex = /\[img(?:\s+size=\d{2,4})?\]([\s\S]*?)\[\/img\]/gi;
    let m: RegExpExecArray | null;
    let idx = 0;
    while ((m = regex.exec(raw)) !== null) {
      const src = m[1].trim();
      if (!src) continue;
      results.push({
        id: `${String(slotKey)}-${idx}`,
        slotKey,
        slotIndex: idx,
        label: idx === 0 && slotKey === 'espectrograma_bbcode' ? baseLabel : `${baseLabel} #${idx + 1}`,
        src,
        isLocalDataUrl: src.startsWith('data:image/'),
        isSvg: src.startsWith('data:image/svg+xml'),
      });
      idx += 1;
    }
  };

  pushImgsFromBb(context.capturas_bbcode, 'capturas_bbcode', 'Captura');
  pushImgsFromBb(context.espectrograma_bbcode, 'espectrograma_bbcode', 'Espectrograma');

  const directSlots: Array<{ key: keyof MediaContext; label: string }> = [
    { key: 'logo_url', label: 'Logo HD' },
    { key: 'poster_url', label: 'Portada' },
    { key: 'banner_url', label: 'Banner' },
    { key: 'clearart_url', label: 'ClearArt' },
    { key: 'background_url', label: 'Background' },
    { key: 'thumb_url', label: 'Miniatura' },
    { key: 'separator_url', label: 'Separador' },
  ];

  for (const s of directSlots) {
    const val = (context[s.key] || '').trim();
    if (!val) continue;
    if (/^(data:image\/|https?:\/\/)/i.test(val)) {
      results.push({
        id: `${String(s.key)}-0`,
        slotKey: s.key,
        slotIndex: 0,
        label: s.label,
        src: val,
        isLocalDataUrl: val.startsWith('data:image/'),
        isSvg: val.startsWith('data:image/svg+xml'),
      });
    }
  }

  return results;
}

function estimateDataUrlBytes(dataUrl: string): number {
  const commaIdx = dataUrl.indexOf(',');
  if (commaIdx < 0) return dataUrl.length;
  const header = dataUrl.slice(0, commaIdx).toLowerCase();
  const payload = dataUrl.slice(commaIdx + 1);
  if (header.includes(';base64')) {
    const clean = payload.replace(/\s+/g, '');
    const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
    return Math.max(0, Math.floor((clean.length * 3) / 4) - padding);
  }
  try {
    return new TextEncoder().encode(decodeURIComponent(payload)).length;
  } catch {
    return payload.length;
  }
}

function detectFormatFromSrc(src: string): string {
  if (src.startsWith('data:image/')) {
    const m = src.match(/^data:image\/([a-z0-9.+-]+)/i);
    const sub = (m?.[1] || 'img').toUpperCase();
    return sub.replace('SVG+XML', 'SVG').replace('JPEG', 'JPG');
  }
  const cleanUrl = src.split('?')[0].split('#')[0];
  const extMatch = cleanUrl.match(/\.(png|jpe?g|webp|gif|bmp|avif|svg)$/i);
  if (extMatch) return extMatch[1].toUpperCase().replace('JPEG', 'JPG');
  return 'URL';
}

function computeAspectRatio(w: number, h: number): string {
  if (!w || !h) return '—';
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const d = gcd(w, h);
  const rw = Math.round(w / d);
  const rh = Math.round(h / d);
  if (rw <= 32 && rh <= 32) return `${rw}:${rh}`;
  return `${(w / h).toFixed(2)}:1`;
}

function probeImageDimensions(src: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const timer = window.setTimeout(() => {
      reject(new Error('Tiempo agotado leyendo dimensiones'));
    }, 6000);

    img.onload = () => {
      window.clearTimeout(timer);
      resolve({
        width: img.naturalWidth || img.width || 0,
        height: img.naturalHeight || img.height || 0,
      });
    };
    img.onerror = () => {
      window.clearTimeout(timer);
      reject(new Error('No se pudo cargar la imagen'));
    };
    img.src = src;
  });
}

async function probeRemoteByteSize(url: string): Promise<number | null> {
  if (!/^https?:\/\//i.test(url)) return null;
  try {
    const resp = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(4000) });
    if (!resp.ok) return null;
    const len = resp.headers.get('content-length');
    if (len && /^\d+$/.test(len)) {
      return Number(len);
    }
    return null;
  } catch {
    return null;
  }
}

export function compressionPercentToQuality(compressionPercent = 25): number {
  const clamped = Math.max(5, Math.min(75, Math.round(compressionPercent)));
  return Math.max(0.2, Math.min(0.96, (100 - clamped) / 100));
}

export function buildCapturesBbCode(sources: string[]): string {
  return sources
    .map((s) => s.trim())
    .filter(Boolean)
    .map((src) => `[img]${src}[/img]`)
    .join(' ');
}

export async function analyzeImageAsset(
  asset: ExtractedDocImage,
  hostProvider: ImageHostProvider,
  compressionPercent = 25
): Promise<AnalyzedImageAsset> {
  const policy = HOST_IMAGE_POLICIES[hostProvider] || HOST_IMAGE_POLICIES.imgbb;
  const format = detectFormatFromSrc(asset.src);

  let sizeBytes: number | null = asset.isLocalDataUrl ? estimateDataUrlBytes(asset.src) : null;
  let width: number | null = null;
  let height: number | null = null;
  let loadError: string | undefined;

  const [dimResult, remoteSize] = await Promise.all([
    probeImageDimensions(asset.src).catch((err) => {
      loadError = err instanceof Error ? err.message : 'Error de carga';
      return null;
    }),
    !asset.isLocalDataUrl ? probeRemoteByteSize(asset.src) : Promise.resolve(null),
  ]);

  if (dimResult) {
    width = dimResult.width;
    height = dimResult.height;
  }
  if (sizeBytes === null && remoteSize !== null) {
    sizeBytes = remoteSize;
  }

  const sizeLabel =
    sizeBytes !== null
      ? formatBytes(sizeBytes)
      : asset.isLocalDataUrl
      ? '—'
      : 'Externo (CORS)';

  const aspectRatio = width && height ? computeAspectRatio(width, height) : '—';

  const suggestions: string[] = [];
  let severity: ImageQualitySeverity = 'optimal';
  let statusLabel = 'Óptima';

  const isThumbOrLogo = asset.slotKey === 'thumb_url' || asset.slotKey === 'logo_url';
  const targetMaxW = isThumbOrLogo ? 720 : Math.min(1920, policy.recommendedMaxWidth);
  const needsResize = Boolean(width && width > targetMaxW);
  const needsCompress =
    Boolean(sizeBytes && sizeBytes > policy.recommendedMaxBytes) ||
    (format === 'PNG' && Boolean(sizeBytes && sizeBytes > 550 * 1024) && asset.slotKey === 'capturas_bbcode');
  const exceedsHostMax = Boolean(sizeBytes && sizeBytes > policy.maxBytes);

  if (asset.isSvg) {
    statusLabel = 'Plantilla SVG';
    suggestions.push('Asset vectorial de muestra; reemplázalo con una captura o cover real antes de subir.');
  } else if (loadError) {
    severity = 'warning';
    statusLabel = 'Sin acceso';
    suggestions.push('No se pudieron leer las dimensiones (URL externa protegida o rota).');
  } else {
    if (exceedsHostMax) {
      severity = 'critical';
      statusLabel = `Excede ${policy.label}`;
      suggestions.push(
        `El peso (${sizeLabel}) supera el máximo de ${policy.label} (${formatBytes(policy.maxBytes)}). Debes comprimir y redimensionar antes de subir.`
      );
    } else if (needsResize && needsCompress) {
      severity = 'warning';
      statusLabel = 'Optimizable';
      suggestions.push(
        `Redimensionar de ${width}px a ${targetMaxW}px y comprimir a JPG/WebP 84% para ahorrar ~55-80% de peso.`
      );
    } else if (needsResize) {
      severity = 'warning';
      statusLabel = 'Muy grande';
      suggestions.push(
        `Ancho ${width}px excede ${targetMaxW}px recomendados para ${policy.label}; redimensionar mejora la carga en el post.`
      );
    } else if (needsCompress) {
      severity = 'warning';
      statusLabel = 'Peso elevado';
      suggestions.push(
        format === 'PNG' && asset.slotKey === 'capturas_bbcode'
          ? `Captura PNG pesada (${sizeLabel}). Convertir a JPEG/WebP 85% reduce drásticamente el peso sin pérdida visible.`
          : `Peso (${sizeLabel}) superior al ideal (${formatBytes(policy.recommendedMaxBytes)}). Recomendado comprimir al 82-85%.`
      );
    } else if (width && width < 400 && asset.slotKey === 'capturas_bbcode') {
      severity = 'warning';
      statusLabel = 'Baja res.';
      suggestions.push(
        `Resolución baja (${width}×${height}). Se recomienda capturar a ≥ 720p para mejor detalle.`
      );
    } else {
      suggestions.push(
        `Lista para subir a ${policy.label}${sizeBytes ? ` (${sizeLabel})` : ''}.`
      );
    }
  }

  let action: ImageOptimizationSuggestion['action'] = 'none';
  if (!asset.isSvg && (needsResize || needsCompress || exceedsHostMax)) {
    if (needsResize && (needsCompress || exceedsHostMax)) action = 'resize-compress';
    else if (needsResize) action = 'resize';
    else action = 'compress';
  }

  const targetFormat: 'image/jpeg' | 'image/webp' =
    asset.slotKey === 'logo_url' ? 'image/webp' : 'image/jpeg';
  const configuredPct = Math.max(5, Math.min(75, Math.round(compressionPercent)));
  const configuredQuality = compressionPercentToQuality(configuredPct);
  const targetQuality = exceedsHostMax ? Math.min(configuredQuality, 0.78) : configuredQuality;
  const targetQualityPct = Math.round(targetQuality * 100);
  const estimatedSavingsPct =
    action === 'resize-compress' ? 72 : action === 'compress' ? 58 : action === 'resize' ? 45 : 0;

  return {
    ...asset,
    width,
    height,
    sizeBytes,
    sizeLabel,
    format,
    aspectRatio,
    severity,
    statusLabel,
    suggestions,
    recommendedAction: {
      action,
      title:
        action === 'resize-compress'
          ? `Redimensionar (${targetMaxW}px) + Comprimir (${configuredPct}%)`
          : action === 'resize'
          ? `Redimensionar a ${targetMaxW}px`
          : action === 'compress'
          ? `Comprimir JPG/WebP (Calidad ${targetQualityPct}%)`
          : 'Sin cambios necesarios',
      reason: suggestions[0] || '',
      targetMaxWidth: targetMaxW,
      targetFormat,
      targetQuality,
      estimatedSavingsPct,
    },
    loadError,
  };
}

export async function optimizeLocalImageDataUrl(
  dataUrl: string,
  options: {
    maxWidth?: number;
    mimeType?: 'image/jpeg' | 'image/webp' | 'image/png';
    quality?: number;
  } = {}
): Promise<{
  dataUrl: string;
  width: number;
  height: number;
  oldBytes: number;
  newBytes: number;
}> {
  if (!dataUrl.startsWith('data:image/') || dataUrl.startsWith('data:image/svg+xml')) {
    throw new Error('Solo se pueden optimizar imágenes raster locales (PNG/JPG/WEBP).');
  }

  const oldBytes = estimateDataUrlBytes(dataUrl);
  const dims = await probeImageDimensions(dataUrl);
  const srcW = dims.width;
  const srcH = dims.height;
  if (!srcW || !srcH) {
    throw new Error('Dimensiones de imagen inválidas.');
  }

  const maxW = options.maxWidth === 0 ? srcW : options.maxWidth ?? 1920;
  const scale = maxW > 0 && srcW > maxW ? maxW / srcW : 1;
  const targetW = Math.max(1, Math.round(srcW * scale));
  const targetH = Math.max(1, Math.round(srcH * scale));

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('Error decodificando la imagen para optimizar.'));
    el.src = dataUrl;
  });

  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Contexto Canvas 2D no disponible.');

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, targetW, targetH);

  const mime = options.mimeType || 'image/jpeg';
  const quality = Math.max(0.2, Math.min(0.98, options.quality ?? 0.85));
  const optimizedUrl = canvas.toDataURL(mime, quality);
  const newBytes = estimateDataUrlBytes(optimizedUrl);

  return {
    dataUrl: optimizedUrl,
    width: targetW,
    height: targetH,
    oldBytes,
    newBytes,
  };
}

export async function optimizeAndBuildCapturesBbCode(
  sources: string[],
  options: {
    maxWidth?: number;
    compressionPercent?: number;
    mimeType?: 'image/jpeg' | 'image/webp' | 'image/png';
  } = {}
): Promise<{
  dataUrls: string[];
  bbcode: string;
  totalOldBytes: number;
  totalNewBytes: number;
}> {
  const quality = compressionPercentToQuality(options.compressionPercent ?? 25);
  const dataUrls: string[] = [];
  let totalOldBytes = 0;
  let totalNewBytes = 0;

  for (const src of sources) {
    if (!src) continue;
    if (src.startsWith('data:image/') && !src.startsWith('data:image/svg+xml')) {
      const opt = await optimizeLocalImageDataUrl(src, {
        maxWidth: options.maxWidth ?? 0,
        mimeType: options.mimeType ?? 'image/jpeg',
        quality,
      });
      dataUrls.push(opt.dataUrl);
      totalOldBytes += opt.oldBytes;
      totalNewBytes += opt.newBytes;
    } else {
      dataUrls.push(src);
    }
  }

  return {
    dataUrls,
    bbcode: buildCapturesBbCode(dataUrls),
    totalOldBytes,
    totalNewBytes,
  };
}
