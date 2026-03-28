import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { configRouter } from './routes/config.js';
import { filesRouter } from './routes/files.js';
import { llmRouter } from './routes/llm.js';
import { syncRouter } from './routes/sync.js';
import { discordRouter } from './routes/discord.js';
import { knowledgeRouter } from './routes/knowledge.js';
import { configStore } from './config/store.js';
import { startDiscordBot } from './services/discord-bot.js';
import { scheduler } from './services/scheduler.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '50mb' }));

// Serve static files (dashboard)
app.use(express.static(path.join(__dirname, '../public')));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API routes
app.use('/api/config', configRouter);
app.use('/api/files', filesRouter);
app.use('/api/llm', llmRouter);
app.use('/api/sync', syncRouter);
app.use('/api/discord', discordRouter);
app.use('/api/knowledge', knowledgeRouter);

// Redirect root to dashboard
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

const config = configStore.getConfig();
const PORT = config.server?.port || 3847;
const HOST = config.server?.host || '127.0.0.1';

app.listen(PORT, HOST, () => {
  console.log(`\n🚀 Teams & Slack File Assistant Server`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`📊 Dashboard:  http://${HOST}:${PORT}`);
  console.log(`🔌 API:        http://${HOST}:${PORT}/api`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
  
  // Start Discord bot if configured
  startDiscordBot();
  
  // Start scheduler for automated tasks
  scheduler.start();
});
