# Teams & Slack File Assistant - Design Document

> This document captures all concepts, design decisions, and architecture for future reference.
> **Keep this file updated when making changes.**
> **Last Updated**: 2026-03-28 (fixed Teams DOM selectors for 2024+ UI)

## Overview

An AI-powered Chrome extension + local server system that:
1. Automatically monitors Teams and Slack web pages
2. Collects messages into a knowledge base
3. Provides AI-powered Q&A via Discord bot
4. Downloads and organizes relevant files automatically
5. Generates catch-up summaries

## Key Design Decisions

### 1. Web Scraping vs Enterprise APIs
**Decision**: Use web page scraping instead of Microsoft Graph API or Slack API.

**Reason**: Enterprise APIs require admin consent and complex OAuth setup. Web scraping works with any logged-in user account without IT department involvement.

**Implementation**: Content scripts injected into Teams/Slack pages extract messages and file attachments from the DOM.

### 2. Local Server Architecture
**Decision**: Chrome extension communicates with a local Node.js server.

**Reason**: Chrome extensions cannot write to arbitrary local file paths. The local server handles:
- File downloads and organization
- Knowledge base storage (JSON file)
- LLM API calls (OpenRouter)
- Discord bot hosting

### 3. OpenRouter for LLM
**Decision**: Use OpenRouter as the single LLM provider.

**Reason**: OpenRouter provides access to multiple models (GPT-4, Claude, Llama, etc.) through a single API, simplifying configuration.

**Models fetched dynamically** from OpenRouter API - not hardcoded.

### 4. Knowledge Base Storage
**Decision**: JSON file storage instead of SQLite.

**Reason**: Simpler setup, no native dependencies, portable. Messages stored in `data/knowledge.json`.

**Structure**:
```json
{
  "messages": [
    {
      "id": "unique_hash",
      "text": "message content",
      "sender": "John Doe",
      "timestamp": "2026-03-28T10:00:00Z",
      "channelName": "Project Alpha",
      "source": "teams|slack",
      "hasAttachment": false
    }
  ],
  "lastUpdated": "2026-03-28T10:00:00Z"
}
```

### 5. Discord Integration
**Two modes**:
1. **Webhook**: For notifications (file downloads, summaries) - simpler setup
2. **Bot**: For Q&A functionality - requires bot token and intents

**Bot commands**:
- `!ask <question>` - Ask about past messages
- Mention the bot - Same as !ask

### 6. Auto Tab Opening
**Decision**: Extension automatically opens Teams/Slack tabs on startup.

**Configuration**: URLs stored in config, opened when extension starts or on-demand.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      Chrome Extension                            │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │   Popup UI   │  │   Settings   │  │   Content Scripts    │  │
│  │  - Scan tabs │  │  - Config    │  │  - teams-content.js  │  │
│  │  - Catch-up  │  │  - Models    │  │  - slack-content.js  │  │
│  │  - Status    │  │  - Discord   │  │  - Auto-scroll       │  │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬───────────┘  │
│         │                 │                      │              │
│         └─────────────────┼──────────────────────┘              │
│                           │                                     │
│              ┌────────────▼────────────┐                       │
│              │    Background.js        │                       │
│              │  - Alarm scheduling     │                       │
│              │  - Auto tab opening     │                       │
│              │  - Message relay        │                       │
│              └────────────┬────────────┘                       │
└───────────────────────────┼─────────────────────────────────────┘
                            │ HTTP (localhost:3847)
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Local Node.js Server                          │
│                                                                  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐ │
│  │  Knowledge  │  │    LLM      │  │      Discord            │ │
│  │    Base     │  │  Service    │  │  - Webhook (notify)     │ │
│  │  (JSON)     │  │ (OpenRouter)│  │  - Bot (Q&A)            │ │
│  └──────┬──────┘  └──────┬──────┘  └───────────┬─────────────┘ │
│         │                │                     │                │
│  ┌──────┴────────────────┴─────────────────────┴──────────────┐│
│  │                    Express.js API                          ││
│  │  /api/config, /api/knowledge, /api/llm, /api/discord       ││
│  └────────────────────────────────────────────────────────────┘│
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐│
│  │                   Web Dashboard                            ││
│  │  - Knowledge base search & Q&A                             ││
│  │  - Full configuration UI                                   ││
│  │  - File download history                                   ││
│  └────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

