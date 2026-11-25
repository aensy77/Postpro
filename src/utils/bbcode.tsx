import React from 'react';
import type { BbTemplate, MediaContext, TemplateSite, ThemePlugin } from '../types';

export interface HosterInfo {
  id: string;
  name: string;
  patterns: string[];
  accentVar: string;
}

export const HOSTER_CATALOG: Record<string, HosterInfo> = {
  mega: { id: 'mega', name: 'MEGA', patterns: ['mega.nz', 'mega.co.nz'], accentVar: 'var(--accent-magenta)' },
  mediafire: { id: 'mediafire', name: 'MediaFire', patterns: ['mediafire.com'], accentVar: 'var(--accent-cyan)' },
  terabox: {
    id: 'terabox',
    name: 'TeraBox',
    patterns: ['terabox.com', 'teraboxapp.com', '1024terabox.com'],
    accentVar: 'var(--accent-cyan)',
  },
  '1fichier': { id: '1fichier', name: '1Fichier', patterns: ['1fichier.com'], accentVar: 'var(--accent-magenta)' },
  gdrive: {
    id: 'gdrive',
    name: 'Google Drive',
    patterns: ['drive.google.com', 'docs.google.com'],
    accentVar: 'var(--accent-green)',
  },
  pixeldrain: { id: 'pixeldrain', name: 'Pixeldrain', patterns: ['pixeldrain.com'], accentVar: 'var(--accent-purple)' },
  krakenfiles: {
    id: 'krakenfiles',
    name: 'KrakenFiles',
    patterns: ['krakenfiles.com'],
    accentVar: 'var(--accent-purple)',
  },
  gofile: { id: 'gofile', name: 'Gofile', patterns: ['gofile.io'], accentVar: 'var(--accent-green)' },
  rapidgator: { id: 'rapidgator', name: 'Rapidgator', patterns: ['rapidgator.net', 'rg.to'], accentVar: 'var(--accent-magenta)' },
  magnet: { id: 'magnet', name: 'Torrent / Magnet', patterns: ['magnet:?', '.torrent'], accentVar: 'var(--accent-purple)' },
  direct: { id: 'direct', name: 'Servidor Directo', patterns: [], accentVar: 'var(--accent-cyan)' },
};

export function detectHosterFromUrl(url: string): HosterInfo {
  const lower = (url || '').trim().toLowerCase();
  if (!lower) return HOSTER_CATALOG.direct;
  for (const key of Object.keys(HOSTER_CATALOG)) {
    if (key === 'direct') continue;
    if (HOSTER_CATALOG[key].patterns.some((p) => lower.includes(p))) {
      return HOSTER_CATALOG[key];
    }
  }
  return HOSTER_CATALOG.direct;
}

export const DEFAULT_CUSTOM_LINK_TEMPLATE =
  '[center][spoiler][url=link]GDrive[/url][/spoiler][/center]';

export function formatCustomLinkLine(
  template: string,
  url: string,
  customLabel?: string
): string {
  const cleanUrl = url.trim();
  const hoster = detectHosterFromUrl(cleanUrl);
  const shortServer = hoster.id === 'gdrive' ? 'GDrive' : hoster.name;
  const trimmedLabel = (customLabel || '').trim();

  let raw = (template || DEFAULT_CUSTOM_LINK_TEMPLATE).trim() || DEFAULT_CUSTOM_LINK_TEMPLATE;

  raw = raw
    .replace(/\{\{?host\}?\}/gi, () => shortServer)
    .replace(/\{\{?id\}?\}/gi, () => hoster.id)
    .replace(/\{\{?(?:label|texto)\}?\}/gi, () => trimmedLabel || shortServer);

  // If the user explicitly typed a custom row label and the template didn't use {label}/{texto},
  // update the anchor text inside [url=...]TEXT[/url] for that specific link.
  if (trimmedLabel && !/\{\{?(?:label|texto)\}?\}/i.test(template || '')) {
    raw = raw.replace(
      /(\[url=[^\]]+\])([\s\S]*?)(\[\/url\])/i,
      (_full, open: string, _inner: string, close: string) => `${open}${trimmedLabel}${close}`
    );
  }

  // Substitute link/url placeholder last so URL contents are never altered
  if (/\{\{?(?:link|url)\}?\}/i.test(raw)) {
    raw = raw.replace(/\{\{?(?:link|url)\}?\}/gi, () => cleanUrl);
  } else if (/\blink\b/i.test(raw)) {
    raw = raw.replace(/\blink\b/i, () => cleanUrl);
  } else {
    raw = raw.replace(/\[url=([^\]]*)\]/i, () => `[url=${cleanUrl}]`);
  }

  return raw;
}

