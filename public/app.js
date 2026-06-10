// 檔案類型配置
const FILE_TYPE_CONFIG = {
  images: { name: '圖片', color: '#3b82f6' },
  videos: { name: '影片', color: '#ef4444' },
  audio: { name: '音訊', color: '#10b981' },
  documents: { name: '文件', color: '#f59e0b' },
  code: { name: '程式碼', color: '#a855f7' },
  archives: { name: '壓縮檔', color: '#ec4899' },
  others: { name: '其他', color: '#6b7280' }
};

// 全域狀態
let eventSource = null;
let scanResultData = null;
let currentSort = {
  key: 'size',
  desc: true
};
let typeChartInstance = null;

// Modal 全域狀態
let modalCurrentPath = '';
let modalSelectedPath = '';
let serverCwd = '';

// 導覽歷史堆疊
let historyStack = [];
let forwardStack = [];
let isNavigating = false;
let currentPathScanned = ''; // 當前成功掃描的路徑

// DOM 元素
const folderPathInput = document.getElementById('folder-path');
const btnBrowse = document.getElementById('btn-browse');
const btnScan = document.getElementById('btn-scan');
const btnCancel = document.getElementById('btn-cancel');
const scanSpinner = document.getElementById('scan-spinner');
const progressCard = document.getElementById('progress-card');
const errorCard = document.getElementById('error-card');
const errorText = document.getElementById('error-text');
const resultsArea = document.getElementById('results-area');
const btnShutdown = document.getElementById('btn-shutdown');

// 導覽與大檔案 DOM
const navControlBar = document.getElementById('nav-control-bar');
const btnNavBack = document.getElementById('btn-nav-back');
const btnNavForward = document.getElementById('btn-nav-forward');
const btnNavParent = document.getElementById('btn-nav-parent');
const btnNavRoot = document.getElementById('btn-nav-root');
const navCurrentPath = document.getElementById('nav-current-path');
const largestFilesList = document.getElementById('largest-files-list');

// Modal DOM 元素
const browseModal = document.getElementById('browse-modal');
const btnModalClose = document.getElementById('btn-modal-close');
const btnModalCancel = document.getElementById('btn-modal-cancel');
const btnModalSelect = document.getElementById('btn-modal-select');
const modalBreadcrumbs = document.getElementById('modal-breadcrumbs');
const modalDirsList = document.getElementById('modal-dirs-list');
const modalDriveSelect = document.getElementById('modal-drive-select');

const statFiles = document.getElementById('stat-files');
const statFolders = document.getElementById('stat-folders');
const currentPathText = document.getElementById('current-path');

const totalSizeBadge = document.getElementById('total-size-badge');
const folderListBody = document.getElementById('folder-list-body');
const typeLegendContainer = document.getElementById('type-legend');

// 初始化
document.addEventListener('DOMContentLoaded', () => {
  initEventListeners();
  fetchCurrentWorkingDirectory();
  fetchAvailableDrives();
  startHeartbeat(); // 啟動心跳發送以證明前端分頁仍開啟
});

// 事件綁定
function initEventListeners() {
  btnScan.addEventListener('click', startScan);
  btnCancel.addEventListener('click', cancelScan);
  btnShutdown.addEventListener('click', shutdownServer);
  
  // 導覽按鈕點擊
  btnNavBack.addEventListener('click', navigateBack);
  btnNavForward.addEventListener('click', navigateForward);
  btnNavParent.addEventListener('click', navigateParent);
  btnNavRoot.addEventListener('click', navigateRoot);
  
  // 瀏覽按鈕點擊
  btnBrowse.addEventListener('click', openBrowseModal);
  
  // Modal 關閉與選擇
  btnModalClose.addEventListener('click', closeBrowseModal);
  btnModalCancel.addEventListener('click', closeBrowseModal);
  btnModalSelect.addEventListener('click', selectFolderFromModal);
  
  // 點擊 Modal 背景關閉
  browseModal.addEventListener('click', (e) => {
    if (e.target === browseModal) {
      closeBrowseModal();
    }
  });

  // 選擇磁碟機下拉選單變更
  modalDriveSelect.addEventListener('change', (e) => {
    loadDirectory(e.target.value);
  });

  // 輸入框 Enter 鍵觸發
  folderPathInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      startScan();
    }
  });

  // 快速連結按鈕
  document.querySelectorAll('.quick-path-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const pathValue = btn.getAttribute('data-path');
      if (pathValue) {
        folderPathInput.value = pathValue;
        startScan();
      }
    });
  });

  // 表格排序綁定
  document.querySelectorAll('.folder-table th.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const key = th.getAttribute('data-sort');
      handleSort(key);
    });
  });
}

