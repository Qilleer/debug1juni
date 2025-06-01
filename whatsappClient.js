const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers } = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');
const path = require('path');
const config = require('./config');

// Get userStates from index.js
function getUserStates() {
  return require('./index').userStates;
}

// Import JID mapper utilities AFTER getUserStates is defined
const { jidMapper, resolveActualJID, findParticipantInGroupWithMapping, isParticipantInGroupWithMapping } = require('./utils/jidMapper');

// Tracking reconnect attempts
const reconnectAttempts = {};
const MAX_RECONNECT_ATTEMPTS = 3;

// Helper function to check if bot is admin in group - IMPROVED
function isBotAdminInGroup(groupMetadata, botJid, botLid) {
  if (!groupMetadata || !groupMetadata.participants) {
    return false;
  }
  
  // Extract bot number from JID (handle both formats)
  const botNumber = botJid.split('@')[0].split(':')[0];
  const botLidNumber = botLid ? botLid.split('@')[0].split(':')[0] : null;
  
  console.log(`[DEBUG] Checking admin status:`);
  console.log(`[DEBUG] - Bot JID: ${botJid}`);
  console.log(`[DEBUG] - Bot LID: ${botLid}`);
  console.log(`[DEBUG] - Bot numbers: ${botNumber}, ${botLidNumber}`);
  console.log(`[DEBUG] - All participants:`, groupMetadata.participants.map(p => `${p.id} (${p.admin || 'member'})`));
  
  const isAdmin = groupMetadata.participants.some(p => {
    // Must have admin role first
    const hasAdminRole = p.admin === 'admin' || p.admin === 'superadmin';
    if (!hasAdminRole) return false;
    
    // Extract participant number
    const participantNumber = p.id.split('@')[0].split(':')[0];
    
    console.log(`[DEBUG] Checking admin participant: ${p.id} (${p.admin}) - number: ${participantNumber}`);
    
    // Multiple ways to match:
    // 1. Exact JID match
    if (p.id === botJid) {
      console.log(`[DEBUG] ✅ Matched via exact JID: ${p.id} === ${botJid}`);
      return true;
    }
    
    // 2. Exact LID match
    if (botLid && p.id === botLid) {
      console.log(`[DEBUG] ✅ Matched via exact LID: ${p.id} === ${botLid}`);
      return true;
    }
    
    // 3. Number match from JID
    if (botNumber === participantNumber) {
      console.log(`[DEBUG] ✅ Matched via number from JID: ${botNumber} === ${participantNumber}`);
      return true;
    }
    
    // 4. Number match from LID
    if (botLidNumber && botLidNumber === participantNumber) {
      console.log(`[DEBUG] ✅ Matched via number from LID: ${botLidNumber} === ${participantNumber}`);
      return true;
    }
    
    console.log(`[DEBUG] ❌ No match for ${p.id}`);
    return false;
  });
  
  console.log(`[DEBUG] Final admin check result: ${isAdmin}`);
  return isAdmin;
}

// Send blast message to a phone number
async function sendBlastMessage(userId, phoneNumber, message) {
  const userStates = getUserStates();
  
  try {
    const sock = userStates[userId]?.whatsapp?.socket;
    
    if (!sock || !userStates[userId]?.whatsapp?.isConnected) {
      throw new Error('WhatsApp tidak terhubung');
    }
    
    console.log(`[DEBUG][${userId}] Sending blast message to ${phoneNumber}`);
    
    // Prepare recipient JID
    const recipientJid = `${phoneNumber}@s.whatsapp.net`;
    
    // Send message with timeout
    const sendPromise = sock.sendMessage(recipientJid, { text: message });
    
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Send message timeout')), 15000)
    );
    
    const result = await Promise.race([sendPromise, timeoutPromise]);
    
    console.log(`[DEBUG][${userId}] Successfully sent blast message to ${phoneNumber}`);
    
    return result;
  } catch (err) {
    console.error(`[ERROR][${userId}] Error sending blast message to ${phoneNumber}:`, err);
    throw err;
  }
}

// Get all groups from WhatsApp
async function getAllGroups(userId) {
  const userStates = getUserStates();
  
  try {
    const sock = userStates[userId]?.whatsapp?.socket;
    
    if (!sock || !userStates[userId]?.whatsapp?.isConnected) {
      throw new Error('WhatsApp tidak terhubung');
    }
    
    console.log(`[DEBUG][${userId}] Getting all groups...`);
    
    // Get all groups
    const groups = await sock.groupFetchAllParticipating();
    const groupList = [];
    
    for (const groupId in groups) {
      const group = groups[groupId];
      
      // Only include groups where bot is participant
      if (group.participants && group.participants.length > 0) {
        const botJid = sock.user.id;
        const botLid = sock.user.lid;
        
        groupList.push({
          id: groupId,
          name: group.subject || 'Unnamed Group',
          participantCount: group.participants.length,
          isAdmin: isBotAdminInGroup(group, botJid, botLid)
        });
      }
    }
    
    console.log(`[DEBUG][${userId}] Found ${groupList.length} groups`);
    
    // Sort by name
    groupList.sort((a, b) => a.name.localeCompare(b.name));
    
    return groupList;
  } catch (err) {
    console.error(`[ERROR][${userId}] Error getting groups:`, err);
    throw err;
  }
}