export function buildHostersSummaryAndIdentiLinks(
  rows: Array<{ url: string; label?: string }>,
  customLinkTemplate: string = DEFAULT_CUSTOM_LINK_TEMPLATE
): {
  servidores: string;
  enlacesIdenti: string;
  enlacesSpoiler: string;
  enlacesDescarga: string;
} {
  const valid = rows.filter((r) => r.url.trim().length > 0);
  const hosterNames: string[] = [];
  const spoilerLines: string[] = [];
  const identiLines: string[] = [];
  const rawUrls: string[] = [];

  const activeTemplate =
    (customLinkTemplate || DEFAULT_CUSTOM_LINK_TEMPLATE).trim() ||
    DEFAULT_CUSTOM_LINK_TEMPLATE;
  const usesCenterSpoiler =
    /\[center\]/i.test(activeTemplate) && /\[spoiler/i.test(activeTemplate);

  for (const r of valid) {
    const cleanUrl = r.url.trim();
    const hoster = detectHosterFromUrl(cleanUrl);
    const shortServer = hoster.id === 'gdrive' ? 'Drive' : hoster.name;
    if (!hosterNames.includes(shortServer)) hosterNames.push(shortServer);

    const formattedCustom = formatCustomLinkLine(activeTemplate, cleanUrl, r.label);
    spoilerLines.push(formattedCustom);

    if (usesCenterSpoiler) {
      identiLines.push(formattedCustom);
    } else {
      const identiLabel = r.label?.trim()
        ? r.label.trim()
        : hoster.id === 'gdrive'
        ? 'GDrive'
        : shortServer;
      identiLines.push(`[center][spoiler][url=${cleanUrl}]${identiLabel}[/url][/spoiler][/center]`);
    }
    rawUrls.push(cleanUrl);
  }

  return {
    servidores: hosterNames.join(' | ') || 'Drive | MEGA',
    enlacesIdenti: identiLines.join('\n'),
    enlacesSpoiler: spoilerLines.join('\n'),
    enlacesDescarga: rawUrls.join('\n'),
  };
}

export function HosterSvgIcon({ hosterId, size = 16 }: { hosterId: string; size?: number }) {
  const hoster = HOSTER_CATALOG[hosterId] || HOSTER_CATALOG.direct;
  const stroke = hoster.accentVar;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={stroke}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ filter: `drop-shadow(0 0 5px ${stroke})`, flexShrink: 0 }}
    >
      {hoster.id === 'mega' && (
        <>
          <polygon points="12 2 21 7 21 17 12 22 3 17 3 7 12 2" />
          <polyline points="7.5 15 7.5 9 12 13 16.5 9 16.5 15" />
        </>
      )}
      {hoster.id === 'mediafire' && (
        <path d="M12 2C9.5 6 7 8.5 7 12.5a5 5 0 0 0 10 0c0-2.5-1.5-4.5-3-6.5-.5 2-2 3-2 3s.5-4 0-7z" />
      )}
      {hoster.id === 'terabox' && (
        <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
      )}
      {hoster.id === '1fichier' && (
        <>
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="12" y1="18" x2="12" y2="12" />
          <polyline points="9 15 12 18 15 15" />
        </>
      )}
      {hoster.id === 'gdrive' && (
        <>
          <polygon points="12 3 21 19 3 19 12 3" />
          <line x1="7.5" y1="13" x2="16.5" y2="13" />
        </>
      )}
      {hoster.id === 'pixeldrain' && (
        <path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z" />
      )}
      {hoster.id === 'krakenfiles' && (
        <>
          <circle cx="12" cy="10" r="5" />
          <path d="M8 15l-2 5" />
          <path d="M11 15l-1 6" />
          <path d="M13 15l1 6" />
          <path d="M16 15l2 5" />
        </>
      )}
      {hoster.id === 'gofile' && (
        <polyline points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
      )}
      {hoster.id === 'rapidgator' && (
        <>
          <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
          <path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
        </>
      )}
      {hoster.id === 'magnet' && (
        <path d="m6 15-4-4 6.75-6.77a7.79 7.79 0 0 1 11 11L13 22l-4-4 6.39-6.36a2.14 2.14 0 0 0-3-3L6 15" />
      )}
      {hoster.id === 'direct' && (
        <>
          <circle cx="12" cy="12" r="9" />
          <polyline points="8 12 12 16 16 12" />
          <line x1="12" y1="8" x2="12" y2="16" />
        </>
      )}
    </svg>
  );
}

export interface BbRenderOptions {
  site?: TemplateSite;
  context?: MediaContext;
}

/**
 * Applies site-specific structural and typographic rules ('zinfinal' vs 'identi')
 * before variable substitution.
 */
