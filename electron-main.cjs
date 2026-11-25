const { app, BrowserWindow, shell, net } = require('electron');
const path = require('path');
const http = require('http');
const fs = require('fs');
const Module = require('module');
const { spawn } = require('child_process');

const PORT = String(process.env.PORT || 3000);
let mainWindow = null;
let devServerProcess = null;
let backendError = null;

function checkSingleUrl(urlStr) {
  return new Promise((resolve) => {
    const req = http.get(urlStr, (res) => {
      res.resume();
      resolve(res.statusCode && res.statusCode < 500 ? urlStr : null);
    });
    req.on('error', () => resolve(null));
    req.setTimeout(600, () => {
      req.destroy();
      resolve(null);
    });
  });
}

async function checkServerReady() {
  const ipv4Url = await checkSingleUrl(`http://127.0.0.1:${PORT}`);
  if (ipv4Url) return ipv4Url;
  const localUrl = await checkSingleUrl(`http://localhost:${PORT}`);
  if (localUrl) return localUrl;
  return null;
}

async function waitForServer(maxAttempts = 30) {
  for (let i = 0; i < maxAttempts; i++) {
    const readyUrl = await checkServerReady();
    if (readyUrl) return readyUrl;
    await new Promise((r) => setTimeout(r, 250));
  }
  return null;
}

function redirectAsarWritesToUserData(userDataDir) {
  const mapAsarPath = (targetPath) => {
    if (typeof targetPath !== 'string') return targetPath;
    const normalized = targetPath.replace(/\\/g, '/');
    const asarMarker = '.asar/';
    const idx = normalized.toLowerCase().indexOf(asarMarker);
    if (idx !== -1) {
      const relativeSubPath = normalized.slice(idx + asarMarker.length);
      return path.join(userDataDir, relativeSubPath);
    }
    return targetPath;
  };

  const origMkdirSync = fs.mkdirSync;
  fs.mkdirSync = function (p, opts) {
    return origMkdirSync.call(fs, mapAsarPath(p), opts);
  };

  const origWriteFileSync = fs.writeFileSync;
  fs.writeFileSync = function (p, data, opts) {
    const mapped = mapAsarPath(p);
    if (typeof mapped === 'string') {
      origMkdirSync.call(fs, path.dirname(mapped), { recursive: true });
    }
    return origWriteFileSync.call(fs, mapped, data, opts);
  };

  const origAppendFileSync = fs.appendFileSync;
  fs.appendFileSync = function (p, data, opts) {
    const mapped = mapAsarPath(p);
    if (typeof mapped === 'string') {
      origMkdirSync.call(fs, path.dirname(mapped), { recursive: true });
    }
    return origAppendFileSync.call(fs, mapped, data, opts);
  };

  if (fs.promises) {
    const origMkdir = fs.promises.mkdir;
    fs.promises.mkdir = function (p, opts) {
      return origMkdir.call(fs.promises, mapAsarPath(p), opts);
    };

    const origWriteFile = fs.promises.writeFile;
    fs.promises.writeFile = async function (p, data, opts) {
      const mapped = mapAsarPath(p);
      if (typeof mapped === 'string') {
        await origMkdir.call(fs.promises, path.dirname(mapped), { recursive: true });
      }
      return origWriteFile.call(fs.promises, mapped, data, opts);
    };
  }
}

function patchOutgoingFetchHeaders() {
  const originalFetch = globalThis.fetch;
  if (typeof originalFetch !== 'function') return;

  globalThis.fetch = async function (input, init = {}) {
    const isReqObj = typeof Request !== 'undefined' && input instanceof Request;
    const urlStr = typeof input === 'string'
      ? input
      : (input && typeof input.url === 'string' ? input.url : '');
    const method = (init.method || (isReqObj ? input.method : 'GET')).toUpperCase();

    const headers = new Headers(init.headers || (isReqObj ? input.headers : undefined));

    const ua = headers.get('user-agent');
    if (!ua || ua.toLowerCase().includes('node') || ua.toLowerCase().includes('undici')) {
      headers.set(
        'User-Agent',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
      );
    }

    if (!headers.has('accept')) {
      headers.set('Accept', 'application/json, text/plain, */*');
    }
    if (!headers.has('accept-language')) {
      headers.set('Accept-Language', 'es-ES,es;q=0.9,en;q=0.8');
    }

    // Elimina Origin y Referer para que la API los trate como petición directa sin bloqueo CSRF/WAF
    headers.delete('origin');
    headers.delete('referer');

    let bodyToSend = undefined;
    if (method !== 'GET' && method !== 'HEAD') {
      const rawBody = init.body !== undefined ? init.body : (isReqObj ? input.body : undefined);
      if (rawBody !== undefined && rawBody !== null) {
        if (typeof FormData !== 'undefined' && rawBody instanceof FormData) {
          const tempResp = new Response(rawBody);
          const contentType = tempResp.headers.get('content-type');
          if (contentType) headers.set('Content-Type', contentType);
          bodyToSend = Buffer.from(await tempResp.arrayBuffer());
        } else if (rawBody instanceof URLSearchParams) {
          bodyToSend = rawBody.toString();
          if (!headers.has('content-type')) {
            headers.set('Content-Type', 'application/x-www-form-urlencoded;charset=UTF-8');
          }
        } else if (isReqObj && init.body === undefined) {
          bodyToSend = Buffer.from(await input.arrayBuffer());
        } else {
          bodyToSend = rawBody;
        }
      }
    }

    // Usa el motor de red nativo de Chromium (electron.net.fetch) para evitar bloqueos TLS de Cloudflare
    if (net && typeof net.fetch === 'function' && urlStr.startsWith('http')) {
      const plainHeaders = {};
      headers.forEach((value, key) => {
        plainHeaders[key] = value;
      });
      return net.fetch(urlStr, {
        method,
        headers: plainHeaders,
        body: bodyToSend,
        redirect: init.redirect || 'follow'
      });
    }

    return originalFetch.call(this, input, { ...init, headers });
  };
}

