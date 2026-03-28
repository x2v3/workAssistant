import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { configStore } from '../config/store.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = path.join(__dirname, '../../data/knowledge.json');

class KnowledgeBase {
  constructor() {
    this.messages = [];
    this.loadDatabase();
  }

  loadDatabase() {
    try {
      const dir = path.dirname(DB_PATH);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      if (fs.existsSync(DB_PATH)) {
        const data = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
        this.messages = data.messages || [];
        console.log(`Loaded ${this.messages.length} messages from knowledge base`);
      }
    } catch (error) {
      console.error('Error loading knowledge base:', error);
      this.messages = [];
    }
  }

  saveDatabase() {
    try {
      const dir = path.dirname(DB_PATH);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(DB_PATH, JSON.stringify({
        messages: this.messages,
        lastUpdated: new Date().toISOString()
      }, null, 2));
    } catch (error) {
      console.error('Error saving knowledge base:', error);
    }
  }

  addMessages(messages, source, channelName) {
    let newCount = 0;
    
    for (const msg of messages) {
      const exists = this.messages.some(m => m.id === msg.id);
      if (!exists) {
        this.messages.push({
          ...msg,
          source: source || msg.source,
          channelName: channelName || msg.channelName,
          storedAt: new Date().toISOString()
        });
        newCount++;
      }
    }

    if (newCount > 0) {
      // Keep only last 10000 messages to prevent unbounded growth
      if (this.messages.length > 10000) {
        this.messages = this.messages.slice(-10000);
      }
      this.saveDatabase();
    }

    return { added: newCount, total: this.messages.length };
  }

  getMessages(options = {}) {
    let result = [...this.messages];

    // Filter by source
    if (options.source) {
      result = result.filter(m => m.source === options.source);
    }

    // Filter by channel
    if (options.channelName) {
      result = result.filter(m => 
        m.channelName?.toLowerCase().includes(options.channelName.toLowerCase())
      );
    }

    // Filter by time range
    if (options.since) {
      const sinceDate = new Date(options.since);
      result = result.filter(m => new Date(m.timestamp) >= sinceDate);
    }

    if (options.until) {
      const untilDate = new Date(options.until);
      result = result.filter(m => new Date(m.timestamp) <= untilDate);
    }

    // Filter by sender
    if (options.sender) {
      result = result.filter(m => 
        m.sender?.toLowerCase().includes(options.sender.toLowerCase())
      );
    }

    // Sort by timestamp (newest first by default)
    result.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    // Limit results
    if (options.limit) {
      result = result.slice(0, options.limit);
    }

    return result;
  }

  search(query, options = {}) {
    const queryLower = query.toLowerCase();
    const queryTerms = queryLower.split(/\s+/).filter(t => t.length > 2);
    
    let results = this.messages.map(msg => {
      const textLower = msg.text?.toLowerCase() || '';
      const senderLower = msg.sender?.toLowerCase() || '';
      const channelLower = msg.channelName?.toLowerCase() || '';
      
      // Calculate relevance score
      let score = 0;
      
      // Exact phrase match
      if (textLower.includes(queryLower)) {
        score += 10;
      }
      
      // Individual term matches
      for (const term of queryTerms) {
        if (textLower.includes(term)) score += 3;
        if (senderLower.includes(term)) score += 2;
        if (channelLower.includes(term)) score += 1;
      }
      
      return { ...msg, score };
    });

    // Filter out zero scores
    results = results.filter(r => r.score > 0);

    // Sort by score, then by recency
    results.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return new Date(b.timestamp) - new Date(a.timestamp);
    });

    // Apply filters
    if (options.source) {
      results = results.filter(m => m.source === options.source);
    }

    if (options.since) {
      const sinceDate = new Date(options.since);
      results = results.filter(m => new Date(m.timestamp) >= sinceDate);
    }

    // Limit results
    const limit = options.limit || 20;
    results = results.slice(0, limit);

    return results;
  }

  getRecentMessages(hoursBack = 24) {
    const since = new Date(Date.now() - hoursBack * 60 * 60 * 1000);
    return this.getMessages({ since: since.toISOString() });
  }

  getStats() {
    const now = new Date();
    const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000);
    const oneWeekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);

    const channelCounts = {};
    const sourceCounts = { teams: 0, slack: 0 };
    let messagesLast24h = 0;
    let messagesLastWeek = 0;

    for (const msg of this.messages) {
      // Count by channel
      const channel = msg.channelName || 'Unknown';
      channelCounts[channel] = (channelCounts[channel] || 0) + 1;

      // Count by source
      if (msg.source) {
        sourceCounts[msg.source] = (sourceCounts[msg.source] || 0) + 1;
      }

      // Count by time
      const msgDate = new Date(msg.timestamp);
      if (msgDate >= oneDayAgo) messagesLast24h++;
      if (msgDate >= oneWeekAgo) messagesLastWeek++;
    }

    // Get top channels
    const topChannels = Object.entries(channelCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, count]) => ({ name, count }));

    return {
      totalMessages: this.messages.length,
      messagesLast24h,
      messagesLastWeek,
      sourceCounts,
      topChannels,
      oldestMessage: this.messages.length > 0 
        ? this.messages.reduce((oldest, m) => 
            new Date(m.timestamp) < new Date(oldest.timestamp) ? m : oldest
          ).timestamp
        : null,
      newestMessage: this.messages.length > 0
        ? this.messages.reduce((newest, m) => 
            new Date(m.timestamp) > new Date(newest.timestamp) ? m : newest
          ).timestamp
        : null
    };
  }

  getContextForQuestion(question, limit = 15) {
    // Search for relevant messages
    const relevant = this.search(question, { limit });
    
    // Also get recent messages for context
    const recent = this.getRecentMessages(48).slice(0, 10);
    
    // Combine and dedupe
    const combined = [...relevant];
    for (const msg of recent) {
      if (!combined.some(m => m.id === msg.id)) {
        combined.push(msg);
      }
    }
    
    // Sort by timestamp for coherent context
    combined.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    
    return combined.slice(0, limit);
  }

  clearOldMessages(daysToKeep = 30) {
    const cutoff = new Date(Date.now() - daysToKeep * 24 * 60 * 60 * 1000);
    const before = this.messages.length;
    
    this.messages = this.messages.filter(m => new Date(m.timestamp) >= cutoff);
    
    const removed = before - this.messages.length;
    if (removed > 0) {
      this.saveDatabase();
    }
    
    return { removed, remaining: this.messages.length };
  }

  clearAll() {
    this.messages = [];
    this.saveDatabase();
    return { success: true };
  }
}

export const knowledgeBase = new KnowledgeBase();
