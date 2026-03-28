import express from 'express';
import { discordService } from '../services/discord.js';
import { llmService } from '../services/llm/index.js';

export const discordRouter = express.Router();

discordRouter.post('/test', async (req, res) => {
  try {
    if (!discordService.isConfigured()) {
      return res.status(400).json({ 
        error: 'Discord webhook not configured',
        configured: false 
      });
    }

    await discordService.testWebhook();
    res.json({ success: true, message: 'Test message sent to Discord' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

discordRouter.post('/send', async (req, res) => {
  try {
    const { message } = req.body;
    
    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    await discordService.sendMessage(message);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

discordRouter.post('/catchup', async (req, res) => {
  try {
    const { messages, sendToDiscord = true } = req.body;
    
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'Messages array is required' });
    }

    const summary = await llmService.summarizeMessages(messages);

    const sources = [];
    const channelMap = new Map();
    
    for (const msg of messages) {
      const key = `${msg.source}-${msg.channelName}`;
      if (!channelMap.has(key)) {
        channelMap.set(key, { 
          source: msg.source, 
          channelName: msg.channelName, 
          messageCount: 0 
        });
      }
      channelMap.get(key).messageCount++;
    }
    
    sources.push(...channelMap.values());

    if (sendToDiscord && discordService.isConfigured()) {
      await discordService.sendCatchUpSummary(summary.summary, sources);
    }

    res.json({ 
      success: true, 
      summary: summary.summary,
      keyPoints: summary.keyPoints,
      actionItems: summary.actionItems,
      sentToDiscord: sendToDiscord && discordService.isConfigured(),
      sources
    });
  } catch (error) {
    console.error('Catch-up error:', error);
    res.status(500).json({ error: error.message });
  }
});

discordRouter.post('/notify-files', async (req, res) => {
  try {
    const { files } = req.body;
    
    if (!files || !Array.isArray(files) || files.length === 0) {
      return res.json({ success: true, skipped: true });
    }

    if (!discordService.isConfigured()) {
      return res.json({ success: true, skipped: true, reason: 'Discord not configured' });
    }

    await discordService.sendFileNotification(files);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

discordRouter.get('/status', (req, res) => {
  res.json({
    configured: discordService.isConfigured()
  });
});