async function startBackend() {
  try {
    patchOutgoingFetchHeaders();

    if (app.isPackaged) {
      process.env.PORT = PORT;
      process.env.NODE_ENV = 'production';

      // Usa AppData\Roaming\PostPro Studio como directorio escribible para configs y subidas
      const userDataDir = app.getPath('userData');
      fs.mkdirSync(userDataDir, { recursive: true });
      process.chdir(userDataDir);
      redirectAsarWritesToUserData(userDataDir);

      // Intercepta require('vite') en producción para que server.cjs no falle al no incluir devDependencies
      const originalLoad = Module._load;
      Module._load = function (request, parent, isMain) {
        if (request === 'vite') {
          return {
            createServer: async () => ({
              middlewares: (req, res, next) => next(),
              transformIndexHtml: async (_url, html) => html
            })
          };
        }
        return originalLoad.apply(this, arguments);
      };

      const rootServerPath = path.join(__dirname, 'server.cjs');
      const legacyServerPath = path.join(__dirname, 'dist', 'server.js');
      if (fs.existsSync(rootServerPath)) {
        require(rootServerPath);
      } else if (fs.existsSync(legacyServerPath)) {
        require(legacyServerPath);
      } else {
        throw new Error('No se encontró server.cjs en el paquete compilado.');
      }
      return;
    }

    const alreadyRunning = await checkServerReady();
    if (!alreadyRunning) {
      const tsxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
      devServerProcess = spawn(tsxCmd, ['tsx', path.join(__dirname, 'server.ts')], {
        env: { ...process.env, PORT },
        stdio: 'inherit'
      });
    }
  } catch (err) {
    backendError = err;
    console.error('[PostPro Backend Error]:', err);
  }
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1520,
    height: 920,
    minWidth: 1100,
    minHeight: 720,
    show: true,
    center: true,
    title: 'PostPro Studio — Windows Edition',
    backgroundColor: '#0b0e14',
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  const bootHtml = `
    <!DOCTYPE html>
    <html>
    <body style="margin:0;background:#0b0e14;color:#00f0ff;font-family:'Segoe UI',sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;">
      <div style="font-size:24px;font-weight:800;letter-spacing:2px;">◈ POSTPRO STUDIO</div>
      <div style="margin-top:10px;font-size:12px;color:#94a3b8;font-family:Consolas,monospace;">Iniciando motor gráfico y servicios locales...</div>
    </body>
    </html>
  `;
  mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(bootHtml)}`);
  mainWindow.show();
  mainWindow.focus();

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

process.on('uncaughtException', (err) => {
  backendError = err;
  console.error('[Uncaught Exception]:', err);
});

process.on('unhandledRejection', (reason) => {
  backendError = reason instanceof Error ? reason : new Error(String(reason));
  console.error('[Unhandled Rejection]:', reason);
});

app.whenReady().then(async () => {
  createMainWindow();

  await startBackend();
  const activeUrl = await waitForServer();

  if (!mainWindow) return;

  if (activeUrl) {
    mainWindow.loadURL(activeUrl);
  } else {
    const errDetail = backendError
      ? (backendError.stack || backendError.message)
      : `El servidor local en puerto ${PORT} no respondió a tiempo.`;
    mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`<body style="background:#0b0e14;color:#ff0055;font-family:Consolas,monospace;padding:32px;"><h2>Error al iniciar el servidor backend local (Puerto ${PORT})</h2><pre style="color:#e2e8f0;white-space:pre-wrap;background:#111622;padding:16px;border-radius:8px;border:1px solid #243044;">${errDetail}</pre></body>`)}`);
  }
});

app.on('window-all-closed', () => {
  if (devServerProcess) {
    devServerProcess.kill();
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