export function applySiteStructureToBbCode(
  rawBody: string,
  site: TemplateSite,
  context: MediaContext
): string {
  let body = rawBody || '';
  if (!body.trim()) return body;

  if (site === 'zinfinal') {
    // 1. Zinfinal Aensy Style: Logo centered at 350px above poster & trailer
    body = body.replace(
      /\[img\]\s*\{\{logo_url\}\}\s*\[\/img\]/gi,
      '[img size=350]{{logo_url}}[/img]'
    );
    if (
      body.includes('[img size=350]{{logo_url}}[/img]') &&
      !/\[center\]\s*\[img size=350\]\{\{logo_url\}\}\[\/img\]\s*\[\/center\]/i.test(body)
    ) {
      body = body.replace(
        /\[img size=350\]\{\{logo_url\}\}\[\/img\]/gi,
        '[center][img size=350]{{logo_url}}[/img][/center]'
      );
    }

    // 2. Map any Identi-only technical placeholders to Zinfinal equivalents
    body = body
      .replace(/\{\{video_info_identi\}\}/gi, '{{video_info_bloque}}')
      .replace(/\{\{subtitulos_identi\}\}/gi, '{{subtitulos_info}}')
      .replace(/\{\{audio_info_identi\}\}/gi, '{{audio_info_bloque}}')
      .replace(/\{\{enlaces_identi\}\}/gi, '{{enlaces_spoiler}}');

    // 3. Ensure Zinfinal's banner separator exists before Capturas if banner_url is populated
    if ((context.banner_url || '').trim() && !/\{\{banner_url\}\}/i.test(body)) {
      if (/\[center\][\s\S]*?Capturas/i.test(body)) {
        body = body.replace(
          /(\[center\][\s\S]*?Capturas)/i,
          '[img]{{banner_url}}[/img]\n\n$1'
        );
      }
    }

    // 4. Ensure Zinfinal's ClearArt footer appears after Descarga / before PASSWORD
    if ((context.clearart_url || '').trim() && !/\{\{clearart_url\}\}/i.test(body)) {
      if (/\[center\][\s\S]*?PASSWORD/i.test(body)) {
        body = body.replace(
          /(\[center\][\s\S]*?PASSWORD)/i,
          '[center][img]{{clearart_url}}[/img][/center]\n\n$1'
        );
      } else {
        body = `${body}\n\n[center][img]{{clearart_url}}[/img][/center]`;
      }
    }
  } else if (site === 'identi') {
    // 1. Identi: plain [img]{{logo_url}}[/img] without Zinfinal's size=350 wrapper
    body = body
      .replace(
        /\[center\]\s*\[img size=\d{2,4}\]\s*\{\{logo_url\}\}\s*\[\/img\]\s*\[\/center\]/gi,
        '[img]{{logo_url}}[/img]'
      )
      .replace(/\[img size=\d{2,4}\]\s*\{\{logo_url\}\}\s*\[\/img\]/gi, '[img]{{logo_url}}[/img]');

    // 2. Map Zinfinal placeholders to Identi equivalents
    body = body
      .replace(/\{\{video_info_bloque\}\}/gi, '{{video_info_identi}}')
      .replace(/\{\{subtitulos_info\}\}/gi, '{{subtitulos_identi}}')
      .replace(/\{\{audio_info_bloque\}\}/gi, '{{audio_info_identi}}')
      .replace(/\{\{enlaces_spoiler\}\}/gi, '{{enlaces_identi}}');

    // 3. Enforce Identi's font-size & #80ffea section scheme when adapted from Zinfinal tags
    body = body
      .replace(/\[size=24\]/gi, '[size=4]')
      .replace(/\[size=20\]/gi, '[size=4]')
      .replace(
        /\[size=22\]\[i\]\[b\]\[color=#3366ff\]Sinopsis\[\/color\]\[\/b\]\[\/i\]\[\/size\]/gi,
        '[b][size=5][color=#80ffea]Sinopsis[/color][/size][/b]'
      )
      .replace(
        /\[size=22\]\[i\]\[b\]\[color=#3366ff\](V[ií]deo|Subt[ií]tulos|Audio)\[\/color\]\[\/b\]\[\/i\]\[\/size\]/gi,
        '[b][size=25][color=#80ffea]$1[/color][/size][/b]'
      )
      .replace(
        /\[size=35\]\[i\]\[b\]\[color=#3366ff\]Capturas\[\/color\]\[\/b\]\[\/i\]\[\/size\]/gi,
        '[b][size=30][color=#80ffea]Capturas[/color][/size][/b]'
      );
  }

  return body;
}

export interface PasswordHeadingInfo {
  hasHeading: boolean;
  headingIsUppercase: boolean;
  hasVariableBelowHeading: boolean;
  hasVariableAnywhere: boolean;
}

const PASSWORD_HEADING_RX = /\b(password|contrase[ñn]a)\b/i;
const PASSWORD_VAR_RX = /\{\{\s*(?:password|contrase[ñn]a|pass)\s*\}\}/i;

export function detectPasswordHeadingInfo(rawBody: string): PasswordHeadingInfo {
  const lines = (rawBody || '').split('\n');
  const hasVariableAnywhere = PASSWORD_VAR_RX.test(rawBody || '');

  for (let i = 0; i < lines.length; i++) {
    const plain = lines[i]
      .replace(/\{\{[^}]*\}\}/g, ' ')
      .replace(/\[[^\]]*\]/g, ' ')
      .trim();
    const match = plain.match(PASSWORD_HEADING_RX);
    if (!match) continue;

    const word = match[1];
    const headingIsUppercase = word === word.toUpperCase() && /[A-ZÁÉÍÓÚÑ]/.test(word);

    // Inspect the next 2 non-empty lines directly below the heading
    let checked = 0;
    let hasVariableBelowHeading = false;
    for (let j = i + 1; j < lines.length && checked < 2; j++) {
      if (!lines[j].trim()) continue;
      checked++;
      if (PASSWORD_VAR_RX.test(lines[j])) {
        hasVariableBelowHeading = true;
        break;
      }
    }

    return {
      hasHeading: true,
      headingIsUppercase,
      hasVariableBelowHeading,
      hasVariableAnywhere,
    };
  }

  return {
    hasHeading: false,
    headingIsUppercase: false,
    hasVariableBelowHeading: false,
    hasVariableAnywhere,
  };
}

export function hasPasswordVariableInPost(rawBody: string): boolean {
  const info = detectPasswordHeadingInfo(rawBody);
  return info.hasVariableBelowHeading || info.hasVariableAnywhere;
}

export function ensurePasswordVariableBelowHeading(
  rawBody: string,
  site: TemplateSite = 'zinfinal'
): string {
  const body = rawBody || '';
  const lines = body.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const plain = lines[i]
      .replace(/\{\{[^}]*\}\}/g, ' ')
      .replace(/\[[^\]]*\]/g, ' ')
      .trim();
    const match = plain.match(PASSWORD_HEADING_RX);
    if (!match) continue;

    // Check next 2 non-empty lines directly below this "Password" / "Contraseña" heading
    let checked = 0;
    for (let j = i + 1; j < lines.length && checked < 2; j++) {
      if (!lines[j].trim()) continue;
      checked++;
      if (PASSWORD_VAR_RX.test(lines[j])) {
        return body;
      }
    }

    const word = match[1];
    const headingIsUppercase = word === word.toUpperCase() && /[A-ZÁÉÍÓÚÑ]/.test(word);
    const varToken = headingIsUppercase ? '{{PASSWORD}}' : '{{password}}';
    const isCentered = /\[center\]/i.test(lines[i]);
    const insertedLine = isCentered ? `[center]${varToken}[/center]` : varToken;

    const updated = [...lines];
    updated.splice(i + 1, 0, '', insertedLine);
    return updated.join('\n');
  }

  // If no Password / Contraseña heading exists anywhere, insert standard block before final signature or at end
  const sizeTag = site === 'identi' ? '5' : '22';
  const block = `[center][size=${sizeTag}][i][b][color=#3366ff]PASSWORD[/color][/b][/i][/size][/center]\n\n[center]{{PASSWORD}}[/center]`;
  const footerRx = /(\n*\[center\][\s\S]*Si te gust[óo] mi contenido[\s\S]*$)/i;
  if (footerRx.test(body)) {
    return body.replace(footerRx, `\n\n${block}$1`);
  }
  return body.trim() ? `${body.trimEnd()}\n\n${block}` : block;
}

