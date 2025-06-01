// WhatsApp JID Converter & Mapper Utility - FIXED VERSION

// Get userStates from index.js
function getUserStates() {
  return require('../index').userStates;
}

class WhatsAppJIDMapper {
  constructor() {
    this.jidCache = new Map(); // Cache untuk mapping nomor ke JID
    this.reverseCache = new Map(); // Cache untuk mapping JID ke nomor
  }

  // Generate possible JID formats for a phone number
  generatePossibleJIDs(phoneNumber) {
    const cleanNumber = phoneNumber.replace(/[^\d]/g, '');
    
    const possibleJIDs = [
      `${cleanNumber}@s.whatsapp.net`,
      `${cleanNumber}@lid`,
      `${cleanNumber}:0@s.whatsapp.net`,
      `${cleanNumber}:1@s.whatsapp.net`,
      `${cleanNumber}:2@s.whatsapp.net`,
    ];

    // Add variations without country code if number starts with country code
    if (cleanNumber.startsWith('62') && cleanNumber.length > 10) {
      const withoutCountryCode = cleanNumber.substring(2);
      possibleJIDs.push(
        `${withoutCountryCode}@s.whatsapp.net`,
        `${withoutCountryCode}@lid`,
        `0${withoutCountryCode}@s.whatsapp.net`,
        `0${withoutCountryCode}@lid`
      );
    }

    return possibleJIDs;
  }

  // Extract phone number from JID
  extractNumberFromJID(jid) {
    if (!jid) return null;
    
    // Remove domain and device suffix
    let number = jid.split('@')[0];
    number = number.split(':')[0];
    
    // Remove leading zeros for Indonesian numbers
    if (number.startsWith('0') && number.length > 10) {
      number = '62' + number.substring(1);
    }
    
    return number;
  }

  // Add mapping to cache
  addMapping(phoneNumber, actualJID) {
    const cleanNumber = phoneNumber.replace(/[^\d]/g, '');
    this.jidCache.set(cleanNumber, actualJID);
    this.reverseCache.set(actualJID, cleanNumber);
    
    console.log(`[JID_MAPPER] Cached mapping: ${cleanNumber} → ${actualJID}`);
  }

  // Get cached JID for phone number
  getCachedJID(phoneNumber) {
    const cleanNumber = phoneNumber.replace(/[^\d]/g, '');
    return this.jidCache.get(cleanNumber);
  }

  // Get cached phone number for JID
  getCachedNumber(jid) {
    return this.reverseCache.get(jid);
  }

  // Check if two identifiers match (number vs JID)
  isMatch(phoneNumber, jid) {
    const cleanNumber = phoneNumber.replace(/[^\d]/g, '');
    const extractedNumber = this.extractNumberFromJID(jid);
    
    if (!extractedNumber) return false;

    // Direct match
    if (cleanNumber === extractedNumber) return true;

    // Check if one contains the other (for converted numbers)
    if (cleanNumber.includes(extractedNumber) || extractedNumber.includes(cleanNumber)) {
      return true;
    }

    // Last 8 digits match (fallback)
    const last8Original = cleanNumber.slice(-8);
    const last8Extracted = extractedNumber.slice(-8);
    
    return last8Original === last8Extracted && last8Original.length === 8;
  }

  // Clear cache
  clearCache() {
    this.jidCache.clear();
    this.reverseCache.clear();
  }
}

// Global JID mapper instance
const jidMapper = new WhatsAppJIDMapper();

