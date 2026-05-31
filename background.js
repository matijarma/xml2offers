'use strict';

async function enableSidePanel() {
    if (!chrome.sidePanel) return;
    try {
        if (chrome.sidePanel.setPanelBehavior) {
            await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
        }
        if (chrome.sidePanel.setOptions) {
            await chrome.sidePanel.setOptions({ path: 'popup.html', enabled: true });
        }
    } catch (e) {
        // ignore
    }
}

chrome.runtime.onInstalled.addListener(() => {
    enableSidePanel();
});

chrome.runtime.onStartup.addListener(() => {
    enableSidePanel();
});

chrome.action.onClicked.addListener((tab) => {
    if (!chrome.sidePanel || !chrome.sidePanel.open || !tab || !tab.id) return;
    try {
        chrome.sidePanel.open({ tabId: tab.id });
    } catch (e) {
        // ignore
    }
});
