const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const { exec, spawn } = require('child_process');

const PORT = 3000;
let lastHeartbeatTime = Date.now();

// 檔案類型定義對照表
const TYPE_MAP = {
  // 圖片
  jpg: 'images', jpeg: 'images', png: 'images', gif: 'images', svg: 'images', webp: 'images', bmp: 'images', tiff: 'images', ico: 'images', heic: 'images',
  // 影片
  mp4: 'videos', mkv: 'videos', avi: 'videos', mov: 'videos', wmv: 'videos', flv: 'videos', webm: 'videos', m4v: 'videos', mpg: 'videos', mpeg: 'videos',
  // 音訊
  mp3: 'audio', wav: 'audio', flac: 'audio', ogg: 'audio', m4a: 'audio', wma: 'audio', aac: 'audio',
  // 文件
  pdf: 'documents', doc: 'documents', docx: 'documents', xls: 'documents', xlsx: 'documents', ppt: 'documents', pptx: 'documents', txt: 'documents', md: 'documents', csv: 'documents', epub: 'documents', rtf: 'documents',
  // 程式碼
  js: 'code', jsx: 'code', ts: 'code', tsx: 'code', html: 'code', css: 'code', py: 'code', java: 'code', c: 'code', cpp: 'code', h: 'code', hpp: 'code', cs: 'code', go: 'code', rs: 'code', rust: 'code', php: 'code', rb: 'code', sh: 'code', bat: 'code', ps1: 'code', json: 'code', xml: 'code', yaml: 'code', yml: 'code', sql: 'code',
  // 壓縮檔
  zip: 'archives', rar: 'archives', '7z': 'archives', tar: 'archives', gz: 'archives'
};

function getFileType(filename) {
  const ext = path.extname(filename).toLowerCase().replace('.', '');
  return TYPE_MAP[ext] || 'others';
}

// 限制並發數的 Promise 輔助類別，防止 EMFILE 錯誤
class LimitPromise {
  constructor(limit) {
    this.limit = limit;
    this.active = 0;
    this.queue = [];
  }
  async run(fn) {
    if (this.active >= this.limit) {
      await new Promise(resolve => this.queue.push(resolve));
    }
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      if (this.queue.length > 0) {
        const next = this.queue.shift();
        next();
      }
    }
  }
}

// 簡易的並發控制 pMap，避免大資料夾一次產生過多 Promise 導致記憶體暴增或 Event Loop 卡死
async function pMap(array, mapper, concurrency) {
  const results = [];
  const promises = [];
  let index = 0;
  async function worker() {
    while (index < array.length) {
      const curIndex = index++;
      const item = array[curIndex];
      results[curIndex] = await mapper(item);
    }
  }
  const workerCount = Math.min(concurrency, array.length);
  for (let i = 0; i < workerCount; i++) {
    promises.push(worker());
  }
  await Promise.all(promises);
  return results;
}

// 遞迴掃描任務類別
class ScanTask {
  constructor(targetPath, sendEvent) {
    this.targetPath = targetPath;
    this.sendEvent = sendEvent;
    this.isCancelled = false;

    this.scannedFiles = 0;
    this.scannedFolders = 0;
    this.totalSize = 0;
    this.currentPath = '';

    this.fileTypes = {
      images: 0,
      videos: 0,
      audio: 0,
      documents: 0,
      code: 0,
      archives: 0,
      others: 0
    };

    this.lastProgressTime = Date.now();
    this.limit = new LimitPromise(64); // 全域限制 64 個並發 I/O
    this.largestFiles = [];
  }

  updateLargestFiles(filePath, size) {
    const name = path.basename(filePath);
    const relativePath = path.relative(this.targetPath, filePath);
    this.largestFiles.push({ name, path: filePath, relativePath, size });
    this.largestFiles.sort((a, b) => b.size - a.size);
    if (this.largestFiles.length > 10) {
      this.largestFiles.pop();
    }
  }

  cancel() {
    this.isCancelled = true;
  }

  // 節流推送進度，避免太過頻繁的網路傳輸導致前端卡頓
  sendProgress(currentPath) {
    if (this.isCancelled) return;
    this.currentPath = currentPath;
    const now = Date.now();
    if (now - this.lastProgressTime > 100) { // 每 100ms 最多送一次進度
      this.lastProgressTime = now;
      this.sendEvent('progress', {
        scannedFiles: this.scannedFiles,
        scannedFolders: this.scannedFolders,
        totalSize: this.totalSize,
        currentPath: this.currentPath
      });
    }
  }

