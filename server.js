const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const url = require('url');
const { exec } = require('child_process');

const PORT = 3000;

// ── Type Map ────────────────────────────────────────────────────────────────
const TYPE_MAP = {
  // 圖片
  jpg: 'images', jpeg: 'images', png: 'images', gif: 'images', svg: 'images', webp: 'images', bmp: 'images', tiff: 'images', ico: 'images', heic: 'images', raw: 'images', cr2: 'images', nef: 'images', arw: 'images', dng: 'images',
  // 影片
  mp4: 'videos', mkv: 'videos', avi: 'videos', mov: 'videos', wmv: 'videos', flv: 'videos', webm: 'videos', m4v: 'videos', mpg: 'videos', mpeg: 'videos', m2ts: 'videos',
  // 音訊
  mp3: 'audio', wav: 'audio', flac: 'audio', ogg: 'audio', m4a: 'audio', wma: 'audio', aac: 'audio', opus: 'audio', mid: 'audio', midi: 'audio',
  // 文件
  pdf: 'documents', doc: 'documents', docx: 'documents', xls: 'documents', xlsx: 'documents', ppt: 'documents', pptx: 'documents', txt: 'documents', md: 'documents', csv: 'documents', epub: 'documents', rtf: 'documents', odt: 'documents', ods: 'documents', log: 'documents',
  // 壓縮檔
  zip: 'archives', rar: 'archives', '7z': 'archives', tar: 'archives', gz: 'archives', bz2: 'archives', xz: 'archives', iso: 'archives', cab: 'archives', dmg: 'archives',
  // 可執行檔 / 程式庫
  exe: 'executables', dll: 'executables', msi: 'executables', sys: 'executables', com: 'executables', scr: 'executables', pyd: 'executables', node: 'executables', so: 'executables', dylib: 'executables', bin: 'executables', apk: 'executables', appimage: 'executables', deb: 'executables', rpm: 'executables',
  // 資料庫 / 快取
  db: 'databases', sqlite: 'databases', sqlite3: 'databases', mdb: 'databases', accdb: 'databases', pack: 'databases', idx: 'databases', ldb: 'databases', cache: 'databases', dat: 'databases',
  // 字型
  ttf: 'fonts', otf: 'fonts', woff: 'fonts', woff2: 'fonts', eot: 'fonts',
  // 程式碼
  js: 'code', jsx: 'code', ts: 'code', tsx: 'code', html: 'code', css: 'code', py: 'code', java: 'code', c: 'code', cpp: 'code', h: 'code', hpp: 'code', cs: 'code', go: 'code', rs: 'code', php: 'code', rb: 'code', sh: 'code', bat: 'code', ps1: 'code', json: 'code', xml: 'code', yaml: 'code', yml: 'code', sql: 'code', vue: 'code', svelte: 'code', swift: 'code', kt: 'code', r: 'code', lua: 'code', toml: 'code', ini: 'code', cfg: 'code', conf: 'code', env: 'code', gitignore: 'code', dockerignore: 'code', makefile: 'code',
};

// ── MIME Types ───────────────────────────────────────────────────────────────
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
};

// ── Concurrency Helpers ─────────────────────────────────────────────────────
class LimitPromise {
  constructor(max) {
    this.max = max;
    this.active = 0;
    this.queue = [];
  }

  async run(fn) {
    if (this.active >= this.max) {
      await new Promise((resolve) => this.queue.push(resolve));
    }
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      if (this.queue.length > 0) {
        this.queue.shift()();
      }
    }
  }
}

async function pMap(items, fn, concurrency) {
  const results = [];
  let i = 0;

  async function worker() {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx], idx);
    }
  }

  const workers = [];
  for (let w = 0; w < Math.min(concurrency, items.length); w++) {
    workers.push(worker());
  }
  await Promise.all(workers);
  return results;
}

// ── Heartbeat ───────────────────────────────────────────────────────────────
let lastHeartbeat = Date.now();
const GRACE_PERIOD = 30000;
const CHECK_INTERVAL = 5000;
const HEARTBEAT_TIMEOUT = 12000;

setTimeout(() => {
  setInterval(() => {
    if (Date.now() - lastHeartbeat > HEARTBEAT_TIMEOUT) {
      console.log('No heartbeat received, shutting down...');
      process.exit(0);
    }
  }, CHECK_INTERVAL);
}, GRACE_PERIOD);

