let monitoringActive = false;
let tabLastActive = {};
let allClosedTabs = [];

// Fungsi untuk mendapatkan waktu saat ini dalam milidetik
function getCurrentTime() {
    return new Date().getTime();
}

// Fungsi untuk menyimpan data ke session storage
async function saveToSession(data) {
    try {
        // Ambil data yang sudah ada di session
        const result = await chrome.storage.session.get('closedTabs');
        let allTabs = result.closedTabs || [];
        
        // Tambahkan data baru
        allTabs = [...allTabs, ...data];
        
        // Simpan kembali ke session storage
        await chrome.storage.session.set({ 'closedTabs': allTabs });
        console.log('Data berhasil disimpan ke session:', allTabs);
        return allTabs;
    } catch (error) {
        console.error('Error menyimpan ke session:', error);
        return data;
    }
}

// Fungsi untuk mengekspor data ke CSV
async function exportToCSV(newData) {
    try {
        // Ambil semua data dari session storage
        const result = await chrome.storage.session.get('closedTabs');
        const allTabs = result.closedTabs || [];
        
        // Buat konten CSV
        let csvContent = "URL,Title,Close Time\n";
        
        // Tambahkan semua data ke CSV
        allTabs.forEach(tab => {
            csvContent += `"${tab.url.replace(/"/g, '""')}","${tab.title.replace(/"/g, '""')}","${new Date(tab.closeTime).toLocaleString()}"\n`;
        });

        // Buat nama file dengan tanggal hari ini
        const date = new Date().toISOString().split('T')[0];
        const filename = `closed_tabs_${date}.csv`;

        // Download file
        const dataUrl = 'data:text/csv;charset=utf-8,\ufeff' + encodeURIComponent(csvContent);
        await chrome.downloads.download({
            url: dataUrl,
            filename: filename,
            conflictAction: 'overwrite',
            saveAs: false
        });

        console.log('File CSV berhasil dibuat dengan', allTabs.length, 'tab');
    } catch (error) {
        console.error('Error saat ekspor CSV:', error);
    }
}

// Fungsi untuk menyimpan backup tabs
async function saveBackupTabs(tabData) {
    try {
        const currentBackups = await chrome.storage.local.get('tabBackups');
        const backups = currentBackups.tabBackups || [];
        
        const newBackup = {
            id: Date.now(),
            timestamp: new Date().toISOString(),
            tabs: tabData
        };
        
        backups.unshift(newBackup); // Tambahkan backup baru di awal array
        
        // Simpan maksimal 10 backup terakhir
        const updatedBackups = backups.slice(0, 10);
        
        await chrome.storage.local.set({ 'tabBackups': updatedBackups });
        return newBackup;
    } catch (error) {
        console.error('Error saving backup:', error);
        return null;
    }
}