// 取得伺服器當前的工作目錄
async function fetchCurrentWorkingDirectory() {
  try {
    const res = await fetch('/api/cwd');
    if (res.ok) {
      const data = await res.json();
      serverCwd = data.cwd;
      const currentProjectBtn = document.getElementById('current-project-btn');
      if (currentProjectBtn && data.cwd) {
        currentProjectBtn.setAttribute('data-path', data.cwd);
        currentProjectBtn.addEventListener('click', () => {
          folderPathInput.value = data.cwd;
          startScan();
        });
      }
    }
  } catch (err) {
    console.warn('無法取得目前工作目錄', err);
  }
}

// 取得本機可用磁碟機清單並填充下拉選單
async function fetchAvailableDrives() {
  try {
    const res = await fetch('/api/drives');
    if (res.ok) {
      const data = await res.json();
      if (modalDriveSelect) {
        modalDriveSelect.innerHTML = '';
        data.drives.forEach(drive => {
          const option = document.createElement('option');
          option.value = drive;
          option.textContent = drive;
          modalDriveSelect.appendChild(option);
        });
      }
    }
  } catch (err) {
    console.warn('無法取得磁碟機清單', err);
  }
}

// 導覽：上一頁
function navigateBack() {
  if (historyStack.length > 0) {
    forwardStack.push(currentPathScanned);
    const prevPath = historyStack.pop();
    isNavigating = true;
    folderPathInput.value = prevPath;
    startScan();
  }
}

// 導覽：下一頁
function navigateForward() {
  if (forwardStack.length > 0) {
    historyStack.push(currentPathScanned);
    const nextPath = forwardStack.pop();
    isNavigating = true;
    folderPathInput.value = nextPath;
    startScan();
  }
}

// 導覽：往上一層
function navigateParent() {
  if (!currentPathScanned) return;
  const currentPath = currentPathScanned;
  const isWindows = currentPath.includes('\\') || currentPath.indexOf(':') === 1;
  
  let parentPath = '';
  if (isWindows) {
    const parts = currentPath.split('\\').filter(p => p !== '');
    if (parts.length > 1) {
      parentPath = parts.slice(0, -1).join('\\');
      if (parentPath.endsWith(':')) {
        parentPath += '\\';
      }
    } else {
      return; // 已經在磁碟根目錄，無法再往上
    }
  } else {
    const parts = currentPath.split('/').filter(p => p !== '');
    if (parts.length > 0) {
      parentPath = '/' + parts.slice(0, -1).join('/');
    } else {
      return; // 已經在根目錄，無法再往上
    }
  }
  
  folderPathInput.value = parentPath;
  startScan();
}

// 導覽：磁碟根目錄
function navigateRoot() {
  if (!currentPathScanned) return;
  const currentPath = currentPathScanned;
  const isWindows = currentPath.includes('\\') || currentPath.indexOf(':') === 1;
  
  let rootPath = '';
  if (isWindows) {
    const match = currentPath.match(/^([a-zA-Z]:\\|[a-zA-Z]:)/);
    if (match) {
      rootPath = match[0].toUpperCase().endsWith('\\') ? match[0].toUpperCase() : match[0].toUpperCase() + '\\';
    } else {
      rootPath = 'C:\\';
    }
  } else {
    rootPath = '/';
  }
  
  folderPathInput.value = rootPath;
  startScan();
}

