/* ============================================================
   Puti-AI 磁碟分析工具 — 前端核心邏輯 v2.1
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

    // hover 互動
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
    // 用 width 來決定尺寸（因為 aspect-ratio 保證正方形，但 height 可能還沒算好）
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
          key,
          value: val,
          ratio: totalSize > 0 ? val / totalSize : 0,
          color: PIE_COLORS[key].color,
          label: PIE_COLORS[key].label,
        });
      }
    }
    this.totalSize = totalSize;

    // 確保 canvas 尺寸正確（首次渲染時容器剛從 display:none 變可見）
    this.resize();
    // 再用 rAF 確認 layout 已完成
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
      // easeOutCubic
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

      // 白色間隔線
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
      if (angle <= cumAngle) {
        found = i;
        break;
      }
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
    this.largestFiles = [];
    this.pieChart = null;

    this.initElements();
    this.bindEvents();
    this.loadDrives();
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
  }

  bindEvents() {
    this.elBtnScan.addEventListener('click', () => this.startScan());
    this.elBtnCancel.addEventListener('click', () => this.cancelScan());
    $('#btn-browse').addEventListener('click', () => this.openBrowseModal());
    this.elFolderPath.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.startScan();
    });

    $('#btn-nav-parent').addEventListener('click', () => this.navigateToParent());
    $('#btn-rescan').addEventListener('click', () => this.startScan());

    this.elSelectAllCb.addEventListener('change', () => this.toggleSelectAll());
    this.elBtnDeleteSelected.addEventListener('click', () => this.showDeleteConfirm());

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

  // ===== 掃描 =====
  startScan() {
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

    // UI
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

    this.largestFiles = data.largestFiles || [];

    // 導覽列
    this.elNavBar.classList.remove('hide');
    this.elNavCurrentPath.textContent = this.currentPath;

    // 先顯示結果區，讓 DOM layout 計算完成
    this.elResultsArea.classList.remove('hide');
    this.elResultsArea.classList.add('fade-in');

    // 圓餅圖（延遲一幀確保 layout 完成）
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

    // 十大巨無霸
    this.renderLargestFiles();

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

  // ===== 十大巨無霸檔案 =====
  renderLargestFiles() {
    this.elFilesList.innerHTML = '';
    this.selectedFiles.clear();
    this.elSelectAllCb.checked = false;
    this.elBtnDeleteSelected.disabled = true;

    if (!this.largestFiles.length) {
      this.elFilesList.innerHTML = '<div class="files-empty">此資料夾沒有檔案</div>';
      return;
    }

    this.largestFiles.forEach((file, idx) => {
      const item = document.createElement('div');
      item.className = 'file-item';

      const ext = file.name.split('.').pop().toLowerCase();
      const typeIcon = this.getFileTypeIcon(ext);

      item.innerHTML = `
        <label class="checkbox-label file-cb">
          <input type="checkbox" data-index="${idx}">
          <span class="checkmark"></span>
        </label>
        <span class="file-rank">${idx + 1}</span>
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
      cb.addEventListener('change', () => this.onFileCheckChange(idx, cb.checked));

      const locateBtn = item.querySelector('.btn-locate');
      locateBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.showInExplorer(file.path);
      });

      this.elFilesList.appendChild(item);
    });
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

  onFileCheckChange(idx, checked) {
    if (checked) {
      this.selectedFiles.add(idx);
    } else {
      this.selectedFiles.delete(idx);
    }
    this.elBtnDeleteSelected.disabled = this.selectedFiles.size === 0;
    this.elSelectAllCb.checked = this.selectedFiles.size === this.largestFiles.length;
  }

  toggleSelectAll() {
    const isChecked = this.elSelectAllCb.checked;
    this.elFilesList.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
      cb.checked = isChecked;
      const idx = parseInt(cb.dataset.index);
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
      const file = this.largestFiles[idx];
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
      files.push(this.largestFiles[idx].path);
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
  navigateToParent() {
    const parts = this.currentPath.replace(/\\/g, '/').split('/').filter(Boolean);
    if (parts.length <= 1) return;
    parts.pop();
    let parent = parts.join('\\');
    if (parent.length === 2 && parent[1] === ':') parent += '\\';
    this.elFolderPath.value = parent;
    this.startScan();
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
