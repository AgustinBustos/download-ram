// Modal state
let modal = null;
let mode = null;
let urls = [];
let filteredUrls = [];
let selectedIndex = 0;
let consumeUrl = null; // URL to remove when navigating (for consume mode)
let urlToSave=null;
let titleToSave=null;

// Fuzzy search implementation
function fuzzyMatch(pattern, str) {
  pattern = pattern.toLowerCase();
  str = str.toLowerCase();

  let patternIdx = 0;
  let score = 0;
  let lastMatchIdx = -1;

  for (let i = 0; i < str.length && patternIdx < pattern.length; i++) {
    if (str[i] === pattern[patternIdx]) {
      score += 1;
      // Bonus for consecutive matches
      if (lastMatchIdx === i - 1) {
        score += 2;
      }
      // Bonus for start of string
      if (i === 0) {
        score += 3;
      }
      // Bonus for after separator
      if (i > 0 && '/.-_'.includes(str[i - 1])) {
        score += 2;
      }
      lastMatchIdx = i;
      patternIdx++;
    }
  }

  // Return score only if all pattern chars were matched
  return patternIdx === pattern.length ? score : 0;
}

// Normalize item to { url, title } format (handles legacy string format)
function normalizeItem(item) {
  if (typeof item === 'string') {
    return { url: item, title: item };
  }
  return {
    url: item.url,
    title: item.title || item.url,
    isTopSite: item.isTopSite || false,
    isSaved: item.isSaved || false,
    visitCount: item.visitCount || 0
  };
}

function filterUrls(query) {
  const normalized = urls.map(normalizeItem);

  if (!query) {
    // No query: sort by top site, then saved, then visit count
    return normalized
      .map(item => {
        let score = 1;
        if (item.isTopSite) score += 100;
        if (item.isSaved) score += 50;
        score += Math.min(item.visitCount || 0, 50); // Cap visit bonus
        return { ...item, score };
      })
      .sort((a, b) => b.score - a.score);
  }

  return normalized
    .map(item => {
      // Search both title and URL, take best score
      const titleScore = fuzzyMatch(query, item.title) * 1.5; // Boost title matches
      const urlScore = fuzzyMatch(query, item.url);
      let score = Math.max(titleScore, urlScore);

      // Boost frequently visited and top sites
      if (score > 0) {
        if (item.isTopSite) score += 10;
        if (item.isSaved) score += 5;
        score += Math.min((item.visitCount || 0) / 10, 5); // Small visit bonus
      }
      return { ...item, score };
    })
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score);
}

// Check if input looks like a URL
function looksLikeUrl(input) {
  return input.includes('.') && !input.includes(' ');
}

// Normalize URL (add https:// if missing)
function normalizeUrl(input) {
  if (!/^https?:\/\//i.test(input)) {
    return 'https://' + input;
  }
  return input;
}

// Create Google search URL
function googleSearchUrl(query) {
  return 'https://www.google.com/search?q=' + encodeURIComponent(query);
}

// Escape HTML to prevent XSS
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Create and show modal
function showModal(modalMode, urlList = [], urlToConsume = null,currentUrl=null,currentTitle=null ) {
  if (modal) {
    closeModal();
  }

  mode = modalMode;
  urls = urlList;
  filteredUrls = filterUrls('');
  selectedIndex = 0;
  consumeUrl = urlToConsume;
  urlToSave=currentUrl
  titleToSave=currentTitle

  // Create modal elements
  modal = document.createElement('div');
  modal.id = 'qul-modal-overlay';
  modal.innerHTML = `
    <div id="qul-modal">
      <input type="text" id="qul-input" placeholder="${mode === 'omnisearch' ? 'Type URL or search...' : 'Search saved URLs...'}" autocomplete="off" />
      <div id="qul-results"></div>
    </div>
  `;

  // Add styles
  const style = document.createElement('style');
  style.id = 'qul-styles';
  style.textContent = `
    #qul-modal-overlay {
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.5);
      display: flex;
      justify-content: center;
      align-items: flex-start;
      padding-top: 15vh;
      z-index: 2147483647;
      font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, monospace;
    }
    #qul-modal {
      background: #1e1e1e;
      border: 1px solid #3c3c3c;
      border-radius: 8px;
      width: 600px;
      max-width: 90vw;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
      overflow: hidden;
    }
    #qul-input {
      width: 100%;
      padding: 16px;
      font-size: 16px;
      background: #252526;
      border: none;
      border-bottom: 1px solid #3c3c3c;
      color: #cccccc;
      outline: none;
      box-sizing: border-box;
      font-family: inherit;
    }
    #qul-input::placeholder {
      color: #6e6e6e;
    }
    #qul-results {
      max-height: 400px;
      overflow-y: auto;
    }
    .qul-result {
      padding: 10px 16px;
      cursor: pointer;
      overflow: hidden;
    }
    .qul-result:hover {
      background: #2a2d2e;
    }
    .qul-result.selected {
      background: #094771;
    }
    .qul-title {
      color: #ffffff;
      font-size: 14px;
      font-weight: 500;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .qul-url {
      color: #6e6e6e;
      font-size: 12px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      margin-top: 2px;
    }
    .qul-hint {
      padding: 10px 16px;
      color: #6e6e6e;
      font-size: 13px;
    }
    .qul-badges {
      display: inline-flex;
      gap: 4px;
      margin-left: 8px;
    }
    .qul-badge {
      font-size: 9px;
      padding: 1px 4px;
      border-radius: 3px;
      text-transform: uppercase;
      font-weight: 600;
    }
    .qul-badge-top {
      background: #2d5a27;
      color: #7ec77b;
    }
    .qul-badge-saved {
      background: #4a3d1a;
      color: #d4a84b;
    }
  `;

  document.head.appendChild(style);
  document.body.appendChild(modal);

  const input = document.getElementById('qul-input');

  // Event listeners
  input.addEventListener('input', handleInput);
  input.addEventListener('keydown', handleKeydown);

  // Global keydown for Escape (works even before input has focus)
  const handleGlobalKeydown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeModal();
    }
  };
  document.addEventListener('keydown', handleGlobalKeydown, true);

  // Prevent Alt keyup from triggering browser navigation
  const preventAltNavigation = (e) => {
    if (e.key === 'Alt') {
      e.preventDefault();
      e.stopPropagation();
    }
  };
  document.addEventListener('keyup', preventAltNavigation, true);

  // Store for cleanup
  modal._cleanupEsc = () => document.removeEventListener('keydown', handleGlobalKeydown, true);
  modal._cleanupAlt = () => document.removeEventListener('keyup', preventAltNavigation, true);

  // Delay focus to let Alt key release and prevent browser menu activation
  setTimeout(() => {
    input.focus();
  }, 50);
  modal.addEventListener('click', handleOverlayClick);

  renderResults();
}