// 開啟本機目錄瀏覽 Modal
function openBrowseModal(e) {
  if (e) e.preventDefault();
  const currentVal = folderPathInput.value.trim();
  const startPath = currentVal || serverCwd || 'C:\\';
  loadDirectory(startPath);
  browseModal.classList.remove('hide');
}

// 關閉 Modal
function closeBrowseModal(e) {
  if (e) e.preventDefault();
  browseModal.classList.add('hide');
}

// 確定選擇 Modal 中的目錄
function selectFolderFromModal(e) {
  if (e) e.preventDefault();
  if (modalSelectedPath) {
    folderPathInput.value = modalSelectedPath;
  }
  closeBrowseModal();
}

// 載入指定目錄的子目錄列表
async function loadDirectory(targetPath) {
  modalDirsList.innerHTML = '<li class="dir-item-li" style="cursor: default; justify-content: center; color: var(--text-muted);">載入中...</li>';
  try {
    const res = await fetch(`/api/list-dir?path=${encodeURIComponent(targetPath)}`);
    if (!res.ok) {
      const errorData = await res.json();
      throw new Error(errorData.error || '無法讀取目錄');
    }
    
    const data = await res.json();
    modalCurrentPath = data.current;
    modalSelectedPath = data.current; // 預設選擇當前目錄
    
    // 自動將磁碟機下拉選單同步為當前路徑的磁碟
    const match = data.current.match(/^([a-zA-Z]:\\|[a-zA-Z]:)/);
    if (match && modalDriveSelect) {
      const driveKey = match[0].toUpperCase().endsWith('\\') ? match[0].toUpperCase() : match[0].toUpperCase() + '\\';
      modalDriveSelect.value = driveKey;
    }
    
    renderModalBreadcrumbs(data.current);
    renderModalDirsList(data.parent, data.directories);
  } catch (err) {
    console.warn(`目錄 [${targetPath}] 載入失敗，嘗試備用路徑...`, err);
    
    // 避免無限循環，如果載入失敗，依序嘗試：1. 伺服器工作目錄 2. C 槽根目錄 3. 拋出錯誤
    if (targetPath !== serverCwd && serverCwd) {
      loadDirectory(serverCwd);
    } else if (targetPath !== 'C:\\' && targetPath !== 'C:/' && targetPath !== '/') {
      const fallbackRoot = (serverCwd.includes('\\') || targetPath.includes('\\')) ? 'C:\\' : '/';
      loadDirectory(fallbackRoot);
    } else {
      modalDirsList.innerHTML = `<li class="dir-item-li" style="cursor: default; justify-content: center; color: #ef4444;">讀取失敗：${err.message}</li>`;
    }
  }
}

// 渲染麵包屑
function renderModalBreadcrumbs(currentPath) {
  modalBreadcrumbs.innerHTML = '';
  
  const isWindows = currentPath.includes('\\') || currentPath.indexOf(':') === 1;
  const separator = isWindows ? '\\' : '/';
  
  // 拆分路徑
  const parts = currentPath.split(/[\\/]/).filter(p => p !== '');
  
  if (!isWindows) {
    const rootSpan = document.createElement('span');
    rootSpan.className = 'breadcrumb-segment';
    rootSpan.textContent = 'Root';
    rootSpan.addEventListener('click', () => loadDirectory('/'));
    modalBreadcrumbs.appendChild(rootSpan);
  }
  
  parts.forEach((part, index) => {
    if (index > 0 || !isWindows) {
      const sep = document.createElement('span');
      sep.className = 'breadcrumb-separator';
      sep.textContent = ' > ';
      modalBreadcrumbs.appendChild(sep);
    }
    
    const span = document.createElement('span');
    span.className = 'breadcrumb-segment';
    span.textContent = part;
    
    span.addEventListener('click', () => {
      let targetPath = '';
      if (isWindows) {
        targetPath = parts.slice(0, index + 1).join('\\');
        if (index === 0 && targetPath.endsWith(':')) {
          targetPath += '\\';
        }
      } else {
        targetPath = '/' + parts.slice(0, index + 1).join('/');
      }
      loadDirectory(targetPath);
    });
    
    modalBreadcrumbs.appendChild(span);
  });
}

