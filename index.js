const TelegramBot = require('node-telegram-bot-api');
const { restoreAllSessions } = require('./whatsappClient');
const { handleAuthCallbacks, handleAuthMessages } = require('./handlers/authHandler');
const { handleAdminCallbacks, handleAdminMessages } = require('./handlers/adminHandler');
const { handleGroupCallbacks, handleGroupMessages } = require('./handlers/groupHandler');
const { handleCtcCallbacks, handleCtcMessages } = require('./handlers/ctcHandler');
const { handleBlastCallbacks, handleBlastMessages } = require('./handlers/blastHandler');
const { showMainMenu } = require('./handlers/menuHandler');
const { isOwner, parsePhoneNumbersFromFile } = require('./utils/helpers');
const config = require('./config');

// Bot instance & user states
const bot = new TelegramBot(config.telegram.token, { polling: true });
const userStates = {};

// Initialize bot - restore sessions on startup
async function initializeBot() {
  console.log('🔄 Restoring existing sessions...');
  
  try {
    const restoredSessions = await restoreAllSessions(bot);
    
    if (restoredSessions.length > 0) {
      console.log(`✅ Restored ${restoredSessions.length} sessions:`, restoredSessions);
      
      // Notify owners about restored sessions
      for (const ownerId of config.telegram.owners) {
        try {
          await bot.sendMessage(
            ownerId, 
            `🚀 *Bot Started!*\n\n✅ Restored ${restoredSessions.length} WhatsApp session(s)\n\nBot siap digunakan!`,
            { parse_mode: 'Markdown' }
          );
        } catch (err) {
          console.warn(`Could not notify owner ${ownerId}:`, err.message);
        }
      }
    } else {
      console.log('ℹ️ No existing sessions found');
    }
  } catch (err) {
    console.error('❌ Error restoring sessions:', err.message);
  }
}

// Handle /start
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  
  if (!isOwner(userId)) {
    await bot.sendMessage(chatId, '❌ Lu bukan owner bot ini bro!');
    return;
  }
  
  await showMainMenu(chatId, bot, userStates);
});

// Handle callback queries - FIXED ROUTING ORDER
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const userId = query.from.id;
  const data = query.data;
  
  if (!isOwner(userId)) {
    try {
      await bot.answerCallbackQuery(query.id, { 
        text: '❌ Lu bukan owner!', 
        show_alert: true 
      });
    } catch (err) {
      console.warn(`Failed to answer callback query: ${err.message}`);
    }
    return;
  }
  
  try {
    console.log(`[DEBUG] Callback data received: ${data} from user ${userId}`);
    
    // MAIN MENU HANDLER - PRIORITAS PERTAMA
    if (data === 'main_menu') {
      await bot.answerCallbackQuery(query.id);
      await showMainMenu(chatId, bot, userStates, query.message.message_id);
      return;
    }
    
    // GROUP HANDLER - PRIORITAS KEDUA (sebelum yang lain)
    if (data === 'rename_groups' || 
        data === 'confirm_rename' ||
        data === 'search_rename_groups' ||
        data.startsWith('select_base_')) {
      console.log(`[DEBUG] Routing to Group handler: ${data}`);
      await handleGroupCallbacks(query, bot, userStates);
      return;
    }
    
    // BLAST HANDLER
    if (data === 'blast' || 
        data === 'blast_chat' || 
        data === 'blast_file' ||
        data === 'confirm_blast_numbers' ||
        data === 'confirm_blast' ||
        data === 'custom_delay' ||
        data === 'cancel_blast_flow' ||
        data.startsWith('set_delay_')) {
      console.log(`[DEBUG] Routing to Blast handler: ${data}`);
      await handleBlastCallbacks(query, bot, userStates);
      return;
    }
    
    // CTC HANDLER
    if (data === 'add_ctc' || 
        data === 'add_ctc_chat' || 
        data === 'add_ctc_file' ||
        data === 'confirm_ctc_numbers' ||
        data === 'search_ctc_groups' ||
        data === 'finish_ctc_group_selection' ||
        data === 'confirm_add_ctc' ||
        data === 'cancel_ctc_flow' ||
        data.startsWith('toggle_ctc_group_') || 
        data.startsWith('ctc_groups_page_')) {
      console.log(`[DEBUG] Routing to CTC handler: ${data}`);
      await handleCtcCallbacks(query, bot, userStates);
      return;
    }
    
    // AUTH HANDLER
    if (data === 'login' || 
        data === 'cancel_login' || 
        data === 'logout' || 
        data === 'auto_accept' || 
        data === 'toggle_auto_accept' || 
        data === 'status') {
      console.log(`[DEBUG] Routing to Auth handler: ${data}`);
      await handleAuthCallbacks(query, bot, userStates);
      return;
    }
    
    // ADMIN HANDLER
    if (data === 'admin_management' ||
        data === 'add_promote_admin' ||
        data === 'demote_admin' ||
        data === 'search_groups' ||
        data === 'finish_group_selection' ||
        data === 'start_search_admin' ||
        data === 'finish_demote_selection' ||
        data === 'confirm_add_promote' ||
        data === 'confirm_demote' ||
        data === 'cancel_admin_flow' ||
        data.startsWith('toggle_group_') ||
        data.startsWith('groups_page_') ||
        data.startsWith('toggle_demote_') ||
        data.startsWith('demote_page_')) {
      console.log(`[DEBUG] Routing to Admin handler: ${data}`);
      await handleAdminCallbacks(query, bot, userStates);
      return;
    }
    
    // FALLBACK - unhandled callback
    console.log(`[DEBUG] Unhandled callback data: ${data}`);
    await bot.answerCallbackQuery(query.id);
    await bot.sendMessage(chatId, '❌ Command tidak dikenal. Coba lagi ya!');
    
  } catch (err) {
    console.error('Error handling callback:', err);
    
    // Answer callback query untuk prevent timeout
    try {
      await bot.answerCallbackQuery(query.id);
    } catch (answerErr) {
      console.warn(`Failed to answer callback query: ${answerErr.message}`);
    }
    
    try {
      await bot.sendMessage(chatId, '❌ Terjadi error saat memproses perintah. Coba lagi ya!');
    } catch (sendErr) {
      console.error('Failed to send error message:', sendErr.message);
    }
  }
});