// Get group admins
async function getGroupAdmins(userId, groupId) {
  const userStates = getUserStates();
  
  try {
    const sock = userStates[userId]?.whatsapp?.socket;
    
    if (!sock || !userStates[userId]?.whatsapp?.isConnected) {
      throw new Error('WhatsApp tidak terhubung');
    }
    
    console.log(`[DEBUG][${userId}] Getting admins for group ${groupId}`);
    
    // Get group metadata
    const groupMetadata = await sock.groupMetadata(groupId);
    
    if (!groupMetadata || !groupMetadata.participants) {
      throw new Error('Gagal mendapatkan data grup');
    }
    
    // Filter only admins
    const admins = groupMetadata.participants.filter(p => 
      p.admin === 'admin' || p.admin === 'superadmin'
    );
    
    console.log(`[DEBUG][${userId}] Found ${admins.length} admins in group ${groupId}`);
    
    return admins;
  } catch (err) {
    console.error(`[ERROR][${userId}] Error getting group admins:`, err);
    throw err;
  }
}

// Check if participant is in group - IMPROVED VERSION
async function isParticipantInGroup(userId, groupId, participantNumber) {
  try {
    // Use the improved function from jidMapper
    return await isParticipantInGroupWithMapping(userId, groupId, participantNumber);
  } catch (err) {
    console.error(`[ERROR][${userId}] Error checking participant in group:`, err);
    return false;
  }
}

// Helper function to find participant JID in group - NEW FUNCTION  
async function findParticipantJidInGroup(userId, groupId, participantNumber) {
  const userStates = getUserStates();
  
  try {
    const sock = userStates[userId]?.whatsapp?.socket;
    
    if (!sock || !userStates[userId]?.whatsapp?.isConnected) {
      throw new Error('WhatsApp tidak terhubung');
    }
    
    console.log(`[DEBUG][${userId}] Finding JID for ${participantNumber} in group ${groupId}`);
    
    // Get fresh group metadata
    const groupMetadata = await sock.groupMetadata(groupId);
    
    if (!groupMetadata || !groupMetadata.participants) {
      return null;
    }
    
    // Find participant with flexible matching
    const participant = groupMetadata.participants.find(p => {
      // Method 1: Exact matches
      if (p.id === `${participantNumber}@s.whatsapp.net` || p.id === `${participantNumber}@lid`) {
        return true;
      }
      
      // Method 2: Number extraction
      const participantNumberFromJid = p.id.split('@')[0].split(':')[0];
      if (participantNumberFromJid === participantNumber) {
        return true;
      }
      
      // Method 3: Partial matching
      if (participantNumber.includes(participantNumberFromJid) || participantNumberFromJid.includes(participantNumber)) {
        return true;
      }
      
      // Method 4: Last 8 digits
      const last8Original = participantNumber.slice(-8);
      const last8JID = participantNumberFromJid.slice(-8);
      if (last8Original === last8JID && last8Original.length === 8) {
        return true;
      }
      
      return false;
    });
    
    if (participant) {
      console.log(`[DEBUG][${userId}] Found participant JID: ${participant.id} for number ${participantNumber}`);
      return participant.id;
    }
    
    console.log(`[DEBUG][${userId}] No JID found for number ${participantNumber}`);
    return null;
  } catch (err) {
    console.error(`[ERROR][${userId}] Error finding participant JID:`, err);
    return null;
  }
}

// Add participant to group - FIXED VERSION
async function addParticipantToGroup(userId, groupId, participantNumber) {
  const userStates = getUserStates();
  
  try {
    const sock = userStates[userId]?.whatsapp?.socket;
    
    if (!sock || !userStates[userId]?.whatsapp?.isConnected) {
      throw new Error('WhatsApp tidak terhubung');
    }
    
    console.log(`[DEBUG][${userId}] Adding ${participantNumber} to group ${groupId}`);
    
    // Get fresh group metadata BEFORE adding
    const groupMetadataBefore = await sock.groupMetadata(groupId);
    const participantsBefore = groupMetadataBefore.participants.map(p => p.id);
    console.log(`[DEBUG][${userId}] Participants BEFORE add:`, participantsBefore);
    
    const botJid = sock.user.id;
    const botLid = sock.user.lid;
    
    // Check if bot is admin
    const isAdmin = isBotAdminInGroup(groupMetadataBefore, botJid, botLid);
    
    if (!isAdmin) {
      const canMembersAdd = groupMetadataBefore.memberAddMode === true;
      if (!canMembersAdd) {
        throw new Error('Bot bukan admin dan grup tidak mengizinkan member menambah participant');
      }
    }
    
    // Step 1: Try to resolve the correct JID for this number
    let targetJID;
    try {
      targetJID = await resolveActualJID(userId, participantNumber, sock);
      console.log(`[DEBUG][${userId}] Resolved JID: ${participantNumber} → ${targetJID}`);
    } catch (err) {
      console.log(`[DEBUG][${userId}] JID resolution failed, using standard format`);
      targetJID = `${participantNumber}@s.whatsapp.net`;
    }
    
    // Step 2: Try multiple JID formats including the resolved one
    const participantJids = [
      targetJID, // Resolved JID first
      `${participantNumber}@s.whatsapp.net`,
      `${participantNumber}@lid`
    ];
    
    // Remove duplicates
    const uniqueJids = [...new Set(participantJids)];
    
    let addResult = null;
    let lastError = null;
    let actualAddedJid = null;
    
    // Try different JID formats
    for (const participantJid of uniqueJids) {
      try {
        console.log(`[DEBUG][${userId}] Trying to add with JID: ${participantJid}`);
        
        const addPromise = sock.groupParticipantsUpdate(
          groupId,
          [participantJid],
          'add'
        );
        
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Add participant timeout')), 20000)
        );
        
        addResult = await Promise.race([addPromise, timeoutPromise]);
        
        console.log(`[DEBUG][${userId}] Add participant result:`, addResult);
        
        // Check result
        if (addResult && addResult.length > 0) {
          const participantResult = addResult[0];
          console.log(`[DEBUG][${userId}] Result status: ${participantResult.status}, JID: ${participantResult.jid}`);
          
          if (participantResult.status === '200') {
            actualAddedJid = participantResult.jid;
            console.log(`[DEBUG][${userId}] Successfully added ${participantNumber} as ${actualAddedJid}`);
            
            // Cache the successful mapping
            jidMapper.addMapping(participantNumber, actualAddedJid);
            break;
          } else if (participantResult.status === '409') {
            // Participant already exists - cache this mapping
            actualAddedJid = participantResult.jid;
            console.log(`[DEBUG][${userId}] Participant already exists as ${actualAddedJid}`);
            
            jidMapper.addMapping(participantNumber, actualAddedJid);
            break;
          } else {
            lastError = new Error(`Status ${participantResult.status}: ${getAddParticipantErrorMessage(participantResult.status)}`);
          }
        }
      } catch (err) {
        console.log(`[DEBUG][${userId}] Failed with JID ${participantJid}: ${err.message}`);
        lastError = err;
        continue;
      }
    }
    
    // Step 3: Verify the add operation
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Get fresh group metadata AFTER adding
    const groupMetadataAfter = await sock.groupMetadata(groupId);
    const participantsAfter = groupMetadataAfter.participants.map(p => p.id);
    console.log(`[DEBUG][${userId}] Participants AFTER add:`, participantsAfter);
    
    // Check if any new participant was added
    const newParticipants = participantsAfter.filter(p => !participantsBefore.includes(p));
    console.log(`[DEBUG][${userId}] New participants detected:`, newParticipants);
    
    if (newParticipants.length > 0) {
      // Cache mapping for any new participants
      for (const newJid of newParticipants) {
        if (jidMapper.isMatch(participantNumber, newJid)) {
          console.log(`[DEBUG][${userId}] ✅ Confirmed: ${participantNumber} was added as ${newJid}`);
          jidMapper.addMapping(participantNumber, newJid);
          return true;
        }
      }
      
      // If no exact match but someone was added, assume success
      console.log(`[DEBUG][${userId}] ⚠️ Someone was added, assuming success`);
      return true;
    }
    
    // Check if target participant already exists using JID mapping
    const existingParticipant = await findParticipantInGroupWithMapping(userId, groupId, participantNumber);
    
    if (existingParticipant) {
      console.log(`[DEBUG][${userId}] ✅ Participant ${participantNumber} found in group as ${existingParticipant.id}`);
      return true;
    }
    
    // If we get here, the add probably failed
    if (lastError) {
      throw lastError;
    } else {
      throw new Error(`Gagal menambah participant ${participantNumber}. Nomor mungkin tidak valid atau diblokir.`);
    }
    
  } catch (err) {
    console.error(`[ERROR][${userId}] Error adding participant ${participantNumber} to group ${groupId}:`, err);
    throw err;
  }
}

