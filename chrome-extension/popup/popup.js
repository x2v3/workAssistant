const SERVER_URL = 'http://127.0.0.1:3847';

document.addEventListener('DOMContentLoaded', async () => {
  await checkServerStatus();
  await loadStats();
  await loadActiveSources();
  await loadSyncStatus();

  // Bind events
  document.getElementById('scanUnreadBtn').addEventListener('click', scanAllUnread);
  document.getElementById('autoScanBtn').addEventListener('click', autoScanTabs);
  document.getElementById('fullScanBtn').addEventListener('click', fullScanTabs);
  document.getElementById('catchupBtn').addEventListener('click', generateCatchup);
  document.getElementById('processFilesBtn').addEventListener('click', processFiles);
  document.getElementById('openDashboard').addEventListener('click', openDashboard);
  document.getElementById('openSettings').addEventListener('click', openSettings);
  document.getElementById('openTabsBtn').addEventListener('click', openSourceTabs);
});

async function checkServerStatus() {
  const badge = document.getElementById('serverStatus');
  
  try {
    const response = await fetch(`${SERVER_URL}/health`, { timeout: 3000 });
    if (response.ok) {
      badge.textContent = 'Connected';
      badge.className = 'status-badge connected';
    } else {
      throw new Error('Server error');
    }
  } catch (e) {
    badge.textContent = 'Server Offline';
    badge.className = 'status-badge error';
  }
}

async function loadStats() {
  try {
    // Load knowledge base stats
    const kbRes = await fetch(`${SERVER_URL}/api/knowledge/stats`);
    const kbStats = await kbRes.json();
    document.getElementById('messagesCount').textContent = kbStats.totalMessages || 0;
  } catch (e) {
    console.log('Could not load KB stats');
  }

  // Load pending files from background
  chrome.runtime.sendMessage({ type: 'GET_PENDING_FILES' }, (response) => {
    const count = response?.files?.length || 0;
    document.getElementById('filesCount').textContent = count;
    document.getElementById('pendingFilesCount').textContent = count;
  });
}

async function loadActiveSources() {
  const container = document.getElementById('activeSourcesList');
  
  try {
    const tabs = await chrome.tabs.query({
      url: [
        'https://teams.microsoft.com/*',
        'https://*.teams.microsoft.com/*',
        'https://app.slack.com/*',
        'https://*.slack.com/*'
      ]
    });

    document.getElementById('sourcesCount').textContent = tabs.length;

    if (tabs.length === 0) {
      container.innerHTML = '<div class="empty-state">No Teams or Slack tabs open.<br>Open them and log in to start scanning.</div>';
      return;
    }

    container.innerHTML = tabs.map(tab => {
      const isTeams = tab.url.includes('teams.microsoft.com');
      const icon = isTeams ? '💼' : '💬';
      const source = isTeams ? 'Teams' : 'Slack';
      const title = tab.title?.substring(0, 40) || 'Unknown';

      return `
        <div class="source-item">
          <span class="source-icon">${icon}</span>
          <div class="source-info">
            <div class="source-name">${title}</div>
            <div class="source-meta">${source}</div>
          </div>
          <div class="source-status"></div>
        </div>
      `;
    }).join('');

  } catch (e) {
    container.innerHTML = '<div class="empty-state">Could not scan tabs</div>';
  }
}

async function loadSyncStatus() {
  chrome.runtime.sendMessage({ type: 'GET_SYNC_STATUS' }, (response) => {
    if (response?.lastSyncTime) {
      const date = new Date(response.lastSyncTime);
      document.getElementById('lastSyncTime').textContent = date.toLocaleTimeString();
    }
  });
}

async function scanAllUnread() {
  const btn = document.getElementById('scanUnreadBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Scanning unread...';

  try {
    const response = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'SCAN_ALL_UNREAD' }, resolve);
    });

    const chats = response?.totalChats || 0;
    const msgs = response?.totalMessages || 0;
    btn.innerHTML = `✓ ${chats} chats, ${msgs} msgs`;
    
    setTimeout(() => {
      btn.innerHTML = '📬 Scan All Unread';
      btn.disabled = false;
    }, 3000);

    await loadStats();

  } catch (e) {
    btn.innerHTML = '✗ Failed';
    setTimeout(() => {
      btn.innerHTML = '📬 Scan All Unread';
      btn.disabled = false;
    }, 2000);
  }
}

