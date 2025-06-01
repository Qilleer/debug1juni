const { getAllGroups, renameGroup } = require('../whatsappClient');
const { 
  safeEditMessage, 
  safeDeleteMessage,
  extractNumberFromGroupName,
  generateProgressMessage,
  isRateLimitError,
  sleep,
  clearUserFlowState
} = require('../utils/helpers');

// Handle group-related callbacks
async function handleGroupCallbacks(query, bot, userStates) {
  const chatId = query.message.chat.id;
  const userId = query.from.id;
  const data = query.data;
  
  console.log(`[DEBUG][GROUP] Callback received: ${data} from user ${userId}`);
  
  try {
    // Answer callback query immediately to prevent timeout
    try {
      await bot.answerCallbackQuery(query.id);
    } catch (err) {
      console.warn(`Failed to answer callback query: ${err.message}`);
    }
    
    switch(true) {
      case data === 'rename_groups':
        console.log(`[DEBUG][GROUP] Starting rename groups flow`);
        await handleRenameGroups(chatId, userId, bot, userStates);
        break;
        
      case data === 'confirm_rename':
        console.log(`[DEBUG][GROUP] Confirming rename`);
        // Prevent duplicate processing
        if (userStates[userId]?.renameState?.processing) {
          console.log(`[DEBUG][GROUP] Rename already in progress, ignoring duplicate callback`);
          return;
        }
        await handleConfirmRename(chatId, userId, bot, userStates);
        break;
        
      case data === 'search_rename_groups':
        console.log(`[DEBUG][GROUP] Searching rename groups`);
        await handleSearchRenameGroups(chatId, userId, bot, userStates);
        break;
        
      case data.startsWith('select_base_'):
        const baseName = data.replace('select_base_', '');
        console.log(`[DEBUG][GROUP] Selecting base name: ${baseName}`);
        await handleBaseNameSelection(chatId, userId, baseName, bot, userStates);
        break;
        
      default:
        console.log(`[DEBUG][GROUP] Unhandled callback: ${data}`);
        break;
    }
  } catch (err) {
    console.error('Error in group callback handler:', err);
    await bot.sendMessage(chatId, '❌ Terjadi error saat memproses group management.');
  }
}

// Handle group-related messages
async function handleGroupMessages(msg, bot, userStates) {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const text = msg.text;
  
  // Handle rename flow
  if (userStates[userId]?.renameState) {
    const state = userStates[userId].renameState;
    
    console.log(`[DEBUG][GROUP] Processing rename step: ${state.step}, input: ${text}`);
    
    // Prevent processing if already in progress
    if (state.processing) {
      console.log(`[DEBUG][GROUP] Step already processing, ignoring input`);
      return true;
    }
    
    switch (state.step) {
      case 'waiting_search_query':
        return await handleSearchQuery(chatId, userId, text, bot, userStates, msg.message_id);
        
      case 'waiting_start_number':
        return await handleStartNumber(chatId, userId, text, bot, userStates);
        
      case 'waiting_end_number':
        return await handleEndNumber(chatId, userId, text, bot, userStates);
        
      case 'waiting_new_name':
        return await handleNewName(chatId, userId, text, bot, userStates);
        
      case 'waiting_start_numbering':
        return await handleStartNumbering(chatId, userId, text, bot, userStates);
    }
  }
  
  return false; // Not handled
}

