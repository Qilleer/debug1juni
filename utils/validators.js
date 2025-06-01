// Validate WhatsApp connection
function validateWhatsAppConnection(userStates, userId) {
  if (!userStates[userId]?.whatsapp?.isConnected) {
    return {
      valid: false,
      message: '❌ WhatsApp belum terhubung! Login dulu ya.'
    };
  }
  return { valid: true };
}

// Validate phone number format
function validatePhoneNumber(phoneNumber) {
  const cleaned = phoneNumber.replace(/[^\d]/g, '');
  
  if (!/^\d{10,15}$/.test(cleaned)) {
    return {
      valid: false,
      message: '❌ Format nomor salah! Harus 10-15 digit angka saja, tanpa + atau spasi.'
    };
  }
  
  return { valid: true, cleaned };
}

// Validate multiple phone numbers
function validatePhoneNumbers(text) {
  const lines = text.trim().split('\n');
  const phoneNumbers = [];
  const errors = [];
  
  for (const line of lines) {
    const cleaned = line.trim().replace(/[^\d]/g, '');
    if (!cleaned) continue;
    
    const validation = validatePhoneNumber(cleaned);
    if (validation.valid) {
      phoneNumbers.push(validation.cleaned);
    } else {
      errors.push(`Format nomor salah: "${line.trim()}"`);
    }
  }
  
  if (phoneNumbers.length === 0) {
    return {
      valid: false,
      message: '❌ Tidak ada nomor yang valid!',
      phoneNumbers: [],
      errors
    };
  }
  
  return {
    valid: true,
    phoneNumbers,
    errors
  };
}

// Validate group name
function validateGroupName(groupName) {
  const trimmed = groupName.trim();
  
  if (!trimmed || trimmed.length < 1) {
    return {
      valid: false,
      message: '❌ Nama grup tidak boleh kosong!'
    };
  }
  
  if (trimmed.length > 100) {
    return {
      valid: false,
      message: '❌ Nama grup terlalu panjang! Maksimal 100 karakter.'
    };
  }
  
  return { valid: true, cleaned: trimmed };
}

// Validate number input
function validateNumber(input, min = 1, max = null) {
  const num = parseInt(input.trim());
  
  if (isNaN(num)) {
    return {
      valid: false,
      message: '❌ Input harus berupa angka!'
    };
  }
  
  if (num < min) {
    return {
      valid: false,
      message: `❌ Angka harus minimal ${min}!`
    };
  }
  
  if (max !== null && num > max) {
    return {
      valid: false,
      message: `❌ Angka tidak boleh lebih dari ${max}!`
    };
  }
  
  return { valid: true, number: num };
}

// Validate admin flow state
function validateAdminFlowState(userStates, userId, expectedType = null, expectedStep = null) {
  const state = userStates[userId]?.adminFlow;
  
  if (!state) {
    return {
      valid: false,
      message: '❌ Session expired. Mulai lagi dari menu admin.'
    };
  }
  
  if (expectedType && state.type !== expectedType) {
    return {
      valid: false,
      message: '❌ Flow state tidak sesuai. Mulai lagi dari awal.'
    };
  }
  
  if (expectedStep && state.step !== expectedStep) {
    return {
      valid: false,
      message: '❌ Step tidak sesuai. Proses sudah berubah.'
    };
  }
  
  return { valid: true, state };
}

// Validate rename flow state
function validateRenameFlowState(userStates, userId, expectedStep = null) {
  const state = userStates[userId]?.renameState;
  
  if (!state) {
    return {
      valid: false,
      message: '❌ Session expired. Mulai lagi dari menu rename.'
    };
  }
  
  if (expectedStep && state.step !== expectedStep) {
    return {
      valid: false,
      message: '❌ Step tidak sesuai. Proses sudah berubah.'
    };
  }
  
  return { valid: true, state };
}

// Validate user has required groups
function validateUserHasGroups(groups) {
  if (!groups || groups.length === 0) {
    return {
      valid: false,
      message: '❌ Tidak ada grup yang ditemukan!'
    };
  }
  
  return { valid: true };
}

// Validate user selections
function validateUserSelections(selections, minRequired = 1) {
  if (!selections || selections.length < minRequired) {
    return {
      valid: false,
      message: `❌ Minimal harus pilih ${minRequired} item!`
    };
  }
  
  return { valid: true };
}

// Validate array has items
function validateArrayHasItems(arr, itemName = 'item') {
  if (!arr || arr.length === 0) {
    return {
      valid: false,
      message: `❌ Tidak ada ${itemName} yang ditemukan!`
    };
  }
  
  return { valid: true };
}

// Validate pagination parameters
function validatePagination(currentPage, totalItems, itemsPerPage) {
  const totalPages = Math.ceil(totalItems / itemsPerPage);
  
  if (currentPage < 0) {
    return {
      valid: false,
      message: '❌ Halaman tidak valid!',
      correctedPage: 0
    };
  }
  
  if (currentPage >= totalPages) {
    return {
      valid: false,
      message: '❌ Halaman melebihi batas!',
      correctedPage: Math.max(0, totalPages - 1)
    };
  }
  
  return { valid: true };
}

// Validate search query
function validateSearchQuery(query) {
  const trimmed = query.trim();
  
  if (!trimmed) {
    return {
      valid: false,
      message: '❌ Query pencarian tidak boleh kosong!'
    };
  }
  
  if (trimmed.length > 50) {
    return {
      valid: false,
      message: '❌ Query pencarian terlalu panjang! Maksimal 50 karakter.'
    };
  }
  
  return { valid: true, cleaned: trimmed };
}

// Validate range input
function validateRange(startNum, endNum, availableNumbers = []) {
  if (startNum > endNum) {
    return {
      valid: false,
      message: '❌ Nomor awal harus lebih kecil atau sama dengan nomor akhir!'
    };
  }
  
  if (availableNumbers.length > 0) {
    if (!availableNumbers.includes(startNum)) {
      return {
        valid: false,
        message: `❌ Nomor ${startNum} tidak tersedia! Tersedia: ${availableNumbers.join(', ')}`
      };
    }
    
    if (!availableNumbers.includes(endNum)) {
      return {
        valid: false,
        message: `❌ Nomor ${endNum} tidak tersedia! Tersedia: ${availableNumbers.join(', ')}`
      };
    }
  }
  
  return { valid: true };
}

module.exports = {
  validateWhatsAppConnection,
  validatePhoneNumber,
  validatePhoneNumbers,
  validateGroupName,
  validateNumber,
  validateAdminFlowState,
  validateRenameFlowState,
  validateUserHasGroups,
  validateUserSelections,
  validateArrayHasItems,
  validatePagination,
  validateSearchQuery,
  validateRange
};