// 渲染目錄清單
function renderModalDirsList(parentPath, directories) {
  modalDirsList.innerHTML = '';
  
  // 1. 上一層目錄 (..)
  if (parentPath) {
    const li = document.createElement('li');
    li.className = 'dir-item-li';
    li.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="folder-icon-modal" style="color: #6b7280;">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
      </svg>
      <span class="dir-name">.. (回到上一層)</span>
    `;
    li.addEventListener('click', () => loadDirectory(parentPath));
    modalDirsList.appendChild(li);
  }
  
  // 2. 子目錄列表
  if (directories.length === 0) {
    const li = document.createElement('li');
    li.className = 'dir-item-li';
    li.style.cursor = 'default';
    li.innerHTML = `<span class="dir-name" style="color: var(--text-muted); font-style: italic;">沒有子目錄</span>`;
    modalDirsList.appendChild(li);
    return;
  }
  
  directories.forEach(dirName => {
    const li = document.createElement('li');
    li.className = 'dir-item-li';
    li.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="folder-icon-modal">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
      </svg>
      <span class="dir-name">${dirName}</span>
    `;
    
    const isWindows = modalCurrentPath.includes('\\') || modalCurrentPath.indexOf(':') === 1;
    const separator = isWindows ? '\\' : '/';
    let childPath = '';
    if (modalCurrentPath.endsWith('\\') || modalCurrentPath.endsWith('/')) {
      childPath = modalCurrentPath + dirName;
    } else {
      childPath = modalCurrentPath + separator + dirName;
    }
    
    // 單擊：選中
    li.addEventListener('click', () => {
      document.querySelectorAll('#modal-dirs-list .dir-item-li').forEach(item => {
        item.classList.remove('active-selection');
      });
      li.classList.add('active-selection');
      modalSelectedPath = childPath;
    });
    
    // 雙擊：進入
    li.addEventListener('dblclick', () => {
      loadDirectory(childPath);
    });
    
    modalDirsList.appendChild(li);
  });
}

// 格式化容量大小
function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

// 開始掃描
function startScan() {
  const targetPath = folderPathInput.value.trim();
  if (!targetPath) {
    showError('請輸入有效的資料夾路徑');
    return;
  }

  // 歷史記錄堆疊管理
  if (!isNavigating) {
    if (currentPathScanned && currentPathScanned !== targetPath) {
      historyStack.push(currentPathScanned);
      forwardStack = []; // 清空「下一頁」堆疊
    }
  }
  isNavigating = false;

  // 重設狀態與 UI
  cancelScan();
  hideError();
  hideResults();
  
  btnScan.disabled = true;
  scanSpinner.classList.remove('hide');
  btnCancel.classList.remove('hide');
  progressCard.classList.remove('hide');

  statFiles.textContent = '0';
  statFolders.textContent = '0';
  currentPathText.textContent = '初始化中...';

  // 建立 SSE 連線
  const url = `/api/scan?path=${encodeURIComponent(targetPath)}`;
  eventSource = new EventSource(url);

  eventSource.addEventListener('progress', (e) => {
    const data = JSON.parse(e.data);
    statFiles.textContent = data.scannedFiles.toLocaleString();
    statFolders.textContent = data.scannedFolders.toLocaleString();
    currentPathText.textContent = data.currentPath;
  });

  eventSource.addEventListener('complete', (e) => {
    const data = JSON.parse(e.data);
    scanResultData = data;
    currentPathScanned = targetPath; // 更新成功掃描的當前路徑
    showResults(data);
    cleanupScanState();
  });

  eventSource.addEventListener('error', (e) => {
    let msg = '掃描過程中發生錯誤，請確認路徑是否存在或具有存取權限。';
    if (e.data) {
      try {
        const errorData = JSON.parse(e.data);
        if (errorData.message) msg = errorData.message;
      } catch (err) {}
    }
    showError(msg);
    cleanupScanState();
  });
}