// Handle text messages
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const text = msg.text;
  
  if (!text || text.startsWith('/')) return;
  if (!isOwner(userId)) return;
  
  try {
    // Route messages to appropriate handlers
    let handled = false;
    
    // Try group handler first (untuk rename flow)
    handled = await handleGroupMessages(msg, bot, userStates);
    
    // If not handled by group, try blast handler
    if (!handled) {
      handled = await handleBlastMessages(msg, bot, userStates);
    }
    
    // If not handled by blast, try auth handler
    if (!handled) {
      handled = await handleAuthMessages(msg, bot, userStates);
    }
    
    // If not handled by auth, try admin handler
    if (!handled) {
      handled = await handleAdminMessages(msg, bot, userStates);
    }
    
    // If not handled by admin, try CTC handler
    if (!handled) {
      handled = await handleCtcMessages(msg, bot, userStates);
    }
    
    // If no handler processed it, ignore
    if (!handled) {
      console.log(`[DEBUG] Unhandled message from ${userId}: ${text}`);
    }
    
  } catch (err) {
    console.error('Error handling message:', err);
    try {
      await bot.sendMessage(chatId, '❌ Terjadi error. Coba lagi ya!');
    } catch (sendErr) {
      console.error('Failed to send error message:', sendErr.message);
    }
  }
});