  async start() {
    try {
      const rootStat = await this.limit.run(() => fs.promises.stat(this.targetPath));
      if (!rootStat.isDirectory()) {
        throw new Error('所選路徑不是資料夾');
      }

      const entries = await this.limit.run(() => fs.promises.readdir(this.targetPath, { withFileTypes: true }));
      const subfolders = [];
      const rootFiles = {
        name: '[根目錄檔案]',
        size: 0,
        filesCount: 0,
        foldersCount: 0,
        isDirectory: false,
        fileTypes: { images: 0, videos: 0, audio: 0, documents: 0, code: 0, archives: 0, others: 0 }
      };

      // 使用 pMap 限制第一層的並發任務數為 16，避免大磁碟大量檔案瞬間卡死
      await pMap(entries, async (entry) => {
        if (this.isCancelled) return;
        if (entry.isSymbolicLink()) return;

        const entryPath = path.join(this.targetPath, entry.name);

        if (entry.isDirectory()) {
          const folderInfo = {
            name: entry.name,
            size: 0,
            filesCount: 0,
            foldersCount: 1, // 包含自己
            isDirectory: true,
            fileTypes: { images: 0, videos: 0, audio: 0, documents: 0, code: 0, archives: 0, others: 0 }
          };
          subfolders.push(folderInfo);
          await this.scanFolderRecursive(entryPath, folderInfo);
        } else if (entry.isFile()) {
          try {
            // 使用 lstat 讀取軟連結/雲端佔位檔大小，避免觸發網路下載或崩潰
            const fileStat = await this.limit.run(() => fs.promises.lstat(entryPath));
            const size = fileStat.size;
            const type = getFileType(entry.name);

            rootFiles.size += size;
            rootFiles.filesCount++;
            rootFiles.fileTypes[type] += size;

            this.totalSize += size;
            this.scannedFiles++;
            this.fileTypes[type] += size;
            
            // 記錄大檔案
            this.updateLargestFiles(entryPath, size);
            
            this.sendProgress(entryPath);
          } catch (err) {
            // 忽略單一檔案錯誤
          }
        }
      }, 16);

      if (this.isCancelled) return;

      if (rootFiles.filesCount > 0) {
        subfolders.push(rootFiles);
      }

      // 掃描完成，回傳完整分析結果 (含十大巨無霸檔案清單)
      this.sendEvent('complete', {
        subfolders,
        fileTypes: this.fileTypes,
        totalSize: this.totalSize,
        scannedFiles: this.scannedFiles,
        scannedFolders: this.scannedFolders,
        largestFiles: this.largestFiles
      });
    } catch (err) {
      if (!this.isCancelled) {
        this.sendEvent('error', { message: err.message });
      }
    }
  }

  async scanFolderRecursive(folderPath, folderInfo) {
    if (this.isCancelled) return;
    this.scannedFolders++;
    this.sendProgress(folderPath);

    try {
      const entries = await this.limit.run(() => fs.promises.readdir(folderPath, { withFileTypes: true }));

      // 限制單層資料夾內的並發任務數為 16
      await pMap(entries, async (entry) => {
        if (this.isCancelled) return;
        if (entry.isSymbolicLink()) return;

        const entryPath = path.join(folderPath, entry.name);

        if (entry.isDirectory()) {
          folderInfo.foldersCount++;
          await this.scanFolderRecursive(entryPath, folderInfo);
        } else if (entry.isFile()) {
          try {
            // 使用 lstat 避免卡死在雲端硬碟線上檔案
            const fileStat = await this.limit.run(() => fs.promises.lstat(entryPath));
            const size = fileStat.size;
            const type = getFileType(entry.name);

            folderInfo.size += size;
            folderInfo.filesCount++;
            folderInfo.fileTypes[type] += size;

            this.totalSize += size;
            this.scannedFiles++;
            this.fileTypes[type] += size;
            
            // 記錄大檔案
            this.updateLargestFiles(entryPath, size);
            
            this.sendProgress(entryPath);
          } catch (err) {
            // 忽略單一檔案錯誤
          }
        }
      }, 16);
    } catch (err) {
      // 忽略此目錄的讀取錯誤
    }
  }
}

// MIME 類型對照表
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon'
};

