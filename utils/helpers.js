const config = require('../config');

// Check if user is owner
function isOwner(userId) {
  return config.telegram.owners.includes(userId.toString());
}

// Extract number from group name - FIXED VERSION
function extractNumberFromGroupName(groupName) {
  // Try to find number at the end of string first
  const endMatch = groupName.match(/(\d+)\s*$/);
  if (endMatch) {
    return parseInt(endMatch[1]);
  }
  
  // If no number at end, try to find any number
  const anyMatch = groupName.match(/\d+/);
  if (anyMatch) {
    return parseInt(anyMatch[0]);
  }
  
  // If no number found, return 0
  return 0;
}

// Format date for Indonesian locale
function formatDate(date) {
  if (!date) return 'N/A';
  return date.toLocaleString('id-ID');
}

// Safe delete message
async function safeDeleteMessage(bot, chatId, messageId) {
  try {
    await bot.deleteMessage(chatId, messageId);
    return true;
  } catch (err) {
    console.warn(`Could not delete message ${messageId}:`, err.message);
    return false;
  }
}

// Safe edit message
async function safeEditMessage(bot, chatId, messageId, text, options = {}) {
  try {
    await bot.editMessageText(text, {
      chat_id: chatId,
      message_id: messageId,
      ...options
    });
    return true;
  } catch (err) {
    console.warn(`Could not edit message ${messageId}:`, err.message);
    // Fallback: send new message
    try {
      await bot.sendMessage(chatId, text, options);
      return true;
    } catch (sendErr) {
      console.error('Failed to send fallback message:', sendErr.message);
      return false;
    }
  }
}

// Create pagination info
function createPagination(currentPage, totalItems, itemsPerPage) {
  const totalPages = Math.ceil(totalItems / itemsPerPage);
  const startIndex = currentPage * itemsPerPage;
  const endIndex = Math.min(startIndex + itemsPerPage, totalItems);
  
  return {
    totalPages,
    currentPage: Math.min(currentPage, totalPages - 1),
    startIndex,
    endIndex,
    hasNext: currentPage < totalPages - 1,
    hasPrev: currentPage > 0
  };
}

// Sleep function
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Clean phone number (remove + and spaces)
function cleanPhoneNumber(phoneNumber) {
  return phoneNumber.replace(/[^\d]/g, '');
}

// Validate phone number format
function isValidPhoneNumber(phoneNumber) {
  const cleaned = cleanPhoneNumber(phoneNumber);
  return /^\d{10,15}$/.test(cleaned);
}

// Parse multiple phone numbers from text
function parsePhoneNumbers(text) {
  const lines = text.trim().split('\n');
  const phoneNumbers = [];
  const errors = [];
  
  for (const line of lines) {
    const number = cleanPhoneNumber(line.trim());
    if (!number) continue;
    
    if (isValidPhoneNumber(number)) {
      phoneNumbers.push(number);
    } else {
      errors.push(`Format nomor salah: "${line.trim()}"`);
    }
  }
  
  return { phoneNumbers, errors };
}

// Parse phone numbers from file content
function parsePhoneNumbersFromFile(fileContent) {
  // Split by newlines and clean each line
  const lines = fileContent.trim().split(/\r?\n/);
  const phoneNumbers = [];
  const errors = [];
  
  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine) continue; // Skip empty lines
    
    const number = cleanPhoneNumber(trimmedLine);
    if (!number) continue;
    
    if (isValidPhoneNumber(number)) {
      phoneNumbers.push(number);
    } else {
      errors.push(`Format nomor salah: "${trimmedLine}"`);
    }
  }
  
  return { phoneNumbers, errors };
}

// Get error message for rate limits
function getRateLimitMessage(err) {
  if (err.message.includes('rate') || err.message.includes('overlimit') || err.message.includes('timeout')) {
    return 'Rate limit detected, menunggu sebentar...';
  }
  return err.message;
}

// Check if error is rate limit
function isRateLimitError(err) {
  return err.message.includes('rate') || 
         err.message.includes('overlimit') || 
         err.message.includes('timeout') ||
         err.message.includes('Too Many Requests');
}

// Generate progress message
function generateProgressMessage(currentIndex, totalItems, statusMessage, operation = 'Proses') {
  const percentage = Math.round((currentIndex / totalItems) * 100);
  const progressBar = '█'.repeat(Math.floor(percentage / 10)) + '░'.repeat(10 - Math.floor(percentage / 10));
  
  return `⏳ ${operation}... (${currentIndex}/${totalItems}) ${percentage}%\n\n[${progressBar}]\n\n${statusMessage}`;
}

// Truncate text for display
function truncateText(text, maxLength = 50) {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + '...';
}

// Clear user flow state
function clearUserFlowState(userStates, userId, flowType = null) {
  if (!userStates[userId]) return;
  
  if (flowType) {
    // Clear specific flow
    switch (flowType) {
      case 'admin':
        delete userStates[userId].adminFlow;
        break;
      case 'rename':
        delete userStates[userId].renameState;
        delete userStates[userId].groupedData;
        break;
      case 'auth':
        userStates[userId].waitingForPhone = false;
        break;
      case 'ctc':
        delete userStates[userId].ctcFlow;
        break;
      case 'blast': // Tambah case baru untuk Blast flow
        delete userStates[userId].blastFlow;
        break;
    }
  } else {
    // Clear all flow states
    delete userStates[userId].adminFlow;
    delete userStates[userId].renameState;
    delete userStates[userId].groupedData;
    delete userStates[userId].ctcFlow;
    delete userStates[userId].blastFlow; // Clear Blast flow juga
    userStates[userId].waitingForPhone = false;
  }
}

module.exports = {
  isOwner,
  extractNumberFromGroupName,
  formatDate,
  safeDeleteMessage,
  safeEditMessage,
  createPagination,
  sleep,
  cleanPhoneNumber,
  isValidPhoneNumber,
  parsePhoneNumbers,
  parsePhoneNumbersFromFile,
  getRateLimitMessage,
  isRateLimitError,
  generateProgressMessage,
  truncateText,
  clearUserFlowState
};