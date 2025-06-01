const { 
  createWhatsAppConnection, 
  generatePairingCode, 
  logoutWhatsApp,
  toggleAutoAccept,
  getAutoAcceptStatus
} = require('../whatsappClient');
const { showMainMenu } = require('./menuHandler');
const { 
  safeDeleteMessage, 
  safeEditMessage, 
  isValidPhoneNumber, 
  cleanPhoneNumber,
  formatDate,
  clearUserFlowState
} = require('../utils/helpers');

// Handle authentication-related callbacks
async function handleAuthCallbacks(query, bot, userStates) {
  const chatId = query.message.chat.id;
  const userId = query.from.id;
  const data = query.data;
  
  switch(data) {
    case 'login':
      await handleLogin(chatId, userId, bot, userStates);
      break;
      
    case 'cancel_login':
      await handleCancelLogin(chatId, userId, bot, userStates);
      break;
      
    case 'auto_accept':
      await handleAutoAccept(chatId, userId, bot, userStates, query.message.message_id);
      break;
      
    case 'toggle_auto_accept':
      await handleToggleAutoAccept(chatId, userId, bot, userStates, query.message.message_id);
      break;
      
    case 'status':
      await handleStatus(chatId, userId, bot, userStates);
      break;
      
    case 'logout':
      await handleLogout(chatId, userId, bot, userStates);
      break;
  }
}

// Handle authentication-related messages
async function handleAuthMessages(msg, bot, userStates) {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const text = msg.text;
  
  // Handle phone number input
  if (userStates[userId]?.waitingForPhone) {
    userStates[userId].waitingForPhone = false;
    
    // Delete user's message for privacy
    await safeDeleteMessage(bot, chatId, msg.message_id);
    
    // Validate phone number
    const phoneNumber = cleanPhoneNumber(text);
    if (!isValidPhoneNumber(phoneNumber)) {
      await bot.sendMessage(chatId, '❌ Format nomor salah! Harus 10-15 digit angka saja.');
      return true;
    }
    
    const loadingMsg = await bot.sendMessage(chatId, '⏳ Tunggu bentar, lagi bikin koneksi...');
    
    try {
      // Create connection
      const sock = await createWhatsAppConnection(userId, bot);
      if (!sock) throw new Error('Gagal bikin koneksi');
      
      // Wait 3 seconds for stable connection
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Generate pairing code
      await generatePairingCode(userId, phoneNumber, bot, loadingMsg.message_id);
    } catch (err) {
      await safeDeleteMessage(bot, chatId, loadingMsg.message_id);
      await bot.sendMessage(chatId, `❌ Error: ${err.message}`, {
        reply_markup: {
          inline_keyboard: [
            [{ text: '🔄 Coba Lagi', callback_data: 'login' }],
            [{ text: '🏠 Menu Utama', callback_data: 'main_menu' }]
          ]
        }
      });
    }
    return true;
  }
  
  return false; // Not handled
}

// Handle login
async function handleLogin(chatId, userId, bot, userStates) {
  // Check if already connected
  if (userStates[userId]?.whatsapp?.isConnected) {
    await bot.sendMessage(chatId, '✅ WhatsApp sudah terhubung! Ga perlu login lagi.');
    return;
  }
  
  if (!userStates[userId]) {
    userStates[userId] = {};
  }
  
  userStates[userId].waitingForPhone = true;
  
  await bot.sendMessage(chatId, '📱 Kirim nomor WA lu (dengan kode negara, tanpa +):\n\nContoh: 628123456789', {
    reply_markup: {
      inline_keyboard: [
        [{ text: '❌ Batal', callback_data: 'cancel_login' }]
      ]
    }
  });
}

// Handle cancel login
async function handleCancelLogin(chatId, userId, bot, userStates) {
  // Clear auth flow state
  clearUserFlowState(userStates, userId, 'auth');
  
  // Close WhatsApp connection if exists
  if (userStates[userId]?.whatsapp?.socket) {
    await logoutWhatsApp(userId);
  }
  
  await bot.sendMessage(chatId, '✅ Login dibatalkan!');
  await showMainMenu(chatId, bot, userStates);
}

// Handle auto accept settings
async function handleAutoAccept(chatId, userId, bot, userStates, messageId) {
  const status = getAutoAcceptStatus(userId);
  
  await safeEditMessage(bot, chatId, messageId, 
    `🤖 *Auto Accept Settings*\n\nStatus: ${status.enabled ? '✅ AKTIF' : '❌ NONAKTIF'}\n\nKalo aktif, bot bakal otomatis approve semua yang mau join grup.`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: status.enabled ? '❌ Matikan' : '✅ Aktifkan', callback_data: 'toggle_auto_accept' }],
          [{ text: '🏠 Menu Utama', callback_data: 'main_menu' }]
        ]
      }
    }
  );
}

// Handle toggle auto accept
async function handleToggleAutoAccept(chatId, userId, bot, userStates, messageId) {
  const currentStatus = getAutoAcceptStatus(userId);
  const newStatus = !currentStatus.enabled;
  
  const result = await toggleAutoAccept(userId, newStatus);
  
  if (result.success) {
    await handleAutoAccept(chatId, userId, bot, userStates, messageId);
  } else {
    await bot.sendMessage(chatId, '❌ Gagal ubah setting. Coba lagi!');
  }
}

// Handle status
async function handleStatus(chatId, userId, bot, userStates) {
  const isConnected = userStates[userId]?.whatsapp?.isConnected || false;
  const autoAcceptStatus = getAutoAcceptStatus(userId);
  const lastConnect = userStates[userId]?.whatsapp?.lastConnect;
  
  let message = '*📊 Status Bot*\n\n';
  message += `WhatsApp: ${isConnected ? '✅ Connected' : '❌ Disconnected'}\n`;
  message += `Auto Accept: ${autoAcceptStatus.enabled ? '✅ ON' : '❌ OFF'}\n`;
  
  if (lastConnect) {
    message += `Last Connect: ${formatDate(lastConnect)}\n`;
  }
  
  await bot.sendMessage(chatId, message, {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [{ text: '🏠 Menu Utama', callback_data: 'main_menu' }]
      ]
    }
  });
}

// Handle logout
async function handleLogout(chatId, userId, bot, userStates) {
  const loadingMsg = await bot.sendMessage(chatId, '⏳ Sedang logout...');
  
  const success = await logoutWhatsApp(userId);
  
  await safeDeleteMessage(bot, chatId, loadingMsg.message_id);
  
  if (success) {
    await bot.sendMessage(chatId, '✅ Logout berhasil! Session dihapus.');
  } else {
    await bot.sendMessage(chatId, '❌ Error waktu logout.');
  }
  
  await showMainMenu(chatId, bot, userStates);
}

module.exports = {
  handleAuthCallbacks,
  handleAuthMessages
};