// Get error message for add participant status codes
function getAddParticipantErrorMessage(statusCode) {
  const errorMessages = {
    '403': 'Nomor tidak bisa ditambahkan ke grup (mungkin privasi atau blokir)',
    '408': 'Timeout - nomor tidak merespons',
    '409': 'Participant sudah ada di grup',
    '400': 'Request tidak valid',
    '401': 'Bot tidak memiliki izin',
    '404': 'Nomor tidak ditemukan'
  };
  
  return errorMessages[statusCode] || 'Error tidak dikenal';
}

// Promote participant to admin - ULTRA FIXED VERSION
async function promoteParticipant(userId, groupId, participantNumber) {
  const userStates = getUserStates();
  
  try {
    const sock = userStates[userId]?.whatsapp?.socket;
    
    if (!sock || !userStates[userId]?.whatsapp?.isConnected) {
      throw new Error('WhatsApp tidak terhubung');
    }
    
    console.log(`[DEBUG][${userId}] Promoting ${participantNumber} to admin in group ${groupId}`);
    
    // Get FRESH group metadata
    const groupMetadata = await sock.groupMetadata(groupId);
    const botJid = sock.user.id;
    const botLid = sock.user.lid;
    
    // Check if bot is admin
    const isAdmin = isBotAdminInGroup(groupMetadata, botJid, botLid);
    
    if (!isAdmin) {
      throw new Error('Bot bukan admin di grup ini');
    }
    
    console.log(`[DEBUG][${userId}] All participants:`, groupMetadata.participants.map(p => `${p.id} (${p.admin || 'member'})`));
    
    // Find participant using JID mapping
    let targetParticipant = await findParticipantInGroupWithMapping(userId, groupId, participantNumber);
    
    if (!targetParticipant) {
      // Try again with fresh metadata after waiting
      console.log(`[DEBUG][${userId}] Participant not found, waiting 5 seconds and retrying...`);
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      const freshGroupMetadata = await sock.groupMetadata(groupId);
      console.log(`[DEBUG][${userId}] Fresh participants:`, freshGroupMetadata.participants.map(p => `${p.id} (${p.admin || 'member'})`));
      
      targetParticipant = await findParticipantInGroupWithMapping(userId, groupId, participantNumber);
      
      if (!targetParticipant) {
        // Show debug info
        console.log(`[DEBUG][${userId}] DEBUGGING - All participants with numbers:`);
        freshGroupMetadata.participants.forEach(p => {
          const extractedNumber = jidMapper.extractNumberFromJID(p.id);
          console.log(`[DEBUG][${userId}]   - JID: ${p.id}, Extracted: ${extractedNumber}, Target: ${participantNumber}`);
        });
        
        throw new Error(`Participant ${participantNumber} tidak ditemukan di grup`);
      }
    }
    
    console.log(`[DEBUG][${userId}] Using participant JID: ${targetParticipant.id} for number ${participantNumber}`);
    
    // Use the actual JID from group metadata for promote
    const actualJid = targetParticipant.id;
    
    // Promote participant with timeout
    const promotePromise = sock.groupParticipantsUpdate(
      groupId,
      [actualJid],
      'promote'
    );
    
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Promote timeout')), 25000)
    );
    
    const result = await Promise.race([promotePromise, timeoutPromise]);
    
    console.log(`[DEBUG][${userId}] Promote result:`, result);
    
    // Check result
    if (result && result.length > 0) {
      const participantResult = result[0];
      if (participantResult.status === '200') {
        console.log(`[DEBUG][${userId}] Successfully promoted ${participantNumber} (JID: ${actualJid}) in group ${groupId}`);
        return true;
      } else {
        const errorCode = participantResult.status || 'unknown';
        throw new Error(`Gagal promote: ${errorCode}`);
      }
    }
    
    return true;
  } catch (err) {
    console.error(`[ERROR][${userId}] Error promoting participant ${participantNumber} in group ${groupId}:`, err);
    throw err;
  }
}

