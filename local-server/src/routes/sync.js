import express from 'express';
import { configStore } from '../config/store.js';

export const syncRouter = express.Router();

const syncState = {
  isRunning: false,
  lastSyncTime: null,
  lastSyncResult: null,
  filesProcessed: 0,
  filesDownloaded: 0,
  errors: []
};

syncRouter.get('/status', (req, res) => {
  res.json({
    ...syncState,
    config: {
      intervalMinutes: configStore.get('sync.intervalMinutes'),
      teamsEnabled: configStore.get('sync.teamsEnabled'),
      slackEnabled: configStore.get('sync.slackEnabled')
    }
  });
});

syncRouter.post('/start', async (req, res) => {
  if (syncState.isRunning) {
    return res.status(409).json({ error: 'Sync already in progress' });
  }

  syncState.isRunning = true;
  syncState.errors = [];
  
  res.json({ success: true, message: 'Sync started' });
});

syncRouter.post('/stop', (req, res) => {
  syncState.isRunning = false;
  res.json({ success: true, message: 'Sync stopped' });
});

syncRouter.post('/complete', (req, res) => {
  const { filesProcessed, filesDownloaded, errors } = req.body;
  
  syncState.isRunning = false;
  syncState.lastSyncTime = new Date().toISOString();
  syncState.lastSyncResult = 'success';
  syncState.filesProcessed = filesProcessed || 0;
  syncState.filesDownloaded = filesDownloaded || 0;
  syncState.errors = errors || [];

  configStore.set('sync.lastSyncTime', syncState.lastSyncTime);

  res.json({ success: true, status: syncState });
});

syncRouter.get('/history', (req, res) => {
  res.json({
    lastSyncTime: syncState.lastSyncTime,
    lastSyncResult: syncState.lastSyncResult,
    filesProcessed: syncState.filesProcessed,
    filesDownloaded: syncState.filesDownloaded
  });
});