function closeModal() {
  if (modal) {
    if (modal._cleanupEsc) modal._cleanupEsc();
    if (modal._cleanupAlt) modal._cleanupAlt();
    modal.remove();
    const style = document.getElementById('qul-styles');
    if (style) style.remove();
    modal = null;
    mode = null;
    consumeUrl = null;
    urlToSave=null;
    titleToSave=null;
  }
}

function handleInput(e) {
  const query = e.target.value;
  filteredUrls = filterUrls(query);
  selectedIndex = 0;
  renderResults(query);
}

function handleKeydown(e) {
  if (e.key === 'Escape') {
    closeModal();
    return;
  }

  if (e.key === 'ArrowDown' || (e.altKey && e.key === 'j')) {
    e.preventDefault();
    const query = document.getElementById('qul-input').value;
    const maxIndex = Math.min(filteredUrls.length - 1, 9); // Limit to 10 items
    if (mode === 'omnisearch' && query && selectedIndex === -1) {
      selectedIndex = 0; // Move from action to first URL
    } else {
      selectedIndex = Math.min(selectedIndex + 1, maxIndex);
    }
    renderResults(query);
    scrollToSelected();
    return;
  }

  if (e.key === 'ArrowUp' || (e.altKey && e.key === 'k')) {
    e.preventDefault();
    const query = document.getElementById('qul-input').value;
    if (mode === 'omnisearch' && query && selectedIndex === 0) {
      selectedIndex = -1; // Move back to action
    } else {
      selectedIndex = Math.max(selectedIndex - 1, 0);
    }
    renderResults(query);
    scrollToSelected();
    return;
  }

  if (e.key === 'Enter') {
    e.preventDefault();
    const input = document.getElementById('qul-input').value.trim();

    if (mode === 'omnisearch') {
      const urlToRemove = consumeUrl;
      const urlToAdd=urlToSave;
      const titleToAdd=titleToSave;


      // If a URL from the list is selected, navigate to it
      if (selectedIndex >= 0 && filteredUrls[selectedIndex]) {
        const url = filteredUrls[selectedIndex].url;
        closeModal();
        if (urlToRemove) {
          chrome.runtime.sendMessage({ action: 'removeAndNavigate', url, removeUrl: urlToRemove });
        } else {
          chrome.runtime.sendMessage({ action: 'saveAndNavigate', url, saveUrl: urlToAdd, saveTitle:titleToAdd });
        }
        return;
      }

      // Otherwise use the input as URL or search
      if (!input) return;
      let url;
      if (looksLikeUrl(input)) {
        url = normalizeUrl(input);
      } else {
        url = googleSearchUrl(input);
      }
      closeModal();
      if (urlToRemove) {
        chrome.runtime.sendMessage({ action: 'removeAndNavigate', url, removeUrl: urlToRemove });
      } else {
        chrome.runtime.sendMessage({ action: 'saveAndNavigate', url,saveUrl: urlToAdd, saveTitle:titleToAdd  });
      }
    } else if (mode === 'finder') {
      if (filteredUrls.length > 0 && filteredUrls[selectedIndex]) {
        const url = filteredUrls[selectedIndex].url;
        closeModal();
        chrome.runtime.sendMessage({ action: 'navigate', url });
      }
    }
  }
}

