// Content script for Slack Web (app.slack.com)

(function() {
  'use strict';

  const SCAN_INTERVAL = 5000;
  let lastScanTime = 0;
  let scannedFileIds = new Set();
  let scannedMessageIds = new Set();
  let isAutoScrolling = false;
  let isFullScanning = false;

  function extractFilesFromPage() {
    const files = [];

    const fileSelectors = [
      '.c-file__container',
      '.c-file_container',
      '[data-qa="file_container"]',
      '.c-message_attachment__file',
      '.p-file_preview_card',
      '.c-file__title',
      'a[data-qa="file_title_link"]',
      '.c-message_kit__file',
      '[data-qa-file-id]'
    ];

    fileSelectors.forEach(selector => {
      document.querySelectorAll(selector).forEach(element => {
        try {
          const fileInfo = extractFileInfo(element);
          if (fileInfo && !scannedFileIds.has(fileInfo.id)) {
            files.push(fileInfo);
          }
        } catch (e) {
          console.debug('Error extracting file info:', e);
        }
      });
    });

    return files;
  }

  function extractMessagesFromPage() {
    const messages = [];
    
    const messageSelectors = [
      '.c-message_kit__message',
      '.c-message',
      '[data-qa="message_container"]',
      '.c-virtual_list__item'
    ];

    messageSelectors.forEach(selector => {
      document.querySelectorAll(selector).forEach(element => {
        try {
          const messageInfo = extractMessageInfo(element);
          if (messageInfo && !scannedMessageIds.has(messageInfo.id)) {
            messages.push(messageInfo);
            scannedMessageIds.add(messageInfo.id);
          }
        } catch (e) {
          console.debug('Error extracting message:', e);
        }
      });
    });

    return messages;
  }

  function extractMessageInfo(element) {
    const textElement = element.querySelector('.c-message__body') ||
                        element.querySelector('.c-message_kit__text') ||
                        element.querySelector('[data-qa="message-text"]') ||
                        element.querySelector('.p-rich_text_section');
    
    const text = textElement?.textContent?.trim();
    if (!text || text.length < 3) return null;

    const sender = getSenderFromMessage(element);
    const timestamp = getTimestampFromMessage(element);
    const id = generateId(sender + timestamp + text.substring(0, 50));

    return {
      id,
      text: text.substring(0, 5000),
      sender,
      timestamp,
      channelName: getCurrentChannelName(),
      source: 'slack',
      hasAttachment: element.querySelector('.c-file__container') !== null
    };
  }

  function extractFileInfo(element) {
    const fileId = element.getAttribute('data-qa-file-id') ||
                   element.closest('[data-qa-file-id]')?.getAttribute('data-qa-file-id');

    const nameElement = element.querySelector('.c-file__title') ||
                        element.querySelector('[data-qa="file_title_link"]') ||
                        element.querySelector('.c-file__name') ||
                        element;
    
    const fileName = nameElement?.textContent?.trim() || 'Unknown file';

    const linkElement = element.querySelector('a[href*="files.slack.com"]') ||
                        element.querySelector('a[download]') ||
                        element.closest('a');
    
    let downloadUrl = linkElement?.href || '';
    
    if (!downloadUrl && fileId) {
      downloadUrl = `https://files.slack.com/files-pri/${fileId}`;
    }

    if (!downloadUrl && !fileId) return null;

    return {
      id: fileId || generateId(downloadUrl + fileName),
      name: fileName,
      downloadUrl: downloadUrl,
      source: 'slack',
      messageContent: getParentMessageContent(element),
      sender: getSenderFromMessage(element),
      timestamp: getTimestampFromMessage(element),
      channelName: getCurrentChannelName()
    };
  }

  function generateId(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return `slack_${Math.abs(hash)}`;
  }

  function getParentMessageContent(element) {
    const messageContainer = element.closest('.c-message') ||
                             element.closest('.c-message_kit__message') ||
                             element.closest('[data-qa="message_container"]');
    
    if (messageContainer) {
      const textElement = messageContainer.querySelector('.c-message__body') ||
                          messageContainer.querySelector('.c-message_kit__text');
      return textElement?.textContent?.trim().substring(0, 500) || '';
    }
    return '';
  }

  function getSenderFromMessage(element) {
    const messageContainer = element.closest('.c-message') ||
                             element.closest('.c-message_kit__message') ||
                             element.closest('[data-qa="message_container"]') ||
                             element;
    
    const senderElement = messageContainer.querySelector('.c-message__sender_link') ||
                          messageContainer.querySelector('[data-qa="message_sender_name"]') ||
                          messageContainer.querySelector('.c-message_kit__sender') ||
                          messageContainer.querySelector('.c-message__sender');
    return senderElement?.textContent?.trim() || 'Unknown';
  }

  function getTimestampFromMessage(element) {
    const messageContainer = element.closest('.c-message') ||
                             element.closest('.c-message_kit__message') ||
                             element.closest('[data-qa="message_container"]') ||
                             element;
    
    const timeElement = messageContainer.querySelector('.c-timestamp') ||
                        messageContainer.querySelector('[data-qa="message_timestamp"]') ||
                        messageContainer.querySelector('time') ||
                        messageContainer.querySelector('.c-message__timestamp');
    
    const timeStr = timeElement?.getAttribute('datetime') ||
                    timeElement?.getAttribute('data-ts') ||
                    timeElement?.title ||
                    timeElement?.textContent;
    
    if (timeStr) {
      try {
        if (/^\d+(\.\d+)?$/.test(timeStr)) {
          return new Date(parseFloat(timeStr) * 1000).toISOString();
        }
        return new Date(timeStr).toISOString();
      } catch {
        return new Date().toISOString();
      }
    }
    return new Date().toISOString();
  }

  function getCurrentChannelName() {
    const channelHeader = document.querySelector('[data-qa="channel_header_title"]') ||
                          document.querySelector('.p-channel_sidebar__channel--selected') ||
                          document.querySelector('.c-channel_header__title') ||
                          document.querySelector('[data-qa="channel-header-channel-name-text"]');
    return channelHeader?.textContent?.trim() || 'Unknown Channel';
  }

  // Auto-scroll functionality
  async function autoScrollToLoadMessages(maxScrolls = 10) {
    if (isAutoScrolling) return { success: false, reason: 'Already scrolling' };
    
    isAutoScrolling = true;
    const messagesBeforeScroll = scannedMessageIds.size;
    
    const scrollContainer = document.querySelector('.c-virtual_list__scroll_container') ||
                            document.querySelector('[data-qa="message_list"]') ||
                            document.querySelector('.c-scrollbar__hider') ||
                            document.querySelector('.p-workspace__primary_view');
    
    if (!scrollContainer) {
      isAutoScrolling = false;
      return { success: false, reason: 'No scroll container found' };
    }

    let scrollCount = 0;
    let lastMessageCount = 0;
    let noNewMessagesCount = 0;

    while (scrollCount < maxScrolls && noNewMessagesCount < 3) {
      scrollContainer.scrollTop = 0;
      await sleep(1500);
      
      const messages = extractMessagesFromPage();
      
      if (scannedMessageIds.size === lastMessageCount) {
        noNewMessagesCount++;
      } else {
        noNewMessagesCount = 0;
      }
      
      lastMessageCount = scannedMessageIds.size;
      scrollCount++;
      
      if (messages.length > 0) {
        chrome.runtime.sendMessage({
          type: 'MESSAGES_COLLECTED',
          source: 'slack',
          messages: messages,
          channelName: getCurrentChannelName()
        });
      }
    }

    scrollContainer.scrollTop = scrollContainer.scrollHeight;
    isAutoScrolling = false;
    
    return {
      success: true,
      messagesFound: scannedMessageIds.size - messagesBeforeScroll,
      totalMessages: scannedMessageIds.size
    };
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Get all channels/DMs from sidebar
  function getAllChannelsFromSidebar() {
    const channels = [];
    
    const channelSelectors = [
      '.p-channel_sidebar__channel',
      '[data-qa="channel_sidebar_channel"]',
      '.p-channel_sidebar__link',
      '[data-qa-channel-sidebar-channel-id]',
      '.c-link--button[data-qa="channel_sidebar_name_button"]'
    ];

    const seenNames = new Set();

    channelSelectors.forEach(selector => {
      document.querySelectorAll(selector).forEach(element => {
        const nameEl = element.querySelector('.p-channel_sidebar__name') ||
                       element.querySelector('[data-qa="channel_sidebar_name_button"]') ||
                       element.querySelector('.c-truncate__cut') ||
                       element;
        let name = nameEl?.textContent?.trim().substring(0, 100);
        
        // Skip non-channel items
        if (!name || name.startsWith('Add') || name.startsWith('Create') || seenNames.has(name)) {
          return;
        }
        
        seenNames.add(name);
        
        // Check for unread indicator
        const hasUnread = element.classList.contains('p-channel_sidebar__channel--unread') ||
                         element.querySelector('.p-channel_sidebar__badge') !== null ||
                         element.querySelector('.c-mention-badge') !== null ||
                         element.getAttribute('data-qa-unread') === 'true';
        
        channels.push({
          element,
          name,
          unread: hasUnread
        });
      });
    });

    return channels;
  }

  // Click on a channel and wait for it to load
  async function openChannelAndWait(channelElement) {
    const previousChannel = getCurrentChannelName();
    
    // Try to find clickable element
    const clickTarget = channelElement.querySelector('button') ||
                       channelElement.querySelector('a') ||
                       channelElement;
    
    clickTarget.click();
    
    // Wait for content to change
    let attempts = 0;
    while (attempts < 10) {
      await sleep(500);
      const newChannel = getCurrentChannelName();
      if (newChannel !== previousChannel && newChannel !== 'Unknown Channel') {
        await sleep(1000); // Extra wait for messages to load
        return true;
      }
      attempts++;
    }
    
    return false;
  }

  // Full scan: go through all channels/DMs
  async function scanAllChannels(options = {}) {
    if (isFullScanning) {
      return { success: false, reason: 'Full scan already in progress' };
    }

    isFullScanning = true;
    const results = {
      channelsScanned: 0,
      totalMessages: 0,
      totalFiles: 0,
      errors: []
    };

    try {
      const channels = getAllChannelsFromSidebar();
      const unreadFirst = options.unreadOnly 
        ? channels.filter(c => c.unread)
        : [...channels.filter(c => c.unread), ...channels.filter(c => !c.unread)];
      
      const maxChannels = options.maxChats || 20;
      const channelsToScan = unreadFirst.slice(0, maxChannels);

      console.log(`[File Assistant] Starting full scan of ${channelsToScan.length} channels (${channels.filter(c => c.unread).length} unread)`);

      for (const channel of channelsToScan) {
        try {
          console.log(`[File Assistant] Scanning: ${channel.name}${channel.unread ? ' (unread)' : ''}`);
          
          const opened = await openChannelAndWait(channel.element);
          if (!opened) {
            results.errors.push(`Failed to open: ${channel.name}`);
            continue;
          }

          // Scroll to load messages
          await autoScrollToLoadMessages(options.scrollDepth || 5);
          
          // Extract current messages and files
          const messages = extractMessagesFromPage();
          const files = extractFilesFromPage();

          if (messages.length > 0) {
            chrome.runtime.sendMessage({
              type: 'MESSAGES_COLLECTED',
              source: 'slack',
              messages: messages,
              channelName: getCurrentChannelName()
            });
          }

          if (files.length > 0) {
            chrome.runtime.sendMessage({
              type: 'FILES_FOUND',
              source: 'slack',
              files: files
            });
            files.forEach(f => scannedFileIds.add(f.id));
          }

          results.channelsScanned++;
          results.totalMessages += messages.length;
          results.totalFiles += files.length;

          // Brief pause between channels
          await sleep(1000);

        } catch (error) {
          results.errors.push(`Error scanning ${channel.name}: ${error.message}`);
        }
      }

    } finally {
      isFullScanning = false;
    }

    console.log(`[File Assistant] Full scan complete:`, results);
    return { success: true, ...results };
  }

  function sendFilesToExtension(files) {
    if (files.length === 0) return;
    files.forEach(f => scannedFileIds.add(f.id));

    chrome.runtime.sendMessage({
      type: 'FILES_FOUND',
      source: 'slack',
      files: files
    });
  }

  function scanPage() {
    const now = Date.now();
    if (now - lastScanTime < SCAN_INTERVAL) return;
    lastScanTime = now;

    const files = extractFilesFromPage();
    if (files.length > 0) {
      sendFilesToExtension(files);
    }

    const messages = extractMessagesFromPage();
    if (messages.length > 0) {
      chrome.runtime.sendMessage({
        type: 'MESSAGES_COLLECTED',
        source: 'slack',
        messages: messages,
        channelName: getCurrentChannelName()
      });
    }
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'SCAN_PAGE') {
      scannedFileIds.clear();
      const files = extractFilesFromPage();
      sendResponse({ files });
    } else if (message.type === 'GET_MESSAGES') {
      const messages = extractMessagesFromPage();
      sendResponse({ messages, channelName: getCurrentChannelName() });
    } else if (message.type === 'AUTO_SCROLL') {
      autoScrollToLoadMessages(message.maxScrolls || 10).then(result => {
        sendResponse(result);
      });
      return true;
    } else if (message.type === 'GET_CHANNELS') {
      const channels = getAllChannelsFromSidebar();
      sendResponse({ 
        channels: channels.map(c => ({ name: c.name, unread: c.unread })),
        unreadCount: channels.filter(c => c.unread).length
      });
    } else if (message.type === 'OPEN_CHANNEL') {
      const channels = getAllChannelsFromSidebar();
      const channel = channels.find(c => c.name.includes(message.channelName));
      if (channel) {
        openChannelAndWait(channel.element).then(success => {
          sendResponse({ success });
        });
      } else {
        sendResponse({ success: false, reason: 'Channel not found' });
      }
      return true;
    } else if (message.type === 'FULL_SCAN') {
      scanAllChannels(message.options || {}).then(result => sendResponse(result));
      return true;
    } else if (message.type === 'SCAN_UNREAD') {
      scanAllChannels({ unreadOnly: true, maxChats: message.maxChats || 50 }).then(result => sendResponse(result));
      return true;
    } else if (message.type === 'GET_STATUS') {
      sendResponse({ 
        active: true, 
        source: 'slack',
        scannedFiles: scannedFileIds.size,
        scannedMessages: scannedMessageIds.size,
        isScrolling: isAutoScrolling,
        isFullScanning: isFullScanning
      });
    }
    return true;
  });

  const observer = new MutationObserver((mutations) => {
    let hasNewContent = false;
    for (const mutation of mutations) {
      if (mutation.addedNodes.length > 0) {
        hasNewContent = true;
        break;
      }
    }
    if (hasNewContent && !isFullScanning) {
      setTimeout(scanPage, 1000);
    }
  });

  function startObserving() {
    const messageContainer = document.querySelector('.c-virtual_list__scroll_container') ||
                             document.querySelector('[data-qa="message_list"]') ||
                             document.querySelector('.p-workspace__primary_view') ||
                             document.body;
    
    observer.observe(messageContainer, {
      childList: true,
      subtree: true
    });

    setTimeout(scanPage, 2000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startObserving);
  } else {
    startObserving();
  }

  console.log('[File Assistant] Slack content script loaded (with full scan capability)');
})();