// Demote participant from admin
async function demoteParticipant(userId, groupId, participantNumber) {
  const userStates = getUserStates();
  
  try {
    const sock = userStates[userId]?.whatsapp?.socket;
    
    if (!sock || !userStates[userId]?.whatsapp?.isConnected) {
      throw new Error('WhatsApp tidak terhubung');
    }
    
    console.log(`[DEBUG][${userId}] Demoting ${participantNumber} from admin in group ${groupId}`);
    
    // Get group metadata
    const groupMetadata = await sock.groupMetadata(groupId);
    const botJid = sock.user.id;
    const botLid = sock.user.lid;
    
    // Check if bot is admin
    const isAdmin = isBotAdminInGroup(groupMetadata, botJid, botLid);
    
    if (!isAdmin) {
      throw new Error('Bot bukan admin di grup ini');
    }
    
    // Find admin participant with flexible matching
    const targetParticipant = groupMetadata.participants.find(p => {
      const participantNumberFromJid = p.id.split('@')[0].split(':')[0];
      return (p.id === `${participantNumber}@s.whatsapp.net` || 
              p.id === `${participantNumber}@lid` ||
              participantNumberFromJid === participantNumber) &&
             (p.admin === 'admin' || p.admin === 'superadmin');
    });
    
    if (!targetParticipant) {
      throw new Error('Participant bukan admin atau tidak ada di grup');
    }
    
    // Use actual JID for demote
    const actualJid = targetParticipant.id;
    
    // Demote participant with timeout
    const demotePromise = sock.groupParticipantsUpdate(
      groupId,
      [actualJid],
      'demote'
    );
    
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Demote timeout')), 20000)
    );
    
    const result = await Promise.race([demotePromise, timeoutPromise]);
    
    console.log(`[DEBUG][${userId}] Demote result:`, result);
    
    // Check result
    if (result && result.length > 0) {
      const participantResult = result[0];
      if (participantResult.status === '200') {
        console.log(`[DEBUG][${userId}] Successfully demoted ${participantNumber} in group ${groupId}`);
        return true;
      } else {
        const errorCode = participantResult.status || 'unknown';
        throw new Error(`Gagal demote: ${errorCode}`);
      }
    }
    
    return true;
  } catch (err) {
    console.error(`[ERROR][${userId}] Error demoting participant ${participantNumber} in group ${groupId}:`, err);
    throw err;
  }
}

// Rename a group - FIXED VERSION
async function renameGroup(userId, groupId, newName) {
  const userStates = getUserStates();
  
  try {
    const sock = userStates[userId]?.whatsapp?.socket;
    
    if (!sock || !userStates[userId]?.whatsapp?.isConnected) {
      throw new Error('WhatsApp tidak terhubung');
    }
    
    console.log(`[DEBUG][${userId}] Renaming group ${groupId} to "${newName}"`);
    
    // Check connection status
    if (!sock.user || !sock.user.id) {
      throw new Error('Socket user tidak tersedia');
    }
    
    // Get fresh group metadata
    const groupMetadata = await sock.groupMetadata(groupId);
    
    if (!groupMetadata) {
      throw new Error('Grup tidak ditemukan');
    }
    
    console.log(`[DEBUG][${userId}] Group found: ${groupMetadata.subject}, participants: ${groupMetadata.participants.length}`);
    
    const botJid = sock.user.id;
    const botLid = sock.user.lid;
    
    console.log(`[DEBUG][${userId}] Bot JID: ${botJid}, Bot LID: ${botLid}`);
    
    // Check if bot is admin
    const isAdmin = isBotAdminInGroup(groupMetadata, botJid, botLid);
    
    if (!isAdmin) {
      throw new Error('Bot bukan admin di grup ini');
    }
    
    console.log(`[DEBUG][${userId}] Bot is admin, proceeding with rename...`);
    
    // Rename the group with timeout and retry logic
    let renameSuccess = false;
    let lastError = null;
    const maxAttempts = 3;
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        console.log(`[DEBUG][${userId}] Rename attempt ${attempt}/${maxAttempts}`);
        
        const renamePromise = sock.groupUpdateSubject(groupId, newName);
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Rename timeout')), 20000)
        );
        
        await Promise.race([renamePromise, timeoutPromise]);
        
        console.log(`[DEBUG][${userId}] Successfully renamed group ${groupId} to "${newName}"`);
        renameSuccess = true;
        break;
        
      } catch (err) {
        console.log(`[DEBUG][${userId}] Rename attempt ${attempt} failed: ${err.message}`);
        lastError = err;
        
        if (attempt < maxAttempts) {
          // Wait before retry
          console.log(`[DEBUG][${userId}] Waiting 5 seconds before retry...`);
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
      }
    }
    
    if (!renameSuccess) {
      throw lastError || new Error('All rename attempts failed');
    }
    
    return true;
  } catch (err) {
    console.error(`[ERROR][${userId}] Error renaming group ${groupId}:`, err);
    throw err;
  }
}

