const SERVER_URL = 'http://127.0.0.1:3847';
const ALARM_NAME = 'fileAssistantSync';
const AUTO_SCAN_ALARM = 'fileAssistantAutoScan';

let pendingFiles = [];
let processedFileIds = new Set();

chrome.runtime.onInstalled.addListener(async () => {
  console.log('Teams & Slack File Assistant installed');
  await initializeAlarms();
  // Auto-open tabs on install
  setTimeout(() => autoOpenTabs(), 3000);
});

chrome.runtime.onStartup.addListener(async () => {
  console.log('Teams & Slack File Assistant starting');
  await initializeAlarms();
  // Auto-open tabs on browser startup
  setTimeout(() => autoOpenTabs(), 5000);
});

async function autoOpenTabs() {
  try {
    const config = await fetchConfig();
    if (!config?.tabs?.autoOpen) {
      console.log('Auto-open tabs disabled');
      return;
    }

    const existingTabs = await chrome.tabs.query({
      url: [
        'https://teams.microsoft.com/*',
        'https://*.teams.microsoft.com/*',
        'https://app.slack.com/*',
        'https://*.slack.com/*'
      ]
    });

    // Check if Teams tab exists
    const hasTeams = existingTabs.some(t => t.url?.includes('teams.microsoft.com'));
    const hasSlack = existingTabs.some(t => t.url?.includes('slack.com'));

    // Open Teams if enabled and not already open
    if (config.sync?.teamsEnabled && !hasTeams && config.tabs?.teamsUrl) {
      console.log('Opening Teams tab:', config.tabs.teamsUrl);
      await chrome.tabs.create({ url: config.tabs.teamsUrl, active: false });
    }

    // Open Slack if enabled and not already open
    if (config.sync?.slackEnabled && !hasSlack && config.tabs?.slackUrl) {
      console.log('Opening Slack tab:', config.tabs.slackUrl);
      await chrome.tabs.create({ url: config.tabs.slackUrl, active: false });
    }

  } catch (error) {
    console.error('Failed to auto-open tabs:', error);
  }
}

async function initializeAlarms() {
  try {
    const config = await fetchConfig();
    const intervalMinutes = config?.sync?.intervalMinutes || 15;
    
    if (intervalMinutes > 0) {
      // File sync alarm
      chrome.alarms.create(ALARM_NAME, {
        delayInMinutes: 1,
        periodInMinutes: intervalMinutes
      });
      
      // Auto-scan alarm (more frequent for message collection)
      chrome.alarms.create(AUTO_SCAN_ALARM, {
        delayInMinutes: 2,
        periodInMinutes: Math.max(5, Math.floor(intervalMinutes / 2))
      });
      
      console.log(`Alarms set: sync every ${intervalMinutes}min, auto-scan every ${Math.max(5, Math.floor(intervalMinutes / 2))}min`);
    }
  } catch (error) {
    console.error('Failed to initialize alarms:', error);
  }
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_NAME) {
    console.log('Sync alarm triggered');
    await performSync();
  } else if (alarm.name === AUTO_SCAN_ALARM) {
    console.log('Auto-scan alarm triggered');
    await performAutoScan();
  }
});

// Handle messages from content scripts and popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'FILES_FOUND') {
    handleFilesFound(message.files, message.source);
    sendResponse({ success: true });
  } else if (message.type === 'MESSAGES_COLLECTED') {
    handleMessagesCollected(message.messages, message.source, message.channelName);
    sendResponse({ success: true });
  } else if (message.type === 'CONFIG_UPDATED') {
    handleConfigUpdate(message.config);
    sendResponse({ success: true });
  } else if (message.type === 'MANUAL_SYNC') {
    performSync().then(result => sendResponse(result));
    return true;
  } else if (message.type === 'GET_SYNC_STATUS') {
    getSyncStatus().then(status => sendResponse(status));
    return true;
  } else if (message.type === 'GET_PENDING_FILES') {
    sendResponse({ files: pendingFiles });
  } else if (message.type === 'SCAN_ACTIVE_TABS') {
    scanActiveTabs().then(result => sendResponse(result));
    return true;
  } else if (message.type === 'AUTO_SCAN_ALL') {
    performAutoScan(false).then(result => sendResponse(result));
    return true;
  } else if (message.type === 'FULL_SCAN_ALL') {
    performAutoScan(true).then(result => sendResponse(result));
    return true;
  } else if (message.type === 'SCAN_ALL_UNREAD') {
    scanAllUnread().then(result => sendResponse(result));
    return true;
  } else if (message.type === 'TRIGGER_CATCHUP') {
    triggerCatchUp(message.sendToDiscord).then(result => sendResponse(result));
    return true;
  } else if (message.type === 'OPEN_TABS') {
    openSourceTabs(message.sources).then(result => sendResponse(result));
    return true;
  } else if (message.type === 'GET_TAB_CONFIG') {
    fetchConfig().then(config => sendResponse(config?.tabs || {}));
    return true;
  }
  return true;
});