// Enhanced function to resolve actual JID from phone number
async function resolveActualJID(userId, phoneNumber, sock = null) {
  const userStates = getUserStates();
  
  if (!sock) {
    sock = userStates[userId]?.whatsapp?.socket;
  }
  
  if (!sock) {
    throw new Error('WhatsApp socket not available');
  }

  const cleanNumber = phoneNumber.replace(/[^\d]/g, '');
  
  // Check cache first
  const cachedJID = jidMapper.getCachedJID(cleanNumber);
  if (cachedJID) {
    console.log(`[JID_RESOLVER] Using cached JID for ${cleanNumber}: ${cachedJID}`);
    return cachedJID;
  }

  try {
    // Method 1: Use onWhatsApp API if available (most reliable)
    try {
      const [result] = await sock.onWhatsApp(cleanNumber);
      if (result && result.exists) {
        const resolvedJID = result.jid;
        console.log(`[JID_RESOLVER] onWhatsApp resolved: ${cleanNumber} → ${resolvedJID}`);
        jidMapper.addMapping(cleanNumber, resolvedJID);
        return resolvedJID;
      }
    } catch (err) {
      console.log(`[JID_RESOLVER] onWhatsApp failed for ${cleanNumber}: ${err.message}`);
    }

    // Method 2: Try possible JID formats
    const possibleJIDs = jidMapper.generatePossibleJIDs(cleanNumber);
    
    for (const testJID of possibleJIDs) {
      try {
        // Try to get profile picture as existence check (quick and lightweight)
        await sock.profilePictureUrl(testJID, 'image');
        console.log(`[JID_RESOLVER] Found valid JID via profile check: ${testJID} for number ${cleanNumber}`);
        jidMapper.addMapping(cleanNumber, testJID);
        return testJID;
      } catch (err) {
        // Continue to next JID format
        continue;
      }
    }

    // Method 3: Default to standard format
    const defaultJID = `${cleanNumber}@s.whatsapp.net`;
    console.log(`[JID_RESOLVER] Using default JID format: ${defaultJID}`);
    return defaultJID;

  } catch (err) {
    console.error(`[JID_RESOLVER] Error resolving JID for ${cleanNumber}:`, err);
    return `${cleanNumber}@s.whatsapp.net`; // Fallback
  }
}

// Enhanced function to find participant in group with JID mapping
async function findParticipantInGroupWithMapping(userId, groupId, phoneNumber) {
  const userStates = getUserStates();
  const sock = userStates[userId]?.whatsapp?.socket;
  
  if (!sock) {
    throw new Error('WhatsApp tidak terhubung');
  }

  try {
    console.log(`[FIND_PARTICIPANT] Looking for ${phoneNumber} in group ${groupId}`);
    
    // Get group metadata
    const groupMetadata = await sock.groupMetadata(groupId);
    if (!groupMetadata || !groupMetadata.participants) {
      return null;
    }

    const cleanNumber = phoneNumber.replace(/[^\d]/g, '');
    console.log(`[FIND_PARTICIPANT] All participants:`, groupMetadata.participants.map(p => p.id));

    // Method 1: Direct JID matching
    for (const participant of groupMetadata.participants) {
      if (jidMapper.isMatch(cleanNumber, participant.id)) {
        console.log(`[FIND_PARTICIPANT] Found match: ${cleanNumber} → ${participant.id}`);
        jidMapper.addMapping(cleanNumber, participant.id);
        return participant;
      }
    }

    // Method 2: Try to resolve JID and match
    try {
      const resolvedJID = await resolveActualJID(userId, cleanNumber, sock);
      const exactMatch = groupMetadata.participants.find(p => p.id === resolvedJID);
      
      if (exactMatch) {
        console.log(`[FIND_PARTICIPANT] Found via resolved JID: ${cleanNumber} → ${resolvedJID}`);
        jidMapper.addMapping(cleanNumber, resolvedJID);
        return exactMatch;
      }
    } catch (err) {
      console.log(`[FIND_PARTICIPANT] JID resolution failed: ${err.message}`);
    }

    console.log(`[FIND_PARTICIPANT] No participant found for ${cleanNumber}`);
    return null;

  } catch (err) {
    console.error(`[FIND_PARTICIPANT] Error:`, err);
    return null;
  }
}

// Simple function to check if participant is in group (for backward compatibility)
async function isParticipantInGroupWithMapping(userId, groupId, participantNumber) {
  try {
    const participant = await findParticipantInGroupWithMapping(userId, groupId, participantNumber);
    const isInGroup = participant !== null;
    
    console.log(`[DEBUG][${userId}] Participant ${participantNumber} in group: ${isInGroup}`);
    if (isInGroup) {
      console.log(`[DEBUG][${userId}] Found as JID: ${participant.id}`);
    }
    
    return isInGroup;
  } catch (err) {
    console.error(`[ERROR][${userId}] Error checking participant in group:`, err);
    return false;
  }
}

// Export the mapper and functions
module.exports = {
  WhatsAppJIDMapper,
  jidMapper,
  resolveActualJID,
  findParticipantInGroupWithMapping,
  isParticipantInGroupWithMapping
};