// Handle rename groups
async function handleRenameGroups(chatId, userId, bot, userStates) {
  // Check if WhatsApp is connected
  if (!userStates[userId]?.whatsapp?.isConnected) {
    await bot.sendMessage(chatId, '❌ WhatsApp belum terhubung! Login dulu ya.');
    return;
  }
  
  const loadingMsg = await bot.sendMessage(chatId, '⏳ Mengambil daftar grup...');
  
  try {
    const groups = await getAllGroups(userId);
    
    if (!groups || groups.length === 0) {
      await safeEditMessage(bot, chatId, loadingMsg.message_id, '❌ Tidak ada grup yang ditemukan!', {
        reply_markup: {
          inline_keyboard: [
            [{ text: '🏠 Menu Utama', callback_data: 'main_menu' }]
          ]
        }
      });
      return;
    }
    
    // Group by base name - IMPROVED VERSION
    const groupedByBase = {};
    
    groups.forEach(group => {
      // Extract base name (remove numbers and extra spaces)
      let baseName = group.name.replace(/\s*\d+\s*$/, '').trim();
      
      // If base name is empty after removing numbers, use original name
      if (!baseName) {
        baseName = group.name;
      }
      
      if (!groupedByBase[baseName]) {
        groupedByBase[baseName] = [];
      }
      
      groupedByBase[baseName].push(group);
    });
    
    console.log('[DEBUG][GROUP] Grouped data:', JSON.stringify(groupedByBase, null, 2));
    
    // Filter only base names with more than 1 group
    const baseNamesWithMultiple = Object.keys(groupedByBase).filter(
      baseName => groupedByBase[baseName].length > 1
    );
    
    if (baseNamesWithMultiple.length === 0) {
      await safeEditMessage(bot, chatId, loadingMsg.message_id, '❌ Tidak ada grup dengan nama dasar yang sama!\n\nContoh: "HK 1", "HK 2" akan dikelompokkan sebagai "HK"', {
        reply_markup: {
          inline_keyboard: [
            [{ text: '🏠 Menu Utama', callback_data: 'main_menu' }]
          ]
        }
      });
      return;
    }
    
    // Create keyboard for base name selection
    const keyboard = [];
    baseNamesWithMultiple.forEach(baseName => {
      const count = groupedByBase[baseName].length;
      keyboard.push([{
        text: `${baseName} (${count} grup)`,
        callback_data: `select_base_${baseName}`
      }]);
    });
    
    // Add search button
    keyboard.push([{ text: '🔍 Cari Grup', callback_data: 'search_rename_groups' }]);
    keyboard.push([{ text: '🏠 Menu Utama', callback_data: 'main_menu' }]);
    
    // Store grouped data for later use
    userStates[userId].groupedData = groupedByBase;
    userStates[userId].originalGroupedData = JSON.parse(JSON.stringify(groupedByBase)); // Deep copy
    
    await safeEditMessage(bot, chatId, loadingMsg.message_id,
      '📝 *Pilih kelompok grup yang mau di-rename:*\n\nBot akan rename grup secara batch dengan numbering otomatis.\n\n🔍 Gunakan tombol "Cari Grup" untuk filter grup tertentu.',
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: keyboard
        }
      }
    );
    
  } catch (err) {
    console.error('Error getting groups:', err);
    await safeEditMessage(bot, chatId, loadingMsg.message_id, `❌ Error mengambil daftar grup: ${err.message}`, {
      reply_markup: {
        inline_keyboard: [
          [{ text: '🏠 Menu Utama', callback_data: 'main_menu' }]
        ]
      }
    });
  }
}

// Handle base name selection
async function handleBaseNameSelection(chatId, userId, baseName, bot, userStates) {
  const groups = userStates[userId].groupedData[baseName];
  
  console.log(`[DEBUG][GROUP] Processing base name: ${baseName}`);
  console.log(`[DEBUG][GROUP] Groups:`, groups.map(g => g.name));
  
  // Sort groups by number (extract number from name)
  groups.sort((a, b) => {
    const numA = extractNumberFromGroupName(a.name);
    const numB = extractNumberFromGroupName(b.name);
    console.log(`[DEBUG][GROUP] Comparing: ${a.name} (${numA}) vs ${b.name} (${numB})`);
    return numA - numB;
  });
  
  let message = `📋 *Grup "${baseName}":*\n\n`;
  groups.forEach((group, index) => {
    const number = extractNumberFromGroupName(group.name);
    message += `${number}. ${group.name}\n`;
  });
  message += '\n💬 Kirim nomor grup yang mau dimulai rename (contoh: 1)';
  
  // Set state for waiting start number
  userStates[userId].renameState = {
    step: 'waiting_start_number',
    baseName: baseName,
    groups: groups,
    processing: false // Add processing flag
  };
  
  console.log(`[DEBUG][GROUP] Rename state set:`, userStates[userId].renameState);
  
  await bot.sendMessage(chatId, message, {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [{ text: '❌ Batal', callback_data: 'rename_groups' }]
      ]
    }
  });
}

