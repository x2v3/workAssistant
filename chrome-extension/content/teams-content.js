// Content script for Microsoft Teams Web (teams.microsoft.com)

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
    const seenIds = new Set();

    // Based on actual Teams 2024+ HTML structure
    const fileSelectors = [
      '[data-testid="file-attachment"]',      // Main file attachment selector
      '[data-tid^="file-chiclet-"]',          // File chiclet elements
      '[data-tid="file-card"]',               // Legacy file cards
      'a[href*=".sharepoint.com"]',           // SharePoint links
      'a[href*="1drv.ms"]',                   // OneDrive short links
      'a[data-testid="atp-safelink"][href*="sharepoint"]'  // Safe links to SharePoint
    ];

    fileSelectors.forEach(selector => {
      document.querySelectorAll(selector).forEach(element => {
        try {
          const fileInfo = extractFileInfo(element);
          if (fileInfo && !scannedFileIds.has(fileInfo.id) && !seenIds.has(fileInfo.id)) {
            files.push(fileInfo);
            seenIds.add(fileInfo.id);
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
    
    // Primary selector based on actual Teams 2024+ HTML structure
    // [data-tid="chat-pane-message"] is the message body container
    const messageElements = document.querySelectorAll('[data-tid="chat-pane-message"]');
    
    messageElements.forEach(element => {
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

    return messages;
  }

  function extractMessageInfo(element) {
    // Get message ID from data-mid attribute (e.g., "1774620679601")
    const messageId = element.getAttribute('data-mid');
    
    // Get message content from [data-message-content] element
    // The aria-label contains the text, or we can get innerText
    const contentEl = element.querySelector('[data-message-content]');
    let text = '';
    
    if (contentEl) {
      // aria-label has the clean text content
      text = contentEl.getAttribute('aria-label') || contentEl.innerText || '';
    }
    
    text = text.trim();
    if (!text || text.length < 2) return null;

    // Navigate up to find the message wrapper which contains author and timestamp
    // Structure: .fui-ChatMessage contains author, timestamp, and message body
    const chatMessage = element.closest('.fui-ChatMessage') || 
                        element.closest('[data-testid="message-wrapper"]')?.querySelector('.fui-ChatMessage');
    
    // Get sender from [data-tid="message-author-name"]
    let sender = 'Unknown';
    const authorEl = chatMessage?.querySelector('[data-tid="message-author-name"]') ||
                     element.closest('[data-testid="message-wrapper"]')?.querySelector('[data-tid="message-author-name"]');
    if (authorEl) {
      sender = authorEl.textContent?.trim() || 'Unknown';
    }
    
    // Get timestamp from time element with datetime attribute
    let timestamp = new Date().toISOString();
    const timeEl = chatMessage?.querySelector('time.fui-ChatMessage__timestamp') ||
                   chatMessage?.querySelector('time[datetime]') ||
                   element.closest('[data-testid="message-wrapper"]')?.querySelector('time[datetime]');
    if (timeEl) {
      const dateStr = timeEl.getAttribute('datetime');
      if (dateStr) {
        try {
          timestamp = new Date(dateStr).toISOString();
        } catch (e) {
          console.debug('Failed to parse timestamp:', dateStr);
        }
      }
    }

    // Use data-mid as unique ID, or generate one
    const id = messageId ? `teams_${messageId}` : generateId(sender + timestamp + text.substring(0, 50));

    // Check for attachments
    const hasAttachment = element.querySelector('[data-tid="file-attachment-grid"]') !== null ||
                          element.querySelector('[data-testid="file-attachment"]') !== null;
    
    // Check for images
    const hasImage = element.querySelector('[itemtype="http://schema.skype.com/AMSImage"]') !== null;

    return {
      id,
      text: text.substring(0, 5000),
      sender,
      timestamp,
      channelName: getCurrentChannelName(),
      source: 'teams',
      hasAttachment: hasAttachment || hasImage
    };
  }

  function extractFileInfo(element) {
    // Get download URL from various possible locations
    const linkElement = element.querySelector('a[href]') || element.closest('a[href]');
    let href = linkElement?.href || element.getAttribute('data-url') || '';
    
    // For file attachments, the title attribute might have the URL
    if (!href && element.hasAttribute('title')) {
      const title = element.getAttribute('title');
      if (title?.includes('sharepoint') || title?.includes('1drv')) {
        const urlMatch = title.match(/(https?:\/\/[^\s]+)/);
        if (urlMatch) href = urlMatch[1];
      }
    }
    
    if (!href) return null;

    // Get file name - multiple strategies based on actual Teams 2024+ HTML
    let fileName = '';
    
    // Strategy 1: From data-tid attribute (e.g., data-tid="file-chiclet-Log 7.zip")
    const dataTid = element.getAttribute('data-tid');
    if (dataTid?.startsWith('file-chiclet-')) {
      fileName = dataTid.replace('file-chiclet-', '');
    }
    
    // Strategy 2: From .ui-text or .ui-attachment__header span
    if (!fileName) {
      const nameEl = element.querySelector('.ui-text') ||
                     element.querySelector('.ui-attachment__header span') ||
                     element.querySelector('[data-tid="file-name"]');
      fileName = nameEl?.textContent?.trim() || '';
    }
    
    // Strategy 3: From link text
    if (!fileName && linkElement) {
      fileName = linkElement.textContent?.trim() || '';
    }
    
    // Strategy 4: Extract from URL
    if (!fileName) {
      fileName = extractFileNameFromUrl(href) || 'Unknown file';
    }
    
    return {
      id: generateId(href + fileName),
      name: fileName,
      downloadUrl: href,
      source: 'teams',
      messageContent: getParentMessageContent(element),
      sender: getSenderFromMessage(element),
      timestamp: getTimestampFromMessage(element),
      channelName: getCurrentChannelName()
    };
  }

  function extractFileNameFromUrl(url) {
    try {
      const urlObj = new URL(url);
      const pathParts = urlObj.pathname.split('/');
      return decodeURIComponent(pathParts[pathParts.length - 1]) || null;
    } catch {
      return null;
    }
  }

  function generateId(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return `teams_${Math.abs(hash)}`;
  }

  function getParentMessageContent(element) {
    // Navigate up to find the message container
    const messageContainer = element.closest('[data-tid="chat-pane-message"]') ||
                             element.closest('[data-testid="message-wrapper"]') ||
                             element.closest('.fui-ChatMessage') ||
                             element.closest('.ts-message-list-item');
    
    if (messageContainer) {
      // Try Teams 2024+ structure first
      const contentEl = messageContainer.querySelector('[data-message-content]');
      if (contentEl) {
        return contentEl.getAttribute('aria-label')?.substring(0, 500) ||
               contentEl.innerText?.substring(0, 500) || '';
      }
      // Fallback to older selectors
      const textElement = messageContainer.querySelector('.message-body-content') ||
                          messageContainer.querySelector('[data-tid="message-text"]');
      return textElement?.textContent?.trim().substring(0, 500) || '';
    }
    return '';
  }

  function getSenderFromMessage(element) {
    // Navigate up to find the message wrapper which contains author
    const messageWrapper = element.closest('[data-testid="message-wrapper"]') ||
                           element.closest('.fui-ChatMessage')?.closest('[data-testid="message-wrapper"]') ||
                           element.closest('[data-tid="chat-pane-item"]');
    
    if (messageWrapper) {
      const senderElement = messageWrapper.querySelector('[data-tid="message-author-name"]');
      if (senderElement) return senderElement.textContent?.trim() || 'Unknown';
    }
    
    // Try within the element itself or nearby
    const senderElement = element.querySelector('[data-tid="message-author-name"]') ||
                          element.closest('.fui-ChatMessage')?.querySelector('[data-tid="message-author-name"]');
    return senderElement?.textContent?.trim() || 'Unknown';
  }

  function getTimestampFromMessage(element) {
    // Navigate up to find the message wrapper
    const messageWrapper = element.closest('[data-testid="message-wrapper"]') ||
                           element.closest('.fui-ChatMessage')?.closest('[data-testid="message-wrapper"]') ||
                           element.closest('[data-tid="chat-pane-item"]');
    
    let timeElement = null;
    
    if (messageWrapper) {
      // Teams 2024+ uses time.fui-ChatMessage__timestamp with datetime attribute
      timeElement = messageWrapper.querySelector('time.fui-ChatMessage__timestamp') ||
                    messageWrapper.querySelector('time[datetime]');
    }
    
    if (!timeElement) {
      timeElement = element.closest('.fui-ChatMessage')?.querySelector('time[datetime]') ||
                    element.querySelector('time[datetime]');
    }
    
    if (timeElement) {
      const dateStr = timeElement.getAttribute('datetime');
      if (dateStr) {
        try {
          return new Date(dateStr).toISOString();
        } catch {
          console.debug('Failed to parse timestamp:', dateStr);
        }
      }
    }
    
    return new Date().toISOString();
  }

  function getCurrentChannelName() {
    // Try multiple selectors for Teams 2024+ UI
    const channelHeader = document.querySelector('[data-tid="channel-header-title"]') ||
                          document.querySelector('[data-tid="chat-header-title"]') ||
                          document.querySelector('[data-tid="conversation-title"]') ||
                          document.querySelector('.channel-name') ||
                          document.querySelector('h2.title');
    
    if (channelHeader) {
      return channelHeader.textContent?.trim() || 'Unknown Channel';
    }
    
    // Fallback: try to get from the active chat item in sidebar
    const activeChat = document.querySelector('[role="treeitem"][aria-selected="true"]');
    if (activeChat) {
      const nameEl = activeChat.querySelector('[id^="title-chat-list-item_"]');
      if (nameEl) return nameEl.textContent?.trim() || 'Unknown Channel';
    }
    
    return 'Unknown Channel';
  }

  // Auto-scroll functionality
  async function autoScrollToLoadMessages(maxScrolls = 10) {
    if (isAutoScrolling) return { success: false, reason: 'Already scrolling' };
    
    isAutoScrolling = true;
    const messagesBeforeScroll = scannedMessageIds.size;
    
    // Based on actual Teams 2024+ HTML structure
    const scrollContainer = document.querySelector('[data-tid="message-pane-list-viewport"]') ||
                            document.querySelector('[data-view="message-pane-list-viewport"]') ||
                            document.querySelector('[data-tid="message-pane-list-runway"]')?.parentElement ||
                            document.querySelector('.ts-message-list') ||
                            document.querySelector('.scrollable');
    
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
          source: 'teams',
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

  // Get all chats/channels from sidebar
  function getAllChatsFromSidebar() {
    const chats = [];
    const seenNames = new Set();
    
    // Find the tree container (based on actual Teams 2024+ HTML structure)
    const treeContainer = document.querySelector('[role="tree"][data-testid="simple-collab-dnd-rail"]') ||
                          document.querySelector('[role="tree"]') ||
                          document.querySelector('[data-tid="app-layout-area--mid-nav"]');
    
    if (!treeContainer) {
      console.log('[File Assistant] Could not find chat tree container');
      return chats;
    }

    // Select actual chat items (not folder headers or special items)
    // Based on actual HTML: role="treeitem" with data-testid="list-item"
    const chatItems = treeContainer.querySelectorAll('[role="treeitem"][data-testid="list-item"]');
    
    console.log(`[File Assistant] Found ${chatItems.length} treeitem elements with data-testid="list-item"`);

    chatItems.forEach(element => {
      try {
        // Get the chat name from the title span (id starts with "title-chat-list-item_")
        const nameEl = element.querySelector('[id^="title-chat-list-item_"]') ||
                       element.querySelector('.fui-TreeItemLayout__main span') ||
                       element.querySelector('[class*="TreeItemLayout__main"] span');
        
        let name = nameEl?.textContent?.trim();
        
        // Fallback: try aria-labelledby referenced elements
        if (!name) {
          const ariaLabelledBy = element.getAttribute('aria-labelledby');
          if (ariaLabelledBy) {
            const labelIds = ariaLabelledBy.split(' ');
            for (const id of labelIds) {
              if (id.startsWith('title-')) {
                const labelEl = document.getElementById(id);
                if (labelEl) {
                  name = labelEl.textContent?.trim();
                  break;
                }
              }
            }
          }
        }
        
        // Skip if no valid name or already seen
        if (!name || name.length < 2 || seenNames.has(name)) return;
        
        // Skip folder headers and special items
        if (element.hasAttribute('data-conversation-folder')) return;
        const itemType = element.getAttribute('data-item-type');
        if (itemType === 'custom-folder' || itemType === 'chats') return;
        
        seenNames.add(name);
        
        // Check for unread indicator - based on actual HTML structure
        // Unread items have a child with data-tid="unread" or id="unread-label"
        const hasUnread = element.querySelector('[data-tid="unread"]') !== null ||
                         element.querySelector('#unread-label') !== null ||
                         element.querySelector('[id="unread-label"]') !== null ||
                         element.getAttribute('aria-labelledby')?.includes('chat_list_unread_text');
        
        chats.push({
          element,
          name,
          unread: hasUnread
        });
      } catch (e) {
        console.debug('[File Assistant] Error processing chat item:', e);
      }
    });

    console.log(`[File Assistant] Found ${chats.length} chats in sidebar (${chats.filter(c => c.unread).length} unread)`);
    return chats;
  }

  // Click on a chat and wait for it to load
  async function openChatAndWait(chatElement) {
    const previousChannel = getCurrentChannelName();
    
    chatElement.click();
    
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

  // Full scan: go through all chats/channels
  async function scanAllChats(options = {}) {
    if (isFullScanning) {
      return { success: false, reason: 'Full scan already in progress' };
    }

    isFullScanning = true;
    const results = {
      chatsScanned: 0,
      totalMessages: 0,
      totalFiles: 0,
      errors: []
    };

    try {
      const chats = getAllChatsFromSidebar();
      const unreadFirst = options.unreadOnly 
        ? chats.filter(c => c.unread)
        : [...chats.filter(c => c.unread), ...chats.filter(c => !c.unread)];
      
      const maxChats = options.maxChats || 20;
      const chatsToScan = unreadFirst.slice(0, maxChats);

      console.log(`[File Assistant] Starting full scan of ${chatsToScan.length} chats (${chats.filter(c => c.unread).length} unread)`);

      for (const chat of chatsToScan) {
        try {
          console.log(`[File Assistant] Scanning: ${chat.name}${chat.unread ? ' (unread)' : ''}`);
          
          const opened = await openChatAndWait(chat.element);
          if (!opened) {
            results.errors.push(`Failed to open: ${chat.name}`);
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
              source: 'teams',
              messages: messages,
              channelName: getCurrentChannelName()
            });
          }

          if (files.length > 0) {
            chrome.runtime.sendMessage({
              type: 'FILES_FOUND',
              source: 'teams',
              files: files
            });
            files.forEach(f => scannedFileIds.add(f.id));
          }

          results.chatsScanned++;
          results.totalMessages += messages.length;
          results.totalFiles += files.length;

          // Brief pause between chats
          await sleep(1000);

        } catch (error) {
          results.errors.push(`Error scanning ${chat.name}: ${error.message}`);
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
      source: 'teams',
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
        source: 'teams',
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
    } else if (message.type === 'GET_CHATS') {
      const chats = getAllChatsFromSidebar();
      sendResponse({ 
        chats: chats.map(c => ({ name: c.name, unread: c.unread })),
        unreadCount: chats.filter(c => c.unread).length
      });
    } else if (message.type === 'OPEN_CHAT') {
      const chats = getAllChatsFromSidebar();
      const chat = chats.find(c => c.name.includes(message.chatName));
      if (chat) {
        openChatAndWait(chat.element).then(success => {
          sendResponse({ success });
        });
      } else {
        sendResponse({ success: false, reason: 'Chat not found' });
      }
      return true;
    } else if (message.type === 'FULL_SCAN') {
      scanAllChats(message.options || {}).then(result => sendResponse(result));
      return true;
    } else if (message.type === 'SCAN_UNREAD') {
      scanAllChats({ unreadOnly: true, maxChats: message.maxChats || 50 }).then(result => sendResponse(result));
      return true;
    } else if (message.type === 'GET_STATUS') {
      sendResponse({ 
        active: true, 
        source: 'teams',
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
    // Based on actual Teams 2024+ HTML structure
    const messageContainer = document.querySelector('[data-tid="message-pane-list-viewport"]') ||
                             document.querySelector('[data-tid="message-pane-body"]') ||
                             document.querySelector('[data-tid="message-pane"]') ||
                             document.querySelector('.ts-message-list') ||
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

  console.log('[File Assistant] Teams content script loaded (with full scan capability)');
})();