export function compileTemplateText(raw: string, context: MediaContext): string {
  let out = raw || '';
  const mergedContext: Record<string, string> = { ...context };

  // Compatibilidad bidireccional entre variables de automatización / proveedores y variables del post
  const aliases: Record<string, string> = {
    title: context.titulo || '',
    nombre: context.titulo || '',
    year: context.anio || '',
    año: context.anio || '',
    overview: context.sinopsis || '',
    plot: context.sinopsis || '',
    descripcion: context.sinopsis || '',
    resumen: context.sinopsis || '',
    genres: context.generos || '',
    genero: context.generos || '',
    rating: context.tmdb_rating || context.imdb_rating || '',
    puntuacion: context.tmdb_rating || context.imdb_rating || '',
    calificacion: context.tmdb_rating || context.imdb_rating || '',
    nota: context.tmdb_rating || context.imdb_rating || '',
    portada: context.poster_url || '',
    poster: context.poster_url || '',
    cover: context.poster_url || '',
    cover_url: context.poster_url || '',
    banner: context.banner_url || '',
    logo: context.logo_url || '',
    clearart: context.clearart_url || '',
    fondo: context.background_url || '',
    background: context.background_url || '',
    backdrop: context.background_url || '',
    trailer: context.trailer_url || '',
    capturas: context.capturas_bbcode || '',
    espectrograma: context.espectrograma_bbcode || '',
    mediainfo: context.mediainfo_completo || '',
    contraseña: context.password || '',
    contrasena: context.password || '',
    pass: context.password || '',
  };

  for (const [aliasKey, aliasVal] of Object.entries(aliases)) {
    if (!mergedContext[aliasKey] && aliasVal) {
      mergedContext[aliasKey] = aliasVal;
    }
  }

  for (const [k, v] of Object.entries(mergedContext)) {
    const escapedKey = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rx = new RegExp(`\\{\\{${escapedKey}\\}\\}`, 'gi');
    out = out.replace(rx, () => v ?? '');
  }
  return out;
}

export function toCleanBbCode(compiledWithMarkers: string): string {
  return compiledWithMarkers.replace(/\[hosticon=([a-z0-9_-]+)\]\s*/gi, (_, hostId) => {
    const h = HOSTER_CATALOG[hostId.toLowerCase()] || HOSTER_CATALOG.direct;
    return `[b][${h.name.toUpperCase()}][/b] `;
  });
}

function isSafeHref(url: string): boolean {
  const lower = url.trim().toLowerCase();
  return lower.startsWith('http://') || lower.startsWith('https://') || lower.startsWith('magnet:?');
}

function isSafeImageSrc(src: string): boolean {
  const lower = src.trim().toLowerCase();
  return (
    lower.startsWith('https://') ||
    lower.startsWith('http://') ||
    lower.startsWith('data:image/') ||
    lower.startsWith('blob:')
  );
}

function resolveBbSizePx(rawSize: number, site: TemplateSite = 'custom'): number {
  if (site === 'identi') {
    const identiForumScale: Record<number, number> = {
      1: 10,
      2: 12,
      3: 14,
      4: 18,
      5: 22,
      6: 27,
      7: 34,
    };
    if (rawSize >= 1 && rawSize <= 7) {
      return identiForumScale[rawSize];
    }
    return Math.max(11, Math.min(44, rawSize || 14));
  }

  if (site === 'zinfinal') {
    const zinfinalFallbackScale: Record<number, number> = {
      1: 11,
      2: 13,
      3: 15,
      4: 18,
      5: 22,
      6: 28,
      7: 35,
    };
    if (rawSize >= 1 && rawSize <= 7) {
      return zinfinalFallbackScale[rawSize];
    }
    return Math.max(12, Math.min(48, rawSize || 14));
  }

  const forumScale: Record<number, number> = {
    1: 10,
    2: 12,
    3: 14,
    4: 17,
    5: 21,
    6: 26,
    7: 32,
  };
  if (rawSize >= 1 && rawSize <= 7) {
    return forumScale[rawSize];
  }
  return Math.max(10, Math.min(48, rawSize || 14));
}

interface MatchedPairedTag {
  tag: string;
  attr: string;
  inner: string;
  endIndex: number;
  hostIconId?: string;
}

function findMatchingClosingTag(
  input: string,
  tagName: string,
  searchFrom: number,
  literalOnly: boolean
): { innerEnd: number; afterClose: number } | null {
  const closePattern = `[/${tagName}]`;
  let pos = searchFrom;
  let depth = 1;

  while (pos < input.length) {
    const nextBracket = input.indexOf('[', pos);
    if (nextBracket === -1) return null;

    if (!literalOnly) {
      const sliceLower = input.slice(nextBracket).toLowerCase();
      // Skip inner literal containers so "[/center]" inside [code] doesn't close outer [center]
      if (sliceLower.startsWith('[code]')) {
        const endCode = sliceLower.indexOf('[/code]', 6);
        pos = endCode === -1 ? input.length : nextBracket + endCode + 7;
        continue;
      }
      if (sliceLower.startsWith('[jd]')) {
        const endJd = sliceLower.indexOf('[/jd]', 4);
        pos = endJd === -1 ? input.length : nextBracket + endJd + 5;
        continue;
      }
    }

    const closeIdx = input.indexOf(']', nextBracket + 1);
    if (closeIdx === -1) return null;

    const rawInside = input.slice(nextBracket + 1, closeIdx);
    const lowerInside = rawInside.trim().toLowerCase();

    if (lowerInside === `/${tagName}`) {
      depth -= 1;
      if (depth === 0) {
        return { innerEnd: nextBracket, afterClose: closeIdx + 1 };
      }
      pos = closeIdx + 1;
      continue;
    }

    if (!literalOnly && (lowerInside === tagName || lowerInside.startsWith(`${tagName}=`) || lowerInside.startsWith(`${tagName} `))) {
      // Only increment nesting depth on valid opening tags of the same tagName
      if (
        lowerInside === tagName ||
        (tagName === 'spoiler' && lowerInside.startsWith('spoiler=')) ||
        (tagName === 'color' && lowerInside.startsWith('color=')) ||
        (tagName === 'size' && lowerInside.startsWith('size=')) ||
        (tagName === 'url' && lowerInside.startsWith('url=')) ||
        (tagName === 'img' && (lowerInside.startsWith('img=') || /^img\s+(?:size|width)=/.test(lowerInside)))
      ) {
        depth += 1;
      }
    }

    // Also advance past exact close match length if rawInside had trailing spaces
    if (input.slice(nextBracket, closeIdx + 1).toLowerCase() === closePattern) {
      depth -= 1;
      if (depth === 0) {
        return { innerEnd: nextBracket, afterClose: closeIdx + 1 };
      }
    }

    pos = closeIdx + 1;
  }

  return null;
}

