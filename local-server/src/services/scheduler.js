import { configStore } from '../config/store.js';
import { knowledgeBase } from './knowledge-base.js';
import { llmService } from './llm/index.js';
import { discordService } from './discord.js';

class Scheduler {
  constructor() {
    this.timers = new Map();
    this.lastDailySummary = null;
  }

  start() {
    // Check for daily summary every hour
    this.timers.set('dailySummary', setInterval(() => {
      this.checkDailySummary();
    }, 60 * 60 * 1000));

    // Initial check
    setTimeout(() => this.checkDailySummary(), 10000);

    // Cleanup old messages weekly
    this.timers.set('cleanup', setInterval(() => {
      this.cleanupOldMessages();
    }, 7 * 24 * 60 * 60 * 1000));

    console.log('📅 Scheduler started');
  }

  stop() {
    for (const timer of this.timers.values()) {
      clearInterval(timer);
    }
    this.timers.clear();
    console.log('Scheduler stopped');
  }

  async checkDailySummary() {
    const config = configStore.get('discord');
    
    if (!config?.autoSummary || !config?.webhookUrl) {
      return;
    }

    const now = new Date();
    const targetHour = config.autoSummaryHour || 9;

    // Check if we're at the target hour and haven't sent today
    if (now.getHours() === targetHour) {
      const today = now.toDateString();
      
      if (this.lastDailySummary === today) {
        return;
      }

      this.lastDailySummary = today;
      await this.sendDailySummary();
    }
  }

  async sendDailySummary() {
    try {
      console.log('📬 Generating daily summary...');
      
      const messages = knowledgeBase.getRecentMessages(24);
      
      if (messages.length === 0) {
        console.log('No messages for daily summary');
        return;
      }

      const summary = await llmService.summarizeMessages(messages);

      // Get source breakdown
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

      const sources = [...channelMap.values()];

      await discordService.sendCatchUpSummary(summary.summary, sources);
      console.log('✅ Daily summary sent to Discord');

    } catch (error) {
      console.error('Failed to send daily summary:', error);
    }
  }

  cleanupOldMessages() {
    try {
      const result = knowledgeBase.clearOldMessages(30);
      if (result.removed > 0) {
        console.log(`🧹 Cleaned up ${result.removed} old messages`);
      }
    } catch (error) {
      console.error('Cleanup failed:', error);
    }
  }

  // Manual trigger for daily summary
  async triggerDailySummary() {
    return this.sendDailySummary();
  }
}

export const scheduler = new Scheduler();
