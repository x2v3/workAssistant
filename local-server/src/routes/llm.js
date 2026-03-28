import express from 'express';
import { llmService } from '../services/llm/index.js';

export const llmRouter = express.Router();

llmRouter.post('/relevance', async (req, res) => {
  try {
    const { file, messageContext } = req.body;
    
    if (!file) {
      return res.status(400).json({ error: 'File information is required' });
    }

    const result = await llmService.checkRelevance(file, messageContext);
    res.json(result);
  } catch (error) {
    console.error('LLM relevance check error:', error);
    res.status(500).json({ error: error.message });
  }
});

llmRouter.post('/organize', async (req, res) => {
  try {
    const { file, messageContext } = req.body;
    
    if (!file) {
      return res.status(400).json({ error: 'File information is required' });
    }

    const result = await llmService.suggestOrganization(file, messageContext);
    res.json(result);
  } catch (error) {
    console.error('LLM organization suggestion error:', error);
    res.status(500).json({ error: error.message });
  }
});

llmRouter.post('/analyze', async (req, res) => {
  try {
    const { files, context } = req.body;
    
    if (!files || !Array.isArray(files)) {
      return res.status(400).json({ error: 'Files array is required' });
    }

    const results = await llmService.analyzeFiles(files, context);
    res.json(results);
  } catch (error) {
    console.error('LLM analysis error:', error);
    res.status(500).json({ error: error.message });
  }
});

llmRouter.get('/status', async (req, res) => {
  try {
    const status = await llmService.getStatus();
    res.json(status);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

llmRouter.post('/test', async (req, res) => {
  try {
    const result = await llmService.testConnection();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message, connected: false });
  }
});

llmRouter.get('/models', async (req, res) => {
  try {
    const models = await llmService.listModels();
    res.json(models);
  } catch (error) {
    const popularModels = llmService.getPopularModels();
    res.json(popularModels);
  }
});

llmRouter.get('/models/popular', (req, res) => {
  const models = llmService.getPopularModels();
  res.json(models);
});