function tryParseTagAt(input: string, index: number): MatchedPairedTag | { hr: true; endIndex: number } | null {
  if (input[index] !== '[') return null;

  // Check [hosticon=...]\s*[url=...]...[/url]
  const hostUrlMatch = /^\[hosticon=([a-z0-9_-]+)\]\s*\[url=([^\]]+)\]/i.exec(input.slice(index));
  if (hostUrlMatch) {
    const contentStart = index + hostUrlMatch[0].length;
    const closed = findMatchingClosingTag(input, 'url', contentStart, false);
    if (closed) {
      return {
        tag: 'hosturl',
        hostIconId: hostUrlMatch[1],
        attr: hostUrlMatch[2],
        inner: input.slice(contentStart, closed.innerEnd),
        endIndex: closed.afterClose,
      };
    }
  }

  const closeBracket = input.indexOf(']', index + 1);
  if (closeBracket === -1) return null;

  const inside = input.slice(index + 1, closeBracket);
  if (inside.toLowerCase() === 'hr') {
    return { hr: true, endIndex: closeBracket + 1 };
  }

  let tag = '';
  let attr = '';
  const lowerInside = inside.toLowerCase();

  if (/^(code|jd|youtube|center|left|right|quote|list|b|i|u|s|spoiler|img)$/.test(lowerInside)) {
    tag = lowerInside;
  } else {
    const spoilerMatch = /^spoiler=([^\]]+)$/i.exec(inside);
    const colorMatch = /^color=(#[0-9a-fA-F]{3,8}|[a-zA-Z]+)$/i.exec(inside);
    const sizeMatch = /^size=(\d{1,2})$/i.exec(inside);
    const imgMatch = /^img(?:(?:\s+(?:size|width)=|=)(\d{2,4})(?:x\d{2,4})?)$/i.exec(inside);
    const urlMatch = /^url=([^\]]+)$/i.exec(inside);

    if (spoilerMatch) {
      tag = 'spoiler';
      attr = spoilerMatch[1];
    } else if (colorMatch) {
      tag = 'color';
      attr = colorMatch[1];
    } else if (sizeMatch) {
      tag = 'size';
      attr = sizeMatch[1];
    } else if (imgMatch) {
      tag = 'img';
      attr = imgMatch[1];
    } else if (urlMatch) {
      tag = 'url';
      attr = urlMatch[1];
    }
  }

  if (!tag) return null;

  const isLiteral = tag === 'code' || tag === 'jd';
  const closed = findMatchingClosingTag(input, tag, closeBracket + 1, isLiteral);
  if (!closed) return null;

  const inner = input.slice(closeBracket + 1, closed.innerEnd);
  if (tag === 'img' && inner.includes('[')) {
    return null;
  }

  return {
    tag,
    attr,
    inner,
    endIndex: closed.afterClose,
  };
}

/**
 * Safe recursive BBCode-to-React renderer (prevents XSS / innerHTML injection).
 */
