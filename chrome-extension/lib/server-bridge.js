const SERVER_URL = 'http://127.0.0.1:3847';

export class ServerBridge {
  constructor() {
    this.serverUrl = SERVER_URL;
  }

  async checkHealth() {
    try {
      const response = await fetch(`${this.serverUrl}/health`);
      return response.ok;
    } catch (error) {
      console.error('Server health check failed:', error);
      return false;
    }
  }

  async getConfig() {
    const response = await fetch(`${this.serverUrl}/api/config`);
    if (!response.ok) throw new Error('Failed to get config');
    return response.json();
  }

  async updateConfig(config) {
    const response = await fetch(`${this.serverUrl}/api/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config)
    });
    if (!response.ok) throw new Error('Failed to update config');
    return response.json();
  }

  async processFiles(files, source) {
    const response = await fetch(`${this.serverUrl}/api/files/process`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files, source })
    });
    if (!response.ok) throw new Error('Failed to process files');
    return response.json();
  }

  async checkRelevance(file, messageContext) {
    const response = await fetch(`${this.serverUrl}/api/llm/relevance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file, messageContext })
    });
    if (!response.ok) throw new Error('Failed to check relevance');
    return response.json();
  }

  async suggestOrganization(file, messageContext) {
    const response = await fetch(`${this.serverUrl}/api/llm/organize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file, messageContext })
    });
    if (!response.ok) throw new Error('Failed to get organization suggestion');
    return response.json();
  }

  async downloadFile(fileInfo) {
    const response = await fetch(`${this.serverUrl}/api/files/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fileInfo)
    });
    if (!response.ok) throw new Error('Failed to download file');
    return response.json();
  }

  async getDownloadHistory() {
    const response = await fetch(`${this.serverUrl}/api/files/history`);
    if (!response.ok) throw new Error('Failed to get download history');
    return response.json();
  }

  async getSyncStatus() {
    const response = await fetch(`${this.serverUrl}/api/sync/status`);
    if (!response.ok) throw new Error('Failed to get sync status');
    return response.json();
  }
}

export const serverBridge = new ServerBridge();
