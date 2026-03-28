import { configStore } from '../../config/store.js';
import { OpenRouterAdapter, POPULAR_MODELS } from './openrouter.js';

class LLMService {
  constructor() {
    this.adapter = new OpenRouterAdapter();
  }

  async checkRelevance(file, messageContext) {
    const prompt = this.buildRelevancePrompt(file, messageContext);
    const response = await this.adapter.complete(prompt);
    return this.parseRelevanceResponse(response);
  }

  buildRelevancePrompt(file, messageContext) {
    return `You are a file relevance analyzer. Analyze the following file and message context to determine if this file should be downloaded and saved.

FILE INFORMATION:
- Name: ${file.name}
- Type: ${file.mimeType || 'unknown'}
- Size: ${file.size ? `${(file.size / 1024).toFixed(1)} KB` : 'unknown'}
- Source: ${file.source}
- Sender: ${file.sender || 'unknown'}

MESSAGE CONTEXT:
${messageContext || file.messageContent || 'No context available'}

CRITERIA FOR RELEVANCE:
- Work-related documents (reports, presentations, spreadsheets)
- Important shared resources (guides, templates, references)
- Project files and assets
- Meeting notes and agendas
- Files explicitly shared for the user

NOT RELEVANT:
- Random memes or casual images
- Temporary or draft files marked as such
- Duplicate shares of already common files
- Personal photos unless work-related

Respond with ONLY a JSON object in this exact format:
{
  "relevant": true or false,
  "confidence": 0.0 to 1.0,
  "reason": "brief explanation",
  "category": "documents|presentations|spreadsheets|images|archives|other"
}`;
  }

  parseRelevanceResponse(response) {
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch (e) {
      console.error('Failed to parse relevance response:', e);
    }

    const isRelevant = response.toLowerCase().includes('"relevant": true') ||
                       response.toLowerCase().includes('"relevant":true');
    
    return {
      relevant: isRelevant,
      confidence: 0.5,
      reason: 'Could not parse LLM response',
      category: 'other'
    };
  }

  async suggestOrganization(file, messageContext) {
    const prompt = this.buildOrganizationPrompt(file, messageContext);
    const response = await this.adapter.complete(prompt);
    return this.parseOrganizationResponse(response, file);
  }

  buildOrganizationPrompt(file, messageContext) {
    const config = configStore.get('storage');
    
    return `You are a file organization assistant. Suggest the best folder path and filename for organizing this file.

FILE INFORMATION:
- Original Name: ${file.name}
- Type: ${file.mimeType || 'unknown'}
- Source: ${file.source} (Teams or Slack)
- Channel/Chat: ${file.channelName || 'unknown'}
- Sender: ${file.sender || 'unknown'}
- Date: ${file.timestamp || new Date().toISOString()}

MESSAGE CONTEXT:
${messageContext || file.messageContent || 'No context available'}

BASE DIRECTORY: ${config?.baseDirectory || 'Downloads/WorkFiles'}

ORGANIZATION RULES:
- Group related files together
- Use clear, descriptive folder names
- Consider project names, dates, or topics from context
- Keep paths reasonably short (max 3 levels deep)
- Use valid filename characters only

Respond with ONLY a JSON object in this exact format:
{
  "folderPath": "suggested/folder/path",
  "fileName": "suggested-filename.ext",
  "reason": "brief explanation of organization choice"
}`;
  }

