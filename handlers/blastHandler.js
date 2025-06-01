const { sendBlastMessage } = require('../whatsappClient');
const { showBlastMenu } = require('./menuHandler');
const { 
  safeDeleteMessage, 
  safeEditMessage, 
  parsePhoneNumbers,
  generateProgressMessage,
  isRateLimitError,
  sleep,
  clearUserFlowState
} = require('../utils/helpers');

// Handle Blast-related callbacks
async function handleBlastCallbacks(query, bot, userStates) {
  const chatId = query.message.chat.id;
  const userId = query.from.id;
  const data = query.data;
  
  console.log(`[DEBUG][BLAST] Callback received: ${data} from user ${userId}`);
  
  try {
    switch(true) {
      case data === 'blast':
        console.log(`[DEBUG][BLAST] Showing blast menu`);
        await showBlastMenu(chatId, bot, query.message.message_id);
        break;
        
      case data === 'blast_chat':
        console.log(`[DEBUG][BLAST] Starting blast via chat`);
        await handleBlastChat(chatId, userId, bot, userStates);
        break;
        
      case data === 'blast_file':
        console.log(`[DEBUG][BLAST] Starting blast via file`);
        await handleBlastFile(chatId, userId, bot, userStates);
        break;
        
      case data === 'confirm_blast_numbers':
        console.log(`[DEBUG][BLAST] Confirming blast numbers`);
        await handleConfirmBlastNumbers(chatId, userId, bot, userStates);
        break;
        
      case data.startsWith('set_delay_'):
        const delay = parseInt(data.replace('set_delay_', ''));
        console.log(`[DEBUG][BLAST] Setting delay: ${delay}`);
        await handleSetDelay(chatId, userId, delay, bot, userStates);
        break;
        
      case data === 'custom_delay':
        console.log(`[DEBUG][BLAST] Custom delay input`);
        await handleCustomDelay(chatId, userId, bot, userStates);
        break;
        
      case data === 'confirm_blast':
        console.log(`[DEBUG][BLAST] Confirming blast`);
        await handleConfirmBlast(chatId, userId, bot, userStates);
        break;
        
      case data === 'cancel_blast_flow':
        console.log(`[DEBUG][BLAST] Canceling blast flow`);
        await handleCancelBlastFlow(chatId, userId, bot, userStates);
        break;
        
      default:
        console.log(`[DEBUG][BLAST] Unhandled callback: ${data}`);
        await bot.sendMessage(chatId, '❌ Command blast tidak dikenal.');
        break;
    }
  } catch (err) {
    console.error('Error in blast callback handler:', err);
    await bot.sendMessage(chatId, '❌ Terjadi error saat memproses blast.');
  }
}

// Handle Blast-related messages
async function handleBlastMessages(msg, bot, userStates) {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const text = msg.text;
  
  // Handle blast flow input
  if (userStates[userId]?.blastFlow) {
    const state = userStates[userId].blastFlow;
    
    console.log(`[DEBUG][BLAST] Message received in step: ${state.step}, text: ${text}`);
    
    if (state.step === 'waiting_numbers' && state.inputMethod === 'chat') {
      // Delete user's message
      await safeDeleteMessage(bot, chatId, msg.message_id);
      
      // Parse phone numbers
      const { phoneNumbers, errors } = parsePhoneNumbers(text);
      
      if (errors.length > 0) {
        await bot.sendMessage(chatId, `❌ ${errors.join('\n')}\n\nFormat harus 10-15 digit angka saja, tanpa + atau spasi.`);
        return true;
      }
      
      if (phoneNumbers.length === 0) {
        await bot.sendMessage(chatId, '❌ Tidak ada nomor yang valid!');
        return true;
      }
      
      state.phoneNumbers = phoneNumbers;
      state.step = 'confirm_numbers';
      
      console.log(`[DEBUG][BLAST] Numbers parsed, showing confirmation. Numbers: ${phoneNumbers.length}`);
      await showConfirmBlastNumbers(chatId, userId, bot, userStates);
      return true;
    }
    
    if (state.step === 'waiting_message') {
      // Delete user's message
      await safeDeleteMessage(bot, chatId, msg.message_id);
      
      if (!text || text.trim().length === 0) {
        await bot.sendMessage(chatId, '❌ Pesan tidak boleh kosong!');
        return true;
      }
      
      if (text.trim().length > 1000) {
        await bot.sendMessage(chatId, '❌ Pesan terlalu panjang! Maksimal 1000 karakter.');
        return true;
      }
      
      state.message = text.trim();
      state.step = 'waiting_delay';
      
      console.log(`[DEBUG][BLAST] Message saved, showing delay options`);
      await showDelayOptions(chatId, userId, bot, userStates);
      return true;
    }
    
    if (state.step === 'waiting_custom_delay') {
      // Delete user's message
      await safeDeleteMessage(bot, chatId, msg.message_id);
      
      const delay = parseInt(text.trim());
      
      if (isNaN(delay) || delay < 1) {
        await bot.sendMessage(chatId, '❌ Delay harus berupa angka minimal 1 detik!');
        return true;
      }
      
      if (delay > 60) {
        await bot.sendMessage(chatId, '❌ Delay maksimal 60 detik!');
        return true;
      }
      
      state.delay = delay * 1000; // convert to milliseconds
      state.step = 'confirm_blast';
      
      console.log(`[DEBUG][BLAST] Custom delay set: ${delay} seconds`);
      await showBlastConfirmation(chatId, userId, bot, userStates);
      return true;
    }
  }
  
  return false; // Not handled
}

