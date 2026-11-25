import type {
  ApiProviderConfig,
  BbTemplate,
  DockState,
  FloatingToolItem,
  FunctionalPlugin,
  MediaContext,
  OpenDocument,
  SavedPasswordEntry,
  SplitRatios,
  ThemePlugin,
  UserConfig,
  YoutubeTrailerPriorityRule,
} from '../types';

export const DEFAULT_SAVED_PASSWORDS: SavedPasswordEntry[] = [
  {
    id: 'pw-none',
    label: 'Sin contraseña',
    value: 'Sin Password',
    uppercase: false,
    createdAt: 1700000000000,
  },
  {
    id: 'pw-zinfinal',
    label: 'Zinfinal',
    value: 'WWW.ZINFINAL.COM',
    uppercase: true,
    createdAt: 1700000001000,
  },
  {
    id: 'pw-identi',
    label: 'Identi',
    value: 'WWW.IDENTI.LI',
    uppercase: true,
    createdAt: 1700000002000,
  },
];

export const DEFAULT_YOUTUBE_PRIORITIES: YoutubeTrailerPriorityRule[] = [
  {
    id: 'latino_dubbed',
    label: 'Trailer oficial doblado al español latino',
    description: 'Prioriza tráilers oficiales con audio/doblaje en español latino.',
    querySuffix: 'trailer oficial español latino',
    enabled: true,
  },
  {
    id: 'subtitled_es',
    label: 'Trailer original subtitulado al español',
    description: 'Secundario: tráiler en idioma original con subtítulos en español.',
    querySuffix: 'trailer oficial subtitulado español',
    enabled: true,
  },
  {
    id: 'original_lang',
    label: 'Trailer original en su idioma original',
    description: 'Tercero: tráiler oficial en su idioma original sin doblaje ni subtítulos.',
    querySuffix: 'official trailer',
    enabled: true,
  },
];