// ── Helpers ─────────────────────────────────────────────────────────────────
function jsonResponse(res, data, status = 200) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function errorResponse(res, message, status = 500) {
  jsonResponse(res, { error: message }, status);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString());
}

// ── Route: GET /api/cwd ─────────────────────────────────────────────────────
function handleCwd(req, res) {
  jsonResponse(res, { cwd: process.cwd() });
}

// ── Route: GET /api/drives ──────────────────────────────────────────────────
async function handleDrives(req, res) {
  const drives = [];
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

  await Promise.all(
    letters.split('').map(async (letter) => {
      const drivePath = `${letter}:\\`;
      try {
        await fsp.access(drivePath);
        drives.push(drivePath);
      } catch {
        // drive not available
      }
    }),
  );

  drives.sort();
  jsonResponse(res, { drives });
}

// ── Route: GET /api/list-dir ────────────────────────────────────────────────
async function handleListDir(req, res) {
  const parsed = url.parse(req.url, true);
  const dirPath = parsed.query.path;

  if (!dirPath) return errorResponse(res, 'Missing path parameter', 400);

  try {
    const resolved = path.resolve(dirPath);
    const entries = await fsp.readdir(resolved, { withFileTypes: true });
    const directories = [];

    for (const entry of entries) {
      if (entry.isDirectory() && !entry.isSymbolicLink()) {
        directories.push(entry.name);
      }
    }

    directories.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

    const parent = path.dirname(resolved);
    jsonResponse(res, {
      current: resolved,
      parent: parent === resolved ? null : parent,
      directories,
    });
  } catch (err) {
    errorResponse(res, err.message, 400);
  }
}

// ── Route: GET /api/scan (SSE) ──────────────────────────────────────────────
function handleScan(req, res) {
  const parsed = url.parse(req.url, true);
  const scanPath = parsed.query.path;

  if (!scanPath) {
    errorResponse(res, 'Missing path parameter', 400);
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });

  function sendEvent(event, data) {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  const limiter = new LimitPromise(64);

  const state = {
    scannedFiles: 0,
    scannedFolders: 0,
    totalSize: 0,
    currentPath: scanPath,
    fileTypes: { images: 0, videos: 0, audio: 0, documents: 0, archives: 0, executables: 0, databases: 0, fonts: 0, code: 0, others: 0 },
    largestFiles: [], // { name, path, relativePath, size }
  };

  let lastProgressTime = 0;
  let aborted = false;

  req.on('close', () => {
    aborted = true;
  });

  function throttledProgress() {
    const now = Date.now();
    if (now - lastProgressTime < 100) return;
    lastProgressTime = now;
    sendEvent('progress', {
      scannedFiles: state.scannedFiles,
      scannedFolders: state.scannedFolders,
      totalSize: state.totalSize,
      currentPath: state.currentPath,
    });
  }

  function trackFile(filePath, size) {
    const ext = path.extname(filePath).slice(1).toLowerCase();
    const category = TYPE_MAP[ext] || 'others';
    state.fileTypes[category] += size;
    state.totalSize += size;
    state.scannedFiles++;

    const entry = {
      name: path.basename(filePath),
      path: filePath,
      relativePath: path.relative(scanPath, filePath),
      size,
    };

    const MAX_LARGEST = 500;
    if (state.largestFiles.length < MAX_LARGEST) {
      state.largestFiles.push(entry);
      state.largestFiles.sort((a, b) => b.size - a.size);
    } else if (size > state.largestFiles[MAX_LARGEST - 1].size) {
      state.largestFiles[MAX_LARGEST - 1] = entry;
      state.largestFiles.sort((a, b) => b.size - a.size);
    }
  }

  async function scanDir(dirPath) {
    if (aborted) return;

    state.scannedFolders++;
    state.currentPath = dirPath;
    throttledProgress();

    let entries;
    try {
      entries = await limiter.run(() => fsp.readdir(dirPath, { withFileTypes: true }));
    } catch {
      return;
    }

    await pMap(
      entries,
      async (entry) => {
        if (aborted) return;
        const fullPath = path.join(dirPath, entry.name);

        try {
          const stat = await limiter.run(() => fsp.lstat(fullPath));

          if (stat.isSymbolicLink()) return;

          if (stat.isDirectory()) {
            await scanDir(fullPath);
          } else if (stat.isFile()) {
            trackFile(fullPath, stat.size);
            throttledProgress();
          }
        } catch {
          // skip inaccessible
        }
      },
      16,
    );
  }

  const resolved = path.resolve(scanPath);

  scanDir(resolved)
    .then(() => {
      if (aborted) return;
      sendEvent('complete', {
        fileTypes: state.fileTypes,
        totalSize: state.totalSize,
        scannedFiles: state.scannedFiles,
        scannedFolders: state.scannedFolders,
        largestFiles: state.largestFiles,
      });
      res.end();
    })
    .catch((err) => {
      if (aborted) return;
      sendEvent('error', { message: err.message });
      res.end();
    });
}