// Handle start number input
async function handleStartNumber(chatId, userId, text, bot, userStates) {
  const state = userStates[userId].renameState;
  
  // Set processing flag
  state.processing = true;
  
  const startNum = parseInt(text.trim());
  console.log(`[DEBUG][GROUP] Start number input: ${startNum}`);
  
  if (isNaN(startNum) || startNum < 1) {
    state.processing = false;
    await bot.sendMessage(chatId, '❌ Nomor tidak valid! Kirim angka yang benar.');
    return true;
  }
  
  // Check if start number exists
  const availableNumbers = state.groups.map(group => {
    const num = extractNumberFromGroupName(group.name);
    console.log(`[DEBUG][GROUP] Group: ${group.name}, extracted number: ${num}`);
    return num;
  });
  
  console.log(`[DEBUG][GROUP] Available numbers:`, availableNumbers);
  console.log(`[DEBUG][GROUP] Looking for number:`, startNum);
  
  const hasStartNum = availableNumbers.includes(startNum);
  
  if (!hasStartNum) {
    state.processing = false;
    await bot.sendMessage(chatId, `❌ Nomor grup ${startNum} tidak ditemukan!\n\nNomor yang tersedia: ${availableNumbers.join(', ')}`);
    return true;
  }
  
  state.startNumber = startNum;
  state.step = 'waiting_end_number';
  state.processing = false;
  
  await bot.sendMessage(chatId, `✅ Mulai dari grup nomor: ${startNum}\n\n💬 Kirim nomor grup terakhir untuk rename\n\nNomor tersedia: ${availableNumbers.join(', ')}`, {
    reply_markup: {
      inline_keyboard: [
        [{ text: '❌ Batal', callback_data: 'rename_groups' }]
      ]
    }
  });
  
  return true;
}

// Handle search rename groups - NEW FUNCTION
async function handleSearchRenameGroups(chatId, userId, bot, userStates) {
  // Initialize search state
  if (!userStates[userId].renameState) {
    userStates[userId].renameState = {
      step: 'waiting_search_query',
      processing: false
    };
  } else {
    userStates[userId].renameState.step = 'waiting_search_query';
    userStates[userId].renameState.processing = false;
  }
  
  await bot.sendMessage(chatId, '🔍 *Cari Grup untuk Rename*\n\nKetik nama grup yang mau dicari:', {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [{ text: '🔄 Reset Filter', callback_data: 'rename_groups' }],
        [{ text: '🏠 Menu Utama', callback_data: 'main_menu' }]
      ]
    }
  });
}

// Handle search query input - NEW FUNCTION
async function handleSearchQuery(chatId, userId, text, bot, userStates, messageId) {
  const state = userStates[userId].renameState;
  
  // Set processing flag
  state.processing = true;
  
  // Delete user's message if messageId provided
  if (messageId) {
    await safeDeleteMessage(bot, chatId, messageId);
  }
  
  const searchQuery = text.trim().toLowerCase();
  
  if (!searchQuery || searchQuery.length < 1) {
    state.processing = false;
    await bot.sendMessage(chatId, '❌ Query pencarian tidak boleh kosong!');
    return true;
  }
  
  // Get original grouped data
  const originalGroupedData = userStates[userId].originalGroupedData;
  
  if (!originalGroupedData) {
    state.processing = false;
    await bot.sendMessage(chatId, '❌ Data grup tidak ditemukan. Mulai lagi dari menu rename.');
    return true;
  }
  
  const loadingMsg = await bot.sendMessage(chatId, `⏳ Mencari grup dengan kata kunci: "${searchQuery}"...`);
  
  try {
    // Filter groups by search query
    const filteredGroupedData = {};
    
    for (const baseName in originalGroupedData) {
      const groups = originalGroupedData[baseName];
      
      // Filter groups that match search query
      const matchingGroups = groups.filter(group => 
        group.name.toLowerCase().includes(searchQuery) ||
        baseName.toLowerCase().includes(searchQuery)
      );
      
      // Only include base names that have matching groups and more than 1 group
      if (matchingGroups.length > 1) {
        filteredGroupedData[baseName] = matchingGroups;
      }
    }
    
    // Check if any groups found
    if (Object.keys(filteredGroupedData).length === 0) {
      await safeEditMessage(bot, chatId, loadingMsg.message_id, 
        `❌ Tidak ada grup yang cocok dengan pencarian: "${searchQuery}"\n\nCoba kata kunci lain atau reset filter.`, {
        reply_markup: {
          inline_keyboard: [
            [{ text: '🔍 Cari Lagi', callback_data: 'search_rename_groups' }],
            [{ text: '🔄 Reset Filter', callback_data: 'rename_groups' }],
            [{ text: '🏠 Menu Utama', callback_data: 'main_menu' }]
          ]
        }
      });
      state.processing = false;
      return true;
    }
    
    // Create keyboard with filtered results
    const keyboard = [];
    for (const baseName in filteredGroupedData) {
      const count = filteredGroupedData[baseName].length;
      keyboard.push([{
        text: `${baseName} (${count} grup)`,
        callback_data: `select_base_${baseName}`
      }]);
    }
    
    // Add action buttons
    keyboard.push([{ text: '🔍 Cari Lagi', callback_data: 'search_rename_groups' }]);
    keyboard.push([{ text: '🔄 Reset Filter', callback_data: 'rename_groups' }]);
    keyboard.push([{ text: '🏠 Menu Utama', callback_data: 'main_menu' }]);
    
    // Update grouped data with filtered results
    userStates[userId].groupedData = filteredGroupedData;
    
    await safeEditMessage(bot, chatId, loadingMsg.message_id,
      `🔍 *Hasil Pencarian: "${searchQuery}"*\n\n📊 Ditemukan ${Object.keys(filteredGroupedData).length} kelompok grup:\n\nPilih kelompok grup yang mau di-rename:`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: keyboard
        }
      }
    );
    
    state.processing = false;
    
  } catch (err) {
    console.error('Error in search query:', err);
    await safeEditMessage(bot, chatId, loadingMsg.message_id, `❌ Error saat pencarian: ${err.message}`, {
      reply_markup: {
        inline_keyboard: [
          [{ text: '🏠 Menu Utama', callback_data: 'main_menu' }]
        ]
      }
    });
    state.processing = false;
  }
  
  return true;
}