// 關閉伺服器
async function shutdownServer() {
  if (!confirm('確定要關閉 Puti-AI 磁碟空間分析工具嗎？\n關閉後，本工具將停止運行且無法繼續分析。')) {
    return;
  }
  
  try {
    cancelScan();
    await fetch('/api/shutdown', { method: 'POST' });
  } catch (err) {
    // 忽略因伺服器立即關閉導致的 fetch 網路異常
  }

  // 清空頁面，顯示已關閉的提示畫面
  document.body.innerHTML = `
    <div style="
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      background-color: #f3f4f6;
      color: #1f2937;
      font-family: 'Outfit', 'Noto Sans TC', sans-serif;
      text-align: center;
      padding: 20px;
    ">
      <svg viewBox="0 0 24 24" fill="none" stroke="#dc2626" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 64px; height: 64px; margin-bottom: 20px; filter: drop-shadow(0 2px 8px rgba(220, 38, 38, 0.2));">
        <path d="M18.36 6.64a9 9 0 1 1-12.73 0"></path>
        <line x1="12" y1="2" x2="12" y2="12"></line>
      </svg>
      <h2 style="margin-bottom: 10px; font-weight: 700; font-size: 1.8rem; background: linear-gradient(135deg, #1f2937, #4b5563); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">工具已結束運行</h2>
      <p style="color: #4b5563; font-size: 1.1rem; margin-bottom: 8px;">Puti-AI 磁碟空間分析工具的背景服務已成功停止。</p>
      <p style="color: #9ca3af; font-size: 0.95rem;">你現在可以安全地關閉此瀏覽器分頁。</p>
    </div>
  `;
}

// 取消掃描
function cancelScan() {
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
  cleanupScanState();
}

// 清除掃描中狀態
function cleanupScanState() {
  btnScan.disabled = false;
  scanSpinner.classList.add('hide');
  btnCancel.classList.add('hide');
  progressCard.classList.add('hide');
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
}

// 顯示錯誤
function showError(message) {
  errorText.textContent = message;
  errorCard.classList.remove('hide');
}

// 隱藏錯誤
function hideError() {
  errorCard.classList.add('hide');
}

// 隱藏結果
function hideResults() {
  resultsArea.classList.add('hide');
  navControlBar.classList.add('hide');
}

// 顯示結果
function showResults(data) {
  totalSizeBadge.textContent = formatBytes(data.totalSize);
  
  // 更新與顯示導覽列
  navCurrentPath.textContent = currentPathScanned;
  btnNavBack.disabled = historyStack.length === 0;
  btnNavForward.disabled = forwardStack.length === 0;
  
  // 檢查是否有父目錄
  const isWindows = currentPathScanned.includes('\\') || currentPathScanned.indexOf(':') === 1;
  let hasParent = false;
  if (isWindows) {
    const parts = currentPathScanned.split('\\').filter(p => p !== '');
    hasParent = parts.length > 1;
  } else {
    const parts = currentPathScanned.split('/').filter(p => p !== '');
    hasParent = parts.length > 0;
  }
  btnNavParent.disabled = !hasParent;
  btnNavRoot.disabled = !hasParent;

  navControlBar.classList.remove('hide');
  
  // 顯示結果區域
  resultsArea.classList.remove('hide');
  
  // 渲染圖表
  renderTypeChart(data.fileTypes, data.totalSize);

  // 渲染資料夾清單
  renderFolderTable();

  // 渲染十大巨無霸檔案
  renderLargestFiles(data.largestFiles);
}