// ── Route: POST /api/show-in-explorer ───────────────────────────────────────
async function handleShowInExplorer(req, res) {
  try {
    const body = await readBody(req);
    const filePath = body.filePath;
    if (!filePath) return errorResponse(res, 'Missing filePath', 400);

    exec(`explorer.exe /select,"${filePath}"`);
    jsonResponse(res, { success: true });
  } catch (err) {
    errorResponse(res, err.message);
  }
}

// ── Route: POST /api/delete-files ───────────────────────────────────────────
async function handleDeleteFiles(req, res) {
  try {
    const body = await readBody(req);
    const files = body.files;

    if (!Array.isArray(files) || files.length === 0) {
      return errorResponse(res, 'Missing or empty files array', 400);
    }

    const results = await Promise.all(
      files.map(async (filePath) => {
        try {
          await fsp.unlink(filePath);
          return { path: filePath, success: true };
        } catch (err) {
          return { path: filePath, success: false, error: err.message };
        }
      }),
    );

    jsonResponse(res, { results });
  } catch (err) {
    errorResponse(res, err.message);
  }
}

// ── Route: POST /api/shutdown ───────────────────────────────────────────────
function handleShutdown(req, res) {
  jsonResponse(res, { message: 'Server shutting down...' });
  setTimeout(() => process.exit(0), 500);
}

// ── Route: GET /api/heartbeat ───────────────────────────────────────────────
function handleHeartbeat(req, res) {
  lastHeartbeat = Date.now();
  jsonResponse(res, { ok: true });
}

// ── Static Files ────────────────────────────────────────────────────────────
const PUBLIC_DIR = path.join(__dirname, 'public');

async function handleStatic(req, res) {
  let reqPath = url.parse(req.url).pathname;
  if (reqPath === '/') reqPath = '/index.html';

  const ext = path.extname(reqPath);
  if (!MIME_TYPES[ext]) {
    res.writeHead(404);
    res.end('Not Found');
    return;
  }

  const filePath = path.join(PUBLIC_DIR, reqPath);
  const resolved = path.resolve(filePath);

  // 防止目錄遍歷攻擊
  if (!resolved.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  try {
    const data = await fsp.readFile(resolved);
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('Not Found');
  }
}

// ── Router ──────────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;
  const method = req.method;

  try {
    if (method === 'GET' && pathname === '/api/cwd') return handleCwd(req, res);
    if (method === 'GET' && pathname === '/api/drives') return await handleDrives(req, res);
    if (method === 'GET' && pathname === '/api/list-dir') return await handleListDir(req, res);
    if (method === 'GET' && pathname === '/api/scan') return handleScan(req, res);
    if (method === 'GET' && pathname === '/api/heartbeat') return handleHeartbeat(req, res);
    if (method === 'POST' && pathname === '/api/show-in-explorer') return await handleShowInExplorer(req, res);
    if (method === 'POST' && pathname === '/api/delete-files') return await handleDeleteFiles(req, res);
    if (method === 'POST' && pathname === '/api/shutdown') return handleShutdown(req, res);

    // Static files
    if (method === 'GET') return await handleStatic(req, res);

    res.writeHead(404);
    res.end('Not Found');
  } catch (err) {
    console.error('Unhandled error:', err);
    if (!res.headersSent) errorResponse(res, 'Internal Server Error');
  }
});

// ── Start ───────────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`Disk Analyzer server running at http://localhost:${PORT}`);
  exec(`start http://localhost:${PORT}`);
});
