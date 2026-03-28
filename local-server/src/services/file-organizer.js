import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { configStore } from '../config/store.js';
import { llmService } from './llm/index.js';

class FileOrganizer {
  constructor() {
    this.downloadedHashes = new Set();
    this.loadHashHistory();
  }

  loadHashHistory() {
    try {
      const config = configStore.get('storage');
      const historyPath = path.join(config?.baseDirectory || '.', '.file-history.json');
      
      if (fs.existsSync(historyPath)) {
        const data = JSON.parse(fs.readFileSync(historyPath, 'utf-8'));
        this.downloadedHashes = new Set(data.hashes || []);
      }
    } catch (e) {
      console.warn('Could not load hash history:', e.message);
    }
  }

  saveHashHistory() {
    try {
      const config = configStore.get('storage');
      const historyPath = path.join(config?.baseDirectory || '.', '.file-history.json');
      
      fs.writeFileSync(historyPath, JSON.stringify({
        hashes: Array.from(this.downloadedHashes),
        lastUpdated: new Date().toISOString()
      }, null, 2));
    } catch (e) {
      console.warn('Could not save hash history:', e.message);
    }
  }

  async processFile(file, source) {
    const relevance = await llmService.checkRelevance(file, file.messageContent);
    
    if (!relevance.relevant) {
      return {
        file: file.name,
        success: true,
        skipped: true,
        reason: relevance.reason || 'Not relevant',
        confidence: relevance.confidence
      };
    }

    if (!this.matchesFilters(file)) {
      return {
        file: file.name,
        success: true,
        skipped: true,
        reason: 'Does not match file type or size filters'
      };
    }

    const organization = await llmService.suggestOrganization(file, file.messageContent);

    const result = await this.downloadAndSave(file, organization);
    
    return {
      file: file.name,
      ...result,
      relevance,
      organization
    };
  }

  matchesFilters(file) {
    const filters = configStore.get('filters');
    
    if (filters?.fileTypes && filters.fileTypes.length > 0) {
      const ext = path.extname(file.name || '').toLowerCase();
      if (!filters.fileTypes.includes(ext)) {
        return false;
      }
    }

    if (filters?.maxFileSizeMB && file.size) {
      const sizeMB = file.size / (1024 * 1024);
      if (sizeMB > filters.maxFileSizeMB) {
        return false;
      }
    }

    return true;
  }

  async downloadAndSave(file, organization) {
    const config = configStore.get('storage');
    const baseDir = config?.baseDirectory || 'D:/Downloads/WorkFiles';

    if (!fs.existsSync(baseDir)) {
      fs.mkdirSync(baseDir, { recursive: true });
    }

    const targetDir = path.join(baseDir, organization.folderPath || '');
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    let content;
    try {
      content = await this.fetchFileContent(file);
    } catch (error) {
      return {
        success: false,
        error: `Download failed: ${error.message}`
      };
    }

    const buffer = Buffer.from(content);
    const hash = crypto.createHash('md5').update(buffer).digest('hex');

    if (this.downloadedHashes.has(hash)) {
      return {
        success: true,
        skipped: true,
        reason: 'Duplicate file (already downloaded)',
        hash
      };
    }

    const fileName = organization.fileName || file.name;
    let filePath = path.join(targetDir, fileName);

    if (fs.existsSync(filePath)) {
      const ext = path.extname(fileName);
      const baseName = path.basename(fileName, ext);
      const timestamp = Date.now();
      filePath = path.join(targetDir, `${baseName}_${timestamp}${ext}`);
    }

    fs.writeFileSync(filePath, buffer);

    this.downloadedHashes.add(hash);
    this.saveHashHistory();

    return {
      success: true,
      filePath,
      size: buffer.length,
      hash
    };
  }

  async fetchFileContent(file) {
    const url = file.downloadUrl || file.contentUrl;
    
    if (!url) {
      throw new Error('No download URL available');
    }

    const headers = {};
    
    if (file.authToken) {
      headers['Authorization'] = `Bearer ${file.authToken}`;
    }

    const response = await fetch(url, { headers });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return response.arrayBuffer();
  }

  async organizeExistingFile(filePath, context = '') {
    const fileName = path.basename(filePath);
    const stats = fs.statSync(filePath);
    
    const file = {
      name: fileName,
      size: stats.size,
      source: 'local',
      messageContent: context
    };

    const organization = await llmService.suggestOrganization(file, context);
    
    const config = configStore.get('storage');
    const baseDir = config?.baseDirectory || 'D:/Downloads/WorkFiles';
    const targetDir = path.join(baseDir, organization.folderPath || '');
    
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const newPath = path.join(targetDir, organization.fileName || fileName);
    
    if (filePath !== newPath) {
      fs.copyFileSync(filePath, newPath);
    }

    return {
      originalPath: filePath,
      newPath,
      organization
    };
  }

  getStats() {
    const config = configStore.get('storage');
    const baseDir = config?.baseDirectory || 'D:/Downloads/WorkFiles';
    
    let totalFiles = 0;
    let totalSize = 0;
    const folderCounts = {};

    const countFiles = (dir, depth = 0) => {
      if (!fs.existsSync(dir) || depth > 5) return;
      
      const items = fs.readdirSync(dir);
      for (const item of items) {
        const fullPath = path.join(dir, item);
        const stat = fs.statSync(fullPath);
        
        if (stat.isDirectory()) {
          countFiles(fullPath, depth + 1);
        } else if (!item.startsWith('.')) {
          totalFiles++;
          totalSize += stat.size;
          
          const relDir = path.relative(baseDir, dir);
          const topFolder = relDir.split(path.sep)[0] || 'root';
          folderCounts[topFolder] = (folderCounts[topFolder] || 0) + 1;
        }
      }
    };

    countFiles(baseDir);

    return {
      totalFiles,
      totalSize,
      totalSizeMB: (totalSize / (1024 * 1024)).toFixed(2),
      uniqueHashes: this.downloadedHashes.size,
      folderCounts,
      baseDirectory: baseDir
    };
  }

  clearHistory() {
    this.downloadedHashes.clear();
    this.saveHashHistory();
  }
}

export const fileOrganizer = new FileOrganizer();