// Check and approve pending join requests
async function checkPendingRequests(userId, sock) {
  const userStates = getUserStates();
  
  // Only process if auto accept is enabled
  if (!userStates[userId]?.autoAccept?.enabled) {
    console.log(`[DEBUG][${userId}] Auto accept disabled, skipping pending requests check`);
    return;
  }
  
  try {
    console.log(`[DEBUG][${userId}] Checking for pending join requests...`);
    
    // Get all groups where this bot is admin
    const groups = await sock.groupFetchAllParticipating();
    
    for (const groupId in groups) {
      const group = groups[groupId];
      
      // Check if bot is admin in this group using improved logic
      const botJid = sock.user.id;
      const botLid = sock.user.lid;
      
      const isAdmin = isBotAdminInGroup(group, botJid, botLid);
      
      console.log(`[DEBUG][${userId}] Is admin in group ${groupId}: ${isAdmin}`);
      
      if (!isAdmin) {
        console.log(`[DEBUG][${userId}] Not admin in group ${groupId}, skipping`);
        continue;
      }
      
      console.log(`[DEBUG][${userId}] Checking group ${groupId} for pending requests...`);
      
      try {
        // Try multiple methods to get pending requests
        let pendingRequests = [];
        
        // Method 1: Try groupRequestParticipantsList
        try {
          const requests1 = await sock.groupRequestParticipantsList(groupId);
          if (requests1 && requests1.length > 0) {
            pendingRequests = requests1;
            console.log(`[DEBUG][${userId}] Method 1: Found ${requests1.length} pending requests`);
          }
        } catch (err) {
          console.log(`[DEBUG][${userId}] Method 1 failed: ${err.message}`);
        }
        
        // Method 2: Try groupGetInviteInfo if method 1 fails
        if (pendingRequests.length === 0) {
          try {
            const groupInfo = await sock.groupMetadata(groupId);
            console.log(`[DEBUG][${userId}] Group metadata:`, JSON.stringify(groupInfo, null, 2));
            
            // Check if there are pending requests in metadata
            if (groupInfo.pendingParticipants && groupInfo.pendingParticipants.length > 0) {
              pendingRequests = groupInfo.pendingParticipants;
              console.log(`[DEBUG][${userId}] Method 2: Found ${pendingRequests.length} pending requests in metadata`);
            }
          } catch (err) {
            console.log(`[DEBUG][${userId}] Method 2 failed: ${err.message}`);
          }
        }
        
        // Process pending requests if found
        if (pendingRequests && pendingRequests.length > 0) {
          console.log(`[DEBUG][${userId}] Processing ${pendingRequests.length} pending requests in group ${groupId}`);
          
          // Approve all pending requests
          for (const request of pendingRequests) {
            try {
              const participantJid = request.jid || request.id || request;
              console.log(`[DEBUG][${userId}] Attempting to approve: ${participantJid}`);
              
              await sock.groupRequestParticipantsUpdate(
                groupId,
                [participantJid],
                'approve'
              );
              console.log(`[DEBUG][${userId}] ✅ Auto approved pending request from ${participantJid} in group ${groupId}`);
              
              // Small delay to avoid rate limits
              await new Promise(resolve => setTimeout(resolve, 1000));
            } catch (err) {
              console.error(`[ERROR][${userId}] Failed to approve ${request.jid || request.id || request}:`, err.message);
            }
          }
        } else {
          console.log(`[DEBUG][${userId}] No pending requests found for group ${groupId}`);
        }
      } catch (err) {
        console.log(`[DEBUG][${userId}] Could not check pending requests for group ${groupId}: ${err.message}`);
      }
    }
  } catch (err) {
    console.error(`[ERROR][${userId}] Error checking pending requests:`, err.message);
  }
}

// Restore all existing sessions on startup
async function restoreAllSessions(bot) {
  const sessionsPath = config.whatsapp.sessionPath;
  const restoredSessions = [];
  
  if (!fs.existsSync(sessionsPath)) {
    console.log('No sessions directory found');
    return restoredSessions;
  }
  
  try {
    const sessionDirs = fs.readdirSync(sessionsPath)
      .filter(dir => dir.startsWith('wa_') && fs.statSync(path.join(sessionsPath, dir)).isDirectory());
    
    console.log(`Found ${sessionDirs.length} potential sessions:`, sessionDirs);
    
    for (const sessionDir of sessionDirs) {
      try {
        // Extract userId from folder name (wa_12345 -> 12345)
        const userId = sessionDir.replace('wa_', '');
        
        // Check if session has required files
        const sessionPath = path.join(sessionsPath, sessionDir);
        const credsFile = path.join(sessionPath, 'creds.json');
        
        if (!fs.existsSync(credsFile)) {
          console.log(`Skipping ${sessionDir} - no creds.json found`);
          continue;
        }
        
        console.log(`Restoring session for userId: ${userId}`);
        
        // Create connection for this user
        const sock = await createWhatsAppConnection(userId, bot, false, true);
        
        if (sock) {
          restoredSessions.push(userId);
          console.log(`✅ Session restored for userId: ${userId}`);
          
          // Wait a bit between connections to avoid rate limits
          await new Promise(resolve => setTimeout(resolve, 1000));
        } else {
          console.log(`❌ Failed to restore session for userId: ${userId}`);
        }
      } catch (err) {
        console.error(`Error restoring session ${sessionDir}:`, err.message);
      }
    }
    
    return restoredSessions;
  } catch (err) {
    console.error('Error scanning sessions directory:', err);
    return restoredSessions;
  }
}