// Handle blast via chat input
async function handleBlastChat(chatId, userId, bot, userStates) {
  // Check if WhatsApp is connected
  if (!userStates[userId]?.whatsapp?.isConnected) {
    await bot.sendMessage(chatId, '❌ WhatsApp belum terhubung! Login dulu ya.');
    return;
  }
  
  // Initialize blast flow state
  userStates[userId].blastFlow = {
    inputMethod: 'chat',
    step: 'waiting_numbers',
    phoneNumbers: [],
    message: '',
    delay: 3000, // default 3 seconds
    currentIndex: 0
  };
  
  console.log(`[DEBUG][BLAST] Initialized chat flow for user ${userId}`);
  
  const message = `📝 *Input Nomor Target*\n\n`;
  const instructions = `💬 Ketik nomor yang mau di-blast:\n\n`;
  const format = `**Format:**\n62812345\n6213456\n62987654\n\n*(Satu nomor per baris, tanpa + atau spasi)*`;
  
  await bot.sendMessage(chatId, message + instructions + format, {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [{ text: '❌ Batal', callback_data: 'cancel_blast_flow' }]
      ]
    }
  });
}

// Handle blast via file input
async function handleBlastFile(chatId, userId, bot, userStates) {
  // Check if WhatsApp is connected
  if (!userStates[userId]?.whatsapp?.isConnected) {
    await bot.sendMessage(chatId, '❌ WhatsApp belum terhubung! Login dulu ya.');
    return;
  }
  
  // Initialize blast flow state
  userStates[userId].blastFlow = {
    inputMethod: 'file',
    step: 'waiting_file',
    phoneNumbers: [],
    message: '',
    delay: 3000, // default 3 seconds
    currentIndex: 0
  };
  
  console.log(`[DEBUG][BLAST] Initialized file flow for user ${userId}`);
  
  const message = `📄 *Upload File TXT*\n\n`;
  const instructions = `📤 Upload file .txt yang berisi nomor target:\n\n`;
  const format = `**Format dalam file:**\n62812345\n6213456\n62987654\n\n*(Satu nomor per baris, tanpa + atau spasi)*`;
  
  await bot.sendMessage(chatId, message + instructions + format, {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [{ text: '❌ Batal', callback_data: 'cancel_blast_flow' }]
      ]
    }
  });
}

// Show confirm blast numbers
async function showConfirmBlastNumbers(chatId, userId, bot, userStates) {
  const state = userStates[userId].blastFlow;
  
  if (!state || !state.phoneNumbers || state.phoneNumbers.length === 0) {
    console.log(`[DEBUG][BLAST] No valid state or numbers for confirmation`);
    await bot.sendMessage(chatId, '❌ Tidak ada nomor yang valid!');
    return;
  }
  
  console.log(`[DEBUG][BLAST] Showing confirmation for ${state.phoneNumbers.length} numbers`);
  
  let message = `✅ *Nomor Target Berhasil Diparse*\n\n`;
  message += `📊 Total: ${state.phoneNumbers.length} nomor\n\n`;
  message += `📝 **Daftar Nomor:**\n`;
  
  state.phoneNumbers.forEach((number, index) => {
    message += `${index + 1}. ${number}\n`;
    if (index >= 19) { // Limit tampilan 20 nomor pertama
      message += `... dan ${state.phoneNumbers.length - 20} nomor lainnya\n`;
      return false;
    }
  });
  
  message += `\n💬 Lanjut input pesan blast?`;
  
  await bot.sendMessage(chatId, message, {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [{ text: '✅ Lanjut Input Pesan', callback_data: 'confirm_blast_numbers' }],
        [{ text: '❌ Batal', callback_data: 'cancel_blast_flow' }]
      ]
    }
  });
}

