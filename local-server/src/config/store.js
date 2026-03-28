import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CONFIG_PATH = path.join(__dirname, '../../config.json');

const DEFAULT_CONFIG = {
  llm: {
    provider: 'openai',
    apiKey: '',
    model: 'gpt-4',
    ollamaHost: 'http://localhost:11434'
  },
  storage: {
    baseDirectory: 'D:/Downloads/WorkFiles',
    organizationRules: 'auto'
  },
  sync: {
    intervalMinutes: 15,
    teamsEnabled: true,
    slackEnabled: true,
    lastSyncTime: null
  },
  filters: {
    fileTypes: ['.pdf', '.docx', '.xlsx', '.pptx', '.zip', '.png', '.jpg', '.jpeg', '.gif', '.txt', '.csv'],
    maxFileSizeMB: 100
  },
  server: {
    port: 3847,
    host: '127.0.0.1'
  },
  teams: {
    clientId: '',
    tenantId: 'common'
  },
  slack: {
    clientId: '',
    clientSecret: '',
    botToken: ''
  }
};

class ConfigStore {
  constructor() {
    this.config = this.loadConfig();
  }

  loadConfig() {
    try {
      if (fs.existsSync(CONFIG_PATH)) {
        const data = fs.readFileSync(CONFIG_PATH, 'utf-8');
        const loaded = JSON.parse(data);
        return this.mergeWithDefaults(loaded);
      }
    } catch (error) {
      console.error('Error loading config:', error);
    }
    return { ...DEFAULT_CONFIG };
  }

  mergeWithDefaults(loaded) {
    const merged = { ...DEFAULT_CONFIG };
    for (const key of Object.keys(loaded)) {
      if (typeof loaded[key] === 'object' && !Array.isArray(loaded[key])) {
        merged[key] = { ...DEFAULT_CONFIG[key], ...loaded[key] };
      } else {
        merged[key] = loaded[key];
      }
    }
    return merged;
  }

  saveConfig() {
    try {
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(this.config, null, 2));
      return true;
    } catch (error) {
      console.error('Error saving config:', error);
      return false;
    }
  }

  getConfig() {
    return { ...this.config };
  }

  updateConfig(updates) {
    for (const key of Object.keys(updates)) {
      if (typeof updates[key] === 'object' && !Array.isArray(updates[key])) {
        this.config[key] = { ...this.config[key], ...updates[key] };
      } else {
        this.config[key] = updates[key];
      }
    }
    this.saveConfig();
    return this.getConfig();
  }

  get(path) {
    const parts = path.split('.');
    let value = this.config;
    for (const part of parts) {
      if (value === undefined) return undefined;
      value = value[part];
    }
    return value;
  }

  set(path, value) {
    const parts = path.split('.');
    let obj = this.config;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!obj[parts[i]]) obj[parts[i]] = {};
      obj = obj[parts[i]];
    }
    obj[parts[parts.length - 1]] = value;
    this.saveConfig();
  }
}

export const configStore = new ConfigStore();
