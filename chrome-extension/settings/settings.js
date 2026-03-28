const SERVER_URL = 'http://127.0.0.1:3847';
let showAllModels = false;
let currentConfig = null;

document.addEventListener('DOMContentLoaded', async () => {
  await loadConfig();
  await loadModels();
  bindEvents();
});

function bindEvents() {
  document.getElementById('saveBtn').addEventListener('click', saveConfig);
  document.getElementById('testLlmBtn').addEventListener('click', testLlm);
  document.getElementById('testDiscordBtn').addEventListener('click', testDiscord);
  document.getElementById('refreshModelsBtn').addEventListener('click', () => loadModels(showAllModels));
  document.getElementById('showAllModelsLink').addEventListener('click', (e) => {
    e.preventDefault();
    showAllModels = !showAllModels;
    e.target.textContent = showAllModels ? 'Show popular models' : 'Show all models';
    loadModels(showAllModels);
  });
  document.getElementById('openDashboardBtn').addEventListener('click', () => {
    chrome.tabs.create({ url: SERVER_URL });
  });
}

async function loadModels(fetchAll = false) {
  const select = document.getElementById('model');
  const currentValue = select.value || currentConfig?.llm?.model || 'openai/gpt-4o-mini';
  select.innerHTML = '<option value="">Loading...</option>';

  try {
    const endpoint = fetchAll ? '/api/llm/models' : '/api/llm/models/popular';
    const res = await fetch(`${SERVER_URL}${endpoint}`);
    const models = await res.json();

    // Group by provider
    const grouped = {};
    for (const model of models) {
      const provider = model.provider || model.id.split('/')[0] || 'Other';
      if (!grouped[provider]) grouped[provider] = [];
      grouped[provider].push(model);
    }

    // Build select options
    let html = '';
    for (const [provider, providerModels] of Object.entries(grouped)) {
      html += `<optgroup label="${provider}">`;
      for (const model of providerModels) {
        const name = model.name || model.id;
        const selected = model.id === currentValue ? 'selected' : '';
        html += `<option value="${model.id}" ${selected}>${name}</option>`;
      }
      html += '</optgroup>';
    }
    select.innerHTML = html;
    if (currentValue) select.value = currentValue;

  } catch (e) {
    select.innerHTML = `
      <option value="openai/gpt-4o-mini">GPT-4o Mini</option>
      <option value="openai/gpt-4o">GPT-4o</option>
      <option value="anthropic/claude-3.5-sonnet">Claude 3.5 Sonnet</option>
    `;
    if (currentValue) select.value = currentValue;
  }
}

async function loadConfig() {
  try {
    const response = await fetch(`${SERVER_URL}/api/config`);
    currentConfig = await response.json();
    populateForm(currentConfig);
  } catch (error) {
    showAlert('saveAlert', 'Could not load config. Is the server running?', 'error');
  }
}

function populateForm(config) {
  // Model is set by loadModels()
  
  // Discord
  document.getElementById('discordWebhook').value = config.discord?.webhookUrl || '';
  document.getElementById('discordBotToken').value = config.discord?.botToken || '';
  document.getElementById('botPrefix').value = config.discord?.botPrefix || '!ask';
  document.getElementById('notifyFiles').checked = config.discord?.notifyOnFiles !== false;
  document.getElementById('notifyCatchUp').checked = config.discord?.notifyOnCatchUp !== false;
  document.getElementById('autoSummary').checked = config.discord?.autoSummary === true;
  
  // Storage
  document.getElementById('baseDir').value = config.storage?.baseDirectory || '';
  
  // Sync
  document.getElementById('syncInterval').value = config.sync?.intervalMinutes?.toString() || '15';
  document.getElementById('teamsEnabled').checked = config.sync?.teamsEnabled !== false;
  document.getElementById('slackEnabled').checked = config.sync?.slackEnabled !== false;
  
  // Tabs
  document.getElementById('autoOpenTabs').checked = config.tabs?.autoOpen !== false;
  document.getElementById('teamsUrl').value = config.tabs?.teamsUrl || 'https://teams.microsoft.com';
  document.getElementById('slackUrl').value = config.tabs?.slackUrl || 'https://app.slack.com';
  
  // Filters
  document.getElementById('fileTypes').value = (config.filters?.fileTypes || []).join(', ');
  document.getElementById('maxSize').value = config.filters?.maxFileSizeMB || 100;
}