function handleOverlayClick(e) {
  if (e.target.id === 'qul-modal-overlay') {
    closeModal();
  }
}

function scrollToSelected() {
  const results = document.getElementById('qul-results');
  const selected = results.querySelector('.selected');
  if (selected) {
    selected.scrollIntoView({ block: 'nearest' });
  }
}

function renderResults(query = '') {
  const results = document.getElementById('qul-results');
  if (!results) return;

  if (mode === 'omnisearch') {
    let html = '';

    // Only show suggestions after user starts typing
    if (!query) {
      html = '<div class="qul-hint">Type a URL or search term, then press Enter</div>';
    } else {
      // Show action hint at top
      if (looksLikeUrl(query)) {
        html += `<div class="qul-result${selectedIndex === -1 ? ' selected' : ''}" data-action="url">
          <div class="qul-title">Go to: ${escapeHtml(normalizeUrl(query))}</div>
        </div>`;
      } else {
        html += `<div class="qul-result${selectedIndex === -1 ? ' selected' : ''}" data-action="search">
          <div class="qul-title">Search Google: ${escapeHtml(query)}</div>
        </div>`;
      }

      // Show filtered URLs from history/top sites
      if (filteredUrls.length > 0) {
        html += filteredUrls.slice(0, 10).map((item, i) => {
          let badges = '';
          if (item.isTopSite) badges += '<span class="qul-badge qul-badge-top">top</span>';
          if (item.isSaved) badges += '<span class="qul-badge qul-badge-saved">saved</span>';
          return `<div class="qul-result${i === selectedIndex ? ' selected' : ''}" data-index="${i}">
          <div class="qul-title">${escapeHtml(item.title)}${badges ? '<span class="qul-badges">' + badges + '</span>' : ''}</div>
          <div class="qul-url">${escapeHtml(item.url)}</div>
        </div>`;
        }).join('');
      }
    }

    results.innerHTML = html;

    // Add click handlers
    results.querySelectorAll('.qul-result[data-index]').forEach(el => {
      el.addEventListener('click', () => {
        const idx = parseInt(el.dataset.index);
        const url = filteredUrls[idx].url;
        const urlToRemove = consumeUrl;
        const urlToAdd=urlToSave;
        const titleToAdd=titleToSave;

        closeModal();
        if (urlToRemove) {
          chrome.runtime.sendMessage({ action: 'removeAndNavigate', url, removeUrl: urlToRemove });
        } else {
          chrome.runtime.sendMessage({ action: 'navigate', url });
        }
      });
    });

    results.querySelectorAll('.qul-result[data-action]').forEach(el => {
      el.addEventListener('click', () => {
        const input = document.getElementById('qul-input').value.trim();
        let url;
        if (el.dataset.action === 'url') {
          url = normalizeUrl(input);
        } else {
          url = googleSearchUrl(input);
        }
        const urlToRemove = consumeUrl;
        const urlToAdd=urlToSave;
        const titleToAdd=titleToSave;
        closeModal();
        if (urlToRemove) {
          chrome.runtime.sendMessage({ action: 'removeAndNavigate', url, removeUrl: urlToRemove });
        } else {
          chrome.runtime.sendMessage({ action: 'saveAndNavigate', url ,saveUrl: urlToAdd, saveTitle:titleToAdd });
        }
      });
    });
  } else if (mode === 'finder') {
    if (filteredUrls.length === 0) {
      results.innerHTML = '<div class="qul-hint">No matching URLs</div>';
    } else {
      results.innerHTML = filteredUrls
        .map((item, i) => {
          let badges = '';
          if (item.isTopSite) badges += '<span class="qul-badge qul-badge-top">top</span>';
          if (item.isSaved) badges += '<span class="qul-badge qul-badge-saved">saved</span>';
          return `<div class="qul-result${i === selectedIndex ? ' selected' : ''}" data-index="${i}">
          <div class="qul-title">${escapeHtml(item.title)}${badges ? '<span class="qul-badges">' + badges + '</span>' : ''}</div>
          <div class="qul-url">${escapeHtml(item.url)}</div>
        </div>`;
        })
        .join('');

      // Add click handlers
      results.querySelectorAll('.qul-result').forEach(el => {
        el.addEventListener('click', () => {
          const idx = parseInt(el.dataset.index);
          const url = filteredUrls[idx].url;
          closeModal();
          chrome.runtime.sendMessage({ action: 'navigate', url });
        });
      });
    }
  }
}

// Listen for messages from background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'openOmnisearch') {
    showModal('omnisearch', message.urls || [],null, message.currentUrl,message.currentTitle);
  } else if (message.action === 'openOmnisearchConsume') {
    showModal('omnisearch', message.urls || [], message.currentUrl);
  } else if (message.action === 'openFinder') {
    showModal('finder', message.urls || []);
  }
});
