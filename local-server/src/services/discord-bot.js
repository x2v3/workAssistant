import { configStore } from '../config/store.js';
import { knowledgeBase } from './knowledge-base.js';
import { llmService } from './llm/index.js';

let botClient = null;
let isConnected = false;

export async function startDiscordBot() {
  const config = configStore.get('discord');
  
  if (!config?.botToken) {
    console.log('💬 Discord bot not configured (no bot token)');
    return;
  }

  try {
    // Dynamic import discord.js
    const { Client, GatewayIntentBits, Events } = await import('discord.js');
    
    botClient = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages
      ]
    });

    botClient.once(Events.ClientReady, (c) => {
      isConnected = true;
      console.log(`🤖 Discord bot connected as ${c.user.tag}`);
    });

    botClient.on(Events.MessageCreate, async (message) => {
      // Ignore messages from bots
      if (message.author.bot) return;

      // Check if bot is mentioned or message starts with prefix
      const prefix = config.botPrefix || '!ask';
      const isMentioned = message.mentions.has(botClient.user);
      const hasPrefix = message.content.startsWith(prefix);

      if (!isMentioned && !hasPrefix) return;

      // Extract the question
      let question = message.content;
      if (hasPrefix) {
        question = message.content.slice(prefix.length).trim();
      } else if (isMentioned) {
        question = message.content.replace(/<@!?\d+>/g, '').trim();
      }

      if (!question) {
        await message.reply('Please ask a question! Example: `!ask What did Sarah say about the deadline?`');
        return;
      }

      // Show typing indicator
      await message.channel.sendTyping();

      try {
        // Get relevant context from knowledge base
        const context = knowledgeBase.getContextForQuestion(question, 20);
        
        if (context.length === 0) {
          await message.reply({
            embeds: [{
              title: '❓ No Messages Found',
              description: "I don't have any messages stored yet. Make sure the Chrome extension is running and scanning your Teams/Slack pages.",
              color: 0xf59e0b
            }]
          });
          return;
        }

        // Build context string
        const contextStr = context.map(m => {
          const time = new Date(m.timestamp).toLocaleString();
          return `[${m.source}/${m.channelName}] ${m.sender} (${time}): ${m.text}`;
        }).join('\n\n');

        // Get answer from LLM
        const answer = await llmService.answerQuestion(question, contextStr);

        // Format sources
        const sources = context.slice(0, 3).map(m => {
          const icon = m.source === 'teams' ? '💼' : '💬';
          const time = new Date(m.timestamp).toLocaleString();
          return `${icon} **${m.sender}** in *${m.channelName}* (${time})`;
        });

        // Send response
        await message.reply({
          embeds: [{
            title: '📚 Answer from Knowledge Base',
            description: answer.substring(0, 4000),
            fields: [
              {
                name: '📖 Sources',
                value: sources.join('\n') || 'No specific sources',
                inline: false
              }
            ],
            color: 0x3b82f6,
            footer: {
              text: `Based on ${context.length} relevant messages`
            }
          }]
        });

      } catch (error) {
        console.error('Discord bot error:', error);
        await message.reply({
          embeds: [{
            title: '❌ Error',
            description: `Sorry, I encountered an error: ${error.message}`,
            color: 0xef4444
          }]
        });
      }
    });

    // Handle slash commands if registered
    botClient.on(Events.InteractionCreate, async (interaction) => {
      if (!interaction.isChatInputCommand()) return;

      if (interaction.commandName === 'ask') {
        const question = interaction.options.getString('question');
        await handleAskCommand(interaction, question);
      } else if (interaction.commandName === 'catchup') {
        await handleCatchupCommand(interaction);
      } else if (interaction.commandName === 'stats') {
        await handleStatsCommand(interaction);
      }
    });

    await botClient.login(config.botToken);

  } catch (error) {
    console.error('Failed to start Discord bot:', error.message);
    
    if (error.message.includes('Cannot find module')) {
      console.log('💡 Install discord.js: npm install discord.js');
    }
  }
}

async function handleAskCommand(interaction, question) {
  await interaction.deferReply();

  try {
    const context = knowledgeBase.getContextForQuestion(question, 20);
    
    if (context.length === 0) {
      await interaction.editReply({
        embeds: [{
          title: '❓ No Messages Found',
          description: "I don't have any messages stored yet.",
          color: 0xf59e0b
        }]
      });
      return;
    }

    const contextStr = context.map(m => {
      const time = new Date(m.timestamp).toLocaleString();
      return `[${m.source}/${m.channelName}] ${m.sender} (${time}): ${m.text}`;
    }).join('\n\n');

    const answer = await llmService.answerQuestion(question, contextStr);

    await interaction.editReply({
      embeds: [{
        title: '📚 Answer',
        description: answer.substring(0, 4000),
        color: 0x3b82f6,
        footer: { text: `Based on ${context.length} messages` }
      }]
    });

  } catch (error) {
    await interaction.editReply({
      embeds: [{
        title: '❌ Error',
        description: error.message,
        color: 0xef4444
      }]
    });
  }
}

async function handleCatchupCommand(interaction) {
  await interaction.deferReply();

  try {
    const messages = knowledgeBase.getRecentMessages(24);
    
    if (messages.length === 0) {
      await interaction.editReply({
        embeds: [{
          title: '📭 No Recent Messages',
          description: 'No messages found in the last 24 hours.',
          color: 0xf59e0b
        }]
      });
      return;
    }

    const summary = await llmService.summarizeMessages(messages);

    await interaction.editReply({
      embeds: [{
        title: '📬 Catch-Up Summary',
        description: summary.summary.substring(0, 4000),
        fields: [
          {
            name: '🔑 Key Points',
            value: summary.keyPoints.slice(0, 5).map(p => `• ${p}`).join('\n') || 'None',
            inline: false
          },
          {
            name: '✅ Action Items',
            value: summary.actionItems.slice(0, 5).map(a => `• ${a}`).join('\n') || 'None',
            inline: false
          }
        ],
        color: 0x22c55e,
        footer: { text: `Based on ${messages.length} messages from the last 24 hours` }
      }]
    });

  } catch (error) {
    await interaction.editReply({
      embeds: [{
        title: '❌ Error',
        description: error.message,
        color: 0xef4444
      }]
    });
  }
}

async function handleStatsCommand(interaction) {
  const stats = knowledgeBase.getStats();

  await interaction.reply({
    embeds: [{
      title: '📊 Knowledge Base Stats',
      fields: [
        { name: 'Total Messages', value: stats.totalMessages.toString(), inline: true },
        { name: 'Last 24 Hours', value: stats.messagesLast24h.toString(), inline: true },
        { name: 'Last Week', value: stats.messagesLastWeek.toString(), inline: true },
        { name: 'Teams', value: stats.sourceCounts.teams?.toString() || '0', inline: true },
        { name: 'Slack', value: stats.sourceCounts.slack?.toString() || '0', inline: true },
        { 
          name: 'Top Channels', 
          value: stats.topChannels.slice(0, 5).map(c => `• ${c.name}: ${c.count}`).join('\n') || 'None',
          inline: false 
        }
      ],
      color: 0x3b82f6
    }]
  });
}

export function stopDiscordBot() {
  if (botClient) {
    botClient.destroy();
    isConnected = false;
    console.log('Discord bot disconnected');
  }
}

export function isBotConnected() {
  return isConnected;
}