// Create WhatsApp connection
async function createWhatsAppConnection(userId, bot, reconnect = false, isRestore = false) {
  try {
    const sessionPath = path.join(config.whatsapp.sessionPath, `wa_${userId}`);
    
    // Pastikan folder session ada (JANGAN HAPUS SESSION LAMA)
    if (!fs.existsSync(sessionPath)) {
      fs.mkdirSync(sessionPath, { recursive: true });
    }
    
    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
    
    // Check if this is a fresh session or existing one
    const isExistingSession = fs.existsSync(path.join(sessionPath, 'creds.json'));
    
    // Buat socket dengan browser config lengkap
    const sock = makeWASocket({
      printQRInTerminal: false,
      auth: state,
      logger: pino({ level: "silent" }),
      browser: Browsers.macOS("Safari"),
      connectTimeoutMs: 60000,
      keepAliveIntervalMs: 10000,
      retryRequestDelayMs: 5000
    });
    
    // Log all events for debugging (compatible version)
    sock.ev.process(
      async (events) => {
        for (const key in events) {
          if (events[key]) {
            console.log(`[DEBUG][${userId}][process] Event:`, key, JSON.stringify(events[key], null, 2));
          }
        }
      }
    );
    
    // Save user state
    const userStates = getUserStates();
    
    if (!userStates[userId]) {
      userStates[userId] = {};
    }
    
    userStates[userId].whatsapp = {
      socket: sock,
      isConnected: false,
      lastConnect: null,
      isWaitingForPairingCode: false,
      isWaitingForQR: false,
      lastQRTime: null,
      isExistingSession: isExistingSession
    };
    
    // Initialize auto accept - restore previous setting
    if (!userStates[userId].autoAccept) {
      // Try to load previous auto accept setting from file
      const settingsPath = path.join(sessionPath, 'settings.json');
      let autoAcceptEnabled = false;
      
      if (fs.existsSync(settingsPath)) {
        try {
          const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
          autoAcceptEnabled = settings.autoAccept || false;
        } catch (err) {
          console.warn(`Error loading settings for ${userId}:`, err.message);
        }
      }
      
      userStates[userId].autoAccept = {
        enabled: autoAcceptEnabled
      };
    }
    
    // Save credentials when updated
    sock.ev.on('creds.update', saveCreds);
    
    // Handle connection update
    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;
      
      console.log(`[DEBUG] Connection update for ${userId}: ${connection}`);
      
      // Handle QR code if available (only for new sessions)
      if (qr && !isExistingSession && userStates[userId]?.whatsapp?.isWaitingForQR) {
        const now = Date.now();
        const lastQRTime = userStates[userId].whatsapp.lastQRTime || 0;
        
        if (now - lastQRTime < 30000) {
          console.log(`[DEBUG] Skipping QR code for ${userId} - too soon since last QR`);
          return;
        }
        
        try {
          userStates[userId].whatsapp.lastQRTime = now;
          
          const qrUrl = await require('qrcode').toDataURL(qr);
          const qrBuffer = Buffer.from(qrUrl.split(',')[1], 'base64');
          
          await bot.sendPhoto(userId, qrBuffer, {
            caption: "🔒 *Scan QR Code ini dengan WhatsApp*\n\nBuka WhatsApp > Menu > Perangkat Tertaut > Tautkan Perangkat\n\nQR code valid selama 60 detik!",
            parse_mode: 'Markdown'
          });
          
          console.log(`[DEBUG] Sent QR code to user ${userId}`);
        } catch (qrErr) {
          console.error(`[ERROR] Failed to send QR code: ${qrErr.message}`);
          await bot.sendMessage(userId, "❌ Error saat mengirim QR code. Coba lagi nanti.");
        }
      }
      
      if (connection === "open") {
        console.log(`WhatsApp connection open for user: ${userId}`);
        
        // Reset reconnect attempts
        reconnectAttempts[userId] = 0;
        
        // Setup auto accept handler
        setupAutoAcceptHandler(userId);
        
        // Update state
        if (userStates[userId] && userStates[userId].whatsapp) {
          userStates[userId].whatsapp.isConnected = true;
          userStates[userId].whatsapp.lastConnect = new Date();
          userStates[userId].whatsapp.isWaitingForPairingCode = false;
          userStates[userId].whatsapp.isWaitingForQR = false;
          userStates[userId].whatsapp.lastQRTime = null;
          
          // Save settings
          await saveUserSettings(userId);
        }
        
        // Check and approve pending requests after connection is stable
        setTimeout(async () => {
          await checkPendingRequests(userId, sock);
        }, 5000); // Wait 5 seconds for connection to stabilize
        
        // Send success message
        if (isRestore) {
          console.log(`Session restored for userId: ${userId}`);
        } else if (reconnect) {
          await bot.sendMessage(
            userId,
            "✅ *Reconnect berhasil!* Bot WhatsApp sudah terhubung kembali.",
            { parse_mode: 'Markdown' }
          );
        } else if (!isRestore) {
          await bot.sendMessage(
            userId,
            "🚀 *Bot WhatsApp berhasil terhubung!*\n\nSekarang kamu bisa menggunakan auto accept!",
            { parse_mode: 'Markdown' }
          );
        }
      } else if (connection === "close") {
        // Update state
        if (userStates[userId] && userStates[userId].whatsapp) {
          userStates[userId].whatsapp.isConnected = false;
        }
        
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const disconnectReason = lastDisconnect?.error?.output?.payload?.message || "Unknown";
        
        console.log(`[DEBUG] Connection closed for userId ${userId}. Status code: ${statusCode}, Reason: ${disconnectReason}`);
        
        // Cek apakah perlu reconnect
        let shouldReconnect = true;
        
        // Status code 401 atau 403 biasanya logout/banned
        if (statusCode === 401 || statusCode === 403) {
          shouldReconnect = false;
        }
        
        // Tambah tracking reconnect attempts
        if (!reconnectAttempts[userId]) {
          reconnectAttempts[userId] = 0;
        }
        
        // Logika reconnect
        if (shouldReconnect && userStates[userId] && reconnectAttempts[userId] < MAX_RECONNECT_ATTEMPTS) {
          // Increment attempt counter
          reconnectAttempts[userId]++;
          
          // Notify user on first attempt only (skip for restore)
          if (reconnectAttempts[userId] === 1 && !isRestore) {
            await bot.sendMessage(
              userId, 
              `⚠️ *Koneksi terputus*\nReason: ${disconnectReason}\n\nSedang mencoba reconnect... (Attempt ${reconnectAttempts[userId]}/${MAX_RECONNECT_ATTEMPTS})`,
              { parse_mode: 'Markdown' }
            );
          }
          
          // Wait before reconnect
          setTimeout(async () => {
            if (userStates[userId]) {
              console.log(`[DEBUG] Attempting to reconnect for userId: ${userId} (Attempt ${reconnectAttempts[userId]}/${MAX_RECONNECT_ATTEMPTS})`);
              await createWhatsAppConnection(userId, bot, true);
            }
          }, config.whatsapp.reconnectDelay || 5000);
        } else if (userStates[userId]) {
          // Reset attempts
          reconnectAttempts[userId] = 0;
          
          // Send permanent disconnect message (skip for restore)
          if (!isRestore) {
            await bot.sendMessage(
              userId, 
              "❌ *Koneksi terputus permanen*\nPerlu login ulang pakai pairing code lagi.", 
              { parse_mode: 'Markdown' }
            );
          }
          
          // Delete session files only if logout/banned
          if (statusCode === 401 || statusCode === 403) {
            const sessionPath = path.join(config.whatsapp.sessionPath, `wa_${userId}`);
            if (fs.existsSync(sessionPath)) {
              fs.rmSync(sessionPath, { recursive: true, force: true });
              console.log(`Session files deleted for userId: ${userId}`);
            }
          }
          
          // Clear user state
          userStates[userId].whatsapp = {
            socket: null,
            isConnected: false,
            lastConnect: null,
            isWaitingForPairingCode: false,
            isWaitingForQR: false,
            lastQRTime: null
          };
        }
      }
    });
    
    // Handle join requests - Multiple event handlers
    sock.ev.on('group.join-request', async (update) => {
      console.log(`[DEBUG][${userId}] group.join-request event:`, JSON.stringify(update, null, 2));
      
      const userStates = getUserStates();
      if (!userStates[userId].autoAccept?.enabled) {
        console.log(`[DEBUG][${userId}] Auto accept disabled for group.join-request`);
        return;
      }

      const { id, participant, author } = update;
      
      try {
        console.log(`[DEBUG][${userId}] Attempting to approve ${participant || author} for group ${id} via group.join-request`);
        
        const targetParticipant = participant || author;
        
        await sock.groupRequestParticipantsUpdate(
          id, // group id
          [targetParticipant], // participant to approve
          'approve' // approve | reject
        );
        console.log(`[DEBUG][${userId}] ✅ Auto approved ${targetParticipant} for group ${id} via group.join-request`);
      } catch (err) {
        console.error(`[ERROR][${userId}] Error auto accepting (group.join-request):`, err.message);
      }
    });
    
    // Additional handler for messages.upsert with GROUP_MEMBERSHIP_JOIN_APPROVAL_REQUEST
    sock.ev.on('messages.upsert', async (messageUpdate) => {
      const userStates = getUserStates();
      if (!userStates[userId].autoAccept?.enabled) return;
      
      const { messages } = messageUpdate;
      
      for (const message of messages) {
        // Check if this is a join approval request message
        if (message.messageStubType === 'GROUP_MEMBERSHIP_JOIN_APPROVAL_REQUEST_NON_ADMIN_ADD') {
          console.log(`[DEBUG][${userId}] Found join approval request in messages.upsert:`, JSON.stringify(message, null, 2));
          
          const groupId = message.key.remoteJid;
          const participant = message.participant;
          const stubParams = message.messageStubParameters || [];
          
          try {
            console.log(`[DEBUG][${userId}] Attempting to approve ${participant} for group ${groupId} via messages.upsert`);
            
            await sock.groupRequestParticipantsUpdate(
              groupId,
              [participant],
              'approve'
            );
            console.log(`[DEBUG][${userId}] ✅ Auto approved ${participant} for group ${groupId} via messages.upsert`);
          } catch (err) {
            console.error(`[ERROR][${userId}] Error auto accepting via messages.upsert:`, err.message);
          }
        }
      }
    });
    
    return sock;
  } catch (err) {
    console.error(`Error creating WhatsApp connection for ${userId}:`, err);
    
    if (!reconnect && !isRestore) {
      await bot.sendMessage(
        userId,
        `❌ Ada error saat membuat koneksi: ${err.message}`
      );
    }
    
    return null;
  }
}