## File Structure

```
workAssistant/
├── DESIGN.md                    # This file - design reference
├── README.md                    # User documentation
├── chrome-extension/
│   ├── manifest.json            # Extension config (Manifest V3)
│   ├── background.js            # Service worker
│   ├── content/
│   │   ├── teams-content.js     # Teams DOM scraping + auto-scroll
│   │   └── slack-content.js     # Slack DOM scraping + auto-scroll
│   ├── popup/
│   │   ├── popup.html/css/js    # Quick actions UI
│   ├── settings/
│   │   └── settings.html/css/js # Full settings page
│   └── icons/
└── local-server/
    ├── package.json
    ├── config.json              # All configuration
    ├── data/
    │   └── knowledge.json       # Message storage
    ├── public/
    │   └── index.html           # Web dashboard (single file)
    └── src/
        ├── index.js             # Express server entry
        ├── config/
        │   └── store.js         # Config management
        ├── routes/
        │   ├── config.js        # GET/PUT /api/config
        │   ├── files.js         # File processing
        │   ├── llm.js           # LLM operations
        │   ├── sync.js          # Sync status
        │   ├── discord.js       # Discord webhook
        │   └── knowledge.js     # Knowledge base CRUD + Q&A
        └── services/
            ├── knowledge-base.js # Message storage & search
            ├── file-organizer.js # File download & organization
            ├── discord.js        # Webhook service
            ├── discord-bot.js    # Bot service
            ├── scheduler.js      # Automated tasks
            └── llm/
                ├── index.js      # LLM abstraction
                └── openrouter.js # OpenRouter adapter

```

## Configuration (config.json)

```json
{
  "llm": {
    "provider": "openrouter",
    "apiKey": "sk-or-...",
    "model": "openai/gpt-4o-mini"
  },
  "storage": {
    "baseDirectory": "D:/Downloads/WorkFiles"
  },
  "sync": {
    "intervalMinutes": 15,
    "teamsEnabled": true,
    "slackEnabled": true
  },
  "filters": {
    "fileTypes": [".pdf", ".docx", ".xlsx"],
    "maxFileSizeMB": 100
  },
  "discord": {
    "webhookUrl": "https://discord.com/api/webhooks/...",
    "botToken": "...",
    "botPrefix": "!ask",
    "notifyOnFiles": true,
    "notifyOnCatchUp": true,
    "autoSummary": false
  },
  "tabs": {
    "autoOpen": true,
    "teamsUrl": "https://teams.microsoft.com",
    "slackUrl": "https://app.slack.com"
  },
  "server": {
    "port": 3847,
    "host": "127.0.0.1"
  }
}
```

## Key Flows

### 1. Message Collection
1. Extension opens Teams/Slack tabs (if autoOpen enabled)
2. Content scripts detect page load
3. **Three scan modes**:
   - **Quick Scan**: Auto-scroll current view to load messages
   - **Full Scan**: Click through ALL chats/channels, scroll each, extract messages
   - **Scan Unread**: Click through only UNREAD chats/channels (prioritized)
4. Messages extracted from DOM
5. Sent to background.js → server → knowledge base

**Full Scan Process**:
1. Get list of all chats/channels from sidebar
2. Sort: unread first, then read
3. For each chat/channel:
   - Click to open it
   - Wait for content to load
   - Auto-scroll to load message history
   - Extract messages and files
   - Move to next
4. Store all collected messages in knowledge base

### 2. Q&A Flow
1. User asks question (Discord bot or dashboard)
2. Server searches knowledge base for relevant messages
3. Context sent to LLM with question
4. LLM generates answer based on actual messages
5. Answer returned with source citations

### 3. File Download Flow
1. Content script detects file attachment
2. File info sent to server
3. LLM evaluates relevance
4. If relevant, LLM suggests organization
5. File downloaded and saved to organized path
6. Discord notification sent (if enabled)

