export type ScreenMode = 'welcome' | 'setup' | 'workspace';

export type PanelId = 'editor' | 'compiled' | 'webview' | 'covers' | 'layers' | 'mediainfo';

export type DockSlotKey =
  | 'left-top'
  | 'left-bottom'
  | 'center-main'
  | 'right-top'
  | 'right-bottom'
  | 'bottom-main';

export type ToolKey =
  | 'covers'
  | 'text'
  | 'align'
  | 'media'
  | 'links'
  | 'vars'
  | 'templates'
  | 'ingest'
  | 'artgallery';

export type ImageHostProvider = 'imgbb' | 'postimages' | 'imgur' | 'freeimage' | 'chevereto';

export type TemplateSite = 'identi' | 'zinfinal' | 'custom';

export type YoutubeTrailerPriorityId = 'latino_dubbed' | 'subtitled_es' | 'original_lang';

export interface YoutubeTrailerPriorityRule {
  id: YoutubeTrailerPriorityId;
  label: string;
  description: string;
  querySuffix: string;
  enabled: boolean;
}

export interface YoutubeTrailerResult {
  videoId: string;
  url: string;
  title: string;
  channel: string;
  duration: string;
  views: string;
  published: string;
  thumbnail: string;
  matchedPriorityId: YoutubeTrailerPriorityId;
  matchedPriorityLabel: string;
  priorityRank: number;
  score: number;
  badges: string[];
}

export type ArtworkSourceProvider = 'fanart' | 'tmdb' | 'omdb';

export interface FanartArtworkItem {
  id: string;
  kind: 'logo' | 'banner' | 'clearart' | 'poster' | 'background' | 'thumb' | 'disc';
  source?: ArtworkSourceProvider;
  url: string;
  previewUrl: string;
  lang: string;
  likes: number;
  width?: number;
  height?: number;
}

export interface LinkedFileMeta {
  name: string;
  sizeBytes?: number;
  lastModified?: number;
  relativePath?: string;
}

export type WatermarkPosition =
  | 'bottom-right'
  | 'bottom-left'
  | 'top-right'
  | 'top-left'
  | 'center'
  | 'tiled';

export interface WatermarkSettings {
  userText: string;
  placeText: string;
  position: WatermarkPosition;
  opacity: number;
  color: string;
  scale: 'sm' | 'md' | 'lg';
}

export interface SavedPasswordEntry {
  id: string;
  label?: string;
  value: string;
  uppercase?: boolean;
  createdAt: number;
}

export interface UserConfig {
  ffmpegPath: string;
  ffmpegLinkedFile?: LinkedFileMeta | null;
  mediainfoPath: string;
  mediainfoLinkedFile?: LinkedFileMeta | null;
  useNativeDll: boolean;
  templatesPath: string;
  templatesLinkedFolder?: string | null;
  templatesCountFound?: number;
  mediaFolderLinked?: string | null;
  mediaFilesIndex?: LinkedFileMeta[];
  imgHostProvider: ImageHostProvider;
  imgHostKey: string;
  imgHostFormat: 'direct' | 'thumb';
  imgHostExpire: 'never' | '24h' | '7d' | '30d';
  imgHostEndpoint: string;
  autoUploadCovers: boolean;
  tmdbApiKey: string;
  omdbApiKey: string;
  fanartApiKey: string;
  fanartClientKey: string;
  youtubeApiKey: string;
  youtubeTrailerPriorities: YoutubeTrailerPriorityRule[];
  connectedApiIds: string[];
  autoEnrichOnDrop: boolean;
  watermarkUser: string;
  watermarkPlace: string;
  watermarkPosition: WatermarkPosition;
  watermarkOpacity: number;
  watermarkColor: string;
  watermarkScale: 'sm' | 'md' | 'lg';
  autoBackupEnabled: boolean;
  autoBackupIntervalMinutes: number;
  autoBackupFolderName?: string | null;
  autoBackupCloudUrl?: string;
  customLinkTemplate?: string;
  captureCount: number;
  captureCompressionPercent: number;
  undoHistoryLimit: number;
  savedPasswords?: SavedPasswordEntry[];
}

export interface MediaContext {
  titulo: string;
  anio: string;
  resolucion: string;
  codec_video: string;
  audio_idiomas: string;
  duracion: string;
  peso_archivo: string;
  tmdb_rating: string;
  imdb_rating: string;
  generos: string;
  sinopsis: string;
  trailer_url: string;
  poster_url: string;
  banner_url: string;
  logo_url: string;
  clearart_url: string;
  background_url: string;
  thumb_url: string;
  separator_url: string;
  capturas_bbcode: string;
  mediainfo_completo: string;
  enlaces_descarga: string;
  enlaces_spoiler: string;
  enlaces_identi: string;
  fuente: string;
  servidores: string;
  creditos: string;
  notas_uploader: string;
  capitulos: string;
  password: string;
  video_info_bloque: string;
  video_info_identi: string;
  subtitulos_info: string;
  subtitulos_identi: string;
  audio_info_bloque: string;
  audio_info_identi: string;
  tmdb_id: string;
  imdb_id: string;
  tvdb_id: string;
  mbid_id: string;
  media_type: string;
  artista: string;
  album: string;
  episodio: string;
  tracklist: string;
  espectrograma_bbcode: string;
  [key: string]: string;
}

