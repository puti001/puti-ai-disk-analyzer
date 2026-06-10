/* ============================================================
   Puti-AI 磁碟分析工具 — 前端核心邏輯 v3.0
   新增：導覽歷史、分頁瀏覽、大小篩選、掃描歷史
   純原生 JS，不依賴任何外部函式庫
   ============================================================ */

// ===== 工具函數 =====
function formatSize(bytes) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const val = bytes / Math.pow(1024, i);
  return val.toFixed(i === 0 ? 0 : 2) + ' ' + units[i];
}

function $(sel) { return document.querySelector(sel); }

// ===== 檔案類型定義 =====
const PIE_COLORS = {
  videos:      { color: '#ef4444', label: '影片' },
  images:      { color: '#3b82f6', label: '圖片' },
  documents:   { color: '#22c55e', label: '文件' },
  audio:       { color: '#f59e0b', label: '音訊' },
  archives:    { color: '#a855f7', label: '壓縮檔' },
  executables: { color: '#ec4899', label: '可執行檔' },
  databases:   { color: '#14b8a6', label: '資料庫/快取' },
  fonts:       { color: '#f97316', label: '字型' },
  code:        { color: '#06b6d4', label: '程式碼' },
  others:      { color: '#94a3b8', label: '其他' },
};

const CATEGORY_ORDER = ['videos', 'images', 'documents', 'audio', 'archives', 'executables', 'databases', 'fonts', 'code', 'others'];

// ===== 圓餅圖繪製 =====
class PieChart {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas.getContext('2d');
    this.data = [];
    this.hoveredIndex = -1;
    this.animationProgress = 0;
    this.animationId = null;
    this.size = 0;

    this.canvas.addEventListener('mousemove', (e) => this.onMouseMove(e));
    this.canvas.addEventListener('mouseleave', () => {
      this.hoveredIndex = -1;
      this.draw();
    });

    window.addEventListener('resize', () => {
      this.resize();
      this.draw();
    });
  }

  resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    const size = Math.min(rect.width || 300, 320);
    if (size <= 0) return;

    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = size * dpr;
    this.canvas.height = size * dpr;
    this.canvas.style.width = size + 'px';
    this.canvas.style.height = size + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.size = size;
  }

  setData(fileTypes, totalSize) {
    this.data = [];
    for (const key of CATEGORY_ORDER) {
      const val = fileTypes[key] || 0;
      if (val > 0) {
        this.data.push({
          key, value: val,
          ratio: totalSize > 0 ? val / totalSize : 0,
          color: PIE_COLORS[key].color,
          label: PIE_COLORS[key].label,
        });
      }
    }
    this.totalSize = totalSize;

    this.resize();
    requestAnimationFrame(() => {
      this.resize();
      this.animateIn();
    });
  }

  animateIn() {
    if (this.animationId) cancelAnimationFrame(this.animationId);
    this.animationProgress = 0;
    const startTime = performance.now();
    const duration = 800;

    const tick = (now) => {
      const elapsed = now - startTime;
      this.animationProgress = Math.min(elapsed / duration, 1);
      this.animationProgress = 1 - Math.pow(1 - this.animationProgress, 3);
      this.draw();
      if (this.animationProgress < 1) {
        this.animationId = requestAnimationFrame(tick);
      }
    };
    this.animationId = requestAnimationFrame(tick);
  }

  draw() {
    const ctx = this.ctx;
    const size = this.size;
    if (size <= 0) return;

    const cx = size / 2;
    const cy = size / 2;
    const outerR = size / 2 - 8;
    const innerR = outerR * 0.58;

    ctx.clearRect(0, 0, size, size);

    if (!this.data.length) {
      ctx.fillStyle = '#94a3b8';
      ctx.font = '14px Inter, Noto Sans TC, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('無資料', cx, cy);
      return;
    }

    let startAngle = -Math.PI / 2;
    const totalAngle = Math.PI * 2 * this.animationProgress;

    this.data.forEach((item, i) => {
      const sliceAngle = item.ratio * totalAngle;
      if (sliceAngle < 0.001) return;

      const isHovered = i === this.hoveredIndex;
      const offset = isHovered ? 6 : 0;
      const midAngle = startAngle + sliceAngle / 2;

      ctx.save();
      if (offset) {
        ctx.translate(Math.cos(midAngle) * offset, Math.sin(midAngle) * offset);
      }

      ctx.beginPath();
      ctx.arc(cx, cy, outerR, startAngle, startAngle + sliceAngle);
      ctx.arc(cx, cy, innerR, startAngle + sliceAngle, startAngle, true);
      ctx.closePath();

      ctx.fillStyle = item.color;
      if (isHovered) {
        ctx.shadowColor = item.color;
        ctx.shadowBlur = 16;
      }
      ctx.fill();
      ctx.shadowBlur = 0;

      ctx.strokeStyle = 'rgba(255,255,255,0.3)';
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.restore();
      startAngle += sliceAngle;
    });
  }

  onMouseMove(e) {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left - this.size / 2;
    const y = e.clientY - rect.top - this.size / 2;
    const dist = Math.sqrt(x * x + y * y);
    const outerR = this.size / 2 - 8;
    const innerR = outerR * 0.58;

    if (dist < innerR || dist > outerR) {
      if (this.hoveredIndex !== -1) {
        this.hoveredIndex = -1;
        this.draw();
      }
      return;
    }

    let angle = Math.atan2(y, x);
    if (angle < -Math.PI / 2) angle += Math.PI * 2;
    else angle += Math.PI / 2;
    if (angle > Math.PI * 2) angle -= Math.PI * 2;

    let cumAngle = 0;
    let found = -1;
    for (let i = 0; i < this.data.length; i++) {
      cumAngle += this.data[i].ratio * Math.PI * 2;
      if (angle <= cumAngle) { found = i; break; }
    }

    if (found !== this.hoveredIndex) {
      this.hoveredIndex = found;
      this.draw();
    }
  }
}

