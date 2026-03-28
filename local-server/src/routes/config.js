import express from 'express';
import { configStore } from '../config/store.js';

export const configRouter = express.Router();

configRouter.get('/', (req, res) => {
  const config = configStore.getConfig();
  const safeConfig = {
    ...config,
    llm: {
      ...config.llm,
      apiKey: config.llm.apiKey ? '***' : ''
    },
    slack: {
      ...config.slack,
      clientSecret: config.slack.clientSecret ? '***' : '',
      botToken: config.slack.botToken ? '***' : ''
    }
  };
  res.json(safeConfig);
});

configRouter.put('/', (req, res) => {
  try {
    const updates = req.body;
    const newConfig = configStore.updateConfig(updates);
    res.json({ success: true, config: newConfig });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

configRouter.get('/:section', (req, res) => {
  const { section } = req.params;
  const value = configStore.get(section);
  if (value === undefined) {
    res.status(404).json({ error: 'Config section not found' });
  } else {
    res.json(value);
  }
});

configRouter.put('/:section', (req, res) => {
  try {
    const { section } = req.params;
    configStore.set(section, req.body);
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});