export interface BbTemplate {
  id: string;
  name: string;
  site?: TemplateSite;
  category?: 'video' | 'music' | 'anime' | 'general';
  titlePattern: string;
  bodyPattern: string;
}

export interface MediaInfoVideoTrack {
  index: number;
  codec: string;
  profile?: string;
  avc?: boolean;
  width?: number;
  height?: number;
  resolutionLabel?: string;
  aspectRatio?: string;
  fps?: string;
  bitrate?: string;
  bitDepth?: string;
  colorSpace?: string;
}

export interface MediaInfoAudioTrack {
  index: number;
  codec: string;
  audioProfile?: string;
  channels?: number;
  channelLayout?: string;
  sampleRate?: string;
  bitDepth?: string;
  bitrate?: string;
  language?: string;
  isDefault?: boolean;
  isForced?: boolean;
}

export interface MediaInfoSubtitleTrack {
  index: number;
  format: string;
  language?: string;
  title?: string;
  isDefault?: boolean;
  isForced?: boolean;
}

export interface MediaInfoDetails {
  fileName: string;
  container: string;
  fileSize: string;
  fileSizeBytes: number;
  duration: string;
  overallBitrate: string;
  videoTracks: MediaInfoVideoTrack[];
  audioTracks: MediaInfoAudioTrack[];
  subtitleTracks: MediaInfoSubtitleTrack[];
  rawReport: string;
  analyzedAt: number;
  sourceKind: 'video' | 'audio' | 'image' | 'text' | 'unknown';
}

export interface OpenDocument {
  id: string;
  name: string;
  dotColor: string;
  templateId: string;
  context: MediaContext;
  customTitle: string | null;
  customBody: string | null;
  mediainfoDetails?: MediaInfoDetails | null;
  fanartGallery?: FanartArtworkItem[];
}

export interface FloatingToolItem {
  label: string;
  open: string;
  close: string;
}

export interface ThemePlugin {
  id: string;
  name: string;
  author: string;
  desc: string;
  vars: Record<string, string>;
  fontFamily?: string;
  soundPack?: 'cyber' | 'retro' | 'matrix' | 'none';
  customBackgroundUrl?: string;
  magicHeader?: string;
  checksum?: string;
}

export interface FunctionalPlugin {
  id: string;
  name: string;
  version: string;
  desc: string;
  enabled: boolean;
}

export interface ApiMappingConfig {
  titulo: string;
  poster_url: string;
  sinopsis: string;
  rating: string;
  generos: string;
  anio: string;
  banner_url?: string;
  logo_url?: string;
  clearart_url?: string;
  background_url?: string;
  trailer_url?: string;
}

export interface ApiProviderConfig {
  id: string;
  name: string;
  category: string;
  method: 'GET' | 'POST';
  url: string;
  headers: Record<string, string>;
  body: string;
  mappings: ApiMappingConfig;
  requiresKey?: 'tmdb' | 'omdb' | 'fanart' | 'custom' | null;
  note?: string;
}

export interface DockSlotState {
  panels: PanelId[];
  active: PanelId | null;
}

export interface FloatingPanelState {
  id: PanelId;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DockState {
  slots: Record<DockSlotKey, DockSlotState>;
  floating: FloatingPanelState[];
}

export interface SplitRatios {
  leftColPct: number;
  centerColPct: number;
  leftTopPct: number;
  rightTopPct: number;
  bottomDockPct: number;
}

export interface SpoilerLinkRow {
  url: string;
  label: string;
  status?: 'idle' | 'checking' | 'active' | 'dead';
  statusMessage?: string;
}

export interface ToastItem {
  id: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
}

export interface ApiVerificationResult {
  ok: boolean;
  status: number;
  statusText?: string;
  latencyMs: number;
  rawJson: unknown;
  rawText: string;
  extracted: Record<string, string>;
  gallery?: FanartArtworkItem[];
  error?: string;
}

export interface ApiPingStatus {
  state: 'checking' | 'connected' | 'disconnected';
  status?: number;
  latencyMs?: number;
  detail?: string;
  checkedAt?: number;
}

export interface RecentMediaProject {
  id: string;
  docName: string;
  templateId: string;
  mediainfoDetails: MediaInfoDetails;
  contextSnapshot: Partial<MediaContext>;
  analyzedAt: number;
}

export type IncrementalBackupKind = 'full' | 'delta';

export type IncrementalBackupTrigger = 'auto-10m' | 'manual';

export interface IncrementalDocumentDelta {
  upserted: OpenDocument[];
  removedIds: string[];
  order: string[];
}

export interface IncrementalStatePatch {
  scalars?: Record<string, unknown>;
  documentsDelta?: IncrementalDocumentDelta;
}

export interface IncrementalBackupRecord {
  id: string;
  chainId: string;
  parentId: string | null;
  sequence: number;
  kind: IncrementalBackupKind;
  createdAt: number;
  trigger: IncrementalBackupTrigger;
  storageMode: 'local-idb' | 'local-folder' | 'cloud-sync';
  stateHash: string;
  changedSections: string[];
  summary: string;
  deltaBytes: number;
  fullBytes: number;
  syncedFolderFile?: string;
  syncedCloudOk?: boolean;
  fullSnapshotJson?: string;
  patch?: IncrementalStatePatch;
}

