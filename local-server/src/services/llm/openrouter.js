import { configStore } from '../../config/store.js';

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1';

export const POPULAR_MODELS = [
  { id: 'openai/gpt-4o', name: 'GPT-4o', provider: 'OpenAI' },
  { id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini', provider: 'OpenAI' },
  { id: 'openai/gpt-4-turbo', name: 'GPT-4 Turbo', provider: 'OpenAI' },
  { id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet', provider: 'Anthropic' },
  { id: 'anthropic/claude-3-opus', name: 'Claude 3 Opus', provider: 'Anthropic' },
  { id: 'anthropic/claude-3-haiku', name: 'Claude 3 Haiku', provider: 'Anthropic' },
  { id: 'google/gemini-pro-1.5', name: 'Gemini Pro 1.5', provider: 'Google' },
  { id: 'google/gemini-flash-1.5', name: 'Gemini Flash 1.5', provider: 'Google' },
  { id: 'meta-llama/llama-3.1-70b-instruct', name: 'Llama 3.1 70B', provider: 'Meta' },
  { id: 'meta-llama/llama-3.1-8b-instruct', name: 'Llama 3.1 8B', provider: 'Meta' },
  { id: 'mistralai/mistral-large', name: 'Mistral Large', provider: 'Mistral' },
  { id: 'mistralai/mixtral-8x7b-instruct', name: 'Mixtral 8x7B', provider: 'Mistral' },
  { id: 'deepseek/deepseek-chat', name: 'DeepSeek Chat', provider: 'DeepSeek' },
  { id: 'qwen/qwen-2-72b-instruct', name: 'Qwen 2 72B', provider: 'Qwen' }
];

export class OpenRouterAdapter {
  constructor() {
    this.apiKey = null;
  }

  getApiKey() {
    const config = configStore.get('llm');
    if (!config?.apiKey) {
      throw new Error('OpenRouter API key not configured');
    }
    return config.apiKey;
  }

  isConfigured() {
    const config = configStore.get('llm');
    return !!(config?.apiKey);
  }

  async complete(prompt, options = {}) {
    const apiKey = this.getApiKey();
    const config = configStore.get('llm');
    const model = options.model || config?.model || 'openai/gpt-4o-mini';

    const response = await fetch(`${OPENROUTER_API_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'http://localhost:3847',
        'X-Title': 'Teams Slack File Assistant'
      },
      body: JSON.stringify({
        model: model,
        messages: [
          {
            role: 'system',
            content: 'You are a helpful assistant that analyzes files and helps organize them. Always respond with valid JSON when requested.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.3,
        max_tokens: 500
      })
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error?.message || `OpenRouter API error: ${response.status}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || '';
  }

  async testConnection() {
    const apiKey = this.getApiKey();
    const config = configStore.get('llm');
    const model = config?.model || 'openai/gpt-4o-mini';

    const response = await fetch(`${OPENROUTER_API_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'http://localhost:3847',
        'X-Title': 'Teams Slack File Assistant'
      },
      body: JSON.stringify({
        model: model,
        messages: [{ role: 'user', content: 'Say "connected" in one word.' }],
        max_tokens: 10
      })
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error?.message || 'Connection failed');
    }

    const data = await response.json();
    
    return {
      connected: true,
      provider: 'openrouter',
      model: model,
      message: data.choices?.[0]?.message?.content
    };
  }

  async listModels() {
    const apiKey = this.getApiKey();

    const response = await fetch(`${OPENROUTER_API_URL}/models`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`
      }
    });

    if (!response.ok) {
      return POPULAR_MODELS;
    }

    const data = await response.json();
    return data.data?.map(m => ({
      id: m.id,
      name: m.name || m.id,
      provider: m.id.split('/')[0],
      contextLength: m.context_length,
      pricing: m.pricing
    })) || POPULAR_MODELS;
  }

  getPopularModels() {
    return POPULAR_MODELS;
  }
}