export function makeSvgAsset(
  title: string,
  subtitle: string,
  bg: string,
  accent: string,
  w: number,
  h: number
): string {
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="${bg}" />
        <stop offset="100%" stop-color="#05070b" />
      </linearGradient>
    </defs>
    <rect width="${w}" height="${h}" fill="url(#g)" />
    <rect x="4" y="4" width="${w - 8}" height="${h - 8}" rx="8" fill="none" stroke="${accent}" stroke-opacity="0.45" stroke-width="2" />
    <text x="50%" y="48%" dominant-baseline="middle" text-anchor="middle" fill="${accent}" font-family="Consolas, monospace" font-weight="700" font-size="${Math.max(12, Math.min(24, Math.round(h / 7)))}">${esc(title)}</text>
    ${subtitle ? `<text x="50%" y="66%" dominant-baseline="middle" text-anchor="middle" fill="#cbd5e1" font-family="Segoe UI, sans-serif" font-size="${Math.max(10, Math.min(14, Math.round(h / 12)))}">${esc(subtitle)}</text>` : ''}
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export const DEFAULT_USER_CONFIG: UserConfig = {
  ffmpegPath: '',
  ffmpegLinkedFile: null,
  mediainfoPath: '',
  mediainfoLinkedFile: null,
  useNativeDll: true,
  templatesPath: '',
  templatesLinkedFolder: null,
  templatesCountFound: 4,
  mediaFolderLinked: null,
  mediaFilesIndex: [],
  imgHostProvider: 'imgbb',
  imgHostKey: '',
  imgHostFormat: 'direct',
  imgHostExpire: 'never',
  imgHostEndpoint: '',
  autoUploadCovers: false,
  tmdbApiKey: '',
  omdbApiKey: '',
  fanartApiKey: '',
  fanartClientKey: '',
  youtubeApiKey: '',
  youtubeTrailerPriorities: DEFAULT_YOUTUBE_PRIORITIES.map((r) => ({ ...r })),
  connectedApiIds: [],
  autoEnrichOnDrop: true,
  watermarkUser: '',
  watermarkPlace: '',
  watermarkPosition: 'bottom-right',
  watermarkOpacity: 0.82,
  watermarkColor: '#ffffff',
  watermarkScale: 'md',
  autoBackupEnabled: true,
  autoBackupIntervalMinutes: 10,
  autoBackupFolderName: null,
  autoBackupCloudUrl: '',
  customLinkTemplate: '[center][spoiler][url=link]GDrive[/url][/spoiler][/center]',
  captureCount: 6,
  captureCompressionPercent: 25,
  undoHistoryLimit: 10,
  savedPasswords: DEFAULT_SAVED_PASSWORDS.map((p) => ({ ...p })),
};

export const THEME_PLUGINS: ThemePlugin[] = [
  {
    id: 'cyberpunk-cyan',
    name: 'Cyberpunk 2077 Cyan (Oficial)',
    author: 'PostPro Core',
    desc: 'Interfaz CAD oscura con acentos cian neón #00f0ff y magenta #ff0055.',
    vars: {
      '--bg-void': '#0b0e14',
      '--bg-panel': '#111622',
      '--bg-elevated': '#182030',
      '--bg-canvas': '#07090d',
      '--border-color': '#243044',
      '--accent-cyan': '#00f0ff',
      '--accent-magenta': '#ff0055',
      '--accent-green': '#00ff9d',
      '--accent-purple': '#9d4edd',
      '--grid-line': 'rgba(0, 240, 255, 0.045)',
    },
  },
  {
    id: 'arasaka-crimson',
    name: 'Arasaka Crimson Neon',
    author: 'NightCity UI',
    desc: 'Estética corporativa rojo láser #ff2a55 y cian táctico sobre carbón profundo.',
    vars: {
      '--bg-void': '#100a0d',
      '--bg-panel': '#181014',
      '--bg-elevated': '#23161d',
      '--bg-canvas': '#090507',
      '--border-color': '#3d222e',
      '--accent-cyan': '#ff2a55',
      '--accent-magenta': '#ff9e00',
      '--accent-green': '#00f5d4',
      '--accent-purple': '#f72585',
      '--grid-line': 'rgba(255, 42, 85, 0.05)',
    },
  },
  {
    id: 'netrunner-matrix',
    name: 'Netrunner Matrix Terminal',
    author: 'ZeroDay Dev',
    desc: 'Terminal fósforo verde #00ff9d con contrastes cian eléctrico.',
    vars: {
      '--bg-void': '#07100c',
      '--bg-panel': '#0d1914',
      '--bg-elevated': '#13241d',
      '--bg-canvas': '#040907',
      '--border-color': '#1e3a2f',
      '--accent-cyan': '#00ff9d',
      '--accent-magenta': '#00e5ff',
      '--accent-green': '#aacc00',
      '--accent-purple': '#38b000',
      '--grid-line': 'rgba(0, 255, 157, 0.05)',
    },
  },
  {
    id: 'synthwave-violet',
    name: 'Synthwave Violet Overdrive',
    author: 'RetroWave Studio',
    desc: 'Atmósfera ultravioleta #b5179e con destellos cian neón.',
    vars: {
      '--bg-void': '#0d0916',
      '--bg-panel': '#150f24',
      '--bg-elevated': '#1f1636',
      '--bg-canvas': '#08050e',
      '--border-color': '#352659',
      '--accent-cyan': '#4cc9f0',
      '--accent-magenta': '#f72585',
      '--accent-green': '#06d6a0',
      '--accent-purple': '#b5179e',
      '--grid-line': 'rgba(181, 23, 158, 0.055)',
    },
  },
];

export const DEFAULT_FUNCTIONAL_PLUGINS: FunctionalPlugin[] = [
  {
    id: 'ext-translator',
    name: 'Limpiador HTML & Formato Sinopsis',
    version: 'v1.4.2',
    desc: 'Limpia etiquetas HTML residuales de respuestas API (TVMaze/AniList) antes de insertarlas al post.',
    enabled: true,
  },
  {
    id: 'ext-jd-bridge',
    name: 'Contenedor JDownloader [jd]',
    version: 'v2.1.0',
    desc: 'Formatea bloques [jd] compatibles con Click’n’Load y enlaces multi-host.',
    enabled: true,
  },
  {
    id: 'ext-batch-scanner',
    name: 'Escáner Múltiple de Medios',
    version: 'v1.2.0',
    desc: 'Al soltar múltiples pistas FLAC/MP3 o episodios, genera el tracklist o lista completa automáticamente.',
    enabled: true,
  },
  {
    id: 'ext-auto-uploader',
    name: 'Auto-Uploader Host Imágenes',
    version: 'v3.0.1',
    desc: 'Sube capturas, espectrogramas y covers arrastrados al servidor configurado cuando hay API Key.',
    enabled: true,
  },
];

export const DEFAULT_API_PROVIDERS: ApiProviderConfig[] = [
  {
    id: 'prov-anilist',
    name: 'AniList GraphQL (Anime)',
    category: 'Anime',
    method: 'POST',
    url: 'https://graphql.anilist.co',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(
      {
        query:
          'query($s:String){Media(search:$s,type:ANIME){title{romaji}description(asHtml:false) coverImage{extraLarge} bannerImage averageScore genres seasonYear trailer{id site}}}',
        variables: { s: '{{query}}' },
      },
      null,
      2
    ),
    mappings: {
      titulo: '$.data.Media.title.romaji',
      poster_url: '$.data.Media.coverImage.extraLarge',
      banner_url: '$.data.Media.bannerImage',
      sinopsis: '$.data.Media.description',
      rating: '$.data.Media.averageScore',
      generos: '$.data.Media.genres[*]',
      anio: '$.data.Media.seasonYear',
    },
    requiresKey: null,
    note: 'API pública sin clave requerida',
  },
  {
    id: 'prov-tvmaze',
    name: 'TVMaze API (Series)',
    category: 'Video',
    method: 'GET',
    url: 'https://api.tvmaze.com/singlesearch/shows?q={{query}}',
    headers: { Accept: 'application/json' },
    body: '',
    mappings: {
      titulo: '$.name',
      poster_url: '$.image.original',
      sinopsis: '$.summary',
      rating: '$.rating.average',
      generos: '$.genres[*]',
      anio: '$.premiered',
    },
    requiresKey: null,
    note: 'API pública sin clave requerida',
  },
  {
    id: 'prov-itunes',
    name: 'iTunes Search API (Música & Álbumes)',
    category: 'Música',
    method: 'GET',
    url: 'https://itunes.apple.com/search?term={{query}}&entity=album&limit=1',
    headers: { Accept: 'application/json' },
    body: '',
    mappings: {
      titulo: '$.results[0].collectionName',
      poster_url: '$.results[0].artworkUrl100',
      sinopsis: '$.results[0].copyright',
      rating: '$.results[0].trackCount',
      generos: '$.results[0].primaryGenreName',
      anio: '$.results[0].releaseDate',
    },
    requiresKey: null,
    note: 'API pública sin clave requerida',
  },
  {
    id: 'prov-musicbrainz',
    name: 'MusicBrainz API (Música)',
    category: 'Música',
    method: 'GET',
    url: 'https://musicbrainz.org/ws/2/release/?query={{query}}&fmt=json&limit=1',
    headers: {
      Accept: 'application/json',
      'User-Agent': 'PostProStudio/1.1 (desktop-bbcode-tool)',
    },
    body: '',
    mappings: {
      titulo: '$.releases[0].title',
      poster_url: '',
      sinopsis: '$.releases[0].disambiguation',
      rating: '$.releases[0].score',
      generos: '$.releases[0].country',
      anio: '$.releases[0].date',
    },
    requiresKey: null,
    note: 'API pública sin clave requerida',
  },
  {
    id: 'prov-tmdb',
    name: 'TMDB API v3 (Cine & Series)',
    category: 'Video',
    method: 'GET',
    url: 'https://api.themoviedb.org/3/search/multi?api_key={{tmdbKey}}&language=es-ES&query={{query}}',
    headers: { Accept: 'application/json' },
    body: '',
    mappings: {
      titulo: '$.results[0].title',
      poster_url: 'https://image.tmdb.org/t/p/w500{{$.results[0].poster_path}}',
      background_url: 'https://image.tmdb.org/t/p/w1280{{$.results[0].backdrop_path}}',
      sinopsis: '$.results[0].overview',
      rating: '$.results[0].vote_average',
      generos: '',
      anio: '$.results[0].release_date',
    },
    requiresKey: 'tmdb',
    note: 'Requiere TMDB API Key en Configuración',
  },
  {
    id: 'prov-omdb',
    name: 'OMDb / IMDb API',
    category: 'Video',
    method: 'GET',
    url: 'https://www.omdbapi.com/?apikey={{omdbKey}}&t={{query}}&plot=full',
    headers: { Accept: 'application/json' },
    body: '',
    mappings: {
      titulo: '$.Title',
      poster_url: '$.Poster',
      sinopsis: '$.Plot',
      rating: '$.imdbRating',
      generos: '$.Genre',
      anio: '$.Year',
    },
    requiresKey: 'omdb',
    note: 'Requiere OMDb API Key en Configuración',
  },
  {
    id: 'prov-fanart',
    name: 'Fanart.tv API v3.2 (Logos, Banners, ClearArt)',
    category: 'Video',
    method: 'GET',
    url: 'https://webservice.fanart.tv/v3.2/movies/{{query}}?api_key={{fanartKey}}&client_key={{fanartClientKey}}',
    headers: { Accept: 'application/json' },
    body: '',
    mappings: {
      titulo: '$.name',
      poster_url: '$.movieposter[0].url',
      banner_url: '$.moviebanner[0].url',
      logo_url: '$.hdmovielogo[0].url',
      clearart_url: '$.hdmovieclearart[0].url',
      background_url: '$.moviebackground[0].url',
      sinopsis: '',
      rating: '',
      generos: '',
      anio: '',
    },
    requiresKey: 'fanart',
    note: 'Se encadena tras TMDB/OMDb/TVMaze/MusicBrainz para obtener Logos HD, Banners y ClearArt',
  },
];

export const MEDIA_SCENARIOS: Record<'movie' | 'music' | 'anime', MediaContext> = {
  movie: {
    titulo: 'Demon Slayer: Kimetsu no Yaiba Castillo infinito',
    anio: '2025',
    resolucion: '2160pAI',
    codec_video: 'HEVC',
    audio_idiomas: 'Trial + Multisubs',
    duracion: '2h 35m',
    peso_archivo: '16.5 GiB',
    tmdb_rating: '8.8',
    imdb_rating: '8.7',
    generos: 'Animación, Acción, Fantasía',
    sinopsis:
      'Tanjirō Kamado es un chico que se unió a una organización dedicada a cazar demonios después de que su hermana menor, Nezuko, fuera convertida. Mientras los miembros de la organización y los Pilares participaban en un programa de entrenamiento grupal, Muzan Kibutsuji aparece en la Mansión Ubuyashiki y arrastra a los cazadores al Castillo Infinito para dar fin a la guerra entre humanos y demonios.',
    trailer_url: 'https://youtu.be/1iBnWJKbvHI',
    poster_url: makeSvgAsset('CASTILLO INFINITO', 'POSTER 2160p', '#0f172a', '#3366ff', 280, 400),
    banner_url: makeSvgAsset('BANNER FANART.TV', 'Separador Gráfico Zinfinal', '#0b0e14', '#3366ff', 760, 140),
    logo_url: makeSvgAsset('KIMETSU NO YAIBA', 'LOGO HD (350px)', '#07090d', '#00f0ff', 350, 110),
    clearart_url: makeSvgAsset('CLEARART HD', 'Fanart.tv ClearArt', '#0b0e14', '#00ff9d', 500, 260),
    background_url: makeSvgAsset('BACKDROP 4K', 'Fanart.tv Background', '#07090d', '#3366ff', 760, 420),
    thumb_url: makeSvgAsset('THUMB 4K', 'Preview', '#111622', '#00ff9d', 220, 130),
    separator_url: makeSvgAsset('━━━━━━ SEPARADOR ━━━━━━', '', '#0b0e14', '#3366ff', 680, 36),
    capturas_bbcode: `[img]${makeSvgAsset('CAPTURA 01', 'Arrastra un MP4/MKV para generar fotogramas', '#0f172a', '#00f0ff', 340, 190)}[/img] [img]${makeSvgAsset('CAPTURA 02', 'Extractor de Fotogramas', '#0f172a', '#3366ff', 340, 190)}[/img]`,
    mediainfo_completo:
      'General\nComplete name : Demon.Slayer.Castillo.Infinito.2025.2160p.BDRip.HEVC.mkv\nFormat : Matroska | File size : 16.5 GiB | Duration : 2 h 35 min\nVideo : HEVC 3840x2160 @ 23.976 fps (10-bit SDR)\nAudio #1 : Japanese E-AC-3 5.1 @ 640 kb/s\nAudio #2 : Spanish Latino AAC 2.0 @ 192 kb/s',
    enlaces_descarga: 'https://drive.google.com/file/d/castillo_infinito\nhttps://mega.nz/file/castillo_infinito_2160p',
    enlaces_spoiler:
      '[center][spoiler][url=https://drive.google.com/file/d/castillo_infinito]GDrive[/url][/spoiler][/center]\n[center][spoiler][url=https://mega.nz/file/castillo_infinito_2160p]MEGA[/url][/spoiler][/center]',
    enlaces_identi:
      '[center][spoiler][url=https://drive.google.com/file/d/castillo_infinito]GDrive[/url][/spoiler][/center]\n[center][spoiler][url=https://mega.nz/file/castillo_infinito_2160p]MEGA[/url][/spoiler][/center]',
    fuente: 'BDRip',
    servidores: 'Drive | Mega',
    creditos: 'PostPro',
    notas_uploader: 'Se agregan mis fansubs',
    capitulos: 'Película',
    password: 'Sin Password',
    video_info_bloque: `Título: Demon Slayer: Kimetsu no Yaiba Castillo infinito (2025) - 2160p - HEVC - SDR
Códec: HEVC
Resolución: 3840x2160
Relación de aspecto: 16:9
Velocidad de cuadros: 23.976 fps
Velocidad de bits: 15300 kbps
Profundidad de bit: 10 bit
Rango de video: SDR`,
    video_info_identi: `Título: Demon Slayer: Kimetsu no Yaiba Castillo infinito (2025) - 2160p - HEVC - SDR
Códec: HEVC
AVC: No
Resolución: 3840x2160
Relación de aspecto: 16:9
Velocidad de cuadros: 23.976
Velocidad de bits: 15300 kbps
Profundidad de bit: 10 bit
Rango de video: SDR`,
    subtitulos_info: `Spanish - Español Latino - ASS - Por defecto
English - Inglés - ASS`,
    subtitulos_identi: `Spanish - Español Latino - ASS
English - Inglés - ASS`,
    audio_info_bloque: `Pista #1: Japanese - Japonés · E-AC-3 · 6 canales · 48.0 kHz · 640 kbps · Por defecto
Pista #2: Spanish - Español Latino · AAC · 2 canales · 48.0 kHz · 192 kbps`,
    audio_info_identi: `Pista #1: Japanese - Japonés · E-AC-3 · 6 canales · 48.0 kHz · 640 kbps
Pista #2: Spanish - Español Latino · AAC (Perfil: LC) · 2 canales · 48.0 kHz · 192 kbps`,
    tmdb_id: '1311031',
    imdb_id: '',
    tvdb_id: '',
    mbid_id: '',
    media_type: 'movie',
    artista: 'Yuki Kajiura & Go Shiina',
    album: 'Kimetsu no Yaiba OST',
    episodio: 'Película',
    tracklist: '01. Infinity Castle Theme (05:12)',
    espectrograma_bbcode: `[img]${makeSvgAsset('ESPECTROGRAMA', 'Arrastra un audio FLAC/MP3', '#07090d', '#00ff9d', 640, 200)}[/img]`,
  },
  music: {
    titulo: 'Random Access Memories',
    artista: 'Daft Punk',
    album: 'Random Access Memories',
    anio: '2013',
    resolucion: 'FLAC 24-bit / 88.2kHz',
    codec_video: 'Lossless PCM',
    audio_idiomas: 'FLAC 24-bit / 88.2 kHz (2780 kbps)',
    duracion: '1h 14m',
    peso_archivo: '1.48 GiB',
    tmdb_rating: '9.4',
    imdb_rating: '9.2',
    generos: 'Electronic, Disco, French House, Funk',
    sinopsis:
      'Cuarto álbum de estudio del dúo francés Daft Punk, grabado con instrumentación analógica en vivo.',
    trailer_url: 'https://www.youtube.com/watch?v=5NV6Rdv1a3I',
    poster_url: makeSvgAsset('DAFT PUNK', 'Random Access Memories', '#0b1310', '#00ff9d', 300, 300),
    banner_url: makeSvgAsset('RANDOM ACCESS MEMORIES', 'Banner Fanart.tv Música', '#07100c', '#00ff9d', 760, 140),
    logo_url: makeSvgAsset('DAFT PUNK', 'HD MUSIC LOGO', '#07090d', '#00ff9d', 350, 110),
    clearart_url: makeSvgAsset('CLEARART MÚSICA', 'Fanart.tv Artist Art', '#07100c', '#00f0ff', 500, 260),
    background_url: makeSvgAsset('ARTIST BACKDROP', 'Fanart.tv 4K', '#07090d', '#00ff9d', 760, 420),
    thumb_url: makeSvgAsset('FLAC 24BIT', 'Audio Cover', '#0d1914', '#00f0ff', 220, 130),
    separator_url: makeSvgAsset('━━━━━━ TRACKLIST LOSSLESS ━━━━━━', '', '#07100c', '#00ff9d', 680, 36),
    capturas_bbcode: `[img]${makeSvgAsset('SPECTRUM ANALYZER', 'Web Audio API / Canvas', '#07090d', '#00ff9d', 640, 200)}[/img]`,
    espectrograma_bbcode: `[img]${makeSvgAsset('SPECTRUM ANALYZER', 'Arrastra tus FLAC/MP3 para analizar', '#07090d', '#00ff9d', 640, 200)}[/img]`,
    tracklist:
      '01. Give Life Back to Music (04:34)\n02. The Game of Love (05:22)\n03. Giorgio by Moroder (09:04)\n04. Within (03:48)\n05. Instant Crush (05:37)\n06. Lose Yourself to Dance (05:53)\n07. Get Lucky (06:09)',
    mediainfo_completo:
      'General\nAlbum : Random Access Memories\nPerformer : Daft Punk | Recorded date : 2013\nAudio : FLAC 24 bits @ 88.2 kHz (2 channels, 2 780 kb/s)',
    enlaces_descarga: 'https://mega.nz/folder/daftpunk_ram_flac\nhttps://www.mediafire.com/file/ram_24bit.rar',
    enlaces_spoiler:
      '[center][spoiler][url=https://mega.nz/folder/daftpunk_ram_flac]MEGA — Álbum FLAC 24-Bit[/url][/spoiler][/center]\n[center][spoiler][url=https://www.mediafire.com/file/ram_24bit.rar]MediaFire — Mirror RAR[/url][/spoiler][/center]',
    enlaces_identi:
      '[center][spoiler][url=https://mega.nz/folder/daftpunk_ram_flac]MEGA — Álbum FLAC 24-Bit[/url][/spoiler][/center]\n[center][spoiler][url=https://www.mediafire.com/file/ram_24bit.rar]MediaFire — Mirror RAR[/url][/spoiler][/center]',
    fuente: 'WEB FLAC 24-bit',
    servidores: 'Mega | MediaFire',
    creditos: 'PostPro',
    notas_uploader: 'Incluye espectrogramas verificados y carátulas',
    capitulos: '13 Pistas',
    password: 'Sin Password',
    video_info_bloque: `Formato: FLAC Lossless\nProfundidad de bit: 24 bit\nFrecuencia de muestreo: 88.2 kHz\nVelocidad de bits: 2780 kbps`,
    video_info_identi: `Formato: FLAC Lossless\nProfundidad de bit: 24 bit\nFrecuencia de muestreo: 88.2 kHz\nVelocidad de bits: 2780 kbps`,
    subtitulos_info: 'No aplica (Álbum musical)',
    subtitulos_identi: 'No aplica',
    audio_info_bloque: `Pista #1: FLAC · 24 bits · 88.2 kHz · 2 canales · 2780 kbps`,
    audio_info_identi: `Pista #1: FLAC · 24 bits · 88.2 kHz · 2 canales · 2780 kbps`,
    tmdb_id: '',
    imdb_id: '',
    tvdb_id: '',
    mbid_id: '056e4f3e-d505-4dad-8ec1-d04f521cbb56',
    media_type: 'music',
    episodio: 'Álbum Completo',
  },
  anime: {
    titulo: 'Even the Student Council Has Its Holes',
    episodio: 'S1E1-7',
    anio: '2026',
    resolucion: '1080p',
    codec_video: 'H264',
    audio_idiomas: 'Sub',
    duracion: '24m 00s',
    peso_archivo: '1.23 Gb',
    tmdb_rating: '8.4',
    imdb_rating: '8.2',
    generos: 'Comedia, Escolar, Slice of Life',
    sinopsis:
      'En la prestigiosa Academia Fujinasu, un instituto privado a las afueras de la ciudad, Ume Mizunoe, una joven entusiasta de la literatura, acepta formar parte del consejo estudiantil para no tener que repetir curso. Sin embargo, los miembros del consejo estudiantil resultan ser un grupo de individuos muy extraños.',
    trailer_url: 'https://youtu.be/yXWE0vQwJ_o',
    poster_url: makeSvgAsset('STUDENT COUNCIL', 'POSTER 1080p', '#180c1c', '#80ffea', 280, 400),
    banner_url: makeSvgAsset('SEPARADOR IDENTI', 'Banner Fanart.tv TV/Anime', '#120816', '#80ffea', 760, 140),
    logo_url: makeSvgAsset('STUDENT COUNCIL', 'LOGO HD', '#07090d', '#80ffea', 350, 110),
    clearart_url: makeSvgAsset('CLEARART SERIE', 'Fanart.tv ClearArt', '#120816', '#3366ff', 500, 260),
    background_url: makeSvgAsset('SERIE BACKDROP', 'Fanart.tv ShowBackground', '#07090d', '#80ffea', 760, 420),
    thumb_url: makeSvgAsset('S1E1-7 HD', 'Episode Thumb', '#181014', '#80ffea', 220, 130),
    separator_url: makeSvgAsset('━━━━━━ SEPARADOR IDENTI ━━━━━━', '', '#120816', '#80ffea', 680, 36),
    capturas_bbcode: `[img]${makeSvgAsset('CAPTURA 01', 'Arrastra el episodio MKV/MP4', '#180c1c', '#80ffea', 340, 190)}[/img] [img]${makeSvgAsset('CAPTURA 02', 'Extractor de Fotogramas', '#180c1c', '#3366ff', 340, 190)}[/img]`,
    mediainfo_completo:
      'General\nComplete name : Even.the.Student.Council.Has.Its.Holes.S01E01-07.1080p.WEB-DL.H264.mkv\nVideo : AVC (H.264) 1920x1080 @ 23.976025 fps (8 bit SDR)\nAudio #1 : Japanese AAC LC 2.0 @ 128 kb/s',
    enlaces_descarga: 'https://drive.google.com/file/d/student_council_ep1_7\nhttps://megaup.net/student_council_ep1_7',
    enlaces_spoiler:
      '[center][spoiler][url=https://drive.google.com/file/d/student_council_ep1_7]GDrive[/url][/spoiler][/center]\n[center][spoiler][url=https://megaup.net/student_council_ep1_7]MegaUp — Mirror 1080p[/url][/spoiler][/center]',
    enlaces_identi:
      '[center][spoiler][url=https://drive.google.com/file/d/student_council_ep1_7]GDrive[/url][/spoiler][/center]\n[center][spoiler][url=https://megaup.net/student_council_ep1_7]MegaUp — Mirror 1080p[/url][/spoiler][/center]',
    fuente: 'Web-dl ADN (Sin Censura)',
    servidores: 'Drive | MegaUp',
    creditos: 'Varyg',
    notas_uploader: 'Se agregan mis fansubs',
    capitulos: '7/12',
    password: 'Sin Password',
    video_info_bloque: `Título: Perdidos en el momento / Ume y Hiratsuka-sensei - 1080p - H264 - SDR
Códec: H264
Resolución: 1920x1080
Relación de aspecto: 16:9
Velocidad de cuadros: 23.976025 fps
Velocidad de bits: 3850 kbps
Profundidad de bit: 8 bit
Rango de video: SDR`,
    video_info_identi: `Título: Perdidos en el momento / Ume y Hiratsuka-sensei / Un día en la vida de Komaro - 1080p - H264 - SDR
Códec: H264
AVC: Yes
Resolución: 1920x1080
Relación de aspecto: 16:9
Velocidad de cuadros: 23.976025
Velocidad de bits: 3850 kbps
Profundidad de bit: 8 bit
Rango de video: SDR`,
    subtitulos_info: `English - Inglés - ASS - Por defecto
Spanish - Español Latino - ASS`,
    subtitulos_identi: `English - Inglés - ASS
French - Francés - ASS
Spanish - Español Latino - ASS`,
    audio_info_bloque: `Pista #1: Japanese - Japonés · AAC · 2 canales · 48.0 kHz · 128 kbps · Por defecto`,
    audio_info_identi: `Pista #1: Japanese - Japonés · AAC (Perfil: LC) · 2 canales · 48.0 kHz · 128 kbps`,
    tmdb_id: '',
    imdb_id: '',
    tvdb_id: '',
    mbid_id: '',
    media_type: 'tv',
    artista: 'Anime Studio',
    album: 'OST',
    tracklist: '01. Opening Theme (01:30)',
    espectrograma_bbcode: `[img]${makeSvgAsset('AUDIO SPECTRUM', 'AAC / FLAC', '#07090d', '#80ffea', 640, 200)}[/img]`,
  },
};

export const DEFAULT_TEMPLATES: BbTemplate[] = [
  {
    id: 'tpl-zinfinal-main',
    name: 'Zinfinal Aensy Style',
    site: 'zinfinal',
    category: 'video',
    titlePattern: '{{titulo}} ({{anio}}) {{fuente}} {{resolucion}} {{audio_idiomas}}',
    bodyPattern: `[center][b][color=#244061][size=24]{{titulo}} ({{anio}}) {{fuente}} {{resolucion}} {{audio_idiomas}}[/size][/color][/b][/center]

[center][img size=350]{{logo_url}}[/img][/center]

[img]{{poster_url}}[/img]

[youtube]{{trailer_url}}[/youtube]

[center][size=22][i][b][color=#3366ff]Sinopsis[/color][/b][/i][/size]

{{sinopsis}}

[/center]

[center][size=22][i][b][color=#3366ff]Vídeo[/color][/b][/i][/size]

{{video_info_bloque}}
Peso total: {{peso_archivo}}
Servidores: {{servidores}}

Fuente: {{fuente}}

Créditos: {{creditos}}

{{notas_uploader}}
[/center]

[center][size=22][i][b][color=#3366ff]Subtítulos[/color][/b][/i][/size]

{{subtitulos_info}}
[/center]

[center][size=22][i][b][color=#3366ff]Audio[/color][/b][/i][/size]

{{audio_info_bloque}}
[/center]

[img]{{banner_url}}[/img]

[center][size=35][i][b][color=#3366ff]Capturas[/color][/b][/i][/size][/center]

[center]{{capturas_bbcode}}[/center]

[center][size=35][i][b][color=#3366ff]Descarga[/color][/b][/i][/size][/center]

{{enlaces_spoiler}}

[center][img]{{clearart_url}}[/img][/center]

[center][size=22][i][b][color=#3366ff]PASSWORD[/color][/b][/i][/size][/center]

[center]{{password}}[/center]

[center][size=20][b][color=#33cc33]Si te gustó mi contenido, comparte y comenta :D[/color][/b][/size][/center]`,
  },
  {
    id: 'tpl-identi-main',
    name: 'Identi — Series / Cine / Anime',
    site: 'identi',
    category: 'video',
    titlePattern: '{{titulo}} {{fuente}} {{episodio}} ({{anio}}) {{resolucion}}',
    bodyPattern: `[center][b][color=#244061][size=4]{{titulo}} {{fuente}} {{episodio}} ({{anio}}) {{resolucion}}[/size][/color][/b][/center]

[img]{{logo_url}}[/img]

[img]{{poster_url}}[/img]

[youtube]{{trailer_url}}[/youtube]

[img]{{banner_url}}[/img]

[center][b][size=5][color=#80ffea]Sinopsis[/color][/size][/b][/center]

[center]{{sinopsis}}

[/center]

[img]{{banner_url}}[/img]

[center][b][size=25][color=#80ffea]Video[/color][/size][/b]

{{video_info_identi}}
Capitulos: {{capitulos}}
Peso total: {{peso_archivo}}
Servidores: {{servidores}}

Fuente: {{fuente}}

Creditos: {{creditos}}

{{notas_uploader}}

[/center]

[center][b][size=25][color=#80ffea]Subtitulos[/color][/size][/b]

{{subtitulos_identi}}

[/center]

[center][b][size=25][color=#80ffea]Audio[/color][/size][/b]

{{audio_info_identi}}

[/center]

[img]{{banner_url}}[/img]

[center][b][size=30][color=#80ffea]Capturas[/color][/size][/b][/center]

[center]{{capturas_bbcode}}[/center]

{{enlaces_identi}}

[center][img]{{clearart_url}}[/img][/center]

[center][size=5][i][b][color=#3366ff]PASSWORD[/color][/b][/i][/size][/center]

[center]{{password}}[/center]

[center][size=4][b][color=#33cc33]Si te gustó mi contenido, comparte y comenta :D[/color][/b][/size][/center]`,
  },
  {
    id: 'tpl-zinfinal-music',
    name: 'Zinfinal — Música FLAC / MP3',
    site: 'zinfinal',
    category: 'music',
    titlePattern: '{{artista}} - {{album}} ({{anio}}) [{{resolucion}}]',
    bodyPattern: `[center][b][color=#244061][size=24]{{artista}} - {{album}} ({{anio}}) [{{resolucion}}][/size][/color][/b][/center]

[center][img size=350]{{logo_url}}[/img][/center]

[img]{{poster_url}}[/img]

[center][size=22][i][b][color=#3366ff]Ficha del Álbum[/color][/b][/i][/size]

Artista: {{artista}}
Álbum: {{album}}
Géneros: {{generos}}
Calidad: {{audio_idiomas}}
Duración: {{duracion}}
Peso total: {{peso_archivo}}
Servidores: {{servidores}}
Créditos: {{creditos}}
[/center]

[center][size=22][i][b][color=#3366ff]Tracklist[/color][/b][/i][/size]

[quote]{{tracklist}}[/quote]
[/center]

[img]{{banner_url}}[/img]

[center][size=35][i][b][color=#3366ff]Espectrograma[/color][/b][/i][/size][/center]

[center]{{espectrograma_bbcode}}[/center]

[center][size=35][i][b][color=#3366ff]Descarga[/color][/b][/i][/size][/center]

{{enlaces_spoiler}}

[center][img]{{clearart_url}}[/img][/center]

[center][size=22][i][b][color=#3366ff]PASSWORD[/color][/b][/i][/size][/center]

[center]{{password}}[/center]

[center][size=20][b][color=#33cc33]Si te gustó mi contenido, comparte y comenta :D[/color][/b][/size][/center]`,
  },
  {
    id: 'tpl-identi-music',
    name: 'Identi — Música FLAC / MP3',
    site: 'identi',
    category: 'music',
    titlePattern: '{{artista}} - {{album}} ({{anio}}) [{{resolucion}}]',
    bodyPattern: `[center][b][color=#244061][size=4]{{artista}} - {{album}} ({{anio}}) [{{resolucion}}][/size][/color][/b][/center]

[img]{{logo_url}}[/img]

[img]{{poster_url}}[/img]

[img]{{banner_url}}[/img]

[center][b][size=5][color=#80ffea]Informacion del Album[/color][/size][/b][/center]

[center]Artista: {{artista}}
Album: {{album}}
Generos: {{generos}}
Calidad: {{audio_idiomas}}
Duracion: {{duracion}}
Peso total: {{peso_archivo}}
Servidores: {{servidores}}
Creditos: {{creditos}}
[/center]

[img]{{banner_url}}[/img]

[center][b][size=25][color=#80ffea]Tracklist[/color][/size][/b]

[quote]{{tracklist}}[/quote]
[/center]

[img]{{banner_url}}[/img]

[center][b][size=30][color=#80ffea]Espectrograma[/color][/size][/b][/center]

[center]{{espectrograma_bbcode}}[/center]

{{enlaces_identi}}

[center][img]{{clearart_url}}[/img][/center]

[center][size=5][i][b][color=#3366ff]PASSWORD[/color][/b][/i][/size][/center]

[center]{{password}}[/center]

[center][size=4][b][color=#33cc33]Si te gustó mi contenido, comparte y comenta :D[/color][/b][/size][/center]`,
  },
];

export const DEFAULT_OPEN_DOCUMENTS: OpenDocument[] = [
  {
    id: 'doc-1',
    name: 'Zinfinal.Kimetsu.2160p.bbcode',
    dotColor: '#3366ff',
    templateId: 'tpl-zinfinal-main',
    context: { ...MEDIA_SCENARIOS.movie },
    customTitle: null,
    customBody: null,
  },
  {
    id: 'doc-2',
    name: 'Identi.StudentCouncil.S1E1-7.bbcode',
    dotColor: '#80ffea',
    templateId: 'tpl-identi-main',
    context: { ...MEDIA_SCENARIOS.anime },
    customTitle: null,
    customBody: null,
  },
  {
    id: 'doc-3',
    name: 'Zinfinal.DaftPunk.RAM.FLAC.bbcode',
    dotColor: '#00ff9d',
    templateId: 'tpl-zinfinal-music',
    context: { ...MEDIA_SCENARIOS.music },
    customTitle: null,
    customBody: null,
  },
];

export const DEFAULT_MINI_MENU: FloatingToolItem[] = [
  { label: 'B', open: '[b]', close: '[/b]' },
  { label: 'I', open: '[i]', close: '[/i]' },
  { label: 'U', open: '[u]', close: '[/u]' },
  { label: 'Centrar', open: '[center]', close: '[/center]' },
  { label: 'URL', open: '[url=https://]', close: '[/url]' },
  { label: 'IMG', open: '[img]', close: '[/img]' },
  { label: '🔗 Spoiler Links', open: '__MODAL_SPOILER_LINKS__', close: '' },
  { label: 'Color', open: '[color=#00f0ff]', close: '[/color]' },
];

export const DEFAULT_DOCK_STATE: DockState = {
  slots: {
    'left-top': { panels: ['editor'], active: 'editor' },
    'left-bottom': { panels: ['compiled'], active: 'compiled' },
    'center-main': { panels: [], active: null },
    'right-top': { panels: ['webview'], active: 'webview' },
    'right-bottom': { panels: ['covers', 'mediainfo', 'layers'], active: 'covers' },
    'bottom-main': { panels: [], active: null },
  },
  floating: [],
};

export const DEFAULT_SPLIT_RATIOS: SplitRatios = {
  leftColPct: 50,
  centerColPct: 26,
  leftTopPct: 65,
  rightTopPct: 56,
  bottomDockPct: 28,
};
