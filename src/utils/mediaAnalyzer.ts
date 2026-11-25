import type {
  MediaContext,
  MediaInfoAudioTrack,
  MediaInfoDetails,
  MediaInfoSubtitleTrack,
  MediaInfoVideoTrack,
} from '../types';
import { makeSvgAsset } from '../data/defaults';
import { formatBytes } from './filePicker';
import { buildCapturesBbCode, compressionPercentToQuality } from './imageAnalyzer';

export interface AnalyzedDropResult {
  kind: 'video' | 'audio' | 'image' | 'text' | 'unknown';
  suggestedTemplateId?: string;
  updates: Partial<MediaContext>;
  mediainfoDetails: MediaInfoDetails;
  summary: string;
  capturedDataUrls: string[];
  embeddedFieldCount: number;
}

function formatDurationSeconds(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return '';
  const total = Math.round(sec);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${m.toString().padStart(2, '0')}m`;
  return `${m}m ${s.toString().padStart(2, '0')}s`;
}

function formatBitrateKbps(kbps?: number): string {
  if (!kbps || !Number.isFinite(kbps) || kbps <= 0) return 'N/D';
  return `${Math.round(kbps).toLocaleString('es-ES')} kb/s`;
}

function formatFpsValue(fps?: number): string {
  if (!fps || !Number.isFinite(fps) || fps <= 0 || fps > 240) return '';
  if (Math.abs(fps - 23.976) < 0.02) return '23.976 fps';
  if (Math.abs(fps - 29.97) < 0.02) return '29.970 fps';
  if (Math.abs(fps - 59.94) < 0.02) return '59.940 fps';
  return `${fps.toFixed(3)} fps`;
}

function computeAspectRatio(width?: number, height?: number): string {
  if (!width || !height || width <= 0 || height <= 0) return '';
  const ratio = width / height;
  if (Math.abs(ratio - 16 / 9) < 0.03) return '16:9';
  if (Math.abs(ratio - 4 / 3) < 0.03) return '4:3';
  if (Math.abs(ratio - 21 / 9) < 0.05) return '21:9';
  if (Math.abs(ratio - 2.39) < 0.04) return '2.39:1';
  if (Math.abs(ratio - 1.85) < 0.03) return '1.85:1';
  return `${ratio.toFixed(2)}:1`;
}

function formatChannelLayout(channels?: number): string {
  if (!channels || channels <= 0) return '';
  if (channels === 1) return '1.0 Mono';
  if (channels === 2) return '2.0 Stereo';
  if (channels === 6) return '5.1 Surround';
  if (channels === 8) return '7.1 Surround';
  return `${channels} canales`;
}

function normalizeCodecName(raw: string): string {
  const c = raw.trim();
  const upper = c.toUpperCase();
  if (upper.includes('HEVC') || upper === 'HVC1' || upper === 'HEV1') return 'HEVC (H.265)';
  if (upper.includes('AVC') || upper === 'AVC1' || upper === 'H264') return 'AVC (H.264)';
  if (upper === 'AV01' || upper === 'AV1') return 'AV1';
  if (upper === 'VP09' || upper === 'VP9') return 'VP9';
  if (upper === 'VP08' || upper === 'VP8') return 'VP8';
  if (upper === 'EAC3' || upper === 'EC-3') return 'E-AC-3 (DD+)';
  if (upper === 'AC3' || upper === 'AC-3') return 'AC-3 (Dolby Digital)';
  if (upper.includes('TRUEHD')) return 'Dolby TrueHD';
  if (upper.includes('DTS')) return 'DTS';
  if (upper === 'MP4A' || upper === 'AAC') return 'AAC';
  if (upper === 'ALAC') return 'ALAC';
  if (upper === 'FLAC') return 'FLAC';
  if (upper === 'OPUS') return 'Opus';
  if (upper === 'VORBIS') return 'Vorbis';
  return c.replace(/^V_/, '').replace(/^A_/, '').replace('MPEGH/ISO/', '').replace('MPEG4/ISO/', '');
}

function formatSpanishLanguageLabel(rawLang?: string): string {
  const code = (rawLang || '').trim().toUpperCase();
  if (!code || code === 'UND') return 'Desconocido';
  const map: Record<string, string> = {
    SPA: 'Spanish - Español',
    ESP: 'Spanish - Español',
    ES: 'Spanish - Español',
    LAT: 'Spanish - Español Latino',
    ENG: 'English - Inglés',
    EN: 'English - Inglés',
    JPN: 'Japanese - Japonés',
    JA: 'Japanese - Japonés',
    JP: 'Japanese - Japonés',
    FRE: 'French - Francés',
    FRA: 'French - Francés',
    FR: 'French - Francés',
    GER: 'German - Alemán',
    DEU: 'German - Alemán',
    DE: 'German - Alemán',
    ITA: 'Italian - Italiano',
    IT: 'Italian - Italiano',
    POR: 'Portuguese - Portugués',
    PT: 'Portuguese - Portugués',
    KOR: 'Korean - Coreano',
    KO: 'Korean - Coreano',
    CHI: 'Chinese - Chino',
    ZHO: 'Chinese - Chino',
    ZH: 'Chinese - Chino',
    RUS: 'Russian - Ruso',
    RU: 'Russian - Ruso',
    ARA: 'Arabic - Árabe',
    AR: 'Arabic - Árabe',
  };
  return map[code] || code;
}

export function parseReleaseFilename(filename: string): {
  title: string;
  year: string;
  resolution: string;
  codec: string;
  audio: string;
  source: string;
  credits: string;
  episode: string;
  artist: string;
  album: string;
  isAnimeOrSeries: boolean;
} {
  const base = filename.replace(/\.[^.]+$/, '');
  const yearMatch = base.match(/(?:^|[.\s(_-])((?:19|20)\d{2})(?:$|[.\s)_-])/);
  const year = yearMatch ? yearMatch[1] : '';

  const epMatch = base.match(/\b(S\d{1,2}E\d{1,3}(?:-\d{1,3})?|E\d{2,3}|Ep\.?\s?\d{2,3}|\d{1,2}x\d{2})\b/i);
  const episode = epMatch ? epMatch[1].toUpperCase() : '';

  let resolution = '';
  if (/2160p|4k|uhd/i.test(base)) resolution = '2160p';
  else if (/1080p|fhd/i.test(base)) resolution = '1080p';
  else if (/720p/i.test(base)) resolution = '720p';
  else if (/480p/i.test(base)) resolution = '480p';

  let source = '';
  if (/bdremux|remux/i.test(base)) source = 'BDRemux';
  else if (/bdrip/i.test(base)) source = 'BDRip';
  else if (/blu-?ray/i.test(base)) source = 'BluRay';
  else if (/web-?dl/i.test(base)) source = 'Web-dl';
  else if (/webrip/i.test(base)) source = 'WEBRip';
  else if (/hdtv/i.test(base)) source = 'HDTV';
  else if (/dvdrip/i.test(base)) source = 'DVDRip';

  let credits = '';
  const bracketGroup = base.match(/^\[([^\]]{2,24})\]/);
  const dashGroup = base.match(/-([A-Za-z0-9]{2,20})(?:\[.*\])?$/);
  if (bracketGroup) credits = bracketGroup[1].trim();
  else if (dashGroup && !/^\d+$/.test(dashGroup[1])) credits = dashGroup[1].trim();

  let codec = '';
  if (/x265|h\.?265|hevc/i.test(base)) codec = /10bit|main10|hdr/i.test(base) ? 'HEVC 10-bit' : 'HEVC';
  else if (/x264|h\.?264|avc/i.test(base)) codec = 'H264';
  else if (/av1/i.test(base)) codec = 'AV1';
  else if (/vp9/i.test(base)) codec = 'VP9';

  const audioParts: string[] = [];
  if (/trial/i.test(base)) audioParts.push('Trial');
  else if (/dual/i.test(base)) audioParts.push('Dual Audio');
  if (/lat|latino/i.test(base)) audioParts.push('Español Latino');
  else if (/esp|castellano|spa/i.test(base)) audioParts.push('Español');
  if (/atmos/i.test(base)) audioParts.push('Atmos');
  else if (/truehd/i.test(base)) audioParts.push('TrueHD');
  else if (/dts-?hd/i.test(base)) audioParts.push('DTS-HD MA');
  else if (/eac3|ddp/i.test(base)) audioParts.push('E-AC-3');
  else if (/ac3|dd5\.1/i.test(base)) audioParts.push('AC-3');
  else if (/flac/i.test(base)) audioParts.push('FLAC');
  else if (/aac/i.test(base)) audioParts.push('AAC');

  // Music pattern: "Artist - Album" or "01. Track"
  let artist = '';
  let album = '';
  const dashSplit = base.split(/\s+-\s+/);
  if (dashSplit.length >= 2 && !epMatch) {
    artist = dashSplit[0].trim();
    album = dashSplit[1].replace(/\([^)]*\)|\[[^\]]*\]/g, '').trim();
  }

  let cleanTitle = base;
  const cutMarkers = [yearMatch?.index, epMatch?.index, base.search(/\b(2160p|1080p|720p|480p|4k|uhd|bluray|web-?dl|webrip|bdrip|dvdrip|hdtv|x264|x265|hevc|av1|flac)\b/i)].filter(
    (idx): idx is number => typeof idx === 'number' && idx > 0
  );
  if (cutMarkers.length > 0) {
    cleanTitle = base.slice(0, Math.min(...cutMarkers));
  }
  cleanTitle = cleanTitle
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/[._]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleanTitle) cleanTitle = base.replace(/[._]+/g, ' ').trim();

  return {
    title: cleanTitle,
    year,
    resolution,
    codec,
    audio: audioParts.join(' '),
    source,
    credits,
    episode,
    artist,
    album,
    isAnimeOrSeries: Boolean(episode),
  };
}

function readUint24BE(view: DataView, offset: number): number {
  return (view.getUint8(offset) << 16) | (view.getUint8(offset + 1) << 8) | view.getUint8(offset + 2);
}

function uint8ToDataUrl(bytes: Uint8Array, mime: string): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return `data:${mime || 'image/jpeg'};base64,${btoa(binary)}`;
}

async function parseFlacFile(file: File): Promise<{
  sampleRate?: number;
  channels?: number;
  bitsPerSample?: number;
  durationSec?: number;
  bitrateKbps?: number;
  tags: Record<string, string>;
  coverDataUrl?: string;
}> {
  const tags: Record<string, string> = {};
  const headBuf = await file.slice(0, Math.min(file.size, 8 * 1024 * 1024)).arrayBuffer();
  const bytes = new Uint8Array(headBuf);
  const view = new DataView(headBuf);

  if (
    bytes.length < 42 ||
    bytes[0] !== 0x66 ||
    bytes[1] !== 0x4c ||
    bytes[2] !== 0x61 ||
    bytes[3] !== 0x43
  ) {
    return { tags };
  }

  let offset = 4;
  let sampleRate: number | undefined;
  let channels: number | undefined;
  let bitsPerSample: number | undefined;
  let durationSec: number | undefined;
  let coverDataUrl: string | undefined;

  while (offset + 4 <= bytes.length) {
    const header = bytes[offset];
    const isLast = (header & 0x80) !== 0;
    const blockType = header & 0x7f;
    const blockLen = readUint24BE(view, offset + 1);
    offset += 4;
    if (offset + blockLen > bytes.length) break;

    if (blockType === 0 && blockLen >= 34) {
      // STREAMINFO
      const b10 = view.getUint32(offset + 10, false);
      sampleRate = b10 >>> 12;
      channels = ((b10 >>> 9) & 0x07) + 1;
      bitsPerSample = ((b10 >>> 4) & 0x1f) + 1;
      const high4 = BigInt(b10 & 0x0f);
      const low32 = BigInt(view.getUint32(offset + 14, false));
      const totalSamples = Number((high4 << 32n) | low32);
      if (sampleRate > 0 && totalSamples > 0) {
        durationSec = totalSamples / sampleRate;
      }
    } else if (blockType === 4 && blockLen >= 8) {
      // VORBIS_COMMENT
      try {
        const dec = new TextDecoder('utf-8');
        let p = offset;
        const vendorLen = view.getUint32(p, true);
        p += 4 + vendorLen;
        if (p + 4 <= offset + blockLen) {
          const count = view.getUint32(p, true);
          p += 4;
          for (let i = 0; i < count && p + 4 <= offset + blockLen; i++) {
            const len = view.getUint32(p, true);
            p += 4;
            if (p + len > offset + blockLen) break;
            const comment = dec.decode(bytes.subarray(p, p + len));
            p += len;
            const eq = comment.indexOf('=');
            if (eq > 0) {
              const k = comment.slice(0, eq).toUpperCase();
              const v = comment.slice(eq + 1).trim();
              if (!tags[k]) tags[k] = v;
            }
          }
        }
      } catch {
        // ignore malformed vorbis comment
      }
    } else if (blockType === 6 && !coverDataUrl && blockLen > 32) {
      // PICTURE
      try {
        const dec = new TextDecoder('utf-8');
        let p = offset + 4; // skip picture type
        const mimeLen = view.getUint32(p, false);
        p += 4;
        const mime = dec.decode(bytes.subarray(p, p + mimeLen));
        p += mimeLen;
        const descLen = view.getUint32(p, false);
        p += 4 + descLen + 16; // skip width, height, depth, colors
        const dataLen = view.getUint32(p, false);
        p += 4;
        if (dataLen > 0 && p + dataLen <= offset + blockLen && dataLen < 5 * 1024 * 1024) {
          coverDataUrl = uint8ToDataUrl(bytes.subarray(p, p + dataLen), mime);
        }
      } catch {
        // ignore picture parse error
      }
    }

    offset += blockLen;
    if (isLast) break;
  }

  const bitrateKbps =
    durationSec && durationSec > 0 ? Math.round((file.size * 8) / durationSec / 1000) : undefined;

  return { sampleRate, channels, bitsPerSample, durationSec, bitrateKbps, tags, coverDataUrl };
}

function decodeId3Text(bytes: Uint8Array): string {
  if (bytes.length === 0) return '';
  const enc = bytes[0];
  const payload = bytes.subarray(1);
  try {
    if (enc === 0) return new TextDecoder('iso-8859-1').decode(payload).replace(/\0/g, '').trim();
    if (enc === 1) return new TextDecoder('utf-16').decode(payload).replace(/\0/g, '').trim();
    if (enc === 2) return new TextDecoder('utf-16be').decode(payload).replace(/\0/g, '').trim();
    return new TextDecoder('utf-8').decode(payload).replace(/\0/g, '').trim();
  } catch {
    return '';
  }
}

async function parseMp3Id3v2(file: File): Promise<{
  tags: Record<string, string>;
  coverDataUrl?: string;
  bitrateKbps?: number;
  sampleRate?: number;
  channels?: number;
  channelMode?: string;
  durationSec?: number;
}> {
  const tags: Record<string, string> = {};
  let coverDataUrl: string | undefined;

  const headBuf = await file.slice(0, Math.min(file.size, 6 * 1024 * 1024)).arrayBuffer();
  const bytes = new Uint8Array(headBuf);
  const view = new DataView(headBuf);

  let audioStart = 0;

  if (bytes.length >= 10 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    const major = bytes[3];
    const tagSize =
      ((bytes[6] & 0x7f) << 21) |
      ((bytes[7] & 0x7f) << 14) |
      ((bytes[8] & 0x7f) << 7) |
      (bytes[9] & 0x7f);

    const end = Math.min(bytes.length, 10 + tagSize);
    audioStart = Math.min(bytes.length, 10 + tagSize);
    let pos = 10;

    while (pos + 10 <= end) {
      const id = String.fromCharCode(bytes[pos], bytes[pos + 1], bytes[pos + 2], bytes[pos + 3]);
      if (!/^[A-Z0-9]{4}$/.test(id)) break;

      const frameSize =
        major >= 4
          ? ((bytes[pos + 4] & 0x7f) << 21) |
            ((bytes[pos + 5] & 0x7f) << 14) |
            ((bytes[pos + 6] & 0x7f) << 7) |
            (bytes[pos + 7] & 0x7f)
          : view.getUint32(pos + 4, false);

      pos += 10;
      if (frameSize <= 0 || pos + frameSize > end) break;

      const frameBytes = bytes.subarray(pos, pos + frameSize);
      if (id.startsWith('T')) {
        tags[id] = decodeId3Text(frameBytes);
      } else if (id === 'APIC' && !coverDataUrl && frameSize > 16) {
        try {
          const enc = frameBytes[0];
          let p = 1;
          while (p < frameBytes.length && frameBytes[p] !== 0) p++;
          const mime = new TextDecoder('ascii').decode(frameBytes.subarray(1, p)) || 'image/jpeg';
          p += 2;
          if (enc === 1 || enc === 2) {
            while (p + 1 < frameBytes.length && !(frameBytes[p] === 0 && frameBytes[p + 1] === 0)) {
              p += 2;
            }
            p += 2;
          } else {
            while (p < frameBytes.length && frameBytes[p] !== 0) p++;
            p += 1;
          }
          if (p < frameBytes.length && frameBytes.length - p < 5 * 1024 * 1024) {
            coverDataUrl = uint8ToDataUrl(frameBytes.subarray(p), mime);
          }
        } catch {
          // ignore APIC parse error
        }
      }

      pos += frameSize;
    }
  }

  // Parse MPEG frame header for real MP3 bitrate, sample rate & channels
  let bitrateKbps: number | undefined;
  let sampleRate: number | undefined;
  let channels: number | undefined;
  let channelMode: string | undefined;
  let durationSec: number | undefined;

  const BITRATE_V1_L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
  const BITRATE_V2_L3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0];
  const SAMPLE_RATES_V1 = [44100, 48000, 32000, 0];
  const SAMPLE_RATES_V2 = [22050, 24000, 16000, 0];
  const CHANNEL_MODES = ['Stereo', 'Joint Stereo', 'Dual Channel', 'Mono'];

  for (let p = audioStart; p + 4 < bytes.length && p < audioStart + 16384; p++) {
    if (bytes[p] === 0xff && (bytes[p + 1] & 0xe0) === 0xe0) {
      const versionBits = (bytes[p + 1] >> 3) & 0x03;
      const layerBits = (bytes[p + 1] >> 1) & 0x03;
      const brIdx = (bytes[p + 2] >> 4) & 0x0f;
      const srIdx = (bytes[p + 2] >> 2) & 0x03;
      const chIdx = (bytes[p + 3] >> 6) & 0x03;

      if (versionBits !== 1 && layerBits === 1 && brIdx > 0 && brIdx < 15 && srIdx < 3) {
        const isV1 = versionBits === 3;
        bitrateKbps = isV1 ? BITRATE_V1_L3[brIdx] : BITRATE_V2_L3[brIdx];
        sampleRate = isV1 ? SAMPLE_RATES_V1[srIdx] : SAMPLE_RATES_V2[srIdx];
        channelMode = CHANNEL_MODES[chIdx];
        channels = chIdx === 3 ? 1 : 2;
        if (bitrateKbps > 0 && file.size > audioStart) {
          durationSec = ((file.size - audioStart) * 8) / (bitrateKbps * 1000);
        }
        break;
      }
    }
  }

  return { tags, coverDataUrl, bitrateKbps, sampleRate, channels, channelMode, durationSec };
}

function readEbmlVint(bytes: Uint8Array, offset: number, keepLeadingBit = false): { val: number; len: number } | null {
  if (offset >= bytes.length) return null;
  const first = bytes[offset];
  if (first === 0) return null;
  let mask = 0x80;
  let len = 1;
  while (len <= 8 && (first & mask) === 0) {
    mask >>= 1;
    len++;
  }
  if (len > 8 || offset + len > bytes.length) return null;

  let val = keepLeadingBit ? first : first & ~mask;
  for (let i = 1; i < len; i++) {
    val = val * 256 + bytes[offset + i];
  }
  return { val, len };
}

interface ParsedMkvTrack {
  type: number;
  codec: string;
  language?: string;
  name?: string;
  isDefault?: boolean;
  isForced?: boolean;
  defaultDurationNs?: number;
  width?: number;
  height?: number;
  displayWidth?: number;
  displayHeight?: number;
  colorSpace?: string;
  channels?: number;
  sampleRate?: number;
  bitDepth?: number;
}

async function parseMkvEbmlMetadata(file: File): Promise<{
  embeddedTitle?: string;
  durationSec?: number;
  videoTracks: MediaInfoVideoTrack[];
  audioTracks: MediaInfoAudioTrack[];
  subtitleTracks: MediaInfoSubtitleTrack[];
  videoCodec?: string;
  width?: number;
  height?: number;
  fps?: number;
  audioCodecs: string[];
  audioChannels?: number;
  sampleRate?: number;
  subtitlesCount: number;
}> {
  const sliceLen = Math.min(file.size, 768 * 1024);
  const buf = await file.slice(0, sliceLen).arrayBuffer();
  const bytes = new Uint8Array(buf);
  const view = new DataView(buf);

  let embeddedTitle: string | undefined;
  let timecodeScale = 1000000;
  let rawDuration: number | undefined;
  const rawTracks: ParsedMkvTrack[] = [];

  let activeTrack: ParsedMkvTrack | null = null;
  let currentColorMatrix: number | undefined;
  let currentTransfer: number | undefined;

  const CONTAINER_IDS = new Set([
    0x1a45dfa3, // EBML
    0x18538067, // Segment
    0x1549a966, // Info
    0x1654ae6b, // Tracks
    0xae,       // TrackEntry
    0xe0,       // Video
    0xe1,       // Audio
    0x55b0,     // Colour
  ]);

  const flushTrack = () => {
    if (activeTrack && activeTrack.type > 0) {
      if (currentColorMatrix === 9 || currentTransfer === 16 || currentTransfer === 18) {
        activeTrack.colorSpace =
          currentTransfer === 16
            ? 'BT.2020 / HDR10 (PQ)'
            : currentTransfer === 18
            ? 'BT.2020 / HLG'
            : 'BT.2020';
      } else if (currentColorMatrix === 1) {
        activeTrack.colorSpace = 'BT.709 (SDR)';
      } else if (currentColorMatrix === 5 || currentColorMatrix === 6) {
        activeTrack.colorSpace = 'BT.601';
      }
      rawTracks.push(activeTrack);
    }
    activeTrack = null;
    currentColorMatrix = undefined;
    currentTransfer = undefined;
  };

  const walk = (start: number, end: number, depth: number) => {
    if (depth > 9) return;
    let p = start;
    while (p < end) {
      const idVint = readEbmlVint(bytes, p, true);
      if (!idVint) break;
      const id = idVint.val;
      p += idVint.len;

      const sizeVint = readEbmlVint(bytes, p, false);
      if (!sizeVint) break;
      p += sizeVint.len;

      const size = sizeVint.val;
      const elemEnd = size < 0 || p + size > end ? end : p + size;

      if (id === 0xae) {
        flushTrack();
        activeTrack = { type: 0, codec: '' };
      }

      if (CONTAINER_IDS.has(id)) {
        walk(p, elemEnd, depth + 1);
        if (id === 0xae) flushTrack();
      } else {
        const readUint = () => {
          let v = 0;
          for (let i = p; i < elemEnd && i - p < 8; i++) v = v * 256 + bytes[i];
          return v;
        };
        const readFloat = () => {
          if (elemEnd - p === 4) return view.getFloat32(p, false);
          if (elemEnd - p === 8) return view.getFloat64(p, false);
          return undefined;
        };
        const readAscii = () =>
          new TextDecoder('ascii').decode(bytes.subarray(p, elemEnd)).replace(/\0/g, '').trim();
        const readUtf8 = () =>
          new TextDecoder('utf-8').decode(bytes.subarray(p, elemEnd)).replace(/\0/g, '').trim();

        if (id === 0x2ad7b1) timecodeScale = readUint() || 1000000;
        else if (id === 0x7ba9 && !embeddedTitle) {
          const t = readUtf8();
          if (t) embeddedTitle = t;
        } else if (id === 0x4489) {
          rawDuration = readFloat();
        } else if (activeTrack) {
          if (id === 0x83) activeTrack.type = readUint();
          else if (id === 0x86) activeTrack.codec = readAscii();
          else if (id === 0x88) activeTrack.isDefault = readUint() === 1;
          else if (id === 0x55aa) activeTrack.isForced = readUint() === 1;
          else if (id === 0x22b59c) activeTrack.language = readAscii().toUpperCase();
          else if (id === 0x536e) activeTrack.name = readUtf8();
          else if (id === 0x23e383) activeTrack.defaultDurationNs = readUint();
          else if (id === 0xb0) activeTrack.width = readUint();
          else if (id === 0xba) activeTrack.height = readUint();
          else if (id === 0x54b0) activeTrack.displayWidth = readUint();
          else if (id === 0x54ba) activeTrack.displayHeight = readUint();
          else if (id === 0x9f) activeTrack.channels = readUint();
          else if (id === 0xb5) activeTrack.sampleRate = Math.round(readFloat() || 0);
          else if (id === 0x6264) activeTrack.bitDepth = readUint();
          else if (id === 0x55bb) currentColorMatrix = readUint();
          else if (id === 0x55b9) currentTransfer = readUint();
        }
      }

      if (elemEnd <= p) break;
      p = elemEnd;
    }
  };

  walk(0, bytes.length, 0);
  flushTrack();

  const durationSec =
    rawDuration && rawDuration > 0 ? (rawDuration * timecodeScale) / 1e9 : undefined;

  const videoTracks: MediaInfoVideoTrack[] = [];
  const audioTracks: MediaInfoAudioTrack[] = [];
  const subtitleTracks: MediaInfoSubtitleTrack[] = [];

  for (const t of rawTracks) {
    if (t.type === 1) {
      const fpsVal =
        t.defaultDurationNs && t.defaultDurationNs > 100000
          ? 1e9 / t.defaultDurationNs
          : undefined;
      const is10Bit = t.codec.toUpperCase().includes('MAIN10') || Boolean(t.colorSpace?.includes('HDR'));
      const rawCodecUpper = t.codec.toUpperCase();
      const isAvc = rawCodecUpper.includes('AVC') || rawCodecUpper.includes('H264');
      videoTracks.push({
        index: videoTracks.length + 1,
        codec: normalizeCodecName(t.codec || 'Video'),
        profile: is10Bit ? 'Main 10' : undefined,
        avc: isAvc,
        width: t.width,
        height: t.height,
        aspectRatio: computeAspectRatio(t.displayWidth || t.width, t.displayHeight || t.height),
        fps: formatFpsValue(fpsVal),
        bitDepth: is10Bit ? '10 bits' : '8 bits',
        colorSpace: t.colorSpace,
      });
    } else if (t.type === 2) {
      const rawAudioUpper = t.codec.toUpperCase();
      const normalizedAudio = normalizeCodecName(t.codec || 'Audio');
      const audioProfile =
        normalizedAudio === 'AAC'
          ? rawAudioUpper.includes('HE') || rawAudioUpper.includes('SBR')
            ? 'HE-AAC'
            : 'LC'
          : undefined;
      audioTracks.push({
        index: audioTracks.length + 1,
        codec: normalizedAudio,
        audioProfile,
        channels: t.channels,
        channelLayout: formatChannelLayout(t.channels),
        sampleRate: t.sampleRate ? `${(t.sampleRate / 1000).toFixed(1)} kHz` : undefined,
        bitDepth: t.bitDepth ? `${t.bitDepth} bits` : undefined,
        language: t.language || 'UND',
        isDefault: t.isDefault ?? audioTracks.length === 0,
        isForced: Boolean(t.isForced),
      });
    } else if (t.type === 17) {
      subtitleTracks.push({
        index: subtitleTracks.length + 1,
        format: t.codec.replace(/^S_TEXT\//, '').replace(/^S_/, '') || 'ASS',
        language: t.language || 'UND',
        title: t.name,
        isDefault: Boolean(t.isDefault),
        isForced: Boolean(t.isForced),
      });
    }
  }

  const primaryVideo = videoTracks[0];
  const primaryFps = primaryVideo?.fps ? parseFloat(primaryVideo.fps) : undefined;

  return {
    embeddedTitle,
    durationSec,
    videoTracks,
    audioTracks,
    subtitleTracks,
    videoCodec: primaryVideo?.codec,
    width: primaryVideo?.width,
    height: primaryVideo?.height,
    fps: primaryFps,
    audioCodecs: audioTracks.map((a) => a.codec),
    audioChannels: audioTracks[0]?.channels,
    sampleRate: rawTracks.find((t) => t.type === 2)?.sampleRate,
    subtitlesCount: subtitleTracks.length,
  };
}

async function parseMp4EmbeddedMetadata(file: File): Promise<{
  title?: string;
  artist?: string;
  album?: string;
  year?: string;
  genre?: string;
  description?: string;
  coverDataUrl?: string;
}> {
  const result: {
    title?: string;
    artist?: string;
    album?: string;
    year?: string;
    genre?: string;
    description?: string;
    coverDataUrl?: string;
  } = {};

  const parseBuffer = (buf: ArrayBuffer) => {
    const bytes = new Uint8Array(buf);
    const view = new DataView(buf);
    const decAscii = new TextDecoder('ascii');
    const decUtf8 = new TextDecoder('utf-8');

    const MP4_CONTAINERS = new Set(['moov', 'udta', 'meta', 'ilst']);

    const walkAtoms = (start: number, end: number, depth: number) => {
      if (depth > 7) return;
      let p = start;
      while (p + 8 <= end) {
        let size = view.getUint32(p, false);
        const type = decAscii.decode(bytes.subarray(p + 4, p + 8));
        let headerLen = 8;
        if (size === 1 && p + 16 <= end) {
          size = Number(view.getBigUint64(p + 8, false));
          headerLen = 16;
        } else if (size === 0) {
          size = end - p;
        }
        if (size < headerLen || p + size > end) break;
        const payloadStart = p + headerLen;
        const atomEnd = p + size;

        if (MP4_CONTAINERS.has(type)) {
          const childStart = type === 'meta' ? payloadStart + 4 : payloadStart;
          if (childStart < atomEnd) walkAtoms(childStart, atomEnd, depth + 1);
        } else if (
          type === '\u00a9nam' ||
          type === '\u00a9ART' ||
          type === '\u00a9alb' ||
          type === '\u00a9day' ||
          type === '\u00a9gen' ||
          type === '\u00a9cmt' ||
          type === 'desc' ||
          type === 'ldes' ||
          type === 'covr'
        ) {
          // Look for nested 'data' atom inside ilst item
          let dp = payloadStart;
          while (dp + 16 <= atomEnd) {
            const dSize = view.getUint32(dp, false);
            const dType = decAscii.decode(bytes.subarray(dp + 4, dp + 8));
            if (dSize < 16 || dp + dSize > atomEnd) break;
            if (dType === 'data') {
              const dataFlag = view.getUint32(dp + 8, false) & 0x00ffffff;
              const rawPayload = bytes.subarray(dp + 16, dp + dSize);
              if (type === 'covr' && !result.coverDataUrl && rawPayload.length > 16) {
                const mime = dataFlag === 14 ? 'image/png' : 'image/jpeg';
                result.coverDataUrl = uint8ToDataUrl(rawPayload, mime);
              } else if (dataFlag === 1) {
                const txt = decUtf8.decode(rawPayload).replace(/\0/g, '').trim();
                if (txt) {
                  if (type === '\u00a9nam' && !result.title) result.title = txt;
                  else if (type === '\u00a9ART' && !result.artist) result.artist = txt;
                  else if (type === '\u00a9alb' && !result.album) result.album = txt;
                  else if (type === '\u00a9day' && !result.year) result.year = txt;
                  else if (type === '\u00a9gen' && !result.genre) result.genre = txt;
                  else if ((type === 'ldes' || type === 'desc' || type === '\u00a9cmt') && !result.description) {
                    result.description = txt;
                  }
                }
              }
            }
            dp += dSize;
          }
        }
        p = atomEnd;
      }
    };

    walkAtoms(0, bytes.length, 0);
  };

  try {
    const headLen = Math.min(file.size, 3 * 1024 * 1024);
    parseBuffer(await file.slice(0, headLen).arrayBuffer());
    if (!result.title && !result.coverDataUrl && file.size > headLen) {
      const tailStart = Math.max(0, file.size - 3 * 1024 * 1024);
      parseBuffer(await file.slice(tailStart, file.size).arrayBuffer());
    }
  } catch {
    // Ignore MP4 atom parse issues
  }

  return result;
}

async function parseMp4TechnicalStreams(file: File): Promise<{
  durationSec?: number;
  videoTracks: MediaInfoVideoTrack[];
  audioTracks: MediaInfoAudioTrack[];
  subtitleTracks: MediaInfoSubtitleTrack[];
}> {
  const videoTracks: MediaInfoVideoTrack[] = [];
  const audioTracks: MediaInfoAudioTrack[] = [];
  const subtitleTracks: MediaInfoSubtitleTrack[] = [];
  let movieDurationSec: number | undefined;

  const parseMoovBuffer = (buf: ArrayBuffer): boolean => {
    const bytes = new Uint8Array(buf);
    const view = new DataView(buf);
    const decAscii = new TextDecoder('ascii');
    let foundMoov = false;

    const readAtoms = (
      start: number,
      end: number,
      onAtom: (type: string, payloadStart: number, atomEnd: number) => void
    ) => {
      let p = start;
      while (p + 8 <= end) {
        let size = view.getUint32(p, false);
        const type = decAscii.decode(bytes.subarray(p + 4, p + 8));
        let headerLen = 8;
        if (size === 1 && p + 16 <= end) {
          size = Number(view.getBigUint64(p + 8, false));
          headerLen = 16;
        } else if (size === 0) {
          size = end - p;
        }
        if (size < headerLen || p + size > end) break;
        onAtom(type, p + headerLen, p + size);
        p += size;
      }
    };

    const parseTrack = (tStart: number, tEnd: number) => {
      let tkhdW = 0;
      let tkhdH = 0;
      let handler = '';
      let mdhdTimescale = 0;
      let mdhdDuration = 0;
      let codec = '';
      let profile: string | undefined;
      let width = 0;
      let height = 0;
      let bitDepth: string | undefined;
      let channels = 0;
      let sampleRate = 0;
      let fpsVal: number | undefined;
      let totalTrackBytes = 0;
      let langCode: string | undefined;

      const walkTrack = (s: number, e: number) => {
        readAtoms(s, e, (type, pStart, aEnd) => {
          if (type === 'tkhd' && pStart + 84 <= aEnd) {
            const ver = bytes[pStart];
            const wOff = ver === 1 ? pStart + 88 : pStart + 76;
            if (wOff + 8 <= aEnd) {
              tkhdW = view.getUint32(wOff, false) >>> 16;
              tkhdH = view.getUint32(wOff + 4, false) >>> 16;
            }
          } else if (type === 'mdia' || type === 'minf' || type === 'stbl') {
            walkTrack(pStart, aEnd);
          } else if (type === 'mdhd' && pStart + 24 <= aEnd) {
            const ver = bytes[pStart];
            if (ver === 1 && pStart + 32 <= aEnd) {
              mdhdTimescale = view.getUint32(pStart + 20, false);
              mdhdDuration = Number(view.getBigUint64(pStart + 24, false));
            } else {
              mdhdTimescale = view.getUint32(pStart + 12, false);
              mdhdDuration = view.getUint32(pStart + 16, false);
              if (pStart + 22 <= aEnd) {
                const langBits = view.getUint16(pStart + 20, false);
                const c1 = ((langBits >> 10) & 0x1f) + 0x60;
                const c2 = ((langBits >> 5) & 0x1f) + 0x60;
                const c3 = (langBits & 0x1f) + 0x60;
                const l = String.fromCharCode(c1, c2, c3).toUpperCase();
                if (/^[A-Z]{3}$/.test(l)) langCode = l;
              }
            }
          } else if (type === 'hdlr' && pStart + 12 <= aEnd) {
            handler = decAscii.decode(bytes.subarray(pStart + 8, pStart + 12));
          } else if (type === 'stsd' && pStart + 16 <= aEnd) {
            const entryCount = view.getUint32(pStart + 4, false);
            if (entryCount >= 1) {
              const entryStart = pStart + 8;
              const entrySize = view.getUint32(entryStart, false);
              if (entryStart + 8 <= aEnd) {
                const fmt = decAscii.decode(bytes.subarray(entryStart + 4, entryStart + 8));
                codec = normalizeCodecName(fmt);
                const entryEnd = Math.min(aEnd, entryStart + entrySize);
                if (handler === 'vide' && entryStart + 78 <= entryEnd) {
                  width = view.getUint16(entryStart + 32, false);
                  height = view.getUint16(entryStart + 34, false);
                  const depthVal = view.getUint16(entryStart + 82, false);
                  if (depthVal === 24 || depthVal === 32) bitDepth = '8 bits';
                  // Check avcC / hvcC inside VisualSampleEntry
                  if (entryStart + 86 < entryEnd) {
                    readAtoms(entryStart + 86, entryEnd, (subType, sp, se) => {
                      if (subType === 'hvcC' && sp + 2 < se) {
                        const pByte = bytes[sp + 1] & 0x1f;
                        if (pByte === 2) {
                          profile = 'Main 10';
                          bitDepth = '10 bits';
                        } else if (pByte === 1) {
                          profile = 'Main';
                        }
                      } else if (subType === 'avcC' && sp + 2 < se) {
                        const pByte = bytes[sp + 1];
                        if (pByte === 100) profile = 'High';
                        else if (pByte === 77) profile = 'Main';
                        else if (pByte === 66) profile = 'Baseline';
                        else if (pByte === 110) {
                          profile = 'High 10';
                          bitDepth = '10 bits';
                        }
                      }
                    });
                  }
                } else if (handler === 'soun' && entryStart + 36 <= entryEnd) {
                  channels = view.getUint16(entryStart + 24, false);
                  const sampleSize = view.getUint16(entryStart + 26, false);
                  sampleRate = view.getUint32(entryStart + 32, false) >>> 16;
                  if (sampleSize > 0) bitDepth = `${sampleSize} bits`;
                }
              }
            }
          } else if (type === 'stts' && pStart + 16 <= aEnd && mdhdTimescale > 0) {
            const count = Math.min(view.getUint32(pStart + 4, false), 512);
            let totalSamples = 0;
            let totalDelta = 0;
            let sp = pStart + 8;
            for (let i = 0; i < count && sp + 8 <= aEnd; i++) {
              const sCount = view.getUint32(sp, false);
              const sDelta = view.getUint32(sp + 4, false);
              totalSamples += sCount;
              totalDelta += sCount * sDelta;
              sp += 8;
            }
            if (totalSamples > 0 && totalDelta > 0) {
              fpsVal = (totalSamples * mdhdTimescale) / totalDelta;
            }
          } else if (type === 'stsz' && pStart + 12 <= aEnd) {
            const fixedSize = view.getUint32(pStart + 4, false);
            const sampleCount = view.getUint32(pStart + 8, false);
            if (fixedSize > 0) {
              totalTrackBytes = fixedSize * sampleCount;
            } else {
              let sp = pStart + 12;
              let sum = 0;
              const maxRead = Math.min(sampleCount, Math.floor((aEnd - sp) / 4));
              for (let i = 0; i < maxRead; i++) {
                sum += view.getUint32(sp, false);
                sp += 4;
              }
              if (maxRead > 0 && maxRead === sampleCount) {
                totalTrackBytes = sum;
              } else if (maxRead > 0 && sampleCount > maxRead) {
                totalTrackBytes = Math.round((sum / maxRead) * sampleCount);
              }
            }
          }
        });
      };

      walkTrack(tStart, tEnd);

      const durSec =
        mdhdTimescale > 0 && mdhdDuration > 0
          ? mdhdDuration / mdhdTimescale
          : movieDurationSec;
      const trackBitrateKbps =
        totalTrackBytes > 0 && durSec && durSec > 0
          ? (totalTrackBytes * 8) / durSec / 1000
          : undefined;

      if (handler === 'vide') {
        const finalW = width || tkhdW || undefined;
        const finalH = height || tkhdH || undefined;
        const isAvc = /AVC|H\.?264/i.test(codec);
        videoTracks.push({
          index: videoTracks.length + 1,
          codec: codec || 'Video',
          profile,
          avc: isAvc,
          width: finalW,
          height: finalH,
          aspectRatio: computeAspectRatio(finalW, finalH),
          fps: formatFpsValue(fpsVal),
          bitrate: trackBitrateKbps ? formatBitrateKbps(trackBitrateKbps) : undefined,
          bitDepth,
        });
      } else if (handler === 'soun') {
        audioTracks.push({
          index: audioTracks.length + 1,
          codec: codec || 'Audio',
          audioProfile: codec === 'AAC' ? 'LC' : undefined,
          channels: channels || undefined,
          channelLayout: formatChannelLayout(channels),
          sampleRate: sampleRate ? `${(sampleRate / 1000).toFixed(1)} kHz` : undefined,
          bitDepth,
          bitrate: trackBitrateKbps ? formatBitrateKbps(trackBitrateKbps) : undefined,
          language: langCode || 'UND',
          isDefault: audioTracks.length === 0,
          isForced: false,
        });
      } else if (handler === 'sbtl' || handler === 'text') {
        subtitleTracks.push({
          index: subtitleTracks.length + 1,
          format: codec || 'Timed Text',
          language: langCode || 'UND',
        });
      }
    };

    readAtoms(0, bytes.length, (type, pStart, aEnd) => {
      if (type === 'moov') {
        foundMoov = true;
        readAtoms(pStart, aEnd, (subType, sp, se) => {
          if (subType === 'mvhd' && sp + 24 <= se) {
            const ver = bytes[sp];
            if (ver === 1 && sp + 32 <= se) {
              const ts = view.getUint32(sp + 20, false);
              const dur = Number(view.getBigUint64(sp + 24, false));
              if (ts > 0 && dur > 0) movieDurationSec = dur / ts;
            } else {
              const ts = view.getUint32(sp + 12, false);
              const dur = view.getUint32(sp + 16, false);
              if (ts > 0 && dur > 0) movieDurationSec = dur / ts;
            }
          } else if (subType === 'trak') {
            parseTrack(sp, se);
          }
        });
      }
    });

    return foundMoov;
  };

  try {
    const headLen = Math.min(file.size, 4 * 1024 * 1024);
    const foundInHead = parseMoovBuffer(await file.slice(0, headLen).arrayBuffer());
    if (!foundInHead && file.size > headLen) {
      const tailStart = Math.max(0, file.size - 4 * 1024 * 1024);
      parseMoovBuffer(await file.slice(tailStart, file.size).arrayBuffer());
    }
  } catch {
    // ignore MP4 technical parse error
  }

  return {
    durationSec: movieDurationSec,
    videoTracks,
    audioTracks,
    subtitleTracks,
  };
}

function buildCaptureSamplePoints(count: number): number[] {
  const safeCount = Math.max(1, Math.min(16, Math.round(count)));
  if (safeCount === 1) return [0.45];
  if (safeCount === 6) return [0.1, 0.25, 0.4, 0.55, 0.72, 0.88];
  const minFrac = 0.08;
  const maxFrac = 0.9;
  return Array.from(
    { length: safeCount },
    (_, idx) => minFrac + (idx * (maxFrac - minFrac)) / (safeCount - 1)
  );
}

async function probeVideoElementAndCapture(
  file: File,
  options?: { captureCount?: number; compressionPercent?: number }
): Promise<{
  durationSec?: number;
  width?: number;
  height?: number;
  screenshots: string[];
}> {
  const captureCount = Math.max(1, Math.min(16, Math.round(options?.captureCount ?? 6)));
  const captureQuality = compressionPercentToQuality(options?.compressionPercent ?? 25);

  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;
    const objectUrl = URL.createObjectURL(file);
    const screenshots: string[] = [];

    let detectedDuration: number | undefined;
    let detectedWidth: number | undefined;
    let detectedHeight: number | undefined;
    let settled = false;
    const finish = (res: { durationSec?: number; width?: number; height?: number; screenshots: string[] }) => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(objectUrl);
      video.removeAttribute('src');
      video.load();
      resolve(res);
    };

    const timer = setTimeout(() => {
      finish({
        durationSec: detectedDuration,
        width: detectedWidth,
        height: detectedHeight,
        screenshots,
      });
    }, Math.max(18000, captureCount * 3000));

    video.onerror = () => {
      clearTimeout(timer);
      finish({
        durationSec: detectedDuration,
        width: detectedWidth,
        height: detectedHeight,
        screenshots,
      });
    };

    video.onloadedmetadata = async () => {
      const durationSec = Number.isFinite(video.duration) ? video.duration : undefined;
      const width = video.videoWidth || undefined;
      const height = video.videoHeight || undefined;
      detectedDuration = durationSec;
      detectedWidth = width;
      detectedHeight = height;

      if (!durationSec || durationSec <= 0 || !width || !height) {
        clearTimeout(timer);
        finish({ durationSec, width, height, screenshots });
        return;
      }

      const canvas = document.createElement('canvas');
      const targetW = width;
      const targetH = height;
      canvas.width = targetW;
      canvas.height = targetH;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
      }

      const points = buildCaptureSamplePoints(captureCount);
      for (const frac of points) {
        if (settled) break;
        try {
          await new Promise<void>((seekResolve) => {
            let seekDone = false;
            const completeSeek = () => {
              if (seekDone) return;
              seekDone = true;
              video.removeEventListener('seeked', onSeeked);
              seekResolve();
            };
            const onSeeked = () => {
              if (ctx && !settled) {
                ctx.drawImage(video, 0, 0, targetW, targetH);
                screenshots.push(canvas.toDataURL('image/jpeg', captureQuality));
              }
              completeSeek();
            };
            video.addEventListener('seeked', onSeeked, { once: true });
            const safeMaxTime = Math.max(0.5, durationSec - 0.5);
            video.currentTime = Math.min(safeMaxTime, Math.max(0.5, durationSec * frac));
            setTimeout(completeSeek, 2200);
          });
        } catch {
          // ignore frame capture errors
        }
      }

      clearTimeout(timer);
      finish({ durationSec, width, height, screenshots });
    };

    video.src = objectUrl;
  });
}

async function probeAudioElementAndSpectrum(file: File): Promise<{
  durationSec?: number;
  spectrumDataUrl?: string;
}> {
  const durationPromise = new Promise<number | undefined>((resolve) => {
    const audio = document.createElement('audio');
    const url = URL.createObjectURL(file);
    const cleanup = () => URL.revokeObjectURL(url);
    const timeout = setTimeout(() => {
      cleanup();
      resolve(undefined);
    }, 3000);
    audio.onloadedmetadata = () => {
      clearTimeout(timeout);
      const d = Number.isFinite(audio.duration) ? audio.duration : undefined;
      cleanup();
      resolve(d);
    };
    audio.onerror = () => {
      clearTimeout(timeout);
      cleanup();
      resolve(undefined);
    };
    audio.src = url;
  });

  let spectrumDataUrl: string | undefined;
  let ctx: AudioContext | null = null;
  try {
    if (file.size <= 65 * 1024 * 1024 && typeof AudioContext !== 'undefined') {
      ctx = new AudioContext();
      const buf = await file.arrayBuffer();
      const audioBuf = await ctx.decodeAudioData(buf);
      const chan = audioBuf.getChannelData(0);

      const canvas = document.createElement('canvas');
      canvas.width = 680;
      canvas.height = 190;
      const g = canvas.getContext('2d');
      if (g) {
        g.fillStyle = '#07090d';
        g.fillRect(0, 0, canvas.width, canvas.height);

        // Grid lines
        g.strokeStyle = 'rgba(0, 240, 255, 0.12)';
        g.lineWidth = 1;
        for (let y = 24; y < canvas.height; y += 32) {
          g.beginPath();
          g.moveTo(0, y);
          g.lineTo(canvas.width, y);
          g.stroke();
        }

        // Waveform / energy bars computed directly from decoded PCM samples
        const bars = 136;
        const step = Math.max(1, Math.floor(chan.length / bars));
        const barW = canvas.width / bars;
        const mid = canvas.height / 2;

        for (let i = 0; i < bars; i++) {
          let peak = 0;
          const start = i * step;
          for (let j = 0; j < step; j += Math.max(1, Math.floor(step / 64))) {
            const amp = Math.abs(chan[start + j] || 0);
            if (amp > peak) peak = amp;
          }
          const h = Math.max(4, peak * (canvas.height - 36));
          const grad = g.createLinearGradient(0, mid - h / 2, 0, mid + h / 2);
          grad.addColorStop(0, '#00f0ff');
          grad.addColorStop(0.5, '#00ff9d');
          grad.addColorStop(1, '#ff0055');
          g.fillStyle = grad;
          g.fillRect(i * barW + 1, mid - h / 2, Math.max(2, barW - 2), h);
        }

        g.fillStyle = '#cbd5e1';
        g.font = 'bold 11px Consolas, monospace';
        g.fillText(
          `PCM ${audioBuf.sampleRate} Hz | ${audioBuf.numberOfChannels} ch | ${formatDurationSeconds(audioBuf.duration)} — ${file.name}`,
          12,
          18
        );

        spectrumDataUrl = canvas.toDataURL('image/png');
      }
    }
  } catch {
    // Codec not natively decodable by browser Web Audio API
  } finally {
    if (ctx) {
      await ctx.close().catch(() => {});
    }
  }

  const durationSec = await durationPromise;
  return { durationSec, spectrumDataUrl };
}

export async function analyzeDroppedFiles(
  files: File[],
  options?: { captureCount?: number; captureCompressionPercent?: number }
): Promise<AnalyzedDropResult> {
  if (!files || files.length === 0) {
    return {
      kind: 'unknown',
      updates: {},
      mediainfoDetails: {
        fileName: 'Sin archivo',
        container: 'Desconocido',
        fileSize: '0 B',
        fileSizeBytes: 0,
        duration: 'N/D',
        overallBitrate: 'N/D',
        videoTracks: [],
        audioTracks: [],
        subtitleTracks: [],
        rawReport: '',
        analyzedAt: Date.now(),
        sourceKind: 'unknown',
      },
      summary: 'No se recibieron archivos.',
      capturedDataUrls: [],
      embeddedFieldCount: 0,
    };
  }

  const primary = files[0];
  const lower = primary.name.toLowerCase();

  // 1. Text / NFO / CUE / SRT
  if (/\.(nfo|txt|cue|srt)$/i.test(lower)) {
    const text = await primary.text();
    const trimmed = text.slice(0, 6000).trim();
    const isCueOrTrack = lower.endsWith('.cue') || /\d{2}\.\s+/.test(trimmed);
    const ext = primary.name.split('.').pop()?.toUpperCase() || 'TEXT';
    const rawReport = [
      'General',
      `Complete name                            : ${primary.name}`,
      `Format                                   : ${ext}`,
      `File size                                : ${formatBytes(primary.size)}`,
    ].join('\n');
    return {
      kind: 'text',
      updates: isCueOrTrack ? { tracklist: trimmed } : { sinopsis: trimmed },
      mediainfoDetails: {
        fileName: primary.name,
        container: ext,
        fileSize: formatBytes(primary.size),
        fileSizeBytes: primary.size,
        duration: 'N/D',
        overallBitrate: 'N/D',
        videoTracks: [],
        audioTracks: [],
        subtitleTracks: [],
        rawReport,
        analyzedAt: Date.now(),
        sourceKind: 'text',
      },
      summary: `Archivo de texto "${primary.name}" analizado (${formatBytes(primary.size)})`,
      capturedDataUrls: [],
      embeddedFieldCount: 1,
    };
  }

  // 2. Image Cover
  if (/\.(png|jpe?g|webp|gif|bmp)$/i.test(lower)) {
    const dataUrl = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.readAsDataURL(primary);
    });
    const ext = primary.name.split('.').pop()?.toUpperCase() || 'IMAGE';
    const rawReport = [
      'General',
      `Complete name                            : ${primary.name}`,
      `Format                                   : ${ext}`,
      `File size                                : ${formatBytes(primary.size)}`,
    ].join('\n');
    return {
      kind: 'image',
      updates: { poster_url: dataUrl },
      mediainfoDetails: {
        fileName: primary.name,
        container: ext,
        fileSize: formatBytes(primary.size),
        fileSizeBytes: primary.size,
        duration: 'N/D',
        overallBitrate: 'N/D',
        videoTracks: [],
        audioTracks: [],
        subtitleTracks: [],
        rawReport,
        analyzedAt: Date.now(),
        sourceKind: 'image',
      },
      summary: `Imagen "${primary.name}" cargada (${formatBytes(primary.size)})`,
      capturedDataUrls: [dataUrl],
      embeddedFieldCount: 1,
    };
  }

  // 3. Audio / Music files (single or multi-track album drop)
  const audioFiles = files.filter((f) => /\.(flac|mp3|wav|ogg|m4a|aac|opus)$/i.test(f.name));
  if (audioFiles.length > 0 && /\.(flac|mp3|wav|ogg|m4a|aac|opus)$/i.test(lower)) {
    const sorted = [...audioFiles].sort((a, b) => a.name.localeCompare(b.name));
    const first = sorted[0];
    const parsedName = parseReleaseFilename(first.name);

    let tags: Record<string, string> = {};
    let coverDataUrl: string | undefined;
    let sampleRate: number | undefined;
    let channels: number | undefined;
    let bitsPerSample: number | undefined;
    let durationSec: number | undefined;
    let bitrateKbps: number | undefined;
    let channelLayout: string | undefined;

    if (first.name.toLowerCase().endsWith('.flac')) {
      const flac = await parseFlacFile(first);
      tags = flac.tags;
      coverDataUrl = flac.coverDataUrl;
      sampleRate = flac.sampleRate;
      channels = flac.channels;
      bitsPerSample = flac.bitsPerSample;
      durationSec = flac.durationSec;
      bitrateKbps = flac.bitrateKbps;
      channelLayout = formatChannelLayout(channels);
    } else if (first.name.toLowerCase().endsWith('.mp3')) {
      const mp3 = await parseMp3Id3v2(first);
      tags = {
        TITLE: mp3.tags.TIT2 || '',
        ARTIST: mp3.tags.TPE1 || '',
        ALBUM: mp3.tags.TALB || '',
        DATE: mp3.tags.TDRC || mp3.tags.TYER || '',
        GENRE: mp3.tags.TCON || '',
        COMMENT: mp3.tags.COMM || '',
      };
      coverDataUrl = mp3.coverDataUrl;
      bitrateKbps = mp3.bitrateKbps;
      sampleRate = mp3.sampleRate;
      channels = mp3.channels;
      durationSec = mp3.durationSec;
      channelLayout = mp3.channelMode || formatChannelLayout(channels);
    } else if (first.name.toLowerCase().endsWith('.m4a')) {
      const [mp4, mp4Streams] = await Promise.all([
        parseMp4EmbeddedMetadata(first),
        parseMp4TechnicalStreams(first),
      ]);
      tags = {
        TITLE: mp4.title || '',
        ARTIST: mp4.artist || '',
        ALBUM: mp4.album || '',
        DATE: mp4.year || '',
        GENRE: mp4.genre || '',
        COMMENT: mp4.description || '',
      };
      coverDataUrl = mp4.coverDataUrl;
      durationSec = mp4Streams.durationSec;
      const firstAudio = mp4Streams.audioTracks[0];
      if (firstAudio) {
        channels = firstAudio.channels;
        channelLayout = firstAudio.channelLayout;
        if (firstAudio.sampleRate) {
          sampleRate = Math.round(parseFloat(firstAudio.sampleRate) * 1000);
        }
        if (firstAudio.bitrate) {
          bitrateKbps = parseFloat(firstAudio.bitrate.replace(/[^0-9.]/g, ''));
        }
      }
    }

    const webAudio = await probeAudioElementAndSpectrum(first);
    if (!durationSec && webAudio.durationSec) durationSec = webAudio.durationSec;
    if (!bitrateKbps && durationSec && durationSec > 0) {
      bitrateKbps = Math.round((first.size * 8) / durationSec / 1000);
    }

    const totalSizeBytes = sorted.reduce((acc, f) => acc + f.size, 0);
    const trackLines: string[] = [];

    for (let i = 0; i < sorted.length; i++) {
      const f = sorted[i];
      const fLower = f.name.toLowerCase();
      let trackTitle = f.name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ');
      let trackDur = '';
      if (fLower.endsWith('.flac')) {
        const info = i === 0 ? { tags, durationSec } : await parseFlacFile(f);
        if (info.tags.TITLE) trackTitle = info.tags.TITLE;
        if (info.durationSec) trackDur = ` (${formatDurationSeconds(info.durationSec)})`;
      } else if (fLower.endsWith('.mp3')) {
        if (i === 0) {
          if (tags.TITLE) trackTitle = tags.TITLE;
          if (durationSec) trackDur = ` (${formatDurationSeconds(durationSec)})`;
        } else {
          const mp3Info = await parseMp3Id3v2(f).catch(() => null);
          if (mp3Info?.tags.TIT2) trackTitle = mp3Info.tags.TIT2;
          if (mp3Info?.durationSec) trackDur = ` (${formatDurationSeconds(mp3Info.durationSec)})`;
        }
      } else if (fLower.endsWith('.m4a')) {
        if (i === 0) {
          if (tags.TITLE) trackTitle = tags.TITLE;
          if (durationSec) trackDur = ` (${formatDurationSeconds(durationSec)})`;
        } else {
          const [mp4Meta, mp4Tech] = await Promise.all([
            parseMp4EmbeddedMetadata(f).catch(() => null),
            parseMp4TechnicalStreams(f).catch(() => null),
          ]);
          if (mp4Meta?.title) trackTitle = mp4Meta.title;
          if (mp4Tech?.durationSec) trackDur = ` (${formatDurationSeconds(mp4Tech.durationSec)})`;
        }
      } else if (i === 0 && tags.TITLE) {
        trackTitle = tags.TITLE;
        if (durationSec) trackDur = ` (${formatDurationSeconds(durationSec)})`;
      }
      trackLines.push(`${String(i + 1).padStart(2, '0')}. ${trackTitle}${trackDur}`);
    }

    const artist = tags.ARTIST || tags.ALBUMARTIST || parsedName.artist || 'Artista Desconocido';
    const album = tags.ALBUM || tags.TITLE || parsedName.album || parsedName.title;
    const year = (tags.DATE || parsedName.year || '').slice(0, 4);
    const genre = tags.GENRE || 'Audio';
    const ext = first.name.split('.').pop()?.toUpperCase() || 'AUDIO';
    const bitrateFormatted = formatBitrateKbps(bitrateKbps);
    const resStr =
      ext === 'FLAC' && bitsPerSample && sampleRate
        ? `FLAC ${bitsPerSample}-bit / ${(sampleRate / 1000).toFixed(1)}kHz`
        : `${ext}${bitrateKbps ? ` ${bitrateKbps} kbps` : ''}`;

    const mediaInfoReport = [
      'General',
      `Complete name                            : ${first.name}${sorted.length > 1 ? ` (+${sorted.length - 1} archivos)` : ''}`,
      `Format                                   : ${ext}`,
      `File size                                : ${formatBytes(totalSizeBytes)}`,
      durationSec ? `Duration                                 : ${formatDurationSeconds(durationSec)} (pista #1)` : null,
      bitrateKbps ? `Overall bit rate                         : ${bitrateFormatted}` : null,
      artist ? `Performer                                : ${artist}` : null,
      album ? `Album                                    : ${album}` : null,
      year ? `Recorded date                            : ${year}` : null,
      '',
      'Audio',
      `Format                                   : ${ext}`,
      bitrateKbps ? `Bit rate                                 : ${bitrateFormatted}` : null,
      sampleRate ? `Sampling rate                            : ${(sampleRate / 1000).toFixed(1)} kHz` : null,
      bitsPerSample ? `Bit depth                                : ${bitsPerSample} bits` : null,
      channels ? `Channel(s)                               : ${channels} channels${channelLayout ? ` (${channelLayout})` : ''}` : null,
    ]
      .filter(Boolean)
      .join('\n');

    const audioTrackDetail: MediaInfoAudioTrack = {
      index: 1,
      codec: ext === 'MP3' ? 'MPEG Audio (MP3)' : ext,
      channels,
      channelLayout: channelLayout || formatChannelLayout(channels),
      sampleRate: sampleRate ? `${(sampleRate / 1000).toFixed(1)} kHz` : undefined,
      bitDepth: bitsPerSample ? `${bitsPerSample} bits` : undefined,
      bitrate: bitrateKbps ? bitrateFormatted : undefined,
    };

    const mediainfoDetails: MediaInfoDetails = {
      fileName: `${first.name}${sorted.length > 1 ? ` (+${sorted.length - 1})` : ''}`,
      container: ext,
      fileSize: formatBytes(totalSizeBytes),
      fileSizeBytes: totalSizeBytes,
      duration: durationSec ? formatDurationSeconds(durationSec) : 'N/D',
      overallBitrate: bitrateFormatted,
      videoTracks: [],
      audioTracks: [audioTrackDetail],
      subtitleTracks: [],
      rawReport: mediaInfoReport,
      analyzedAt: Date.now(),
      sourceKind: 'audio',
    };

    const updates: Partial<MediaContext> = {
      titulo: album || parsedName.title,
      artista: artist,
      album: album,
      anio: year || new Date().getFullYear().toString(),
      resolucion: resStr,
      codec_video: ext,
      audio_idiomas: resStr,
      peso_archivo: formatBytes(totalSizeBytes),
      duracion: durationSec ? formatDurationSeconds(durationSec) : 'N/D',
      generos: genre,
      tmdb_rating: '—',
      imdb_rating: '—',
      sinopsis: tags.COMMENT || `${artist} — ${album} (${resStr}). Metadatos extraídos del archivo local.`,
      trailer_url: '',
      tracklist: trackLines.join('\n'),
      mediainfo_completo: mediaInfoReport,
      fuente: parsedName.source || `WEB ${ext}`,
      creditos: parsedName.credits || 'PostPro',
      capitulos: `${sorted.length} ${sorted.length === 1 ? 'Pista' : 'Pistas'}`,
      password: 'Sin Password',
      video_info_bloque: [
        `Formato: ${ext}`,
        bitsPerSample ? `Profundidad de bit: ${bitsPerSample} bit` : null,
        sampleRate ? `Frecuencia de muestreo: ${(sampleRate / 1000).toFixed(1)} kHz` : null,
        bitrateKbps ? `Velocidad de bits: ${bitrateKbps} kbps` : null,
      ]
        .filter(Boolean)
        .join('\n'),
      video_info_identi: [
        `Formato: ${ext}`,
        bitsPerSample ? `Profundidad de bit: ${bitsPerSample} bit` : null,
        sampleRate ? `Frecuencia de muestreo: ${(sampleRate / 1000).toFixed(1)} kHz` : null,
        bitrateKbps ? `Velocidad de bits: ${bitrateKbps} kbps` : null,
      ]
        .filter(Boolean)
        .join('\n'),
      subtitulos_info: 'No aplica (Álbum musical)',
      subtitulos_identi: 'No aplica',
      audio_info_bloque: `Pista #1: ${ext}${bitsPerSample ? ` · ${bitsPerSample} bits` : ''}${sampleRate ? ` · ${(sampleRate / 1000).toFixed(1)} kHz` : ''}${channels ? ` · ${channels} canales` : ''}${bitrateKbps ? ` · ${bitrateKbps} kbps` : ''}`,
      audio_info_identi: `Pista #1: ${ext}${bitsPerSample ? ` · ${bitsPerSample} bits` : ''}${sampleRate ? ` · ${(sampleRate / 1000).toFixed(1)} kHz` : ''}${channels ? ` · ${channels} canales` : ''}${bitrateKbps ? ` · ${bitrateKbps} kbps` : ''}`,
      poster_url: coverDataUrl || makeSvgAsset(album.slice(0, 24), artist, '#0b1310', '#00ff9d', 300, 300),
      banner_url: makeSvgAsset(album.slice(0, 28), resStr, '#07100c', '#00ff9d', 760, 140),
      logo_url: makeSvgAsset(artist.slice(0, 18), ext, '#07090d', '#00f0ff', 350, 110),
      clearart_url: makeSvgAsset(artist.slice(0, 18), 'CLEARART', '#07100c', '#00ff9d', 500, 260),
      background_url: makeSvgAsset(album.slice(0, 24), resStr, '#07090d', '#00ff9d', 760, 420),
      thumb_url: coverDataUrl || makeSvgAsset(ext, formatBytes(totalSizeBytes), '#0b1310', '#00ff9d', 220, 130),
    };

    const capturedDataUrls: string[] = [];
    if (coverDataUrl) {
      capturedDataUrls.push(coverDataUrl);
    }
    if (webAudio.spectrumDataUrl) {
      updates.espectrograma_bbcode = `[img]${webAudio.spectrumDataUrl}[/img]`;
      capturedDataUrls.push(webAudio.spectrumDataUrl);
    }

    return {
      kind: 'audio',
      suggestedTemplateId: 'tpl-zinfinal-music',
      updates,
      mediainfoDetails,
      summary: `Audio analizado: ${sorted.length} archivo(s) ${ext} (${formatBytes(totalSizeBytes)}${bitrateKbps ? `, ${bitrateFormatted}` : ''})`,
      capturedDataUrls,
      embeddedFieldCount: Object.keys(updates).length,
    };
  }

  // 4. Video files (.mkv, .mp4, .webm, .mov, .avi, .m4v)
  if (/\.(mkv|mp4|webm|mov|avi|m4v|ts|m2ts)$/i.test(lower)) {
    const parsed = parseReleaseFilename(primary.name);
    const isMkv = /\.(mkv|webm)$/i.test(lower);
    const isMp4 = /\.(mp4|m4v|mov)$/i.test(lower);

    const [ebml, mp4Tags, mp4Streams, htmlProbe] = await Promise.all([
      isMkv ? parseMkvEbmlMetadata(primary) : Promise.resolve(null),
      isMp4 ? parseMp4EmbeddedMetadata(primary) : Promise.resolve(null),
      isMp4 ? parseMp4TechnicalStreams(primary) : Promise.resolve(null),
      probeVideoElementAndCapture(primary, {
        captureCount: options?.captureCount,
        compressionPercent: options?.captureCompressionPercent,
      }),
    ]);

    const ebmlPrimaryVideo = ebml?.videoTracks[0];
    const mp4PrimaryVideo = mp4Streams?.videoTracks[0];

    const width = ebmlPrimaryVideo?.width || mp4PrimaryVideo?.width || htmlProbe.width;
    const height = ebmlPrimaryVideo?.height || mp4PrimaryVideo?.height || htmlProbe.height;
    const durationSec = ebml?.durationSec || mp4Streams?.durationSec || htmlProbe.durationSec;

    let resLabel = parsed.resolution;
    if (width && height) {
      if (height >= 2000 || width >= 3800) resLabel = `2160p 4K (${width}x${height})`;
      else if (height >= 1000 || width >= 1900) resLabel = `1080p Full HD (${width}x${height})`;
      else if (height >= 700 || width >= 1200) resLabel = `720p HD (${width}x${height})`;
      else resLabel = `${width}x${height}`;
    }

    const finalTitle = mp4Tags?.title || ebml?.embeddedTitle || parsed.title;
    const finalYear = (mp4Tags?.year || parsed.year || '').slice(0, 4) || new Date().getFullYear().toString();
    const vCodec =
      ebmlPrimaryVideo?.codec ||
      mp4PrimaryVideo?.codec ||
      parsed.codec ||
      primary.type ||
      'Video';

    const ext = primary.name.split('.').pop()?.toUpperCase() || 'VIDEO';
    const containerName =
      ext === 'MKV'
        ? 'Matroska (MKV)'
        : ext === 'MP4' || ext === 'M4V'
        ? 'MPEG-4 (MP4)'
        : ext === 'WEBM'
        ? 'WebM (Matroska)'
        : ext;
    const durFormatted = durationSec ? formatDurationSeconds(durationSec) : 'N/D';
    const overallBitrateKbps =
      durationSec && durationSec > 0 ? Math.round((primary.size * 8) / durationSec / 1000) : undefined;
    const avgBitrate = formatBitrateKbps(overallBitrateKbps);

    const fpsLabel = ebmlPrimaryVideo?.fps || mp4PrimaryVideo?.fps || '';

    const videoTracks: MediaInfoVideoTrack[] =
      ebml && ebml.videoTracks.length > 0
        ? ebml.videoTracks.map((vt, idx) => ({
            ...vt,
            width: vt.width || width,
            height: vt.height || height,
            resolutionLabel: resLabel || undefined,
            aspectRatio: vt.aspectRatio || computeAspectRatio(vt.width || width, vt.height || height),
            bitrate:
              vt.bitrate ||
              (idx === 0 && overallBitrateKbps ? `${formatBitrateKbps(overallBitrateKbps * 0.88)} (est.)` : undefined),
          }))
        : mp4Streams && mp4Streams.videoTracks.length > 0
        ? mp4Streams.videoTracks.map((vt, idx) => ({
            ...vt,
            width: vt.width || width,
            height: vt.height || height,
            resolutionLabel: resLabel || undefined,
            aspectRatio: vt.aspectRatio || computeAspectRatio(vt.width || width, vt.height || height),
            bitrate:
              vt.bitrate ||
              (idx === 0 && overallBitrateKbps ? `${formatBitrateKbps(overallBitrateKbps * 0.88)} (est.)` : undefined),
          }))
        : [
            {
              index: 1,
              codec: vCodec,
              width,
              height,
              resolutionLabel: resLabel || undefined,
              aspectRatio: computeAspectRatio(width, height),
              fps: fpsLabel || undefined,
              bitrate: overallBitrateKbps ? `${formatBitrateKbps(overallBitrateKbps * 0.88)} (est.)` : undefined,
            },
          ];

    const audioTracks: MediaInfoAudioTrack[] =
      ebml && ebml.audioTracks.length > 0
        ? ebml.audioTracks
        : mp4Streams && mp4Streams.audioTracks.length > 0
        ? mp4Streams.audioTracks
        : [
            {
              index: 1,
              codec: parsed.audio || 'Audio Detectado',
            },
          ];

    const subtitleTracks: MediaInfoSubtitleTrack[] =
      ebml?.subtitleTracks || mp4Streams?.subtitleTracks || [];

    const audioStr = audioTracks
      .map((a) => {
        const lang = a.language && a.language !== 'UND' ? `${a.language} ` : '';
        const ch = a.channelLayout ? ` ${a.channelLayout.split(' ')[0]}` : a.channels ? ` ${a.channels}ch` : '';
        return `${lang}${a.codec}${ch}`.trim();
      })
      .join(' + ');

    const mediaInfoReport = [
      'General',
      `Complete name                            : ${primary.name}`,
      `Format                                   : ${containerName}`,
      `File size                                : ${formatBytes(primary.size)}`,
      `Duration                                 : ${durFormatted}`,
      `Overall bit rate                         : ${avgBitrate}`,
      finalTitle ? `Movie name                               : ${finalTitle}` : null,
      '',
      ...videoTracks.flatMap((vt) => [
        `Video #${vt.index}`,
        `Format                                   : ${vt.codec}${vt.profile ? ` (${vt.profile})` : ''}`,
        vt.bitrate ? `Bit rate                                 : ${vt.bitrate}` : null,
        vt.width && vt.height
          ? `Width x Height                           : ${vt.width} x ${vt.height} pixels${vt.aspectRatio ? ` (${vt.aspectRatio})` : ''}`
          : null,
        vt.fps ? `Frame rate                               : ${vt.fps}` : null,
        vt.bitDepth ? `Bit depth                                : ${vt.bitDepth}` : null,
        vt.colorSpace ? `Color space                              : ${vt.colorSpace}` : null,
      ]),
      '',
      ...audioTracks.flatMap((at) => [
        `Audio #${at.index}`,
        `Format                                   : ${at.codec}`,
        at.bitrate ? `Bit rate                                 : ${at.bitrate}` : null,
        at.channels
          ? `Channel(s)                               : ${at.channels} channels${at.channelLayout ? ` (${at.channelLayout})` : ''}`
          : null,
        at.sampleRate ? `Sampling rate                            : ${at.sampleRate}` : null,
        at.language && at.language !== 'UND' ? `Language                                 : ${at.language}` : null,
      ]),
      subtitleTracks.length > 0
        ? `\nText / Subtitles                         : ${subtitleTracks.map((s) => `${s.language || 'UND'} (${s.format})`).join(', ')}`
        : null,
    ]
      .filter(Boolean)
      .join('\n');

    const mediainfoDetails: MediaInfoDetails = {
      fileName: primary.name,
      container: containerName,
      fileSize: formatBytes(primary.size),
      fileSizeBytes: primary.size,
      duration: durFormatted,
      overallBitrate: avgBitrate,
      videoTracks,
      audioTracks,
      subtitleTracks,
      rawReport: mediaInfoReport,
      analyzedAt: Date.now(),
      sourceKind: 'video',
    };

    const primaryV = videoTracks[0];
    const shortRes =
      height && height >= 2000
        ? '2160p'
        : height && height >= 1000
        ? '1080p'
        : height && height >= 700
        ? '720p'
        : parsed.resolution || (width && height ? `${height}p` : 'HD');
    const shortCodec = /HEVC|H\.?265/i.test(vCodec)
      ? 'HEVC'
      : /AVC|H\.?264/i.test(vCodec)
      ? 'H264'
      : vCodec;
    const isAvcVideo = Boolean(primaryV?.avc) || /AVC|H\.?264/i.test(vCodec);
    const videoRange = primaryV?.colorSpace?.includes('HDR') ? 'HDR' : 'SDR';
    const rawBitDepthNum = (primaryV?.bitDepth || '').replace(/\D+/g, '') || '8';
    const cleanFpsZinfinal = primaryV?.fps || (fpsLabel ? `${fpsLabel}` : '23.976 fps');
    const cleanFpsIdenti = cleanFpsZinfinal.replace(/\s*fps/i, '').trim();
    const rawVideoBitrate =
      primaryV?.bitrate?.replace(/\s*\(est\.\)/i, '').replace(/kb\/s/i, 'kbps') ||
      avgBitrate.replace(/kb\/s/i, 'kbps');
    const resDims =
      primaryV?.width && primaryV?.height
        ? `${primaryV.width}x${primaryV.height}`
        : width && height
        ? `${width}x${height}`
        : shortRes;
    const aspectStr = primaryV?.aspectRatio || computeAspectRatio(width, height) || '16:9';

    const videoInfoZinfinal = [
      `Título: ${finalTitle} (${finalYear}) - ${shortRes} - ${shortCodec} - ${videoRange}`,
      `Códec: ${shortCodec}`,
      `Resolución: ${resDims}`,
      `Relación de aspecto: ${aspectStr}`,
      `Velocidad de cuadros: ${cleanFpsZinfinal}`,
      `Velocidad de bits: ${rawVideoBitrate}`,
      `Profundidad de bit: ${rawBitDepthNum} bit`,
      `Rango de video: ${videoRange}`,
    ].join('\n');

    const videoInfoIdenti = [
      `Título: ${finalTitle} (${finalYear}) - ${shortRes} - ${shortCodec} - ${videoRange}`,
      `Códec: ${shortCodec}`,
      `AVC: ${isAvcVideo ? 'Yes' : 'No'}`,
      `Resolución: ${resDims}`,
      `Relación de aspecto: ${aspectStr}`,
      `Velocidad de cuadros: ${cleanFpsIdenti}`,
      `Velocidad de bits: ${rawVideoBitrate}`,
      `Profundidad de bit: ${rawBitDepthNum} bit`,
      `Rango de video: ${videoRange}`,
    ].join('\n');

    const subsZinfinal =
      subtitleTracks.length > 0
        ? subtitleTracks
            .map((s) => {
              const langLabel = formatSpanishLanguageLabel(s.language);
              const flags = [
                s.isDefault ? 'Por defecto' : null,
                s.isForced ? 'Forzado' : null,
              ].filter(Boolean);
              return [langLabel, s.format || 'ASS', ...flags].join(' - ');
            })
            .join('\n')
        : 'Sin subtítulos incrustados detectados';

    const subsIdenti =
      subtitleTracks.length > 0
        ? subtitleTracks
            .map((s) => `${formatSpanishLanguageLabel(s.language)} - ${s.format || 'ASS'}`)
            .join('\n')
        : 'Sin subtítulos incrustados detectados';

    const audioZinfinal = audioTracks
      .map((a) => {
        const parts = [
          `Pista #${a.index}: ${formatSpanishLanguageLabel(a.language)}`,
          a.codec,
          a.channels ? `${a.channels} canales` : a.channelLayout || null,
          a.sampleRate || null,
          a.bitrate ? a.bitrate.replace(/kb\/s/i, 'kbps') : null,
          a.isDefault ? 'Por defecto' : null,
          a.isForced ? 'Forzado' : null,
        ].filter(Boolean);
        return parts.join(' · ');
      })
      .join('\n');

    const audioIdenti = audioTracks
      .map((a) => {
        const codecWithProfile = a.audioProfile ? `${a.codec} (Perfil: ${a.audioProfile})` : a.codec;
        const parts = [
          `Pista #${a.index}: ${formatSpanishLanguageLabel(a.language)}`,
          codecWithProfile,
          a.channels ? `${a.channels} canales` : a.channelLayout || null,
          a.sampleRate || null,
          a.bitrate ? a.bitrate.replace(/kb\/s/i, 'kbps') : null,
        ].filter(Boolean);
        return parts.join(' · ');
      })
      .join('\n');

    // Las capturas extraídas del archivo se asignan exclusivamente a {{capturas_bbcode}} para no sustituir otros artes.
    const fallbackPoster =
      mp4Tags?.coverDataUrl ||
      makeSvgAsset(finalTitle.slice(0, 22), resLabel || ext, '#0f172a', '#3366ff', 280, 400);
    const fallbackBanner = makeSvgAsset(
      finalTitle.slice(0, 26),
      `${shortRes} · ${shortCodec}`,
      '#0b0e14',
      '#3366ff',
      760,
      140
    );
    const fallbackBackground = makeSvgAsset(
      finalTitle.slice(0, 24),
      `${shortRes} · ${shortCodec}`,
      '#0b0e14',
      '#00f0ff',
      760,
      420
    );

    const updates: Partial<MediaContext> = {
      titulo: finalTitle,
      anio: finalYear,
      resolucion: shortRes || resLabel || 'HD',
      codec_video: shortCodec || vCodec,
      audio_idiomas: parsed.audio || audioStr || 'Audio Detectado',
      duracion: durFormatted,
      peso_archivo: formatBytes(primary.size),
      generos: mp4Tags?.genre || 'Multimedia Local',
      tmdb_rating: '—',
      imdb_rating: '—',
      sinopsis:
        mp4Tags?.description ||
        `Metadatos incrustados extraídos de ${primary.name} (${resLabel || ext}, ${vCodec}, ${audioStr}).`,
      trailer_url: '',
      poster_url: fallbackPoster,
      banner_url: fallbackBanner,
      logo_url: makeSvgAsset(finalTitle.slice(0, 18), shortRes || ext, '#07090d', '#00f0ff', 350, 110),
      clearart_url: makeSvgAsset(finalTitle.slice(0, 18), 'CLEARART', '#0b0e14', '#00ff9d', 500, 260),
      background_url: fallbackBackground,
      thumb_url: makeSvgAsset(ext, formatBytes(primary.size), '#111622', '#00ff9d', 220, 130),
      episodio: parsed.episode || 'Película',
      fuente: parsed.source || ext,
      creditos: parsed.credits || 'PostPro',
      capitulos:
        files.length > 1
          ? `${files.length} archivos`
          : parsed.episode
          ? parsed.episode
          : 'Película',
      password: 'Sin Password',
      notas_uploader: subtitleTracks.length > 0 ? 'Se agregan mis fansubs' : '',
      video_info_bloque: videoInfoZinfinal,
      video_info_identi: videoInfoIdenti,
      subtitulos_info: subsZinfinal,
      subtitulos_identi: subsIdenti,
      audio_info_bloque: audioZinfinal,
      audio_info_identi: audioIdenti,
      mediainfo_completo: mediaInfoReport,
    };

    if (htmlProbe.screenshots.length > 0) {
      updates.capturas_bbcode = buildCapturesBbCode(htmlProbe.screenshots);
    } else {
      updates.capturas_bbcode = `[img]${makeSvgAsset('SIN FOTOGRAMA DECODIFICABLE', 'Contenedor no decodificable en navegador', '#0f172a', '#00f0ff', 340, 190)}[/img]`;
    }

    return {
      kind: 'video',
      suggestedTemplateId: parsed.isAnimeOrSeries ? 'tpl-identi-main' : 'tpl-zinfinal-main',
      updates,
      mediainfoDetails,
      summary: `Video analizado: ${primary.name} (${formatBytes(primary.size)}${width && height ? `, ${width}x${height}` : ''}${fpsLabel ? `, ${fpsLabel}` : ''}${overallBitrateKbps ? `, ${avgBitrate}` : ''}${htmlProbe.screenshots.length > 0 ? `, ${htmlProbe.screenshots.length} capturas` : ''})`,
      capturedDataUrls: htmlProbe.screenshots,
      embeddedFieldCount: Object.keys(updates).length,
    };
  }

  const fallbackRaw = [
    'General',
    `Complete name                            : ${primary.name}`,
    `File size                                : ${formatBytes(primary.size)}`,
  ].join('\n');

  return {
    kind: 'unknown',
    updates: {
      titulo: primary.name,
      peso_archivo: formatBytes(primary.size),
      mediainfo_completo: fallbackRaw,
    },
    mediainfoDetails: {
      fileName: primary.name,
      container: primary.name.split('.').pop()?.toUpperCase() || 'FILE',
      fileSize: formatBytes(primary.size),
      fileSizeBytes: primary.size,
      duration: 'N/D',
      overallBitrate: 'N/D',
      videoTracks: [],
      audioTracks: [],
      subtitleTracks: [],
      rawReport: fallbackRaw,
      analyzedAt: Date.now(),
      sourceKind: 'unknown',
    },
    summary: `Archivo "${primary.name}" (${formatBytes(primary.size)}) analizado`,
    capturedDataUrls: [],
    embeddedFieldCount: 2,
  };
}