async function openSourceTabs(sources = ['teams', 'slack']) {
  try {
    const config = await fetchConfig();
    const results = { teams: false, slack: false };

    const existingTabs = await chrome.tabs.query({
      url: [
        'https://teams.microsoft.com/*',
        'https://*.teams.microsoft.com/*',
        'https://app.slack.com/*',
        'https://*.slack.com/*'
      ]
    });

    const hasTeams = existingTabs.some(t => t.url?.includes('teams.microsoft.com'));
    const hasSlack = existingTabs.some(t => t.url?.includes('slack.com'));

    if (sources.includes('teams') && !hasTeams) {
      const url = config?.tabs?.teamsUrl || 'https://teams.microsoft.com';
      await chrome.tabs.create({ url, active: false });
      results.teams = true;
    }

    if (sources.includes('slack') && !hasSlack) {
      const url = config?.tabs?.slackUrl || 'https://app.slack.com';
      await chrome.tabs.create({ url, active: false });
      results.slack = true;
    }

    return { success: true, opened: results };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

function handleFilesFound(files, source) {
  const newFiles = files.filter(f => !processedFileIds.has(f.id));
  
  if (newFiles.length > 0) {
    pendingFiles.push(...newFiles);
    newFiles.forEach(f => processedFileIds.add(f.id));
    
    chrome.action.setBadgeText({ text: pendingFiles.length.toString() });
    chrome.action.setBadgeBackgroundColor({ color: '#3b82f6' });
    
    console.log(`Found ${newFiles.length} new files from ${source}`);
  }
}

async function handleMessagesCollected(messages, source, channelName) {
  if (!messages || messages.length === 0) return;
  
  try {
    // Send messages to server for storage in knowledge base
    await fetch(`${SERVER_URL}/api/knowledge/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, source, channelName })
    });
    console.log(`Stored ${messages.length} messages from ${source}/${channelName}`);
  } catch (error) {
    console.error('Failed to store messages:', error);
  }
}

async function handleConfigUpdate(config) {
  if (config.sync) {
    const intervalMinutes = config.sync.intervalMinutes || 15;
    
    await chrome.alarms.clear(ALARM_NAME);
    await chrome.alarms.clear(AUTO_SCAN_ALARM);
    
    if (intervalMinutes > 0) {
      chrome.alarms.create(ALARM_NAME, {
        delayInMinutes: intervalMinutes,
        periodInMinutes: intervalMinutes
      });
      chrome.alarms.create(AUTO_SCAN_ALARM, {
        delayInMinutes: Math.max(5, Math.floor(intervalMinutes / 2)),
        periodInMinutes: Math.max(5, Math.floor(intervalMinutes / 2))
      });
    }
  }
}

async function fetchConfig() {
  try {
    const response = await fetch(`${SERVER_URL}/api/config`);
    if (response.ok) {
      return await response.json();
    }
  } catch (error) {
    console.log('Server not available');
  }
  return null;
}

async function performAutoScan(fullScan = false) {
  console.log(`Starting ${fullScan ? 'full' : 'auto'}-scan of all tabs...`);
  
  const tabs = await chrome.tabs.query({
    url: [
      'https://teams.microsoft.com/*',
      'https://*.teams.microsoft.com/*',
      'https://app.slack.com/*',
      'https://*.slack.com/*'
    ]
  });

  const results = { tabsScanned: 0, totalMessages: 0, totalChats: 0 };

  for (const tab of tabs) {
    try {
      if (fullScan) {
        // Full scan: go through all chats/channels
        const response = await chrome.tabs.sendMessage(tab.id, { 
          type: 'FULL_SCAN',
          options: { maxChats: 30, scrollDepth: 5 }
        });
        if (response?.success) {
          results.totalMessages += response.totalMessages || 0;
          results.totalChats += response.chatsScanned || response.channelsScanned || 0;
        }
      } else {
        // Quick scan: just scroll current view
        await chrome.tabs.sendMessage(tab.id, { type: 'AUTO_SCROLL', maxScrolls: 5 });
      }
      
      results.tabsScanned++;
      console.log(`Scanned tab: ${tab.title}`);
      
      // Wait between tabs
      await new Promise(resolve => setTimeout(resolve, fullScan ? 5000 : 3000));
    } catch (e) {
      console.log(`Could not scan tab ${tab.id}:`, e.message);
    }
  }

  // Trigger scheduled summary if configured
  const config = await fetchConfig();
  if (config?.discord?.autoSummary && config?.discord?.webhookUrl) {
    await triggerCatchUp(true);
  }

  return { success: true, ...results };
}

async function scanAllUnread() {
  console.log('Starting scan of all unread messages...');
  
  const tabs = await chrome.tabs.query({
    url: [
      'https://teams.microsoft.com/*',
      'https://*.teams.microsoft.com/*',
      'https://app.slack.com/*',
      'https://*.slack.com/*'
    ]
  });

  const results = { tabsScanned: 0, totalMessages: 0, totalChats: 0 };

  for (const tab of tabs) {
    try {
      const response = await chrome.tabs.sendMessage(tab.id, { 
        type: 'SCAN_UNREAD',
        maxChats: 50
      });
      
      if (response?.success) {
        results.totalMessages += response.totalMessages || 0;
        results.totalChats += response.chatsScanned || response.channelsScanned || 0;
      }
      
      results.tabsScanned++;
      console.log(`Scanned unread in tab: ${tab.title}`);
      
    } catch (e) {
      console.log(`Could not scan tab ${tab.id}:`, e.message);
    }
  }

  return { success: true, ...results };
}

async function scanActiveTabs() {
  const files = [];
  
  try {
    const tabs = await chrome.tabs.query({
      url: [
        'https://teams.microsoft.com/*',
        'https://*.teams.microsoft.com/*',
        'https://app.slack.com/*',
        'https://*.slack.com/*'
      ]
    });

    for (const tab of tabs) {
      try {
        const response = await chrome.tabs.sendMessage(tab.id, { type: 'SCAN_PAGE' });
        if (response?.files) {
          files.push(...response.files);
        }
      } catch (e) {
        console.log(`Could not scan tab ${tab.id}:`, e.message);
      }
    }
  } catch (error) {
    console.error('Error scanning tabs:', error);
  }

  if (files.length > 0) {
    handleFilesFound(files, 'manual-scan');
  }

  return { success: true, filesFound: files.length };
}

async function triggerCatchUp(sendToDiscord = true) {
  try {
    const response = await fetch(`${SERVER_URL}/api/knowledge/catchup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sendToDiscord, hoursBack: 24 })
    });
    
    const result = await response.json();
    return result;
  } catch (error) {
    console.error('Catch-up failed:', error);
    return { success: false, error: error.message };
  }
}

