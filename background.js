console.log('=== Service worker loaded ===');

// Save URL to storage if not already saved
async function saveUrl(url, title) {

  const data = await chrome.storage.local.get('savedUrls');
  const savedUrls = data.savedUrls || [];

  // Check if URL already exists
  const exists = savedUrls.some(item =>
    (typeof item === 'string' ? item : item.url) === url
  );

  if (!exists) {
    savedUrls.push({ url, title: title || url });
    await chrome.storage.local.set({ savedUrls });
  }
}

// Get all saved URLs
async function getSavedUrls() {
  const data = await chrome.storage.local.get('savedUrls');
  return data.savedUrls || [];
}

// Get browser history from last 30 days
async function getHistoryUrls() {
  const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
  const historyItems = await chrome.history.search({
    text: '',
    startTime: thirtyDaysAgo,
    maxResults: 500
  });
  return historyItems
    .filter(item => item.url && item.url.startsWith('http'))
    .map(item => ({
      url: item.url,
      title: item.title || item.url,
      source: 'history',
      visitCount: item.visitCount || 0
    }));
}

// Get top sites
async function getTopSites() {
  const topSites = await chrome.topSites.get();
  return topSites.map(site => ({
    url: site.url,
    title: site.title || site.url,
    source: 'topSite'
  }));
}

// Merge and deduplicate URLs from all sources
async function getAllUrls() {
  const [savedUrls, historyUrls, topSites] = await Promise.all([
    getSavedUrls(),
    getHistoryUrls(),
    getTopSites()
  ]);

  const urlMap = new Map();

  // Add top sites first (highest priority indicator)
  for (const item of topSites) {
    urlMap.set(item.url, { ...item, isTopSite: true });
  }

  // Add history (with visit count for scoring)
  for (const item of historyUrls) {
    if (urlMap.has(item.url)) {
      const existing = urlMap.get(item.url);
      existing.visitCount = item.visitCount;
    } else {
      urlMap.set(item.url, item);
    }
  }

  // Add saved URLs (mark as saved)
  for (const item of savedUrls) {
    const url = typeof item === 'string' ? item : item.url;
    const title = typeof item === 'string' ? item : (item.title || item.url);
    if (urlMap.has(url)) {
      const existing = urlMap.get(url);
      existing.isSaved = true;
      // Prefer saved title if available
      if (title && title !== url) {
        existing.title = title;
      }
    } else {
      urlMap.set(url, { url, title, isSaved: true });
    }
  }

  // Convert to array and sort: top sites first, then by visit count
  return Array.from(urlMap.values()).sort((a, b) => {
    if (a.isTopSite && !b.isTopSite) return -1;
    if (!a.isTopSite && b.isTopSite) return 1;
    if (a.isSaved && !b.isSaved) return -1;
    if (!a.isSaved && b.isSaved) return 1;
    return (b.visitCount || 0) - (a.visitCount || 0);
  });
}

// Remove URL from storage
async function removeUrl(url) {
  const data = await chrome.storage.local.get('savedUrls');
  const savedUrls = data.savedUrls || [];
  const index = savedUrls.findIndex(item =>
    (typeof item === 'string' ? item : item.url) === url
  );
  if (index > -1) {
    savedUrls.splice(index, 1);
    await chrome.storage.local.set({ savedUrls });
  }
}

// Send message to content script, injecting it first if needed
async function sendToContentScript(tabId, message) {
  console.log('=== Sending to content script:', tabId, message.action, '===');
  try {
    await chrome.tabs.sendMessage(tabId, message);
  } catch (e) {
    // Content script not loaded, try to inject it
    console.log('Content script not ready, injecting...', e.message);
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content.js']
      });
      console.log('Content script injected successfully');
      // Small delay to ensure message listener is registered
      await new Promise(resolve => setTimeout(resolve, 50));
      // Retry sending message after injection
      await chrome.tabs.sendMessage(tabId, message);
    } catch (injectError) {
      // Can't inject (chrome:// pages, etc.) - silently fail
      console.log('Cannot inject content script on this page:', injectError);
    }
  }
}

// Listen for keyboard shortcut commands
chrome.commands.onCommand.addListener(async (command) => {
  console.log('=== Command received:', command, '===');
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  console.log('Active tab:', tab);

  if (!tab || !tab.id || !tab.url) return;

  // Skip non-http pages (chrome://, about:, etc.)
  if (!tab.url.startsWith('http')) return;

  if (command === 'omnisearch') {
    // await saveUrl(tab.url, tab.title);
    const urls = await getAllUrls();
    await sendToContentScript(tab.id, { action: 'openOmnisearch', urls , addUrl:true, currentUrl:tab.url,currentTitle:tab.title});
  } else if (command === 'omnisearch-consume') {
    const urls = await getAllUrls();
    await sendToContentScript(tab.id, { action: 'openOmnisearchConsume', currentUrl: tab.url, urls,addUrl:false });
  } else if (command === 'url-finder') {
    // await saveUrl(tab.url, tab.title);
    const urls = await getSavedUrls();
    await sendToContentScript(tab.id, { action: 'openFinder', urls , addUrl:false});
  }
});

// Listen for navigation requests from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('=== Message received:', message, '===');
  if (message.action === 'navigate') {
    chrome.tabs.update(sender.tab.id, { url: message.url });
  } else if (message.action === 'saveAndNavigate') {
    saveUrl(message.saveUrl,message.saveTitle).then(() => {
      chrome.tabs.update(sender.tab.id, { url: message.url });
    });
  } else if (message.action === 'removeAndNavigate') {
    removeUrl(message.removeUrl).then(() => {
      chrome.tabs.update(sender.tab.id, { url: message.url });
    });
  }
});