export function renderBbCodeNodes(
  input: string,
  keyPrefix = 'bb',
  options?: BbRenderOptions
): React.ReactNode {
  if (!input) return null;

  const site: TemplateSite = options?.site || 'custom';
  const ctx = options?.context;
  const nodes: React.ReactNode[] = [];
  let cursor = 0;
  let plainStart = 0;
  let counter = 0;

  while (cursor < input.length) {
    if (input[cursor] !== '[') {
      const nextBracket = input.indexOf('[', cursor);
      if (nextBracket === -1) {
        cursor = input.length;
        break;
      }
      cursor = nextBracket;
      continue;
    }

    const parsed = tryParseTagAt(input, cursor);
    if (!parsed) {
      cursor += 1;
      continue;
    }

    if (cursor > plainStart) {
      nodes.push(renderPlainTextWithBreaks(input.slice(plainStart, cursor), `${keyPrefix}-t-${counter++}`));
    }

    const k = `${keyPrefix}-n-${counter++}`;

    if ('hr' in parsed) {
      nodes.push(<hr key={k} className="border-t border-cyberBorder/80 my-3" />);
      cursor = parsed.endIndex;
      plainStart = cursor;
      continue;
    }

    if (parsed.tag === 'code') {
      nodes.push(
        <pre
          key={k}
          className="bg-void border border-cyberBorder rounded-xl p-3 font-mono text-[11px] text-cyberGreen overflow-x-auto text-left my-2 whitespace-pre-wrap"
        >
          {parsed.inner}
        </pre>
      );
    } else if (parsed.tag === 'spoiler') {
      const title = parsed.attr || 'Ver Contenido Oculto';
      nodes.push(
        <details key={k} open className="bg-panel/90 border border-cyberBorder rounded-xl p-3 my-2.5 text-left">
          <summary className="cursor-pointer font-bold text-cyberCyan text-xs select-none">
            👁 {title}
          </summary>
          <div className="mt-2 pt-2 border-t border-cyberBorder/60">
            {renderBbCodeNodes(parsed.inner, `${k}-sp`, options)}
          </div>
        </details>
      );
    } else if (parsed.tag === 'jd') {
      nodes.push(
        <div key={k} className="bg-elevated border border-cyberCyan/50 rounded-xl p-3 my-2.5 text-left shadow-md">
          <div className="text-[11px] font-mono font-extrabold text-cyberCyan uppercase mb-1">
            🌐 Contenedor JDownloader / Click&apos;n&apos;Load
          </div>
          <div className="font-mono text-[11px] text-slate-200 break-all whitespace-pre-wrap">
            {parsed.inner.trim()}
          </div>
        </div>
      );
    } else if (parsed.tag === 'youtube') {
      const rawYt = parsed.inner.trim();
      if (rawYt) {
        const vidMatch = rawYt.match(
          /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)?([a-zA-Z0-9_-]{11})/
        );
        const vid = vidMatch ? vidMatch[1] : '';
        const watchUrl = vid ? `https://youtu.be/${vid}` : isSafeHref(rawYt) ? rawYt : '';
        nodes.push(
          <div key={k} className="my-2.5 max-w-md mx-auto rounded-xl overflow-hidden border border-cyberBorder bg-void shadow-lg">
            <div className="aspect-video relative flex flex-col items-center justify-center bg-gradient-to-br from-panel to-void overflow-hidden">
              {vid && (
                <img
                  src={`https://i.ytimg.com/vi/${vid}/hqdefault.jpg`}
                  alt={`YouTube trailer ${vid}`}
                  referrerPolicy="no-referrer"
                  className="absolute inset-0 w-full h-full object-cover opacity-80"
                />
              )}
              <div className="relative z-10 flex flex-col items-center justify-center p-4 bg-black/45 rounded-xl backdrop-blur-[2px]">
                <a
                  href={watchUrl || '#'}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-12 h-12 rounded-full bg-red-600 hover:bg-red-500 text-white flex items-center justify-center text-lg shadow-lg mb-1.5 transition-transform hover:scale-105"
                >
                  ▶
                </a>
                <div className="font-mono text-[11px] text-slate-200">
                  YouTube · <span className="text-cyberCyan font-bold">{vid || rawYt}</span>
                </div>
              </div>
            </div>
          </div>
        );
      }
    } else if (parsed.tag === 'center') {
      nodes.push(<div key={k} className="text-center">{renderBbCodeNodes(parsed.inner, `${k}-c`, options)}</div>);
    } else if (parsed.tag === 'left') {
      nodes.push(<div key={k} className="text-left">{renderBbCodeNodes(parsed.inner, `${k}-l`, options)}</div>);
    } else if (parsed.tag === 'right') {
      nodes.push(<div key={k} className="text-right">{renderBbCodeNodes(parsed.inner, `${k}-r`, options)}</div>);
    } else if (parsed.tag === 'quote') {
      nodes.push(
        <blockquote key={k} className="bg-panel/80 border border-cyberCyan/35 rounded-xl px-3.5 py-2.5 my-2 text-left text-slate-300">
          {renderBbCodeNodes(parsed.inner, `${k}-q`, options)}
        </blockquote>
      );
    } else if (parsed.tag === 'list') {
      const items = parsed.inner.split(/\[\*\]/i).map((s) => s.trim()).filter(Boolean);
      nodes.push(
        <ul key={k} className="list-disc pl-6 my-2 text-left space-y-1">
          {items.map((it, idx) => (
            <li key={`${k}-li-${idx}`}>{renderBbCodeNodes(it, `${k}-li-${idx}`, options)}</li>
          ))}
        </ul>
      );
    } else if (parsed.tag === 'b') {
      nodes.push(<strong key={k} className="font-bold text-white">{renderBbCodeNodes(parsed.inner, `${k}-b`, options)}</strong>);
    } else if (parsed.tag === 'i') {
      nodes.push(<em key={k} className="italic">{renderBbCodeNodes(parsed.inner, `${k}-i`, options)}</em>);
    } else if (parsed.tag === 'u') {
      nodes.push(<u key={k} className="underline">{renderBbCodeNodes(parsed.inner, `${k}-u`, options)}</u>);
    } else if (parsed.tag === 's') {
      nodes.push(<s key={k} className="line-through opacity-80">{renderBbCodeNodes(parsed.inner, `${k}-s`, options)}</s>);
    } else if (parsed.tag === 'color') {
      nodes.push(<span key={k} style={{ color: parsed.attr }}>{renderBbCodeNodes(parsed.inner, `${k}-col`, options)}</span>);
    } else if (parsed.tag === 'size') {
      const px = resolveBbSizePx(Number(parsed.attr) || 14, site);
      nodes.push(<span key={k} style={{ fontSize: `${px}px`, lineHeight: 1.25 }}>{renderBbCodeNodes(parsed.inner, `${k}-sz`, options)}</span>);
    } else if (parsed.tag === 'img') {
      const imgSize = parsed.attr ? Math.min(1200, Math.max(40, Number(parsed.attr))) : undefined;
      const src = parsed.inner.trim();
      if (src && isSafeImageSrc(src)) {
        const isLogo = imgSize === 350 || Boolean(ctx?.logo_url && src === ctx.logo_url.trim());
        const isPoster = Boolean(ctx?.poster_url && src === ctx.poster_url.trim());
        const isBanner = Boolean(ctx?.banner_url && src === ctx.banner_url.trim());
        const isClearArt = Boolean(ctx?.clearart_url && src === ctx.clearart_url.trim());

        let imgClass = 'inline-block max-w-full rounded-lg border border-cyberBorder shadow-md my-1';
        let imgStyle: React.CSSProperties | undefined = imgSize
          ? { width: `${imgSize}px`, maxWidth: '100%' }
          : undefined;

        if (site === 'zinfinal') {
          if (isLogo) {
            imgClass = 'block mx-auto max-w-full object-contain my-2 drop-shadow-[0_4px_14px_rgba(0,0,0,0.65)]';
            imgStyle = { width: `${imgSize || 350}px`, maxWidth: '100%' };
          } else if (isPoster) {
            imgClass =
              'block mx-auto max-w-[320px] max-h-[480px] object-contain rounded-xl border border-[#3366ff]/50 shadow-[0_8px_28px_rgba(51,102,255,0.22)] my-2.5';
          } else if (isBanner) {
            imgClass =
              'block mx-auto w-full max-w-[760px] rounded-lg border border-[#3366ff]/40 shadow-md my-3 object-cover';
          } else if (isClearArt) {
            imgClass =
              'block mx-auto max-w-[500px] w-auto object-contain my-3 drop-shadow-[0_6px_18px_rgba(0,240,255,0.2)]';
          }
        } else if (site === 'identi') {
          if (isBanner) {
            imgClass =
              'block mx-auto w-full max-w-[720px] rounded-md border border-[#80ffea]/35 my-2.5 object-cover';
          } else if (isLogo) {
            imgClass = 'block mx-auto max-w-[420px] object-contain my-2';
          } else if (isPoster) {
            imgClass =
              'block mx-auto max-w-[320px] max-h-[460px] object-contain rounded-lg border border-[#80ffea]/40 shadow-md my-2';
          } else if (isClearArt) {
            imgClass = 'block mx-auto max-w-[480px] w-auto object-contain my-2.5';
          }
        }

        nodes.push(
          <img
            key={k}
            src={src}
            alt={
              isLogo
                ? 'Logo HD'
                : isPoster
                ? 'Poster'
                : isBanner
                ? 'Banner separador'
                : isClearArt
                ? 'ClearArt'
                : 'Post media asset'
            }
            referrerPolicy="no-referrer"
            style={imgStyle}
            className={imgClass}
          />
        );
      }
    } else if (parsed.tag === 'hosturl') {
      const hostId = (parsed.hostIconId || 'direct').toLowerCase();
      const href = parsed.attr.trim();
      const label = parsed.inner;
      const hoster = HOSTER_CATALOG[hostId] || detectHosterFromUrl(href);
      if (isSafeHref(href)) {
        nodes.push(
          <a
            key={k}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            style={{ borderColor: `color-mix(in srgb, ${hoster.accentVar} 55%, var(--border-color))` }}
            className="group flex items-center justify-between gap-3 bg-void/95 hover:bg-elevated border rounded-xl px-3 py-2 my-1.5 text-left transition-all shadow-sm"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <div
                style={{
                  borderColor: hoster.accentVar,
                  background: `color-mix(in srgb, ${hoster.accentVar} 12%, var(--bg-panel))`,
                }}
                className="w-7 h-7 rounded-lg border flex items-center justify-center shrink-0"
              >
                <HosterSvgIcon hosterId={hoster.id} size={16} />
              </div>
              <div className="min-w-0">
                <div className="font-bold text-xs text-white group-hover:text-cyberCyan truncate">
                  {renderBbCodeNodes(label, `${k}-hl`, options)}
                </div>
                <div className="font-mono text-[10px] text-slate-400 truncate">{href}</div>
              </div>
            </div>
            <span
              style={{
                color: hoster.accentVar,
                borderColor: `color-mix(in srgb, ${hoster.accentVar} 45%, transparent)`,
              }}
              className="px-2 py-0.5 rounded bg-panel border font-mono text-[10px] font-bold uppercase shrink-0"
            >
              {hoster.name} ↗
            </span>
          </a>
        );
      }
    } else if (parsed.tag === 'url') {
      const href = parsed.attr.trim();
      if (isSafeHref(href)) {
        nodes.push(
          <a
            key={k}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-cyberCyan hover:underline font-medium inline-block"
          >
            {renderBbCodeNodes(parsed.inner, `${k}-ul`, options)}
          </a>
        );
      } else {
        nodes.push(
          <React.Fragment key={k}>
            {renderBbCodeNodes(parsed.inner, `${k}-ul`, options)}
          </React.Fragment>
        );
      }
    }

    cursor = parsed.endIndex;
    plainStart = cursor;
  }

  if (plainStart < input.length) {
    nodes.push(renderPlainTextWithBreaks(input.slice(plainStart), `${keyPrefix}-tail`));
  }

  return nodes;
}