// Handle end number input
async function handleEndNumber(chatId, userId, text, bot, userStates) {
  const state = userStates[userId].renameState;
  
  // Set processing flag
  state.processing = true;
  
  const endNum = parseInt(text.trim());
  console.log(`[DEBUG][GROUP] End number input: ${endNum}`);
  
  if (isNaN(endNum) || endNum < state.startNumber) {
    state.processing = false;
    await bot.sendMessage(chatId, `❌ Nomor tidak valid! Harus lebih besar atau sama dengan ${state.startNumber}.`);
    return true;
  }
  
  // Check if end number exists
  const availableEndNumbers = state.groups.map(group => extractNumberFromGroupName(group.name));
  const hasEndNum = availableEndNumbers.includes(endNum);
  
  if (!hasEndNum) {
    state.processing = false;
    await bot.sendMessage(chatId, `❌ Nomor grup ${endNum} tidak ditemukan!\n\nNomor yang tersedia: ${availableEndNumbers.join(', ')}`);
    return true;
  }
  
  state.endNumber = endNum;
  state.step = 'waiting_new_name';
  state.processing = false;
  
  await bot.sendMessage(chatId, `✅ Rename dari grup ${state.startNumber} sampai ${state.endNumber}\n\n💬 Kirim nama grup baru (tanpa nomor, contoh: "MK"):`, {
    reply_markup: {
      inline_keyboard: [
        [{ text: '❌ Batal', callback_data: 'rename_groups' }]
      ]
    }
  });
  
  return true;
}

// Handle new name input
async function handleNewName(chatId, userId, text, bot, userStates) {
  const state = userStates[userId].renameState;
  
  // Set processing flag
  state.processing = true;
  
  const newName = text.trim();
  if (!newName || newName.length < 1) {
    state.processing = false;
    await bot.sendMessage(chatId, '❌ Nama grup tidak boleh kosong!');
    return true;
  }
  
  state.newName = newName;
  state.step = 'waiting_start_numbering';
  state.processing = false;
  
  await bot.sendMessage(chatId, `✅ Nama grup baru: "${newName}"\n\n💬 Kirim nomor mulai untuk nama baru (contoh: jika kirim 4, maka jadi "${newName} 4", "${newName} 5", dst):`, {
    reply_markup: {
      inline_keyboard: [
        [{ text: '❌ Batal', callback_data: 'rename_groups' }]
      ]
    }
  });
  
  return true;
}

// Handle start numbering input
async function handleStartNumbering(chatId, userId, text, bot, userStates) {
  const state = userStates[userId].renameState;
  
  // Set processing flag
  state.processing = true;
  
  const startNumbering = parseInt(text.trim());
  if (isNaN(startNumbering) || startNumbering < 1) {
    state.processing = false;
    await bot.sendMessage(chatId, '❌ Nomor tidak valid! Kirim angka yang benar.');
    return true;
  }
  
  state.startNumbering = startNumbering;
  state.processing = false;
  
  // Show confirmation
  const groupsInRange = state.groups.filter(group => {
    const groupNum = extractNumberFromGroupName(group.name);
    return groupNum >= state.startNumber && groupNum <= state.endNumber;
  });
  
  const totalGroups = groupsInRange.length;
  let confirmMsg = `🔄 *Konfirmasi Rename:*\n\n`;
  confirmMsg += `Base Name: ${state.baseName}\n`;
  confirmMsg += `Range: Grup ${state.startNumber} - ${state.endNumber}\n`;
  confirmMsg += `Total: ${totalGroups} grup\n`;
  confirmMsg += `Nama Baru: ${state.newName}\n`;
  confirmMsg += `Mulai Numbering: ${startNumbering}\n\n`;
  confirmMsg += `*Preview:*\n`;
  
  // Sort groups in range for preview
  groupsInRange.sort((a, b) => {
    const numA = extractNumberFromGroupName(a.name);
    const numB = extractNumberFromGroupName(b.name);
    return numA - numB;
  });
  
  groupsInRange.forEach((group, index) => {
    const oldNumber = extractNumberFromGroupName(group.name);
    const newNumber = startNumbering + index;
    confirmMsg += `• ${group.name} → ${state.newName} ${newNumber}\n`;
  });
  
  confirmMsg += `\n⚠️ Proses ini tidak bisa dibatalkan!`;
  
  await bot.sendMessage(chatId, confirmMsg, {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [{ text: '✅ Lanjutkan Rename', callback_data: 'confirm_rename' }],
        [{ text: '❌ Batal', callback_data: 'rename_groups' }]
      ]
    }
  });
  
  return true;
}