  parseOrganizationResponse(response, file) {
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          folderPath: this.sanitizePath(parsed.folderPath || ''),
          fileName: this.sanitizeFileName(parsed.fileName || file.name),
          reason: parsed.reason || ''
        };
      }
    } catch (e) {
      console.error('Failed to parse organization response:', e);
    }

    const date = new Date();
    const monthFolder = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    
    return {
      folderPath: `${file.source}/${monthFolder}`,
      fileName: file.name,
      reason: 'Default organization by source and date'
    };
  }

  sanitizePath(path) {
    return path
      .replace(/[<>:"|?*]/g, '')
      .replace(/\\/g, '/')
      .replace(/\/+/g, '/')
      .replace(/^\/|\/$/g, '');
  }

  sanitizeFileName(name) {
    return name
      .replace(/[<>:"|?*\/\\]/g, '-')
      .replace(/-+/g, '-')
      .substring(0, 200);
  }

  async analyzeFiles(files, context) {
    const results = [];
    
    for (const file of files) {
      const relevance = await this.checkRelevance(file, context);
      
      if (relevance.relevant) {
        const organization = await this.suggestOrganization(file, context);
        results.push({
          file,
          relevance,
          organization,
          shouldDownload: true
        });
      } else {
        results.push({
          file,
          relevance,
          organization: null,
          shouldDownload: false
        });
      }
    }
    
    return results;
  }

  async getStatus() {
    const config = configStore.get('llm');
    
    return {
      provider: 'openrouter',
      model: config?.model || 'openai/gpt-4o-mini',
      configured: this.adapter.isConfigured(),
      ready: await this.adapter.testConnection().then(() => true).catch(() => false)
    };
  }

  async testConnection() {
    return this.adapter.testConnection();
  }

  async listModels() {
    return this.adapter.listModels();
  }

  getPopularModels() {
    return POPULAR_MODELS;
  }

  async summarizeMessages(messages) {
    const prompt = this.buildSummaryPrompt(messages);
    const response = await this.adapter.complete(prompt);
    return this.parseSummaryResponse(response);
  }

  buildSummaryPrompt(messages) {
    const groupedMessages = this.groupMessagesByChannel(messages);
    
    let messageText = '';
    for (const [channel, msgs] of Object.entries(groupedMessages)) {
      messageText += `\n## ${channel}\n`;
      for (const msg of msgs.slice(0, 30)) {
        const time = new Date(msg.timestamp).toLocaleTimeString();
        messageText += `[${time}] ${msg.sender}: ${msg.text}\n`;
      }
    }

    return `You are a helpful assistant that summarizes workplace messages. The user has been away and needs to catch up on what they missed.

MESSAGES TO SUMMARIZE:
${messageText.substring(0, 8000)}

Please provide:
1. A concise summary of the key discussions and updates (2-4 paragraphs)
2. Key points as bullet points (5-10 items)
3. Any action items or things that might need the user's attention

Respond with ONLY a JSON object in this exact format:
{
  "summary": "Your 2-4 paragraph summary here...",
  "keyPoints": ["point 1", "point 2", "point 3"],
  "actionItems": ["action 1", "action 2"]
}`;
  }

  groupMessagesByChannel(messages) {
    const grouped = {};
    for (const msg of messages) {
      const key = `${msg.source === 'teams' ? '💼' : '💬'} ${msg.channelName}`;
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(msg);
    }
    return grouped;
  }

  parseSummaryResponse(response) {
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          summary: parsed.summary || 'Could not generate summary',
          keyPoints: parsed.keyPoints || [],
          actionItems: parsed.actionItems || []
        };
      }
    } catch (e) {
      console.error('Failed to parse summary response:', e);
    }

    return {
      summary: response.substring(0, 2000),
      keyPoints: [],
      actionItems: []
    };
  }

  async answerQuestion(question, context) {
    const prompt = `You are a helpful assistant that answers questions based on workplace messages from Teams and Slack.

CONTEXT (Messages from the user's Teams and Slack):
${context.substring(0, 10000)}

USER'S QUESTION:
${question}

Instructions:
- Answer based ONLY on the context provided above
- If the answer is not in the context, say "I couldn't find information about that in the messages"
- Be specific and cite who said what when relevant
- Keep your answer concise but complete

Answer:`;

    const response = await this.adapter.complete(prompt);
    return response;
  }
}

export const llmService = new LLMService();
