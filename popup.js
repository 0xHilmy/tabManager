document.addEventListener('DOMContentLoaded', async () => {
    // Load saved keywords
    const loadKeywords = async () => {
        const result = await chrome.storage.sync.get('excludeKeywords');
        return result.excludeKeywords || [];
    };

    // Save keywords
    const saveKeywords = async (keywords) => {
        await chrome.storage.sync.set({ 'excludeKeywords': keywords });
    };

    // Update keywords display
    const updateKeywordsList = (keywords) => {
        const keywordsList = document.getElementById('keywordsList');
        keywordsList.innerHTML = '';
        
        keywords.forEach(keyword => {
            // Buat container tag
            const tag = document.createElement('div');
            tag.className = 'keyword-tag';

            // Buat text span
            const textSpan = document.createElement('span');
            textSpan.className = 'keyword-text';
            textSpan.textContent = keyword;

            // Buat remove button span
            const removeSpan = document.createElement('span');
            removeSpan.className = 'remove-keyword';
            removeSpan.dataset.keyword = keyword;
            removeSpan.innerHTML = '&times;';

            // Gabungkan elemen-elemen
            tag.appendChild(textSpan);
            tag.appendChild(removeSpan);
            keywordsList.appendChild(tag);
        });
    };

    // Load and display saved keywords
    let excludeKeywords = await loadKeywords();
    updateKeywordsList(excludeKeywords);

    // Update tab count
    const updateTabCount = async () => {
        const tabs = await chrome.tabs.query({});
        document.getElementById('activeTabCount').textContent = tabs.length;
    };
    updateTabCount();

    // Handle new keyword input
    document.getElementById('excludeKeyword').addEventListener('keypress', async (e) => {
        if (e.key === 'Enter') {
            const input = e.target;
            const keyword = input.value.trim();
            
            if (keyword && !excludeKeywords.includes(keyword)) {
                excludeKeywords.push(keyword);
                await saveKeywords(excludeKeywords);
                updateKeywordsList(excludeKeywords);
                input.value = '';
            }
        }
    });

    // Handle keyword removal
    document.getElementById('keywordsList').addEventListener('click', async (e) => {
        if (e.target.classList.contains('remove-keyword')) {
            const keyword = e.target.dataset.keyword;
            excludeKeywords = excludeKeywords.filter(k => k !== keyword);
            await saveKeywords(excludeKeywords);
            updateKeywordsList(excludeKeywords);
        }
    });

    // Handle close inactive tabs button - SINGLE EVENT LISTENER
    document.getElementById('closeInactiveTabs').addEventListener('click', () => {
        chrome.runtime.sendMessage({ 
            action: 'closeInactiveTabs',
            excludeKeywords: excludeKeywords
        });
        window.close();
    });

    // Handle restore tabs button
    document.getElementById('restoreTabs').addEventListener('click', async () => {
        // Get backups
        chrome.runtime.sendMessage({ action: 'getBackups' }, async (response) => {
            const backups = response.backups;
            if (!backups || backups.length === 0) {
                alert('No backups available');
                return;
            }

            // Buat dan tampilkan modal untuk memilih backup
            const modal = document.createElement('div');
            modal.className = 'modal';
            modal.innerHTML = `
                <div class="modal-content">
                    <h2>Select Backup to Restore</h2>
                    <div class="backup-list">
                        ${backups.map(backup => `
                            <div class="backup-item" data-id="${backup.id}">
                                <div class="backup-info">
                                    <div class="backup-header">
                                        <div class="backup-header-top">
                                            <div class="backup-time">${new Date(backup.timestamp).toLocaleString()}</div>
                                            <button class="delete-backup" title="Delete backup">
                                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                                                    <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                                                </svg>
                                            </button>
                                        </div>
                                        <div class="backup-count">${backup.tabs.length} tabs</div>
                                    </div>
                                    <div class="backup-details-btn" data-id="${backup.id}">
                                        <span>Show details</span>
                                        
                                    </div>
                                    <div class="backup-details" id="details-${backup.id}" style="display: none;">
                                        ${backup.tabs.map(tab => `
                                            <div class="tab-detail">
                                                <div class="tab-title">${tab.title}</div>
                                                <div class="tab-url">${tab.url}</div>
                                            </div>
                                        `).join('')}
                                    </div>
                                </div>
                                <button class="restore-btn">Restore</button>
                            </div>
                        `).join('')}
                    </div>
                    <button class="close-modal">Close</button>
                </div>
            `;

            document.body.appendChild(modal);

            // Handle details toggle
            modal.addEventListener('click', async (e) => {
                if (e.target.closest('.backup-details-btn')) {
                    const btn = e.target.closest('.backup-details-btn');
                    const backupId = btn.dataset.id;
                    const details = document.getElementById(`details-${backupId}`);
                    const arrow = btn.querySelector('.dropdown-arrow');
                    
                    if (details.style.display === 'none') {
                        details.style.display = 'block';
                        btn.classList.add('active');
                    } else {
                        details.style.display = 'none';
                        btn.classList.remove('active');
                    }
                } else if (e.target.closest('.delete-backup')) {
                    const backupItem = e.target.closest('.backup-item');
                    const backupId = Number(backupItem.dataset.id);
                    
                    // Langsung hapus tanpa konfirmasi
                    chrome.runtime.sendMessage({ 
                        action: 'deleteBackup',
                        backupId: backupId
                    }, (response) => {
                        if (response.success) {
                            backupItem.remove();
                            // If no more backups, close modal
                            if (modal.querySelectorAll('.backup-item').length === 0) {
                                modal.remove();
                            }
                        } else {
                            alert('Failed to delete backup');
                        }
                    });
                } else if (e.target.closest('.restore-btn')) {
                    const backupId = Number(e.target.closest('.backup-item').dataset.id);
                    chrome.runtime.sendMessage({ 
                        action: 'restoreBackup',
                        backupId: backupId
                    }, (response) => {
                        if (response.success) {
                            modal.remove();
    window.close();
                        } else {
                            alert('Failed to restore backup');
                        }
                    });
                } else if (e.target.classList.contains('close-modal')) {
                    modal.remove();
                }
            });
        });
    });
}); 