// ===== 應用程式主體 =====
class App {
  constructor() {
    this.eventSource = null;
    this.scanning = false;
    this.currentPath = '';
    this.selectedFiles = new Set();
    this.allLargestFiles = []; // 所有大檔案（server 回傳，最多 500 筆）
    this.filteredFiles = [];   // 篩選後
    this.pieChart = null;

    // 分頁
    this.pageSize = 10;
    this.currentPage = 0;

    // 篩選
    this.minSizeFilter = 0;

    // 導覽歷史
    this.navHistory = [];
    this.navIndex = -1;

    this.initElements();
    this.bindEvents();
    this.loadDrives();
    this.loadScanHistory();
    this.startHeartbeat();
  }

  initElements() {
    this.elFolderPath = $('#folder-path');
    this.elBtnScan = $('#btn-scan');
    this.elBtnCancel = $('#btn-cancel');
    this.elProgressCard = $('#progress-card');
    this.elErrorCard = $('#error-card');
    this.elErrorText = $('#error-text');
    this.elStatFiles = $('#stat-files');
    this.elStatFolders = $('#stat-folders');
    this.elStatSize = $('#stat-size');
    this.elCurrentPath = $('#current-path');
    this.elProgressBar = $('#progress-bar');
    this.elResultsArea = $('#results-area');
    this.elNavBar = $('#nav-bar');
    this.elNavCurrentPath = $('#nav-current-path');
    this.elQuickDrives = $('#quick-drives');
    this.elFilesList = $('#files-list');
    this.elLegendList = $('#legend-list');
    this.elChartTotal = $('#chart-total');
    this.elSelectAllCb = $('#select-all-cb');
    this.elBtnDeleteSelected = $('#btn-delete-selected');
    this.elBtnNavBack = $('#btn-nav-back');
    this.elBtnNavForward = $('#btn-nav-forward');
    this.elBtnPagePrev = $('#btn-page-prev');
    this.elBtnPageNext = $('#btn-page-next');
    this.elPageInfo = $('#page-info');
    this.elFilterCount = $('#filter-count');
    this.elScanHistory = $('#scan-history');
  }