async function performSync() {
  console.log('Starting sync...');
  
  try {
    const healthCheck = await fetch(`${SERVER_URL}/health`);
    if (!healthCheck.ok) {
      throw new Error('Server not available');
    }
  } catch (error) {
    console.log('Server offline, skipping sync');
    return { success: false, error: 'Server offline' };
  }

  // First auto-scan tabs
  await performAutoScan();

  // Process pending files
  const filesToProcess = [...pendingFiles];
  
  if (filesToProcess.length === 0) {
    console.log('No files to process');
    return { success: true, filesProcessed: 0, filesDownloaded: 0 };
  }

  try {
    const response = await fetch(`${SERVER_URL}/api/files/process`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files: filesToProcess, source: 'auto-sync' })
    });

    const result = await response.json();
    const downloaded = result.results?.filter(r => r.success && !r.skipped).length || 0;
    
    pendingFiles = pendingFiles.filter(f => 
      !filesToProcess.some(p => p.id === f.id)
    );
    
    if (pendingFiles.length === 0) {
      chrome.action.setBadgeText({ text: '' });
    } else {
      chrome.action.setBadgeText({ text: pendingFiles.length.toString() });
    }

    if (downloaded > 0) {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: 'File Assistant',
        message: `Downloaded ${downloaded} new file${downloaded > 1 ? 's' : ''}`
      });

      // Notify Discord
      await fetch(`${SERVER_URL}/api/discord/notify-files`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: filesToProcess.slice(0, downloaded) })
      });
    }

    await fetch(`${SERVER_URL}/api/sync/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filesProcessed: filesToProcess.length,
        filesDownloaded: downloaded,
        errors: []
      })
    });

    return { success: true, filesProcessed: filesToProcess.length, filesDownloaded: downloaded };
  } catch (error) {
    console.error('Sync failed:', error);
    return { success: false, error: error.message };
  }
}

async function getSyncStatus() {
  try {
    const response = await fetch(`${SERVER_URL}/api/sync/status`);
    if (response.ok) {
      const status = await response.json();
      return {
        ...status,
        pendingFiles: pendingFiles.length
      };
    }
  } catch (error) {
    console.log('Could not get sync status');
  }
  return { isRunning: false, lastSyncTime: null, pendingFiles: pendingFiles.length };
}

console.log('Background service worker loaded (with auto-scan)');
