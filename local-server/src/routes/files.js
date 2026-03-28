import express from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { configStore } from '../config/store.js';
import { fileOrganizer } from '../services/file-organizer.js';

export const filesRouter = express.Router();

const downloadHistory = [];
const fileHashes = new Set();

filesRouter.post('/process', async (req, res) => {
  try {
    const { files, source } = req.body;
    
    if (!files || !Array.isArray(files)) {
      return res.status(400).json({ error: 'Files array is required' });
    }

    const results = [];
    
    for (const file of files) {
      try {
        const result = await fileOrganizer.processFile(file, source);
        results.push(result);
      } catch (error) {
        results.push({
          file: file.name,
          success: false,
          error: error.message
        });
      }
    }

    res.json({ 
      success: true, 
      processed: results.length,
      results 
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

filesRouter.post('/download', async (req, res) => {
  try {
    const { url, fileName, targetPath, authToken, source } = req.body;
    
    if (!url || !fileName) {
      return res.status(400).json({ error: 'URL and fileName are required' });
    }

    const config = configStore.getConfig();
    const baseDir = config.storage.baseDirectory;
    
    if (!fs.existsSync(baseDir)) {
      fs.mkdirSync(baseDir, { recursive: true });
    }

    const finalPath = targetPath 
      ? path.join(baseDir, targetPath)
      : baseDir;
    
    if (!fs.existsSync(finalPath)) {
      fs.mkdirSync(finalPath, { recursive: true });
    }

    const filePath = path.join(finalPath, fileName);

    const headers = {};
    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }

    const response = await fetch(url, { headers });
    
    if (!response.ok) {
      throw new Error(`Failed to download: ${response.status}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    
    const hash = crypto.createHash('md5').update(buffer).digest('hex');
    if (fileHashes.has(hash)) {
      return res.json({ 
        success: true, 
        skipped: true, 
        reason: 'Duplicate file',
        hash 
      });
    }

    fs.writeFileSync(filePath, buffer);
    fileHashes.add(hash);

    const historyEntry = {
      id: crypto.randomUUID(),
      fileName,
      filePath,
      source,
      downloadedAt: new Date().toISOString(),
      size: buffer.length,
      hash
    };
    downloadHistory.unshift(historyEntry);
    if (downloadHistory.length > 100) {
      downloadHistory.pop();
    }

    res.json({ 
      success: true, 
      filePath,
      size: buffer.length,
      hash
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

filesRouter.get('/history', (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  res.json(downloadHistory.slice(0, limit));
});

filesRouter.get('/stats', (req, res) => {
  const totalDownloaded = downloadHistory.length;
  const totalSize = downloadHistory.reduce((sum, f) => sum + (f.size || 0), 0);
  
  const bySource = downloadHistory.reduce((acc, f) => {
    acc[f.source] = (acc[f.source] || 0) + 1;
    return acc;
  }, {});

  res.json({
    totalDownloaded,
    totalSize,
    totalSizeMB: (totalSize / (1024 * 1024)).toFixed(2),
    bySource,
    uniqueFiles: fileHashes.size
  });
});

filesRouter.delete('/history', (req, res) => {
  downloadHistory.length = 0;
  res.json({ success: true });
});

filesRouter.post('/check-duplicate', (req, res) => {
  const { hash } = req.body;
  res.json({ isDuplicate: fileHashes.has(hash) });
});