function renderPlainTextWithBreaks(text: string, keyPrefix: string): React.ReactNode {
  const parts = text.split(/\r?\n/);
  return parts.map((part, idx) => (
    <React.Fragment key={`${keyPrefix}-${idx}`}>
      {part}
      {idx < parts.length - 1 && <br />}
    </React.Fragment>
  ));
}

export function computePostTemplateChecksum(authorship: any, template: any): string {
  const raw = JSON.stringify({
    authorship,
    template: {
      name: template?.name,
      site: template?.site,
      category: template?.category,
      titlePattern: template?.titlePattern,
      bodyPattern: template?.bodyPattern,
    },
    salt: 'POSTPRO_STUDIO_DIGITAL_SIGNATURE_SALT_2026',
  });
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    const char = raw.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return 'ps_sig_' + Math.abs(hash).toString(16) + '_' + raw.length.toString(16) + '_sec';
}

export function validateAndParsePostTemplateFile(text: string): {
  ok: boolean;
  template?: BbTemplate;
  authorship?: { name: string; author: string; version: string; description: string };
  error?: string;
} {
  try {
    if (!text || text.length > 3_000_000) {
      return { ok: false, error: 'El archivo excede el tamaño máximo permitido (3 MB) o está vacío.' };
    }
    const data = JSON.parse(text);
    if (!data || typeof data !== 'object') {
      return { ok: false, error: 'Estructura JSON inválida en el archivo .Post.' };
    }
    if (data.magicHeader !== 'POSTPRO_STUDIO_POST_TEMPLATE_V1' && data.format !== 'postpro-studio-template') {
      return { ok: false, error: 'Archivo .Post no reconocido o carece de la firma oficial de seguridad de PostPro Studio.' };
    }

    const checksum = data.checksum;
    if (!checksum || typeof checksum !== 'string') {
      return { ok: false, error: 'El archivo .Post carece de la firma digital o campo checksum requerido.' };
    }

    const expectedChecksum = computePostTemplateChecksum(data.authorship, data.template);
    if (checksum !== expectedChecksum) {
      return {
        ok: false,
        error: 'Fallo de verificación de firma digital: El checksum del archivo .Post no coincide. El archivo pudo haber sido manipulado o corrompido.',
      };
    }

    const tpl = data.template;
    if (!tpl || typeof tpl !== 'object' || !tpl.titlePattern || !tpl.bodyPattern) {
      return { ok: false, error: 'El archivo .Post no contiene una estructura de plantilla BBCode válida.' };
    }

    const titleStr = String(tpl.titlePattern);
    const bodyStr = String(tpl.bodyPattern);
    const combined = (titleStr + '\n' + bodyStr).toLowerCase();

    const dangerousPatterns = [
      '<script',
      'javascript:',
      'onload=',
      'onerror=',
      'eval(',
      'document.cookie',
      '<iframe',
      '<object',
      '<embed',
      'vbscript:',
      'expression(',
    ];

    for (const pat of dangerousPatterns) {
      if (combined.includes(pat)) {
        return {
          ok: false,
          error: `Rechazado por filtros de seguridad avanzados: se detectó contenido potencialmente malicioso o no permitido (${pat}).`,
        };
      }
    }

    const importedTpl: BbTemplate = {
      id: String(tpl.id || `tpl-imported-${Date.now()}`),
      name: String(tpl.name || data.authorship?.name || 'Plantilla Importada .Post'),
      site: ['zinfinal', 'identi', 'custom'].includes(tpl.site) ? tpl.site : 'custom',
      category: ['video', 'music', 'anime', 'general'].includes(tpl.category) ? tpl.category : 'video',
      titlePattern: titleStr,
      bodyPattern: bodyStr,
    };

    return {
      ok: true,
      template: importedTpl,
      authorship: data.authorship,
    };
  } catch (err: any) {
    return { ok: false, error: `Error de análisis del archivo .Post: ${err?.message || 'Formato JSON corrupto'}` };
  }
}