// Save user settings to file
async function saveUserSettings(userId) {
  const userStates = getUserStates();
  
  try {
    const sessionPath = path.join(config.whatsapp.sessionPath, `wa_${userId}`);
    const settingsPath = path.join(sessionPath, 'settings.json');
    
    const settings = {
      autoAccept: userStates[userId]?.autoAccept?.enabled || false,
      lastSaved: new Date().toISOString()
    };
    
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    console.log(`Settings saved for userId: ${userId}`);
  } catch (err) {
    console.error(`Error saving settings for userId ${userId}:`, err);
  }
}

// Generate pairing code
async function generatePairingCode(userId, phoneNumber, bot, messageId) {
  const userStates = getUserStates();
  
  try {
    // Check if socket exists
    if (!userStates[userId]?.whatsapp?.socket) {
      throw new Error("Koneksi WhatsApp belum dibuat");
    }
    
    const sock = userStates[userId].whatsapp.socket;
    
    // Set flag to indicate we're in pairing phase
    userStates[userId].whatsapp.isWaitingForPairingCode = true;
    
    // Store phone number
    userStates[userId].whatsapp.phoneNumber = phoneNumber;
    
    // Delete loading message
    try {
      await bot.deleteMessage(userId, messageId);
    } catch (err) {
      console.warn(`Could not delete loading message: ${err.message}`);
    }
    
    // Request pairing code with options
    const code = await sock.requestPairingCode(phoneNumber);
    
    // Send pairing code
    await bot.sendMessage(
      userId,
      `🔑 *Pairing Code:*\n\n*${code}*\n\nMasukkan code di atas ke WhatsApp kamu dalam 60 detik!\n\nBuka WhatsApp > Menu > Perangkat Tertaut > Tautkan Perangkat\n\nKalau terputus, otomatis akan reconnect!`,
      { 
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '❌ Batal', callback_data: 'cancel_login' }]
          ]
        }
      }
    );
    
    return true;
  } catch (err) {
    console.error(`Error generating pairing code for ${userId}:`, err);
    
    // Delete loading message if exists
    try {
      await bot.deleteMessage(userId, messageId);
    } catch (delErr) {
      console.warn(`Could not delete loading message: ${delErr.message}`);
    }
    
    // Send error message
    await bot.sendMessage(
      userId,
      `❌ Gagal membuat pairing code. Coba lagi nanti atau pakai nomor lain`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: '🏠 Menu Utama', callback_data: 'main_menu' }]
          ]
        }
      }
    );
    
    return false;
  }
}

