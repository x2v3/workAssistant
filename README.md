# Teams & Slack File Assistant

An AI-powered Chrome extension that helps you:
- **Catch up** on missed Teams and Slack messages with AI summaries
- **Ask questions** about past conversations via Discord bot
- **Automatically download** and organize relevant files
- **Build a knowledge base** from your workplace messages

## Features

### 🧠 Knowledge Base
- Automatically collects messages from open Teams and Slack tabs
- Stores messages locally for search and Q&A
- Auto-scrolls pages to load message history

### 💬 Discord Integration
- **Webhook**: Receive file notifications and daily summaries
- **Bot**: Ask questions like `!ask What did Sarah say about the deadline?`
- Get AI-powered answers based on your workplace messages

### 📁 Smart File Management
- AI decides which files are worth downloading
- Intelligent organization based on context
- Deduplication to avoid downloading the same file twice

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Chrome Extension                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │  Popup UI   │  │  Settings   │  │  Content Scripts    │ │
│  │             │  │             │  │  (Teams + Slack)    │ │
│  └──────┬──────┘  └──────┬──────┘  └──────────┬──────────┘ │
│         │                │                     │            │
│         └────────┬───────┴─────────────────────┘            │
│                  │                                          │
│         ┌────────▼────────┐                                │
│         │ Background.js   │◄── Auto-scan, message relay    │
│         └────────┬────────┘                                │
└──────────────────┼──────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────┐
│                    Local Node.js Server                      │
│  ┌───────────┐  ┌───────────┐  ┌────────────┐              │
│  │ Knowledge │  │   LLM     │  │  Discord   │              │
│  │   Base    │  │  Service  │  │   Bot      │              │
│  │  (JSON)   │  │(OpenRouter)│  │   + Hook  │              │
│  └─────┬─────┘  └─────┬─────┘  └──────┬─────┘              │
│        │              │               │                     │
│        └──────────────┼───────────────┘                     │
│                       │                                     │
│              ┌────────▼────────┐                           │
│              │  Web Dashboard  │◄── Full configuration UI  │
│              │  localhost:3847 │                           │
│              └─────────────────┘                           │
└─────────────────────────────────────────────────────────────┘
```

## Quick Start

### 1. Install Dependencies

```bash
cd local-server
npm install
```

### 2. Start the Server

```bash
npm start
```

The server runs at `http://localhost:3847` with a web dashboard.

### 3. Load the Chrome Extension

1. Open Chrome → `chrome://extensions`
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select the `chrome-extension` folder

### 4. Configure via Dashboard

Open `http://localhost:3847` and configure:

1. **OpenRouter API Key** - Get one at [openrouter.ai/keys](https://openrouter.ai/keys)
2. **Discord Webhook** (optional) - For notifications
3. **Discord Bot Token** (optional) - For Q&A

### 5. Open Teams/Slack Tabs

Open your Teams and Slack in Chrome (log in to your accounts). The extension will:
- Automatically detect open tabs
- Periodically scan for new messages
- Auto-scroll to load history

## Discord Bot Setup

For the Q&A feature, create a Discord bot:

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Create a new application
3. Go to "Bot" section and click "Add Bot"
4. Enable these intents:
   - Message Content Intent
   - Server Members Intent (optional)
5. Copy the bot token
6. Go to OAuth2 → URL Generator:
   - Select `bot` scope
   - Select permissions: Send Messages, Read Message History, Use Slash Commands
7. Use the generated URL to invite the bot to your server
8. Paste the bot token in the dashboard

### Bot Commands

- **`!ask <question>`** - Ask about past messages
  - Example: `!ask What was discussed about the Q4 deadline?`
- **Mention the bot** - Same as !ask
  - Example: `@FileAssistant What did John say about the API?`

## Configuration

All settings can be configured via the web dashboard at `http://localhost:3847`.

### AI Settings
- **Provider**: OpenRouter (supports GPT-4, Claude, Llama, etc.)
- **Model**: Choose your preferred model

### Discord Settings
- **Webhook URL**: For file notifications and summaries
- **Bot Token**: For Q&A functionality
- **Command Prefix**: Default is `!ask`
- **Auto Summary**: Send daily summaries at 9 AM

### Sync Settings
- **Interval**: How often to scan (5-60 minutes)
- **Sources**: Enable/disable Teams or Slack

### File Filters
- **File Types**: Which extensions to download
- **Max Size**: Maximum file size to download

## How It Works

### Message Collection
1. Content scripts run on Teams/Slack pages
2. They extract visible messages and file attachments
3. Periodic auto-scroll loads older messages
4. Messages are sent to the server's knowledge base

### AI Q&A
1. User asks a question (via Discord or dashboard)
2. Server searches the knowledge base for relevant messages
3. Relevant context is sent to the LLM
4. AI generates an answer based on actual messages

### File Processing
1. Files are detected in message attachments
2. AI evaluates relevance (work documents vs memes)
3. Relevant files are downloaded with smart organization
4. Discord notifications are sent (if configured)

## Privacy & Security

- All data stays on your machine
- Messages are stored locally in JSON format
- API calls go to OpenRouter for AI processing
- No data is sent to third parties except your configured AI provider

## File Structure

```
workAssistant/
├── chrome-extension/
│   ├── manifest.json
│   ├── background.js
│   ├── content/
│   │   ├── teams-content.js
│   │   └── slack-content.js
│   ├── popup/
│   └── settings/
└── local-server/
    ├── package.json
    ├── config.json
    ├── data/
    │   └── knowledge.json
    ├── public/
    │   └── index.html (dashboard)
    └── src/
        ├── index.js
        ├── routes/
        └── services/
            ├── knowledge-base.js
            ├── discord-bot.js
            ├── discord.js
            └── llm/
```

## Troubleshooting

### Server won't start
- Make sure port 3847 is not in use
- Run `npm install` to install dependencies

### Extension not detecting tabs
- Ensure you're logged into Teams/Slack
- Check that the URLs match `teams.microsoft.com` or `app.slack.com`

### Discord bot not responding
- Verify the bot token is correct
- Ensure the bot has Message Content Intent enabled
- Check the bot has permission to read/send messages in the channel

### No messages in knowledge base
- Click "Auto-Scan All Tabs" in the popup
- Make sure Teams/Slack tabs are open
- Wait for the periodic sync (default: 15 min)

## License

MIT