async function saveConfig() {
  const btn = document.getElementById('saveBtn');
  btn.disabled = true;
  btn.textContent = 'Saving...';

  const config = {
    llm: {
      provider: 'openrouter',
      model: document.getElementById('model').value
    },
    discord: {
      webhookUrl: document.getElementById('discordWebhook').value,
      botToken: document.getElementById('discordBotToken').value,
      botPrefix: document.getElementById('botPrefix').value,
      notifyOnFiles: document.getElementById('notifyFiles').checked,
      notifyOnCatchUp: document.getElementById('notifyCatchUp').checked,
      autoSummary: document.getElementById('autoSummary').checked
    },
    storage: {
      baseDirectory: document.getElementById('baseDir').value
    },
    sync: {
      intervalMinutes: parseInt(document.getElementById('syncInterval').value) || 15,
      teamsEnabled: document.getElementById('teamsEnabled').checked,
      slackEnabled: document.getElementById('slackEnabled').checked
    },
    tabs: {
      autoOpen: document.getElementById('autoOpenTabs').checked,
      teamsUrl: document.getElementById('teamsUrl').value || 'https://teams.microsoft.com',
      slackUrl: document.getElementById('slackUrl').value || 'https://app.slack.com'
    },
    filters: {
      fileTypes: document.getElementById('fileTypes').value.split(',').map(t => t.trim()).filter(t => t),
      maxFileSizeMB: parseInt(document.getElementById('maxSize').value) || 100
    }
  };

  // Include API key only if provided
  const apiKey = document.getElementById('apiKey').value;
  if (apiKey) {
    config.llm.apiKey = apiKey;
  }

  try {
    const response = await fetch(`${SERVER_URL}/api/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config)
    });

    if (response.ok) {
      showAlert('saveAlert', 'Settings saved! Restart server for Discord bot changes.', 'success');
      
      // Notify background script
      chrome.runtime.sendMessage({ type: 'CONFIG_UPDATED', config });
    } else {
      throw new Error('Failed to save');
    }
  } catch (error) {
    showAlert('saveAlert', 'Error: ' + error.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '💾 Save Settings';
  }
}

async function testLlm() {
  const btn = document.getElementById('testLlmBtn');
  const alert = document.getElementById('llmAlert');
  
  btn.disabled = true;
  btn.textContent = 'Testing...';

  // Save first
  await saveConfig();

  try {
    const response = await fetch(`${SERVER_URL}/api/llm/test`, { method: 'POST' });
    const data = await response.json();
    
    if (data.connected) {
      showAlert('llmAlert', `✓ Connected to ${data.model}`, 'success');
    } else {
      showAlert('llmAlert', `✗ ${data.error || 'Connection failed'}`, 'error');
    }
  } catch (error) {
    showAlert('llmAlert', `✗ ${error.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Test Connection';
  }
}

async function testDiscord() {
  const btn = document.getElementById('testDiscordBtn');
  
  btn.disabled = true;
  btn.textContent = 'Testing...';

  // Save first
  await saveConfig();

  try {
    const response = await fetch(`${SERVER_URL}/api/discord/test`, { method: 'POST' });
    const data = await response.json();
    
    if (data.success) {
      showAlert('discordAlert', '✓ Test message sent to Discord!', 'success');
    } else {
      showAlert('discordAlert', `✗ ${data.error || 'Test failed'}`, 'error');
    }
  } catch (error) {
    showAlert('discordAlert', `✗ ${error.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Test Webhook';
  }
}

function showAlert(id, message, type) {
  const alert = document.getElementById(id);
  alert.textContent = message;
  alert.className = 'alert ' + type;
  alert.style.display = 'block';
  
  if (type === 'success') {
    setTimeout(() => { alert.style.display = 'none'; }, 5000);
  }
}