async function autoScanTabs() {
  const btn = document.getElementById('autoScanBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>';

  try {
    await new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'AUTO_SCAN_ALL' }, resolve);
    });

    btn.innerHTML = '✓ Done';
    setTimeout(() => {
      btn.innerHTML = '🔄 Quick Scan';
      btn.disabled = false;
    }, 2000);

    await loadStats();

  } catch (e) {
    btn.innerHTML = '✗';
    setTimeout(() => {
      btn.innerHTML = '🔄 Quick Scan';
      btn.disabled = false;
    }, 2000);
  }
}

async function fullScanTabs() {
  const btn = document.getElementById('fullScanBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>';

  try {
    const response = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'FULL_SCAN_ALL' }, resolve);
    });

    const chats = response?.totalChats || 0;
    btn.innerHTML = `✓ ${chats}`;
    
    setTimeout(() => {
      btn.innerHTML = '📋 Full Scan';
      btn.disabled = false;
    }, 2000);

    await loadStats();

  } catch (e) {
    btn.innerHTML = '✗';
    setTimeout(() => {
      btn.innerHTML = '📋 Full Scan';
      btn.disabled = false;
    }, 2000);
  }
}

async function generateCatchup() {
  const btn = document.getElementById('catchupBtn');
  const resultBox = document.getElementById('summaryResult');
  const sendToDiscord = document.getElementById('sendToDiscord').checked;

  btn.disabled = true;
  btn.textContent = 'Generating...';
  resultBox.style.display = 'none';

  try {
    const response = await fetch(`${SERVER_URL}/api/knowledge/catchup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sendToDiscord, hoursBack: 24 })
    });

    const data = await response.json();

    resultBox.className = 'result-box';
    resultBox.style.display = 'block';

    if (data.summary) {
      let text = data.summary.substring(0, 500);
      if (data.sentToDiscord) {
        text += '\n\n✓ Sent to Discord';
      }
      resultBox.textContent = text;
    } else {
      resultBox.textContent = 'No messages found to summarize.';
    }

  } catch (e) {
    resultBox.className = 'result-box error';
    resultBox.style.display = 'block';
    resultBox.textContent = 'Error: ' + e.message;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Generate Summary';
  }
}

async function processFiles() {
  const btn = document.getElementById('processFilesBtn');
  btn.disabled = true;
  btn.textContent = 'Processing...';

  try {
    const response = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'MANUAL_SYNC' }, resolve);
    });

    if (response.success) {
      btn.textContent = `✓ ${response.filesDownloaded || 0} files downloaded`;
    } else {
      btn.textContent = '✗ ' + (response.error || 'Failed');
    }

    setTimeout(() => {
      btn.textContent = '📥 Process Files Now';
      btn.disabled = false;
    }, 2000);

    await loadStats();

  } catch (e) {
    btn.textContent = '✗ Error';
    btn.disabled = false;
  }
}

async function openSourceTabs() {
  const btn = document.getElementById('openTabsBtn');
  btn.disabled = true;
  btn.textContent = 'Opening...';

  try {
    const response = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'OPEN_TABS', sources: ['teams', 'slack'] }, resolve);
    });

    if (response.success) {
      const opened = [];
      if (response.opened.teams) opened.push('Teams');
      if (response.opened.slack) opened.push('Slack');
      
      btn.textContent = opened.length > 0 ? `✓ Opened ${opened.join(' & ')}` : '✓ Already open';
    } else {
      btn.textContent = '✗ Failed';
    }

    setTimeout(() => {
      btn.textContent = '🌐 Open Teams & Slack Tabs';
      btn.disabled = false;
      loadActiveSources();
    }, 2000);

  } catch (e) {
    btn.textContent = '✗ Error';
    btn.disabled = false;
  }
}

function openDashboard(e) {
  e.preventDefault();
  chrome.tabs.create({ url: SERVER_URL });
}

function openSettings(e) {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
}