// 渲染十大巨無霸檔案
function renderLargestFiles(files) {
  largestFilesList.innerHTML = '';
  if (!files || files.length === 0) {
    largestFilesList.innerHTML = '<div style="color: var(--text-muted); font-style: italic; font-size: 0.9rem; text-align: center; padding: 10px;">本資料夾下無任何檔案</div>';
    return;
  }
  
  files.forEach((file, index) => {
    const item = document.createElement('div');
    item.className = 'legend-item';
    item.style.alignItems = 'center';
    item.style.gap = '10px';
    
    // Windows 反斜線安全處理，防範 JSON 傳遞時字元逸出問題
    const safePath = file.path.replace(/\\/g, '\\\\');
    
    item.innerHTML = `
      <div class="legend-left" style="overflow: hidden; flex: 1;">
        <span style="font-weight: 700; color: #7c3aed; min-width: 18px; display: inline-block;">${index + 1}.</span>
        <div style="display: flex; flex-direction: column; overflow: hidden; text-align: left;">
          <span class="legend-name" style="text-overflow: ellipsis; overflow: hidden; white-space: nowrap; font-size: 0.9rem;" title="${file.name}">${file.name}</span>
          <span style="font-size: 0.75rem; color: var(--text-muted); text-overflow: ellipsis; overflow: hidden; white-space: nowrap;" title="${file.relativePath}">${file.relativePath || '.'}</span>
        </div>
      </div>
      <div class="legend-right" style="flex-shrink: 0; display: flex; align-items: center; gap: 8px;">
        <span class="legend-size" style="font-size: 0.85rem;">${formatBytes(file.size)}</span>
        <button type="button" class="btn btn-browse btn-open-file" data-path="${safePath}" style="padding: 4px 8px; font-size: 0.75rem; border-radius: 6px;">
          📁 定位
        </button>
      </div>
    `;
    
    const btnOpen = item.querySelector('.btn-open-file');
    btnOpen.addEventListener('click', async (e) => {
      e.preventDefault();
      const filePath = btnOpen.getAttribute('data-path');
      try {
        await fetch('/api/show-in-explorer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filePath })
        });
      } catch (err) {
        console.error('無法定位檔案', err);
      }
    });
    
    largestFilesList.appendChild(item);
  });
}

// 繪製檔案類型圓環圖
function renderTypeChart(fileTypes, totalSize) {
  const labels = [];
  const chartData = [];
  const backgroundColors = [];
  
  // 清空舊圖例
  typeLegendContainer.innerHTML = '';

  // 排序檔案類型，依大小降序
  const sortedTypes = Object.keys(fileTypes)
    .map(key => ({
      key,
      size: fileTypes[key],
      percentage: totalSize > 0 ? (fileTypes[key] / totalSize * 100).toFixed(1) : 0,
      ...FILE_TYPE_CONFIG[key]
    }))
    .sort((a, b) => b.size - a.size);

  sortedTypes.forEach(item => {
    // 圖表資料
    if (item.size > 0 || sortedTypes.length <= 1) { // 僅在有大小時放入圖表，除非全部為 0
      labels.push(item.name);
      chartData.push(item.size);
      backgroundColors.push(item.color);
    }

    // 渲染圖例
    const legendItem = document.createElement('div');
    legendItem.className = 'legend-item';
    legendItem.innerHTML = `
      <div class="legend-left">
        <span class="legend-color" style="background-color: ${item.color}"></span>
        <span class="legend-name">${item.name}</span>
      </div>
      <div class="legend-right">
        <span class="legend-percent">${item.percentage}%</span>
        <span class="legend-size">${formatBytes(item.size)}</span>
      </div>
    `;
    typeLegendContainer.appendChild(legendItem);
  });

  // 如果 Chart 實例已存在則銷毀
  if (typeChartInstance) {
    typeChartInstance.destroy();
  }

  const ctx = document.getElementById('type-chart').getContext('2d');
  typeChartInstance = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: labels,
      datasets: [{
        data: chartData,
        backgroundColor: backgroundColors,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.1)'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: false // 隱藏預設圖例，使用自訂的 HTML 圖例
        },
        tooltip: {
          callbacks: {
            label: function(context) {
              const val = context.raw;
              const pct = totalSize > 0 ? (val / totalSize * 100).toFixed(1) : 0;
              return ` ${context.label}: ${formatBytes(val)} (${pct}%)`;
            }
          }
        }
      },
      cutout: '70%' // 圓環寬度
    }
  });
}

