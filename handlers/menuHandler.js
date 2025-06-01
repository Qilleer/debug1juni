const { safeEditMessage } = require('../utils/helpers');

// Show main menu
async function showMainMenu(chatId, bot, userStates, messageId = null) {
  const isConnected = userStates[chatId]?.whatsapp?.isConnected || false;
  
  const menuText = `👋 *Welcome to Auto Accept Bot!*\n\nStatus: ${isConnected ? '✅ Connected' : '❌ Disconnected'}\n\nPilih menu:`;
  const keyboard = {
    inline_keyboard: [
      [{ text: '🔑 Login WhatsApp', callback_data: 'login' }],
      [{ text: '🤖 Auto Accept Settings', callback_data: 'auto_accept' }],
      [{ text: '👥 Admin Management', callback_data: 'admin_management' }],
      [{ text: '📞 Add CTC', callback_data: 'add_ctc' }],
      [{ text: '⚡ Blast', callback_data: 'blast' }], // Button blast baru
      [{ text: '✏️ Rename Groups', callback_data: 'rename_groups' }],
      [{ text: '🔄 Status', callback_data: 'status' }],
      [{ text: '🚪 Logout', callback_data: 'logout' }]
    ]
  };
  
  if (messageId) {
    await safeEditMessage(bot, chatId, messageId, menuText, {
      parse_mode: 'Markdown',
      reply_markup: keyboard
    });
  } else {
    await bot.sendMessage(chatId, menuText, {
      parse_mode: 'Markdown',
      reply_markup: keyboard
    });
  }
}

// Show Admin Management Menu
async function showAdminManagementMenu(chatId, bot, messageId = null) {
  const menuText = `👥 *Admin Management*\n\nPilih aksi yang ingin dilakukan:`;
  const keyboard = {
    inline_keyboard: [
      [{ text: '➕ Add & Promote Admin', callback_data: 'add_promote_admin' }],
      [{ text: '➖ Demote Admin', callback_data: 'demote_admin' }],
      [{ text: '🏠 Menu Utama', callback_data: 'main_menu' }]
    ]
  };
  
  if (messageId) {
    await safeEditMessage(bot, chatId, messageId, menuText, {
      parse_mode: 'Markdown',
      reply_markup: keyboard
    });
  } else {
    await bot.sendMessage(chatId, menuText, {
      parse_mode: 'Markdown',
      reply_markup: keyboard
    });
  }
}

// Show Add CTC Menu
async function showAddCtcMenu(chatId, bot, messageId = null) {
  const menuText = `📞 *Add Contact to Groups*\n\nPilih cara input nomor contact:`;
  const keyboard = {
    inline_keyboard: [
      [{ text: '📝 Lewat Chat', callback_data: 'add_ctc_chat' }],
      [{ text: '📄 Lewat File TXT', callback_data: 'add_ctc_file' }],
      [{ text: '🏠 Menu Utama', callback_data: 'main_menu' }]
    ]
  };
  
  if (messageId) {
    await safeEditMessage(bot, chatId, messageId, menuText, {
      parse_mode: 'Markdown',
      reply_markup: keyboard
    });
  } else {
    await bot.sendMessage(chatId, menuText, {
      parse_mode: 'Markdown',
      reply_markup: keyboard
    });
  }
}

// Show Blast Menu - BARU
async function showBlastMenu(chatId, bot, messageId = null) {
  const menuText = `⚡ *Blast Message*\n\nPilih cara input nomor target:`;
  const keyboard = {
    inline_keyboard: [
      [{ text: '📝 Lewat Chat', callback_data: 'blast_chat' }],
      [{ text: '📄 Lewat File TXT', callback_data: 'blast_file' }],
      [{ text: '🏠 Menu Utama', callback_data: 'main_menu' }]
    ]
  };
  
  if (messageId) {
    await safeEditMessage(bot, chatId, messageId, menuText, {
      parse_mode: 'Markdown',
      reply_markup: keyboard
    });
  } else {
    await bot.sendMessage(chatId, menuText, {
      parse_mode: 'Markdown',
      reply_markup: keyboard
    });
  }
}

module.exports = {
  showMainMenu,
  showAdminManagementMenu,
  showAddCtcMenu,
  showBlastMenu // Export function blast baru
};