const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');

const app = express();
app.use(bodyParser.json());

// ⚠️ CONFIGURATION - FILL THESE IN
const PAGE_ACCESS_TOKEN = "EAAcLptP3AhgBRA5CXWfCWha5BKBWjFC8CM0hZBMFCLG8ZCZATN1DNHtg0iGQJ3g2Y2Y4Gc5lH0y5bfFafFKuHlPTD0826zfsxc5buUWY0XIiHF9s7yD5Rr8AGmMEYsgQJoJaWzDYYZCP4xpZChqdrgFRIWNa2ZAuk4jDaMlEmwrU6v1ZAbSkN2AILZBjbTMIRHaF0199PQZDZD";
const PORT = process.env.PORT || 3000;

// 📦 DATABASE (In-Memory, resets on restart)
let waitingQueue = [];
let activeChats = {}; // { userId: partnerId }
let userMessageCount = {}; // Track message count for /stop rule

// ==========================
// WEBHOOK VERIFICATION
// ==========================
app.get('/webhook', (req, res) => {
    const VERIFY_TOKEN = "key";
    
    if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === VERIFY_TOKEN) {
        console.log("Webhook Verified ✅");
        res.status(200).send(req.query['hub.challenge']);
    } else {
        res.sendStatus(403);
    }
});

// ==========================
// HANDLE INCOMING MESSAGES
// ==========================
app.post('/webhook', async (req, res) => {
    const body = req.body;

    if (body.object === 'page') {
        body.entry.forEach(entry => {
            entry.messaging.forEach(async event => {
                if (event.message && event.message.text) {
                    const senderId = event.sender.id;
                    const messageText = event.message.text.trim().toLowerCase();

                    // Count messages
                    userMessageCount[senderId] = (userMessageCount[senderId] || 0) + 1;

                    await handleMessage(senderId, messageText);
                }
            });
        });
        res.status(200).send('EVENT_RECEIVED');
    } else {
        res.sendStatus(404);
    }
});

// ==========================
// MAIN LOGIC
// ==========================
async function handleMessage(senderId, text) {

    // 🛑 COMMAND: STOP
    if (text === "stop") {
        await handleStopCommand(senderId);
        return;
    }

    // ⏹️ IF USER IS ALREADY IN CHAT, FORWARD MESSAGE
    if (activeChats[senderId]) {
        const partnerId = activeChats[senderId];
        await sendMessage(partnerId, text);
        return;
    }

    // 🚀 COMMAND: START
    if (text === "start") {
        await handleStartCommand(senderId);
        return;
    }

    // ℹ️ DEFAULT MESSAGE
    await sendMessage(senderId, "👋 Welcome to Stranger Chat!\nType *start* to find a partner.\nType *stop* to end conversation (requires 5+ messages).");
}

// ==========================
// START - FIND PARTNER
// ==========================
async function handleStartCommand(userId) {
    
    // Remove from queue if already there
    waitingQueue = waitingQueue.filter(id => id !== userId);

    // Find someone waiting (not self)
    const partnerId = waitingQueue.length > 0 ? waitingQueue.shift() : null;

    if (partnerId) {
        // ✅ Match found!
        createChat(userId, partnerId);
    } else {
        // ⏳ No one available, add to queue
        waitingQueue.push(userId);
        await sendMessage(userId, "⏳ Searching for stranger...\nPlease wait...");
    }
}

// ==========================
// CREATE CHAT
// ==========================
function createChat(user1, user2) {
    // Link users
    activeChats[user1] = user2;
    activeChats[user2] = user1;
    
    // Reset message count
    userMessageCount[user1] = 0;
    userMessageCount[user2] = 0;

    // Send notifications
    sendMessage(user1, "🎉 You are now connected!\nYou can talk now.\nType *stop* to end chat.");
    sendMessage(user2, "🎉 You are now connected!\nYou can talk now.\nType *stop* to end chat.");
}

// ==========================
// STOP COMMAND LOGIC
// ==========================
async function handleStopCommand(userId) {
    // Check if user is in chat
    if (!activeChats[userId]) {
        await sendMessage(userId, "❌ You are not in a conversation right now.");
        return;
    }

    // ✅ RULE: Can stop only if 5+ messages sent
    if ((userMessageCount[userId] || 0) < 5) {
        await sendMessage(userId, "⚠️ You need to send at least *5 messages* before you can use 'stop'.");
        return;
    }

    const partnerId = activeChats[userId];
    
    // End chat
    await endChat(userId, partnerId);
}

// ==========================
// END CHAT
// ==========================
async function endChat(user1, user2) {
    delete activeChats[user1];
    delete activeChats[user2];
    delete userMessageCount[user1];
    delete userMessageCount[user2];

    await sendMessage(user1, "👋 Conversation ended.\nType *start* anytime to find a new stranger.");
    await sendMessage(user2, "👋 Stranger has ended the conversation.\nType *start* anytime to find a new stranger.");
}

// ==========================
// SEND MESSAGE FUNCTION
// ==========================
async function sendMessage(recipientId, text) {
    // Avoid empty messages
    if (!text || text.trim() === "") return;

    try {
        await axios.post('https://graph.facebook.com/v18.0/me/messages', {
            recipient: { id: recipientId },
            message: { text: text }
        }, {
            params: { access_token: PAGE_ACCESS_TOKEN }
        });
    } catch (error) {
        console.error("Error sending message:", error.response?.data || error.message);
    }
}

// ==========================
// START SERVER
// ==========================
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📊 Waiting Users: ${waitingQueue.length}`);
    console.log(`💬 Active Chats: ${Object.keys(activeChats).length / 2}`);
});