// 處理表格排序邏輯
function handleSort(key) {
  if (currentSort.key === key) {
    currentSort.desc = !currentSort.desc;
  } else {
    currentSort.key = key;
    currentSort.desc = true;
  }

  // 更新 Table Header 箭頭
  document.querySelectorAll('.folder-table th.sortable').forEach(th => {
    const sortIcon = th.querySelector('.sort-icon');
    const sortKey = th.getAttribute('data-sort');
    
    th.classList.remove('sorted-asc', 'sorted-desc');
    
    if (sortKey === currentSort.key) {
      th.classList.add(currentSort.desc ? 'sorted-desc' : 'sorted-asc');
      sortIcon.textContent = currentSort.desc ? '↓' : '↑';
    } else {
      sortIcon.textContent = '↕';
    }
  });

  renderFolderTable();
}

// 渲染資料夾清單表格
function renderFolderTable() {
  if (!scanResultData || !scanResultData.subfolders) return;

  const subfolders = [...scanResultData.subfolders];

  // 排序
  subfolders.sort((a, b) => {
    let valA, valB;
    switch (currentSort.key) {
      case 'name':
        valA = a.name.toLowerCase();
        valB = b.name.toLowerCase();
        return currentSort.desc 
          ? valB.localeCompare(valA, 'zh-Hant') 
          : valA.localeCompare(valB, 'zh-Hant');
      case 'size':
        valA = a.size;
        valB = b.size;
        break;
      case 'files':
        valA = a.filesCount;
        valB = b.filesCount;
        break;
      case 'folders':
        valA = a.foldersCount;
        valB = b.foldersCount;
        break;
      default:
        valA = a.size;
        valB = b.size;
    }
    return currentSort.desc ? valB - valA : valA - valB;
  });

  folderListBody.innerHTML = '';

  subfolders.forEach(item => {
    const tr = document.createElement('tr');
    
    // 名稱欄位（支援鑽取點擊）
    let nameContent = '';
    if (item.isDirectory) {
      nameContent = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="folder-icon">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
        </svg>
        <a class="folder-name-link" data-name="${item.name}">${item.name}</a>
      `;
    } else {
      nameContent = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="file-icon">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
          <polyline points="14 2 14 8 20 8"></polyline>
        </svg>
        <span>${item.name}</span>
      `;
    }

    tr.innerHTML = `
      <td>
        <div class="folder-name-cell">
          ${nameContent}
        </div>
      </td>
      <td class="folder-size-cell">${formatBytes(item.size)}</td>
      <td class="file-count-cell">${item.filesCount.toLocaleString()}</td>
      <td class="folder-count-cell">${item.isDirectory ? item.foldersCount.toLocaleString() : '-'}</td>
    `;

    // 點擊資料夾名稱時鑽取深入
    if (item.isDirectory) {
      const link = tr.querySelector('.folder-name-link');
      link.addEventListener('click', (e) => {
        e.preventDefault();
        drillDown(item.name);
      });
    }

    folderListBody.appendChild(tr);
  });
}

// 鑽取深入子目錄
function drillDown(subfolderName) {
  const currentPath = folderPathInput.value.trim();
  let newPath = '';
  
  if (currentPath.endsWith('\\') || currentPath.endsWith('/')) {
    newPath = currentPath + subfolderName;
  } else {
    const separator = currentPath.includes('/') ? '/' : '\\';
    newPath = currentPath + separator + subfolderName;
  }
  
  folderPathInput.value = newPath;
  startScan();
}

// 心跳機制，定時向後端發送訊號以證明前端分頁仍開啟
function startHeartbeat() {
  setInterval(async () => {
    try {
      await fetch('/api/heartbeat');
    } catch (err) {
      console.warn('心跳發送失敗，伺服器可能已關閉');
    }
  }, 5000); // 每 5 秒發送一次
}