// Setup auto accept handler
function setupAutoAcceptHandler(userId) {
  const userStates = getUserStates();
  const sock = userStates[userId]?.whatsapp?.socket;
  
  if (!sock || userStates[userId].autoAcceptHandlerActive) return;
  
  // Handle join requests
  sock.ev.on('group-participants.update', async (update) => {
    console.log(`[DEBUG][${userId}] Group participants update:`, update);
    
    // Check if auto accept is enabled
    if (!userStates[userId].autoAccept?.enabled) {
      console.log(`[DEBUG][${userId}] Auto accept is disabled, skipping`);
      return;
    }
    
    const { id, participants, action } = update;
    console.log(`[DEBUG][${userId}] Action: ${action}, Group: ${id}, Participants: ${participants.join(', ')}`);
    
    // Only process join_request action
    if (action !== 'join_request') {
      console.log(`[DEBUG][${userId}] Not a join request, skipping`);
      return;
    }
    
    try {
      // Approve all join requests
      for (const jid of participants) {
        console.log(`[DEBUG][${userId}] Attempting to approve ${jid} for group ${id}`);
        await sock.groupRequestParticipantsUpdate(
          id, // group id
          [jid], // participants to approve
          'approve' // approve | reject
        );
        
        console.log(`[DEBUG][${userId}] Successfully approved ${jid} for group ${id}`);
      }
    } catch (err) {
      console.error(`[ERROR][${userId}] Error auto accepting:`, err);
    }
  });
  
  userStates[userId].autoAcceptHandlerActive = true;
}

// Toggle auto accept
async function toggleAutoAccept(userId, enabled) {
  const userStates = getUserStates();
  
  if (!userStates[userId]) {
    userStates[userId] = {};
  }
  
  if (!userStates[userId].autoAccept) {
    userStates[userId].autoAccept = {};
  }
  
  userStates[userId].autoAccept.enabled = enabled;
  
  // Save settings to file
  await saveUserSettings(userId);
  
  // Re-setup handler if enabling
  if (enabled && userStates[userId].whatsapp?.isConnected) {
   setupAutoAcceptHandler(userId);
 }
 
 // Check pending requests if enabling auto accept
 if (enabled && userStates[userId].whatsapp?.isConnected) {
   const sock = userStates[userId].whatsapp.socket;
   if (sock) {
     setTimeout(async () => {
       await checkPendingRequests(userId, sock);
     }, 1000);
   }
 }
 
 return { success: true, enabled };
}

// Get auto accept status
function getAutoAcceptStatus(userId) {
 const userStates = getUserStates();
 return {
   enabled: userStates[userId]?.autoAccept?.enabled || false
 };
}

// Logout WhatsApp
async function logoutWhatsApp(userId) {
 const userStates = getUserStates();
 
 try {
   // Logout if connected
   if (userStates[userId]?.whatsapp?.socket) {
     await userStates[userId].whatsapp.socket.logout();
   }
   
   // Delete session files
   const sessionPath = path.join(config.whatsapp.sessionPath, `wa_${userId}`);
   if (fs.existsSync(sessionPath)) {
     fs.rmSync(sessionPath, { recursive: true, force: true });
   }
   
   // Clear state
   delete userStates[userId];
   
   // Reset reconnect attempts
   reconnectAttempts[userId] = 0;
   
   return true;
 } catch (err) {
   console.error('Error logging out:', err);
   return false;
 }
}

module.exports = {
  createWhatsAppConnection,
  generatePairingCode,
  toggleAutoAccept,
  getAutoAcceptStatus,
  logoutWhatsApp,
  restoreAllSessions,
  checkPendingRequests,
  getAllGroups,
  renameGroup,
  addParticipantToGroup,
  promoteParticipant,
  demoteParticipant,
  getGroupAdmins,
  isParticipantInGroup,
  findParticipantJidInGroup,
  jidMapper,
  resolveActualJID,
  findParticipantInGroupWithMapping,
  sendBlastMessage
};