// Update message listener untuk menangani backup dan restore
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "closeInactiveTabs") {
        const excludeKeywords = request.excludeKeywords || [];
        
        chrome.tabs.query({ active: false }, async (tabs) => {
            if (tabs.length === 0) {
                console.log('Tidak ada tab tidak aktif yang dapat ditutup');
                return;
            }

            let newTabsToClose = [];
            let closedTabsWindow = null;
            
            try {
                // Cari dan tutup window closed tabs yang lama
                const allWindows = await chrome.tabs.query({});
                for (const tab of allWindows) {
                    if (tab.url.startsWith('data:text/html') && tab.title === 'Closed Tabs List') {
                        await chrome.tabs.remove(tab.id);
                    }
                }

                // Kumpulkan data tab baru yang akan ditutup
                for (const tab of tabs) {
                    if (!tab.url.startsWith('chrome://') && 
                        !tab.url.startsWith('edge://') && 
                        !tab.url.startsWith('data:text/html') && 
                        !tab.title.includes('Closed Tabs List')) {
                        
                        const shouldExclude = excludeKeywords.some(keyword => 
                            tab.title.toLowerCase().includes(keyword.toLowerCase()) ||
                            tab.url.toLowerCase().includes(keyword.toLowerCase())
                        );

                        if (!shouldExclude) {
                            const newTab = {
                                title: tab.title,
                                url: tab.url,
                                closeTime: new Date().toLocaleString()
                            };
                            newTabsToClose.push({ id: tab.id, data: newTab });
                        }
                    }
                }

                // Tambahkan tab baru ke daftar semua tab yang ditutup
                newTabsToClose.forEach(tab => {
                    allClosedTabs.unshift(tab.data); // Tambahkan di awal array
                });

                // Tutup tab yang akan ditutup
                for (const tab of newTabsToClose) {
                    await chrome.tabs.remove(tab.id);
                }

                // Buat tab baru dengan daftar lengkap
                const htmlContent = createClosedTabsHTML(allClosedTabs);
                const dataUrl = 'data:text/html;charset=utf-8,' + encodeURIComponent(htmlContent);
                await chrome.tabs.create({ url: dataUrl });

                // Simpan backup
                await saveBackupTabs(newTabsToClose.map(t => t.data));

                console.log(`Berhasil menutup ${newTabsToClose.length} tab`);
                sendResponse({ success: true });
            } catch (error) {
                console.error('Terjadi kesalahan:', error);
                sendResponse({ success: false, error: error.message });
            }
        });
        return true;
    } else if (request.action === "getBackups") {
        chrome.storage.local.get('tabBackups', (result) => {
            sendResponse({ backups: result.tabBackups || [] });
        });
        return true;
    } else if (request.action === "restoreBackup") {
        const backupId = request.backupId;
        chrome.storage.local.get('tabBackups', async (result) => {
            const backups = result.tabBackups || [];
            const backup = backups.find(b => b.id === backupId);
            
            if (backup) {
                for (const tab of backup.tabs) {
                    await chrome.tabs.create({ url: tab.url, active: false });
                }
                sendResponse({ success: true });
            } else {
                sendResponse({ success: false, error: 'Backup not found' });
            }
        });
        return true;
    } else if (request.action === "deleteBackup") {
        const backupId = request.backupId;
        chrome.storage.local.get('tabBackups', async (result) => {
            const backups = result.tabBackups || [];
            const updatedBackups = backups.filter(b => b.id !== backupId);
            
            try {
                await chrome.storage.local.set({ 'tabBackups': updatedBackups });
                sendResponse({ success: true });
            } catch (error) {
                console.error('Error deleting backup:', error);
                sendResponse({ success: false, error: 'Failed to delete backup' });
            }
        });
        return true;
    }
    return true;
});

// Monitor tab activity
chrome.tabs.onActivated.addListener((activeInfo) => {
  if (monitoringActive) {
    tabLastActive[activeInfo.tabId] = Date.now();
  }
});

// Start monitoring
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'startMonitoring') {
    monitoringActive = true;
    checkInactiveTabs();
  } else if (request.action === 'stopMonitoring') {
    monitoringActive = false;
  }
});

// Check inactive tabs
async function checkInactiveTabs() {
  if (!monitoringActive) return;

  const tabs = await chrome.tabs.query({});
  const closedTabsInfo = [];

  for (const tab of tabs) {
    const lastActiveTime = tabLastActive[tab.id] || Date.now();
    const inactiveTime = Date.now() - lastActiveTime;

    // Jika tab tidak aktif selama 15 menit (900000 ms)
    if (inactiveTime > 5000) {
      const summary = await getSummary(tab.url);
      

      closedTabsInfo.push({
        title: tab.title,
        summary: summary,
        url: tab.url,
        lastActive: new Date(lastActiveTime).toLocaleString()
      });

      chrome.tabs.remove(tab.id);
      delete tabLastActive[tab.id];
    }
  }

  if (closedTabsInfo.length > 0) {
    exportToCSV(closedTabsInfo);
  }

  // Check again after 1 minute
  setTimeout(checkInactiveTabs, 30000);
}

// Fungsi untuk mendapatkan ringkasan menggunakan AI (contoh sederhana)
async function getSummary(url) {
  // Di sini Anda bisa mengimplementasikan integrasi dengan API AI
  // Untuk contoh, kita return teks sederhana
  return "Ringkasan website akan ditambahkan di sini";
}