  bindEvents() {
    this.elBtnScan.addEventListener('click', () => this.startScan());
    this.elBtnCancel.addEventListener('click', () => this.cancelScan());
    $('#btn-browse').addEventListener('click', () => this.openBrowseModal());
    this.elFolderPath.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.startScan();
    });

    // 導覽
    this.elBtnNavBack.addEventListener('click', () => this.navigateBack());
    this.elBtnNavForward.addEventListener('click', () => this.navigateForward());
    $('#btn-nav-parent').addEventListener('click', () => this.navigateToParent());
    $('#btn-nav-root').addEventListener('click', () => this.navigateToRoot());
    $('#btn-rescan').addEventListener('click', () => this.startScan());

    // 檔案選取
    this.elSelectAllCb.addEventListener('change', () => this.toggleSelectAll());
    this.elBtnDeleteSelected.addEventListener('click', () => this.showDeleteConfirm());

    // 分頁
    this.elBtnPagePrev.addEventListener('click', () => this.goPage(this.currentPage - 1));
    this.elBtnPageNext.addEventListener('click', () => this.goPage(this.currentPage + 1));

    // 篩選
    $('#filter-buttons').addEventListener('click', (e) => {
      const btn = e.target.closest('.filter-btn');
      if (!btn) return;
      const minVal = parseInt(btn.dataset.min) || 0;
      this.setMinSizeFilter(minVal);
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });

    // Browse modal
    $('#btn-modal-close').addEventListener('click', () => this.closeBrowseModal());
    $('#btn-modal-cancel').addEventListener('click', () => this.closeBrowseModal());
    $('#btn-modal-select').addEventListener('click', () => this.selectModalFolder());
    $('#modal-drive-select').addEventListener('change', (e) => this.loadModalDir(e.target.value));

    // Confirm modal
    $('#btn-confirm-close').addEventListener('click', () => this.closeConfirmModal());
    $('#btn-confirm-cancel').addEventListener('click', () => this.closeConfirmModal());
    $('#btn-confirm-delete').addEventListener('click', () => this.executeDelete());

    // Modal overlay click
    $('#browse-modal').addEventListener('click', (e) => {
      if (e.target.classList.contains('modal-overlay')) this.closeBrowseModal();
    });
    $('#confirm-modal').addEventListener('click', (e) => {
      if (e.target.classList.contains('modal-overlay')) this.closeConfirmModal();
    });

    $('#btn-shutdown').addEventListener('click', () => this.shutdown());
  }

  // ===== 心跳 =====
  startHeartbeat() {
    setInterval(() => {
      fetch('/api/heartbeat').catch(() => {});
    }, 5000);
  }

  // ===== 磁碟機 =====
  async loadDrives() {
    try {
      const res = await fetch('/api/drives');
      const data = await res.json();
      const drives = data.drives || [];
      drives.forEach(d => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'quick-drive-btn';
        btn.textContent = d.replace('\\', '');
        btn.addEventListener('click', () => {
          this.elFolderPath.value = d;
          this.startScan();
        });
        this.elQuickDrives.appendChild(btn);
      });
      this.drives = drives;
    } catch (err) {
      console.warn('無法載入磁碟機清單', err);
    }
  }

  // ===== 掃描歷史 (localStorage) =====
  loadScanHistory() {
    try {
      const data = JSON.parse(localStorage.getItem('disk-analyzer-history') || '[]');
      this.scanHistory = data.slice(0, 10);
    } catch {
      this.scanHistory = [];
    }
    this.renderScanHistory();
  }

  saveScanHistory(pathStr, totalSize) {
    // 移除舊的相同路徑
    this.scanHistory = this.scanHistory.filter(h => h.path.toLowerCase() !== pathStr.toLowerCase());
    // 加到最前面
    this.scanHistory.unshift({
      path: pathStr,
      totalSize,
      lastScanned: new Date().toISOString(),
    });
    // 最多 10 筆
    this.scanHistory = this.scanHistory.slice(0, 10);
    localStorage.setItem('disk-analyzer-history', JSON.stringify(this.scanHistory));
    this.renderScanHistory();
  }

  renderScanHistory() {
    const container = this.elScanHistory;
    // 保留 label span
    const label = container.querySelector('.label');
    container.innerHTML = '';
    if (label) container.appendChild(label);

    if (!this.scanHistory.length) {
      container.classList.add('hide');
      return;
    }
    container.classList.remove('hide');

    this.scanHistory.forEach(h => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'history-btn';
      // 顯示最後一段路徑
      const shortName = h.path.split('\\').filter(Boolean).pop() || h.path;
      btn.title = h.path + ' (' + formatSize(h.totalSize) + ')';
      btn.textContent = shortName;
      btn.addEventListener('click', () => {
        this.elFolderPath.value = h.path;
        this.startScan();
      });

      // 刪除按鈕
      const delBtn = document.createElement('span');
      delBtn.className = 'history-del';
      delBtn.textContent = '×';
      delBtn.title = '移除';
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.scanHistory = this.scanHistory.filter(x => x.path !== h.path);
        localStorage.setItem('disk-analyzer-history', JSON.stringify(this.scanHistory));
        this.renderScanHistory();
      });
      btn.appendChild(delBtn);

      container.appendChild(btn);
    });
  }

  // ===== 掃描 =====
  startScan(pushHistory = true) {
    const targetPath = this.elFolderPath.value.trim();
    if (!targetPath) {
      this.showToast('請輸入或選擇資料夾路徑', 'error');
      this.elFolderPath.focus();
      return;
    }

    if (this.scanning) this.cancelScan();

    this.scanning = true;
    this.currentPath = targetPath;
    this.selectedFiles.clear();

    // 導覽歷史
    if (pushHistory) {
      // 清除 forward 歷史
      if (this.navIndex < this.navHistory.length - 1) {
        this.navHistory = this.navHistory.slice(0, this.navIndex + 1);
      }
      this.navHistory.push(targetPath);
      this.navIndex = this.navHistory.length - 1;
    }

    // UI reset
    this.elBtnScan.classList.add('hide');
    this.elBtnCancel.classList.remove('hide');
    this.elProgressCard.classList.remove('hide');
    this.elErrorCard.classList.add('hide');
    this.elResultsArea.classList.add('hide');
    this.elNavBar.classList.add('hide');
    this.elStatFiles.textContent = '0';
    this.elStatFolders.textContent = '0';
    this.elStatSize.textContent = '0 B';
    this.elCurrentPath.textContent = '準備中...';
    this.elProgressBar.classList.add('shimmer');

    // SSE
    const encodedPath = encodeURIComponent(targetPath);
    this.eventSource = new EventSource(`/api/scan?path=${encodedPath}`);

    this.eventSource.addEventListener('progress', (e) => {
      const d = JSON.parse(e.data);
      this.elStatFiles.textContent = d.scannedFiles.toLocaleString();
      this.elStatFolders.textContent = d.scannedFolders.toLocaleString();
      this.elStatSize.textContent = formatSize(d.totalSize);
      this.elCurrentPath.textContent = d.currentPath;
    });

    this.eventSource.addEventListener('complete', (e) => {
      const d = JSON.parse(e.data);
      this.onScanComplete(d);
    });

    this.eventSource.addEventListener('error', (e) => {
      try {
        const d = JSON.parse(e.data);
        this.showError(d.message);
      } catch {
        if (this.scanning) {
          this.showError('掃描連線中斷');
        }
      }
      this.stopScan();
    });
  }

  cancelScan() {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    this.stopScan();
    this.showToast('掃描已取消', 'error');
  }

  stopScan() {
    this.scanning = false;
    this.elProgressBar.classList.remove('shimmer');
    this.elBtnScan.classList.remove('hide');
    this.elBtnCancel.classList.add('hide');
    this.elProgressCard.classList.add('hide');
  }

  // ===== 掃描完成 =====
  onScanComplete(data) {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    this.stopScan();

    this.allLargestFiles = data.largestFiles || [];

    // 儲存歷史
    this.saveScanHistory(this.currentPath, data.totalSize);

    // 導覽列
    this.elNavBar.classList.remove('hide');
    this.elNavCurrentPath.textContent = this.currentPath;
    this.updateNavButtons();

    // 結果區
    this.elResultsArea.classList.remove('hide');
    this.elResultsArea.classList.add('fade-in');

    // 圓餅圖
    requestAnimationFrame(() => {
      if (!this.pieChart) {
        this.pieChart = new PieChart('pie-chart');
      }
      this.pieChart.setData(data.fileTypes, data.totalSize);
    });

    // 圖例
    this.renderLegend(data.fileTypes, data.totalSize);

    // 中心數字
    this.elChartTotal.textContent = formatSize(data.totalSize);

    // 大檔案：重設篩選，回到第一頁
    this.minSizeFilter = 0;
    document.querySelectorAll('.filter-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.min === '0');
    });
    this.applyFilter();

    this.showToast(`分析完成！共 ${data.scannedFiles.toLocaleString()} 個檔案，${formatSize(data.totalSize)}`, 'success');
  }

  // ===== 圖例 =====
  renderLegend(fileTypes, totalSize) {
    this.elLegendList.innerHTML = '';
    for (const key of CATEGORY_ORDER) {
      const val = fileTypes[key] || 0;
      if (val === 0) continue;
      const pct = totalSize > 0 ? ((val / totalSize) * 100).toFixed(1) : '0';
      const item = document.createElement('div');
      item.className = 'legend-item';
      item.innerHTML = `
        <span class="legend-dot" style="background:${PIE_COLORS[key].color}"></span>
        <span class="legend-label">${PIE_COLORS[key].label}</span>
        <span class="legend-value">${formatSize(val)}</span>
        <span class="legend-pct">${pct}%</span>
      `;
      this.elLegendList.appendChild(item);
    }
  }

  // ===== 篩選 =====
  setMinSizeFilter(minBytes) {
    this.minSizeFilter = minBytes;
    this.applyFilter();
  }

  applyFilter() {
    if (this.minSizeFilter > 0) {
      this.filteredFiles = this.allLargestFiles.filter(f => f.size >= this.minSizeFilter);
    } else {
      this.filteredFiles = [...this.allLargestFiles];
    }
    this.currentPage = 0;
    this.selectedFiles.clear();
    this.elSelectAllCb.checked = false;
    this.elBtnDeleteSelected.disabled = true;
    this.elFilterCount.textContent = `共 ${this.filteredFiles.length} 個檔案`;
    this.renderCurrentPage();
  }

  // ===== 分頁 =====
  get totalPages() {
    return Math.max(1, Math.ceil(this.filteredFiles.length / this.pageSize));
  }

  goPage(page) {
    if (page < 0 || page >= this.totalPages) return;
    this.currentPage = page;
    this.selectedFiles.clear();
    this.elSelectAllCb.checked = false;
    this.elBtnDeleteSelected.disabled = true;
    this.renderCurrentPage();
  }

  renderCurrentPage() {
    const start = this.currentPage * this.pageSize;
    const end = Math.min(start + this.pageSize, this.filteredFiles.length);
    const pageFiles = this.filteredFiles.slice(start, end);

    this.elFilesList.innerHTML = '';

    if (!this.filteredFiles.length) {
      this.elFilesList.innerHTML = '<div class="files-empty">沒有符合條件的檔案</div>';
      this.updatePagination();
      return;
    }

    pageFiles.forEach((file, localIdx) => {
      const globalIdx = start + localIdx;
      const item = document.createElement('div');
      item.className = 'file-item';

      const ext = file.name.split('.').pop().toLowerCase();
      const typeIcon = this.getFileTypeIcon(ext);

      item.innerHTML = `
        <label class="checkbox-label file-cb">
          <input type="checkbox" data-global-index="${globalIdx}">
          <span class="checkmark"></span>
        </label>
        <span class="file-rank">${globalIdx + 1}</span>
        <span class="file-type-icon">${typeIcon}</span>
        <div class="file-info">
          <div class="file-name" title="${this.escapeHtml(file.name)}">${this.escapeHtml(file.name)}</div>
          <div class="file-path" title="${this.escapeHtml(file.relativePath || file.path)}">${this.escapeHtml(file.relativePath || file.path)}</div>
        </div>
        <span class="file-size">${formatSize(file.size)}</span>
        <button type="button" class="btn-locate" title="在檔案總管中顯示" data-path="${this.escapeHtml(file.path)}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
            <path d="M10 3H6a2 2 0 0 0-2 2v14c0 1.1.9 2 2 2h12a2 2 0 0 0 2-2v-4"></path>
            <path d="M14 3h7v7"></path>
            <path d="M21 3L10 14"></path>
          </svg>
        </button>
      `;

      const cb = item.querySelector('input[type="checkbox"]');
      cb.checked = this.selectedFiles.has(globalIdx);
      cb.addEventListener('change', () => this.onFileCheckChange(globalIdx, cb.checked));

      const locateBtn = item.querySelector('.btn-locate');
      locateBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.showInExplorer(file.path);
      });

      this.elFilesList.appendChild(item);
    });

    this.updatePagination();
  }

  updatePagination() {
    const total = this.totalPages;
    this.elBtnPagePrev.disabled = this.currentPage <= 0;
    this.elBtnPageNext.disabled = this.currentPage >= total - 1;
    this.elPageInfo.textContent = `第 ${this.currentPage + 1} 頁 / 共 ${total} 頁`;
  }

  getFileTypeIcon(ext) {
    const map = {
      mp4: '🎬', mkv: '🎬', avi: '🎬', mov: '🎬', wmv: '🎬', flv: '🎬', webm: '🎬', m4v: '🎬',
      jpg: '🖼️', jpeg: '🖼️', png: '🖼️', gif: '🖼️', svg: '🖼️', webp: '🖼️', bmp: '🖼️', heic: '🖼️',
      mp3: '🎵', wav: '🎵', flac: '🎵', ogg: '🎵', m4a: '🎵', wma: '🎵', aac: '🎵',
      pdf: '📄', doc: '📄', docx: '📄', xls: '📊', xlsx: '📊', ppt: '📊', pptx: '📊', txt: '📝',
      zip: '📦', rar: '📦', '7z': '📦', tar: '📦', gz: '📦', iso: '📦',
      exe: '⚙️', dll: '⚙️', msi: '⚙️', sys: '⚙️', pyd: '⚙️', node: '⚙️',
      db: '🗄️', sqlite: '🗄️', pack: '🗄️', dat: '🗄️', cache: '🗄️',
      ttf: '🔤', otf: '🔤', woff: '🔤', woff2: '🔤',
      js: '💻', py: '💻', ts: '💻', html: '💻', css: '💻', json: '💻',
    };
    return map[ext] || '📁';
  }

  escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  onFileCheckChange(globalIdx, checked) {
    if (checked) {
      this.selectedFiles.add(globalIdx);
    } else {
      this.selectedFiles.delete(globalIdx);
    }
    this.elBtnDeleteSelected.disabled = this.selectedFiles.size === 0;

    // 全選 checkbox 狀態
    const start = this.currentPage * this.pageSize;
    const end = Math.min(start + this.pageSize, this.filteredFiles.length);
    let allChecked = true;
    for (let i = start; i < end; i++) {
      if (!this.selectedFiles.has(i)) { allChecked = false; break; }
    }
    this.elSelectAllCb.checked = allChecked;
  }

  toggleSelectAll() {
    const isChecked = this.elSelectAllCb.checked;
    const start = this.currentPage * this.pageSize;
    const end = Math.min(start + this.pageSize, this.filteredFiles.length);

    this.elFilesList.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
      cb.checked = isChecked;
      const idx = parseInt(cb.dataset.globalIndex);
      if (isChecked) this.selectedFiles.add(idx);
      else this.selectedFiles.delete(idx);
    });
    this.elBtnDeleteSelected.disabled = this.selectedFiles.size === 0;
  }

  // ===== 刪除 =====
  showDeleteConfirm() {
    if (this.selectedFiles.size === 0) return;
    const list = $('#confirm-file-list');
    list.innerHTML = '';
    for (const idx of this.selectedFiles) {
      const file = this.filteredFiles[idx];
      if (!file) continue;
      const li = document.createElement('li');
      li.innerHTML = `<strong>${this.escapeHtml(file.name)}</strong> <span class="confirm-size">(${formatSize(file.size)})</span>`;
      list.appendChild(li);
    }
    $('#confirm-modal').classList.remove('hide');
  }

  closeConfirmModal() {
    $('#confirm-modal').classList.add('hide');
  }

  async executeDelete() {
    const files = [];
    for (const idx of this.selectedFiles) {
      const f = this.filteredFiles[idx];
      if (f) files.push(f.path);
    }
    this.closeConfirmModal();

    try {
      const res = await fetch('/api/delete-files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files }),
      });
      const data = await res.json();

      let successCount = 0;
      let failCount = 0;
      const failedNames = [];

      data.results.forEach((r) => {
        if (r.success) successCount++;
        else {
          failCount++;
          failedNames.push(r.path.split('\\').pop() || r.path.split('/').pop());
        }
      });

      if (successCount > 0) this.showToast(`成功刪除 ${successCount} 個檔案`, 'success');
      if (failCount > 0) this.showToast(`${failCount} 個檔案刪除失敗: ${failedNames.join(', ')}`, 'error');
      if (successCount > 0) setTimeout(() => this.startScan(), 500);
    } catch (err) {
      this.showToast('刪除操作失敗: ' + err.message, 'error');
    }
  }

  // ===== 導覽 =====
  updateNavButtons() {
    this.elBtnNavBack.disabled = this.navIndex <= 0;
    this.elBtnNavForward.disabled = this.navIndex >= this.navHistory.length - 1;
  }

  navigateBack() {
    if (this.navIndex <= 0) return;
    this.navIndex--;
    this.elFolderPath.value = this.navHistory[this.navIndex];
    this.startScan(false); // 不 push 歷史
  }

  navigateForward() {
    if (this.navIndex >= this.navHistory.length - 1) return;
    this.navIndex++;
    this.elFolderPath.value = this.navHistory[this.navIndex];
    this.startScan(false);
  }

  navigateToParent() {
    const parts = this.currentPath.replace(/\\/g, '/').split('/').filter(Boolean);
    if (parts.length <= 1) return;
    parts.pop();
    let parent = parts.join('\\');
    if (parent.length === 2 && parent[1] === ':') parent += '\\';
    this.elFolderPath.value = parent;
    this.startScan();
  }

  navigateToRoot() {
    // 取得目前路徑的磁碟根目錄，例如 C:\
    const match = this.currentPath.match(/^([A-Za-z]):/);
    if (match) {
      this.elFolderPath.value = match[1].toUpperCase() + ':\\';
      this.startScan();
    }
  }

  // ===== 檔案總管定位 =====
  async showInExplorer(filePath) {
    try {
      await fetch('/api/show-in-explorer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath }),
      });
    } catch (err) {
      this.showToast('無法開啟檔案總管', 'error');
    }
  }

  // ===== 瀏覽 Modal =====
  async openBrowseModal() {
    $('#browse-modal').classList.remove('hide');
    const select = $('#modal-drive-select');
    select.innerHTML = '';
    if (this.drives) {
      this.drives.forEach((d) => {
        const opt = document.createElement('option');
        opt.value = d;
        opt.textContent = d;
        select.appendChild(opt);
      });
    }
    const first = select.value || 'C:\\';
    await this.loadModalDir(first);
  }

  closeBrowseModal() {
    $('#browse-modal').classList.add('hide');
  }

  async loadModalDir(dirPath) {
    try {
      const res = await fetch(`/api/list-dir?path=${encodeURIComponent(dirPath)}`);
      const data = await res.json();
      if (data.error) {
        this.showToast(data.error, 'error');
        return;
      }

      this.modalCurrentDir = data.current;
      this.renderBreadcrumbs(data.current);

      const list = $('#modal-dirs-list');
      list.innerHTML = '';

      if (data.parent) {
        const li = document.createElement('li');
        li.className = 'dir-item dir-parent';
        li.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><polyline points="15 18 9 12 15 6"></polyline></svg> ..（上一層）`;
        li.addEventListener('click', () => this.loadModalDir(data.parent));
        list.appendChild(li);
      }

      data.directories.forEach((name) => {
        const li = document.createElement('li');
        li.className = 'dir-item';
        li.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16" style="color:#f59e0b"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg> ${this.escapeHtml(name)}`;
        li.addEventListener('click', () => {
          const newPath = data.current + (data.current.endsWith('\\') ? '' : '\\') + name;
          this.loadModalDir(newPath);
        });
        list.appendChild(li);
      });

      if (data.directories.length === 0 && !data.parent) {
        list.innerHTML = '<li class="dir-item dir-empty">此目錄下沒有子資料夾</li>';
      }
    } catch (err) {
      this.showToast('無法讀取目錄: ' + err.message, 'error');
    }
  }

  renderBreadcrumbs(fullPath) {
    const container = $('#modal-breadcrumbs');
    container.innerHTML = '';
    const parts = fullPath.split('\\').filter(Boolean);
    let accumulated = '';

    parts.forEach((part, i) => {
      accumulated += part + (i === 0 && part.endsWith(':') ? '\\' : (i < parts.length - 1 ? '\\' : ''));

      if (i > 0) {
        const sep = document.createElement('span');
        sep.className = 'breadcrumb-sep';
        sep.textContent = '›';
        container.appendChild(sep);
      }

      const crumb = document.createElement('button');
      crumb.type = 'button';
      crumb.className = 'breadcrumb-btn';
      crumb.textContent = part;
      const pathSnapshot = accumulated + (accumulated.endsWith('\\') ? '' : '\\');
      crumb.addEventListener('click', () => this.loadModalDir(pathSnapshot));
      container.appendChild(crumb);
    });
  }

  selectModalFolder() {
    if (this.modalCurrentDir) this.elFolderPath.value = this.modalCurrentDir;
    this.closeBrowseModal();
  }

  // ===== 錯誤 =====
  showError(msg) {
    this.elErrorCard.classList.remove('hide');
    this.elErrorText.textContent = msg;
  }

  // ===== Toast =====
  showToast(message, type = 'success') {
    const container = $('#toast-container');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
      <span>${message}</span>
      <button type="button" class="toast-close">&times;</button>
    `;
    toast.querySelector('.toast-close').addEventListener('click', () => toast.remove());
    container.appendChild(toast);
    setTimeout(() => {
      toast.classList.add('toast-exit');
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }

  // ===== 關閉 =====
  async shutdown() {
    if (!confirm('確定要關閉磁碟分析工具嗎？')) return;
    try {
      await fetch('/api/shutdown', { method: 'POST' });
    } catch { /* 預期連線斷開 */ }
    document.body.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100vh;color:#64748b;font-size:1.2rem;font-family:Inter,sans-serif">工具已關閉，您可以關閉此頁面。</div>';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new App();
});
