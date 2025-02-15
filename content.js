// Simpan data tab yang ditutup
let closedTabs = [];

// Listener untuk komunikasi dengan background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "getExistingTabs") {
        sendResponse({ existingTabs: closedTabs });
        return true;
    }
    if (request.action === "updateTabs") {
        closedTabs = request.tabs;
        return true;
    }
}); 