function createClosedTabsHTML(tabData) {
    const groupedTabs = tabData.reduce((groups, tab) => {
        const date = tab.closeTime.split(',')[0];
        if (!groups[date]) {
            groups[date] = [];
        }
        groups[date].push(tab);
        return groups;
    }, {});

    return `
        <!DOCTYPE html>
        <html>
        <head>
            <title>Closed Tabs List</title>
            <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
            <style>
                :root {
                    --primary-color: #4f46e5;
                    --bg-gradient: linear-gradient(135deg, #4f46e5, #7c3aed);
                    --surface-color: rgba(255, 255, 255, 0.95);
                }

                body {
                    font-family: 'Inter', system-ui, -apple-system, sans-serif;
                    margin: 0;
                    padding: 2rem;
                    min-height: 100vh;
                    background: var(--bg-gradient);
                    color: #1f2937;
                }

                .container {
                    max-width: 900px;
                    margin: 0 auto;
                    background: var(--surface-color);
                    border-radius: 24px;
                    padding: 2rem;
                    box-shadow: 0 12px 36px rgba(0, 0, 0, 0.1);
                    backdrop-filter: blur(12px);
                }

                .header {
                    text-align: center;
                    margin-bottom: 2rem;
                }

                .header h1 {
                    font-size: 2rem;
                    font-weight: 600;
                    margin: 0;
                    background: var(--bg-gradient);
                    -webkit-background-clip: text;
                    -webkit-text-fill-color: transparent;
                }

                .stats {
                    display: inline-block;
                    margin-top: 1rem;
                    padding: 0.5rem 1rem;
                    background: rgba(255, 255, 255, 0.5);
                    border-radius: 20px;
                    font-size: 0.9rem;
                    color: #4b5563;
                }

                .date-group {
                    margin-bottom: 2.5rem;
                }

                .date-header {
                    background: rgba(255, 255, 255, 0.8);
                    padding: 1rem 1.5rem;
                    border-radius: 16px;
                    margin-bottom: 1rem;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
                }

                .date-header span {
                    font-weight: 600;
                    color: #1f2937;
                    font-size: 1.1rem;
                }

                .date-stats {
                    background: var(--bg-gradient);
                    color: white;
                    padding: 0.4rem 1rem;
                    border-radius: 20px;
                    font-size: 0.85rem;
                    font-weight: 500;
                }

                .tab-item {
                    background: white;
                    border-radius: 12px;
                    padding: 1rem;
                    margin-bottom: 0.75rem;
                    text-decoration: none;
                    color: inherit;
                    display: block;
                    transition: all 0.2s;
                    border: 1px solid rgba(226, 232, 240, 0.8);
                }

                .tab-item:hover {
                    transform: translateY(-2px);
                    box-shadow: 0 6px 16px rgba(0, 0, 0, 0.08);
                    border-color: var(--primary-color);
                }

                .tab-title {
                    font-weight: 500;
                    color: #1f2937;
                    margin-bottom: 0.5rem;
                    font-size: 1rem;
                }

                .tab-url {
                    color: #6b7280;
                    font-size: 0.9rem;
                    margin-bottom: 0.5rem;
                    word-break: break-all;
                }

                .tab-time {
                    font-size: 0.8rem;
                    color: #9ca3af;
                }

                @media (max-width: 768px) {
                    body {
                        padding: 1rem;
                    }

                    .container {
                        padding: 1.5rem;
                    }

                    .header h1 {
                        font-size: 1.5rem;
                    }
                }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>Closed Tabs History</h1>
                    <div class="stats">
                        Total closed tabs: ${tabData.length}
                    </div>
                </div>
                <div class="tab-list">
                    ${Object.entries(groupedTabs).map(([date, tabs]) => `
                        <div class="date-group">
                            <div class="date-header">
                                <span>${date}</span>
                                <span class="date-stats">${tabs.length} tabs</span>
                            </div>
                            <div class="group-tab-list">
                                ${tabs.map(tab => `
                                    <a href="${tab.url}" class="tab-item" target="_blank">
                                        <div class="tab-title">${tab.title}</div>
                                        <div class="tab-url">${tab.url}</div>
                                        <div class="tab-time">Closed at: ${tab.closeTime.split(',')[1]}</div>
                                    </a>
                                `).join('')}
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        </body>
        </html>
    `;
} 