### 4. Catch-Up Summary
1. User requests catch-up (popup, dashboard, or scheduled)
2. Server fetches recent messages (24h default)
3. Messages grouped by channel
4. LLM generates summary with key points + action items
5. Summary sent to Discord (if enabled)

## Teams DOM Selectors (2024+ UI)

**Important**: Teams UI changes frequently. These selectors were verified on 2026-03-28.

### Chat List (Sidebar)
```javascript
// Container
treeContainer = document.querySelector('[role="tree"][data-testid="simple-collab-dnd-rail"]')

// Individual chat items (NOT folder headers)
chatItems = treeContainer.querySelectorAll('[role="treeitem"][data-testid="list-item"]')

// Chat name - span with id starting with "title-chat-list-item_"
nameEl = element.querySelector('[id^="title-chat-list-item_"]')

// Unread indicator - child element with data-tid="unread"
hasUnread = element.querySelector('[data-tid="unread"]') !== null
```

### Key Attributes
- `data-item-type`: "chat", "muted-chat", "custom-folder", etc.
- `data-conversation-folder="true"`: Folder headers (skip these)
- `aria-labelledby`: Contains IDs like "chat_list_unread_text" for unread items

### Messages Area
```javascript
// Message list container
messageList = document.querySelector('[data-tid="message-pane-list-viewport"]') ||
              document.querySelector('[data-tid="message-pane-list-runway"]')

// Individual messages - 21 messages found with this selector
messages = document.querySelectorAll('[data-tid="chat-pane-message"]')

// For each message element:
// Message ID
messageId = msg.getAttribute('data-mid')  // e.g., "1774620679601"

// Author name
authorEl = msg.closest('[data-testid="message-wrapper"]')
            ?.querySelector('[data-tid="message-author-name"]')
author = authorEl?.textContent  // e.g., "Guilherme Graciosa"

// Timestamp
timeEl = msg.closest('.fui-ChatMessage')
          ?.querySelector('time.fui-ChatMessage__timestamp')
timestamp = timeEl?.getAttribute('datetime')  // ISO format: "2026-03-27T14:11:19.601Z"

// Message content - multiple ways to get it
contentEl = msg.querySelector('[data-message-content]')
// Option 1: aria-label has text content
content = contentEl?.getAttribute('aria-label')
// Option 2: innerText of paragraphs
content = contentEl?.innerText

// Check for attachments
hasAttachment = msg.querySelector('[data-tid="file-attachment-grid"]') !== null

// Check for images
hasImage = msg.querySelector('[itemtype="http://schema.skype.com/AMSImage"]') !== null

// Links in message
links = contentEl?.querySelectorAll('a[href]')
```

### Message Structure Example
```html
<div data-tid="chat-pane-message" id="message-body-1774620679601" 
     data-mid="1774620679601" role="group">
  <div id="content-1774620679601" 
       aria-label="ok, thanks for the quick feedback" 
       data-message-content="">
    <p>ok, thanks for the quick feedback</p>
  </div>
</div>
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/config` | GET/PUT | Get or update configuration |
| `/api/knowledge/messages` | GET/POST | Get or add messages |
| `/api/knowledge/search` | GET | Search messages |
| `/api/knowledge/stats` | GET | Knowledge base statistics |
| `/api/knowledge/ask` | POST | AI Q&A |
| `/api/knowledge/catchup` | POST | Generate catch-up summary |
| `/api/llm/models` | GET | List all OpenRouter models |
| `/api/llm/models/popular` | GET | List popular models |
| `/api/llm/test` | POST | Test LLM connection |
| `/api/discord/test` | POST | Test Discord webhook |
| `/api/files/process` | POST | Process and download files |
| `/api/files/history` | GET | Download history |

## Future Enhancements (Ideas)

- [ ] Vector embeddings for better semantic search
- [ ] Multiple Discord channel support
- [ ] Slack/Teams direct reply from Discord
- [ ] File content extraction (PDF text, etc.)
- [ ] Message threading support
- [ ] User mentions/highlights

---

*This document should be updated whenever significant changes are made to the architecture or design.*