// Handle document uploads untuk file TXT (CTC & Blast)
bot.on('document', async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const document = msg.document;
  
  if (!isOwner(userId)) return;
  
  // Check if user is in CTC flow waiting for file
  if (userStates[userId]?.ctcFlow && userStates[userId].ctcFlow.step === 'waiting_file') {
    try {
      // Validate file type
      if (!document.file_name.toLowerCase().endsWith('.txt')) {
        await bot.sendMessage(chatId, '❌ File harus berformat .txt!');
        return;
      }
      
      // Validate file size (max 5MB)
      if (document.file_size > 5 * 1024 * 1024) {
        await bot.sendMessage(chatId, '❌ File terlalu besar! Maksimal 5MB.');
        return;
      }
      
      const loadingMsg = await bot.sendMessage(chatId, '⏳ Memproses file...');
      
      // Download file
      const fileLink = await bot.getFileLink(document.file_id);
      const response = await fetch(fileLink);
      const fileContent = await response.text();
      
      // Parse phone numbers from file
      const { phoneNumbers, errors } = parsePhoneNumbersFromFile(fileContent);
      
      if (errors.length > 0) {
        await bot.editMessageText(
          `❌ Ada error dalam file:\n\n${errors.slice(0, 10).join('\n')}${errors.length > 10 ? `\n... dan ${errors.length - 10} error lainnya` : ''}`,
          {
            chat_id: chatId,
            message_id: loadingMsg.message_id
          }
        );
        return;
      }
      
      if (phoneNumbers.length === 0) {
        await bot.editMessageText('❌ Tidak ada nomor valid yang ditemukan dalam file!', {
          chat_id: chatId,
          message_id: loadingMsg.message_id
        });
        return;
      }
      
      // Store parsed numbers
      userStates[userId].ctcFlow.contactNumbers = phoneNumbers;
      userStates[userId].ctcFlow.step = 'confirm_numbers';
      
      // Delete loading message
      await bot.deleteMessage(chatId, loadingMsg.message_id);
      
      // Show confirmation
      const { showConfirmCtcNumbers } = require('./handlers/ctcHandler');
      await showConfirmCtcNumbers(chatId, userId, bot, userStates);
      
    } catch (err) {
      console.error('Error processing CTC file:', err);
      await bot.sendMessage(chatId, '❌ Error memproses file. Coba lagi ya!');
    }
    return;
  }
  
  // Check if user is in Blast flow waiting for file
  if (userStates[userId]?.blastFlow && userStates[userId].blastFlow.step === 'waiting_file') {
    try {
      // Validate file type
      if (!document.file_name.toLowerCase().endsWith('.txt')) {
        await bot.sendMessage(chatId, '❌ File harus berformat .txt!');
        return;
      }
      
      // Validate file size (max 5MB)
      if (document.file_size > 5 * 1024 * 1024) {
        await bot.sendMessage(chatId, '❌ File terlalu besar! Maksimal 5MB.');
        return;
      }
      
      const loadingMsg = await bot.sendMessage(chatId, '⏳ Memproses file...');
      
      // Download file
      const fileLink = await bot.getFileLink(document.file_id);
      const response = await fetch(fileLink);
      const fileContent = await response.text();
      
      // Parse phone numbers from file
      const { phoneNumbers, errors } = parsePhoneNumbersFromFile(fileContent);
      
      if (errors.length > 0) {
        await bot.editMessageText(
          `❌ Ada error dalam file:\n\n${errors.slice(0, 10).join('\n')}${errors.length > 10 ? `\n... dan ${errors.length - 10} error lainnya` : ''}`,
          {
            chat_id: chatId,
            message_id: loadingMsg.message_id
          }
        );
        return;
      }
      
      if (phoneNumbers.length === 0) {
        await bot.editMessageText('❌ Tidak ada nomor valid yang ditemukan dalam file!', {
          chat_id: chatId,
          message_id: loadingMsg.message_id
        });
        return;
      }
      
      // Store parsed numbers
      userStates[userId].blastFlow.phoneNumbers = phoneNumbers;
      userStates[userId].blastFlow.step = 'confirm_numbers';
      
      // Delete loading message
      await bot.deleteMessage(chatId, loadingMsg.message_id);
      
      // Show confirmation
      const { showConfirmBlastNumbers } = require('./handlers/blastHandler');
      await showConfirmBlastNumbers(chatId, userId, bot, userStates);
      
    } catch (err) {
      console.error('Error processing Blast file:', err);
      await bot.sendMessage(chatId, '❌ Error memproses file. Coba lagi ya!');
    }
    return;
  }
});

// Global error handlers
bot.on('error', (error) => {
  console.error('Telegram Bot Error:', error);
});

bot.on('polling_error', (error) => {
  console.error('Telegram Polling Error:', error);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  process.exit(1);
});

// Export userStates for whatsappClient
module.exports = { userStates };

// Initialize bot with session restore
initializeBot().then(() => {
  console.log('✅ Bot started! Send /start to begin.');
}).catch(err => {
  console.error('❌ Bot initialization failed:', err);
});
