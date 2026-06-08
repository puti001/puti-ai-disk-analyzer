const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const EXE_NAME = 'puti-ai-disk-analyzer.exe';

console.log('1. 開始使用 pkg 打包應用程式...');
try {
  execSync('npx pkg . --targets node18-win-x64 --output ' + EXE_NAME, { stdio: 'inherit' });
  console.log('✔ pkg 打包完成。');
} catch (err) {
  console.error('❌ pkg 打包失敗:', err);
  process.exit(1);
}

console.log('2. 開始修改 PE 標頭，將 Subsystem 從 Console (3) 改為 Windows GUI (2)...');
const exePath = path.join(__dirname, EXE_NAME);

try {
  const buffer = fs.readFileSync(exePath);

  // 1. 在 DOS Header 的偏移量 0x3c 處取得 PE Header 的偏移量 (e_lfanew)
  const peHeaderOffset = buffer.readUInt32LE(0x3c);
  
  // 2. 檢查 PE 標誌 signature 是否為 'PE\0\0' (0x50 0x45 0x00 0x00)
  const signature = buffer.toString('ascii', peHeaderOffset, peHeaderOffset + 4);
  if (signature !== 'PE\0\0') {
    throw new Error('找不到正確的 PE 標誌，該檔案可能不是合法的 PE 可執行檔。');
  }

  // 3. Subsystem 偏移量 = peHeaderOffset + 4 (Signature) + 20 (COFF File Header) + 68 (Optional Header 中 Subsystem 的相對偏移量) = peHeaderOffset + 92
  const subsystemOffset = peHeaderOffset + 92;
  const currentSubsystem = buffer.readUInt16LE(subsystemOffset);

  console.log(`目前的 Subsystem 值為: ${currentSubsystem} (${currentSubsystem === 3 ? 'Console' : currentSubsystem === 2 ? 'GUI' : '其他'})`);

  if (currentSubsystem === 3) {
    // 將其修改為 2 (IMAGE_SUBSYSTEM_WINDOWS_GUI)
    buffer.writeUInt16LE(2, subsystemOffset);
    fs.writeFileSync(exePath, buffer);
    console.log('✔ 成功修改 PE 標頭：已將 Subsystem 更改為 Windows GUI (2)！本程式將不再彈出小黑窗。');
  } else if (currentSubsystem === 2) {
    console.log('ℹ 檔案的 Subsystem 已經是 GUI，無需修改。');
  } else {
    throw new Error(`未知的 Subsystem 值: ${currentSubsystem}`);
  }
} catch (err) {
  console.error('❌ 修改 PE 標頭失敗:', err.message);
  process.exit(1);
}

console.log('🎉 建置完成！您現在可以直接雙擊 ' + EXE_NAME + ' 啟動，無須透過 VBS 啟動器。');