const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  // 1. 取得目前工作目錄 API
  if (pathname === '/api/cwd' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ cwd: process.cwd() }));
    return;
  }

  // 1.1 關閉伺服器 API (讓前端可以主動關閉背景的 exe 服務)
  if (pathname === '/api/shutdown') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ message: '伺服器已成功關閉' }));
    console.log('收到關閉請求，準備結束服務進程...');
    setTimeout(() => {
      process.exit(0);
    }, 500); // 延遲 500ms 結束進程，確保 Response 能順利傳回給瀏覽器
    return;
  }

  // 1.15 心跳接收 API (供前端分頁定期發送，證明前端仍然開啟)
  if (pathname === '/api/heartbeat') {
    lastHeartbeatTime = Date.now();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  // 1.5 取得本機可用磁碟機 API (僅限 Windows，其他平台預設回傳 '/')
  if (pathname === '/api/drives' && req.method === 'GET') {
    try {
      const drives = [];
      if (process.platform === 'win32') {
        const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        await Promise.all(Array.from(letters).map(async (letter) => {
          const drivePath = `${letter}:\\`;
          try {
            await fs.promises.access(drivePath, fs.constants.R_OK);
            drives.push(drivePath);
          } catch (err) {
            // 忽略不存在或無權限的磁碟
          }
        }));
      } else {
        drives.push('/');
      }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ drives: drives.sort() }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // 1.55 在檔案總管中顯示指定檔案 API (僅限 Windows)
  if (pathname === '/api/show-in-explorer' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { filePath } = JSON.parse(body);
        if (!filePath) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: '請提供 filePath 參數' }));
          return;
        }
        if (process.platform === 'win32') {
          // 確保路徑中的反斜線正常（收攏多餘的反斜線），並包裹雙引號以支援含有空格的路徑
          const normalizedPath = path.normalize(filePath);
          spawn('explorer.exe', [`/select,"${normalizedPath}"`], { 
            detached: true, 
            stdio: 'ignore',
            windowsVerbatimArguments: true 
          });
        }
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: true }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // 1.6 本機目錄瀏覽 API
  if (pathname === '/api/list-dir' && req.method === 'GET') {
    const targetPath = parsedUrl.query.path || process.cwd();
    try {
      const stat = await fs.promises.stat(targetPath);
      if (!stat.isDirectory()) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: '該路徑不是資料夾' }));
        return;
      }
      const entries = await fs.promises.readdir(targetPath, { withFileTypes: true });
      
      // 僅篩選出資料夾，跳過符號連結
      const dirs = entries
        .filter(entry => entry.isDirectory() && !entry.isSymbolicLink())
        .map(entry => entry.name)
        .sort((a, b) => a.localeCompare(b, 'zh-Hant'));
        
      const parent = path.dirname(targetPath);
      
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ 
        current: path.resolve(targetPath),
        parent: parent !== targetPath ? parent : null,
        directories: dirs
      }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // 2. SSE API: /api/scan
  if (pathname === '/api/scan' && req.method === 'GET') {
    const targetPath = parsedUrl.query.path;

    if (!targetPath) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '請提供 path 參數' }));
      return;
    }

    // 設定 SSE 標頭
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });

    const sendEvent = (event, data) => {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    const task = new ScanTask(targetPath, sendEvent);

    req.on('close', () => {
      task.cancel();
      console.log(`掃描任務已取消: ${targetPath}`);
    });

    console.log(`開始掃描任務: ${targetPath}`);
    task.start().then(() => {
      res.end();
    });
    return;
  }

  // 2. 靜態檔案託管
  let filePath = path.join(__dirname, 'public', pathname === '/' ? 'index.html' : pathname);

  // 防止目錄遍歷攻擊
  const relative = path.relative(path.join(__dirname, 'public'), filePath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('403 Forbidden - 無權存取此路徑');
    return;
  }

  const ext = path.extname(filePath);
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('404 Not Found - 找不到檔案');
      } else {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(`500 Internal Server Error - ${err.code}`);
      }
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content, 'utf-8');
    }
  });
});

server.listen(PORT, () => {
  console.log(`Disk Analyzer 伺服器已啟動！請打開瀏覽器：http://localhost:${PORT}`);
  // 自動打開預設瀏覽器
  try {
    if (process.platform === 'win32') {
      exec(`start http://localhost:${PORT}`);
    } else if (process.platform === 'darwin') {
      exec(`open http://localhost:${PORT}`);
    }
  } catch (err) {
    console.warn('無法自動開啟瀏覽器，請手動打開網址。', err);
  }
});

// 啟動心跳檢查機制，若長時間無前端連線，則自動關閉程式，防範背景常駐佔用資源
const HEARTBEAT_TIMEOUT = 12000; // 12秒無心跳則判定關閉
const GRACE_PERIOD = 30000; // 啟動前 30 秒為寬限期，不進行檢測（等待瀏覽器開啟）
const startupTime = Date.now();

setInterval(() => {
  const now = Date.now();
  if (now - startupTime < GRACE_PERIOD) {
    // 在啟動寬限期內，持續重置心跳時間
    lastHeartbeatTime = now;
    return;
  }
  if (now - lastHeartbeatTime > HEARTBEAT_TIMEOUT) {
    console.log('偵測到所有網頁端均已關閉（無心跳訊號），自動關閉服務...');
    process.exit(0);
  }
}, 5000); // 每 5 秒檢查一次