// Handle confirm rename - FIXED VERSION
async function handleConfirmRename(chatId, userId, bot, userStates) {
  const state = userStates[userId].renameState;
  
  if (!state) {
    await bot.sendMessage(chatId, '❌ Session expired. Mulai lagi dari menu rename.');
    return;
  }
  
  // Prevent duplicate processing
  if (state.processing) {
    console.log(`[DEBUG][GROUP] Rename already in progress, ignoring duplicate request`);
    return;
  }
  
  // Set processing flag
  state.processing = true;
  
  const loadingMsg = await bot.sendMessage(chatId, '⏳ Memulai proses rename...');
  
  try {
    // Filter groups to rename
    const groupsToRename = state.groups.filter(group => {
      const groupNum = extractNumberFromGroupName(group.name);
      return groupNum >= state.startNumber && groupNum <= state.endNumber;
    });
    
    console.log(`[DEBUG][GROUP] Groups to rename:`, groupsToRename.map(g => `${g.name} (${extractNumberFromGroupName(g.name)})`));
    
    // Sort groups by number
    groupsToRename.sort((a, b) => {
      const numA = extractNumberFromGroupName(a.name);
      const numB = extractNumberFromGroupName(b.name);
      return numA - numB;
    });
    
    let successCount = 0;
    let failCount = 0;
    let statusMessage = '';
    
    for (let i = 0; i < groupsToRename.length; i++) {
      const group = groupsToRename[i];
      const newNumber = state.startNumbering + i; // Sequential numbering
      const newGroupName = `${state.newName} ${newNumber}`;
      
      console.log(`[DEBUG][GROUP] Renaming: ${group.name} → ${newGroupName}`);
      
      try {
        await renameGroup(userId, group.id, newGroupName);
        successCount++;
        statusMessage += `✅ ${group.name} → ${newGroupName}\n`;
        
        // Update progress
        const progressMsg = generateProgressMessage(i + 1, groupsToRename.length, statusMessage, 'Rename');
        await safeEditMessage(bot, chatId, loadingMsg.message_id, progressMsg);
        
        // Delay to avoid rate limit
        await sleep(5000); // 5 seconds
      } catch (err) {
        failCount++;
        statusMessage += `❌ ${group.name} → Error: ${err.message}\n`;
        console.error(`[DEBUG][GROUP] Error renaming ${group.name}:`, err);
        
        // If rate limit, wait longer
        if (isRateLimitError(err)) {
          console.log(`[DEBUG][GROUP] Rate limit detected, waiting 10 seconds...`);
          await sleep(10000); // 10 seconds
        }
      }
    }
    
    // Final result
    let finalMessage = `🎉 *Proses rename selesai!*\n\n`;
    finalMessage += `✅ Berhasil: ${successCount}\n`;
    finalMessage += `❌ Gagal: ${failCount}\n\n`;
    finalMessage += `*Detail:*\n${statusMessage}`;
    
    await safeEditMessage(bot, chatId, loadingMsg.message_id, finalMessage, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔄 Rename Lagi', callback_data: 'rename_groups' }],
          [{ text: '🏠 Menu Utama', callback_data: 'main_menu' }]
        ]
      }
    });
    
  } catch (err) {
    console.error('Error in rename process:', err);
    await safeEditMessage(bot, chatId, loadingMsg.message_id, `❌ Error dalam proses rename: ${err.message}`, {
      reply_markup: {
        inline_keyboard: [
          [{ text: '🏠 Menu Utama', callback_data: 'main_menu' }]
        ]
      }
    });
  } finally {
    // Clear rename state regardless of success/failure
    clearUserFlowState(userStates, userId, 'rename');
  }
}

module.exports = {
  handleGroupCallbacks,
  handleGroupMessages
};