// Handle confirm blast numbers
async function handleConfirmBlastNumbers(chatId, userId, bot, userStates) {
  const state = userStates[userId].blastFlow;
  
  if (!state || !state.phoneNumbers || state.phoneNumbers.length === 0) {
    console.log(`[DEBUG][BLAST] No valid numbers to confirm`);
    await bot.sendMessage(chatId, '❌ Tidak ada nomor yang valid!');
    return;
  }
  
  state.step = 'waiting_message';
  
  const message = `💬 *Input Pesan Blast*\n\n`;
  const instructions = `📝 Ketik pesan yang mau dikirim ke ${state.phoneNumbers.length} nomor:\n\n`;
  const note = `*Note: Maksimal 1000 karakter*`;
  
  await bot.sendMessage(chatId, message + instructions + note, {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [{ text: '❌ Batal', callback_data: 'cancel_blast_flow' }]
      ]
    }
  });
}

// Show delay options
async function showDelayOptions(chatId, userId, bot, userStates) {
  const state = userStates[userId].blastFlow;
  
  let message = `⏰ *Setting Delay Pengiriman*\n\n`;
  message += `📞 Target: ${state.phoneNumbers.length} nomor\n`;
  message += `💬 Pesan: "${state.message.substring(0, 50)}${state.message.length > 50 ? '...' : ''}"\n\n`;
  message += `⚡ Pilih delay antar pengiriman:`;
  
  await bot.sendMessage(chatId, message, {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [
          { text: '⚡ 1 detik', callback_data: 'set_delay_1' },
          { text: '🚀 3 detik (Rekomendasi)', callback_data: 'set_delay_3' }
        ],
        [
          { text: '⏰ 5 detik', callback_data: 'set_delay_5' },
          { text: '🐌 10 detik', callback_data: 'set_delay_10' }
        ],
        [{ text: '⚙️ Custom Delay', callback_data: 'custom_delay' }],
        [{ text: '❌ Batal', callback_data: 'cancel_blast_flow' }]
      ]
    }
  });
}

// Handle set delay
async function handleSetDelay(chatId, userId, delay, bot, userStates) {
  const state = userStates[userId].blastFlow;
  
  if (!state) {
    await bot.sendMessage(chatId, '❌ Session expired. Mulai lagi dari menu blast.');
    return;
  }
  
  state.delay = delay * 1000; // convert to milliseconds
  state.step = 'confirm_blast';
  
  console.log(`[DEBUG][BLAST] Delay set to ${delay} seconds`);
  await showBlastConfirmation(chatId, userId, bot, userStates);
}

// Handle custom delay
async function handleCustomDelay(chatId, userId, bot, userStates) {
  const state = userStates[userId].blastFlow;
  
  if (!state) {
    await bot.sendMessage(chatId, '❌ Session expired. Mulai lagi dari menu blast.');
    return;
  }
  
  state.step = 'waiting_custom_delay';
  
  const message = `⚙️ *Custom Delay*\n\n`;
  const instructions = `🔢 Ketik delay dalam detik (1-60):\n\n`;
  const example = `*Contoh: 7 (untuk 7 detik)*`;
  
  await bot.sendMessage(chatId, message + instructions + example, {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [{ text: '❌ Batal', callback_data: 'cancel_blast_flow' }]
      ]
    }
  });
}