export function computeThemeChecksum(theme: any): string {
  const raw = JSON.stringify({
    name: theme?.name,
    vars: theme?.vars,
    fontFamily: theme?.fontFamily,
    soundPack: theme?.soundPack,
    salt: 'POSTPRO_STUDIO_THEME_SIGNATURE_SALT_2026',
  });
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    const char = raw.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return 'th_sig_' + Math.abs(hash).toString(16) + '_' + raw.length.toString(16);
}

export function validateAndParseThemeFile(text: string): {
  ok: boolean;
  theme?: ThemePlugin;
  error?: string;
} {
  try {
    if (!text || text.length > 2_000_000) {
      return { ok: false, error: 'El archivo excede el tamaño máximo permitido (2 MB) o está vacío.' };
    }
    const data = JSON.parse(text);
    if (!data || typeof data !== 'object') {
      return { ok: false, error: 'Estructura JSON inválida en el archivo .Themes.' };
    }
    if (data.magicHeader !== 'POSTPRO_STUDIO_THEME_FILE_V1' && data.format !== 'postpro-studio-theme') {
      return { ok: false, error: 'Archivo .Themes no reconocido o carece de la firma oficial de seguridad de PostPro Studio.' };
    }

    const themeObj = data.theme || data;
    if (!themeObj.name || !themeObj.vars || typeof themeObj.vars !== 'object') {
      return { ok: false, error: 'El archivo .Themes no contiene un nombre o variables de color (vars) válidos.' };
    }

    const serialized = JSON.stringify(themeObj).toLowerCase();
    const dangerousPatterns = [
      '<script',
      'javascript:',
      'onload=',
      'onerror=',
      'eval(',
      'document.cookie',
      '<iframe',
      '<object',
      '<embed',
    ];
    for (const pat of dangerousPatterns) {
      if (serialized.includes(pat)) {
        return { ok: false, error: `Rechazado por filtros de seguridad avanzados: se detectó contenido malicioso (${pat}).` };
      }
    }

    const checksum = data.checksum;
    const expectedChecksum = computeThemeChecksum(themeObj);
    if (!checksum || checksum !== expectedChecksum) {
      return { ok: false, error: 'Fallo de verificación de firma digital: El checksum del archivo .Themes no coincide o ha sido alterado.' };
    }

    const parsedTheme: ThemePlugin = {
      id: String(themeObj.id || `theme-custom-${Date.now()}`),
      name: String(themeObj.name),
      author: String(themeObj.author || data.authorship?.author || 'Custom Uploader'),
      desc: String(themeObj.description || themeObj.desc || 'Tema personalizado importado con seguridad.'),
      vars: themeObj.vars,
      fontFamily: themeObj.fontFamily,
      soundPack: themeObj.soundPack,
      customBackgroundUrl: themeObj.customBackgroundUrl,
    };

    return { ok: true, theme: parsedTheme };
  } catch (err: any) {
    return { ok: false, error: `Error de análisis del archivo .Themes: ${err?.message || 'JSON corrupto'}` };
  }
}


