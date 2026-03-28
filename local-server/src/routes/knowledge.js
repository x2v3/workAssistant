import express from 'express';
import { knowledgeBase } from '../services/knowledge-base.js';
import { llmService } from '../services/llm/index.js';
import { discordService } from '../services/discord.js';

export const knowledgeRouter = express.Router();

// Store messages from extension
knowledgeRouter.post('/messages', (req, res) => {
  try {
    const { messages, source, channelName } = req.body;
    
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'Messages array required' });
    }

    const result = knowledgeBase.addMessages(messages, source, channelName);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get messages with filters
knowledgeRouter.get('/messages', (req, res) => {
  try {
    const options = {
      source: req.query.source,
      channelName: req.query.channel,
      sender: req.query.sender,
      since: req.query.since,
      until: req.query.until,
      limit: parseInt(req.query.limit) || 100
    };

    const messages = knowledgeBase.getMessages(options);
    res.json({ messages, count: messages.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Search messages
knowledgeRouter.get('/search', (req, res) => {
  try {
    const { q, source, since, limit } = req.query;
    
    if (!q) {
      return res.status(400).json({ error: 'Query parameter q required' });
    }

    const results = knowledgeBase.search(q, {
      source,
      since,
      limit: parseInt(limit) || 20
    });

    res.json({ results, count: results.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get stats
knowledgeRouter.get('/stats', (req, res) => {
  try {
    const stats = knowledgeBase.getStats();
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// AI-powered catch-up summary
knowledgeRouter.post('/catchup', async (req, res) => {
  try {
    const { sendToDiscord = true, hoursBack = 24 } = req.body;
    
    const messages = knowledgeBase.getRecentMessages(hoursBack);
    
    if (messages.length === 0) {
      return res.json({ 
        success: true, 
        summary: 'No messages found in the specified time period.',
        messageCount: 0 
      });
    }

    const summary = await llmService.summarizeMessages(messages);

    // Get source breakdown
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

    // Send to Discord if configured
    if (sendToDiscord && discordService.isConfigured()) {
      await discordService.sendCatchUpSummary(summary.summary, sources);
    }

    res.json({ 
      success: true, 
      summary: summary.summary,
      keyPoints: summary.keyPoints,
      actionItems: summary.actionItems,
      messageCount: messages.length,
      sources,
      sentToDiscord: sendToDiscord && discordService.isConfigured()
    });
  } catch (error) {
    console.error('Catch-up error:', error);
    res.status(500).json({ error: error.message });
  }
});

// AI-powered Q&A
knowledgeRouter.post('/ask', async (req, res) => {
  try {
    const { question } = req.body;
    
    if (!question) {
      return res.status(400).json({ error: 'Question required' });
    }

    // Get relevant context
    const context = knowledgeBase.getContextForQuestion(question, 20);
    
    if (context.length === 0) {
      return res.json({
        answer: "I don't have any messages stored yet. Please make sure the extension is scanning your Teams and Slack pages.",
        sources: []
      });
    }

    // Build context string
    const contextStr = context.map(m => {
      const time = new Date(m.timestamp).toLocaleString();
      return `[${m.source}/${m.channelName}] ${m.sender} (${time}): ${m.text}`;
    }).join('\n\n');

    // Ask LLM
    const answer = await llmService.answerQuestion(question, contextStr);

    res.json({
      answer,
      sources: context.slice(0, 5).map(m => ({
        sender: m.sender,
        channel: m.channelName,
        source: m.source,
        timestamp: m.timestamp,
        preview: m.text?.substring(0, 100)
      }))
    });
  } catch (error) {
    console.error('Q&A error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Clear old messages
knowledgeRouter.delete('/cleanup', (req, res) => {
  try {
    const daysToKeep = parseInt(req.query.days) || 30;
    const result = knowledgeBase.clearOldMessages(daysToKeep);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Clear all messages
knowledgeRouter.delete('/all', (req, res) => {
  try {
    const result = knowledgeBase.clearAll();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