// Show blast confirmation
async function showBlastConfirmation(chatId, userId, bot, userStates) {
  const state = userStates[userId].blastFlow;
  
  if (!state) {
    await bot.sendMessage(chatId, '❌ Session expired. Mulai lagi dari menu blast.');
    return;
  }
  
  const firstNumber = state.phoneNumbers[0];
  const lastNumber = state.phoneNumbers[state.phoneNumbers.length - 1];
  const delaySeconds = state.delay / 1000;
  const estimatedTime = Math.ceil((state.phoneNumbers.length * delaySeconds) / 60);
  
  let message = `🔍 *Konfirmasi Blast*\n\n`;
  message += `📊 **Total Nomor:** ${state.phoneNumbers.length}\n`;
  message += `📞 **Nomor Pertama:** ${firstNumber}\n`;
  message += `📞 **Nomor Terakhir:** ${lastNumber}\n\n`;
  message += `💬 **Pesan:**\n"${state.message}"\n\n`;
  message += `⏰ **Delay:** ${delaySeconds} detik\n`;
  message += `🕒 **Estimasi Waktu:** ~${estimatedTime} menit\n\n`;
  message += `⚠️ Proses ini tidak bisa dibatalkan setelah dimulai!`;
  
  await bot.sendMessage(chatId, message, {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [{ text: '🚀 Mulai Blast', callback_data: 'confirm_blast' }],
        [{ text: '❌ Batal', callback_data: 'cancel_blast_flow' }]
      ]
    }
  });
}

// Handle confirm blast
async function handleConfirmBlast(chatId, userId, bot, userStates) {
  const state = userStates[userId].blastFlow;
  
  if (!state || !state.phoneNumbers || state.phoneNumbers.length === 0) {
    console.log(`[DEBUG][BLAST] Invalid state for confirm blast`);
    await bot.sendMessage(chatId, '❌ Data tidak lengkap. Mulai lagi ya!');
    return;
  }
  
  const loadingMsg = await bot.sendMessage(chatId, '⏳ Memulai proses blast...');
  
  try {
    let statusMessage = '';
    let successCount = 0;
    let failCount = 0;
    const totalNumbers = state.phoneNumbers.length;
    
    state.step = 'processing';
    
    for (let i = 0; i < state.phoneNumbers.length; i++) {
      const phoneNumber = state.phoneNumbers[i];
      state.currentIndex = i + 1;
      
      try {
        // Send message
        await sendBlastMessage(userId, phoneNumber, state.message);
        
        successCount++;
        statusMessage += `✅ ${phoneNumber}\n`;
        
        console.log(`[DEBUG][BLAST] Successfully sent to ${phoneNumber} (${i + 1}/${totalNumbers})`);
        
        // Update progress
        const progressMsg = generateProgressMessage(i + 1, totalNumbers, statusMessage, 'Blast');
        await safeEditMessage(bot, chatId, loadingMsg.message_id, progressMsg);
        
        // Delay sebelum kirim ke nomor berikutnya (kecuali nomor terakhir)
        if (i < state.phoneNumbers.length - 1) {
          await sleep(state.delay);
        }
        
      } catch (err) {
        failCount++;
        statusMessage += `❌ ${phoneNumber}: ${err.message}\n`;
        console.error(`[DEBUG][BLAST] Failed to send to ${phoneNumber}:`, err);
        
        // If rate limit, wait longer
        if (isRateLimitError(err)) {
          console.log(`[DEBUG][BLAST] Rate limit detected, waiting extra time...`);
          await sleep(state.delay + 5000); // extra 5 seconds
        }
      }
    }
    
    // Final result
    let finalMessage = `🎉 *Blast Selesai!*\n\n`;
    finalMessage += `✅ Berhasil: ${successCount}\n`;
    finalMessage += `❌ Gagal: ${failCount}\n`;
    finalMessage += `📊 Total: ${totalNumbers} nomor\n\n`;
    finalMessage += `*Detail:*\n${statusMessage}`;
    
    await safeEditMessage(bot, chatId, loadingMsg.message_id, finalMessage, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '⚡ Blast Lagi', callback_data: 'blast' }],
          [{ text: '🏠 Menu Utama', callback_data: 'main_menu' }]
        ]
      }
    });
    
  } catch (err) {
    console.error('Error in blast process:', err);
    await safeEditMessage(bot, chatId, loadingMsg.message_id, `❌ Error dalam proses blast: ${err.message}`, {
      reply_markup: {
        inline_keyboard: [
          [{ text: '🏠 Menu Utama', callback_data: 'main_menu' }]
        ]
      }
    });
  }
  
  // Clear blast flow state
  clearUserFlowState(userStates, userId, 'blast');
}

// Handle cancel blast flow
async function handleCancelBlastFlow(chatId, userId, bot, userStates) {
  // Clear blast flow state
  clearUserFlowState(userStates, userId, 'blast');
  
  await bot.sendMessage(chatId, '✅ Proses blast dibatalkan!');
  await showBlastMenu(chatId, bot);
}

module.exports = {
  handleBlastCallbacks,
  handleBlastMessages,
  showConfirmBlastNumbers // Export function ini juga
};