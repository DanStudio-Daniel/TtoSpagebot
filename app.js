const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');

const app = express();
app.use(bodyParser.json());

// ⚙️ CONFIGURATION
const PAGE_ACCESS_TOKEN = "EAAcLptP3AhgBRA5CXWfCWha5BKBWjFC8CM0hZBMFCLG8ZCZATN1DNHtg0iGQJ3g2Y2Y4Gc5lH0y5bfFafFKuHlPTD0826zfsxc5buUWY0XIiHF9s7yD5Rr8AGmMEYsgQJoJaWzDYYZCP4xpZChqdrgFRIWNa2ZAuk4jDaMlEmwrU6v1ZAbSkN2AILZBjbTMIRHaF0199PQZDZD";
const VERIFY_TOKEN = "key";
const PORT = process.env.PORT || 3000;

// 📦 DATABASE
let waitingQueue = [];
let activeChats = {}; // { userId: partnerId }
let userMessageCount = {};

// ==========================
// WEBHOOK VERIFICATION
// ==========================
app.get('/webhook', (req, res) => {
    if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === VERIFY_TOKEN) {
        console.log("✅ Webhook Verified");
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
                const senderId = event.sender.id;

                // 👁️ AUTO SEEN
                await markSeen(senderId);

                if (event.message && event.message.text) {
                    const messageText = event.message.text.trim().toLowerCase();
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

    // ⏩ IF ALREADY IN CHAT
    if (activeChats[senderId]) {
        const partnerId = activeChats[senderId];
        await sendMessage(partnerId, `💬 ${text}`);
        return;
    }

    // 🚀 COMMAND: START
    if (text === "start") {
        await handleStartCommand(senderId);
        return;
    }

    // ℹ️ DEFAULT WELCOME
    await sendMessage(senderId, 
        "👋 **Welcome to Stranger Chat!**\n\n" +
        "🔍 Type *start* to find partner\n" +
        "🛑 Type *stop* to end chat\n" +
        "📝 *Need 5+ messages to use stop*"
    );
}

// ==========================
// START - FIND PARTNER
// ==========================
async function handleStartCommand(userId) {
    
    // 🚫 CHECK: Already in chat?
    if (activeChats[userId]) {
        await sendMessage(userId, "⚠️ You are already in a conversation!\nType *stop* first if you want to change partner.");
        return;
    }

    // 🚫 CHECK: Already waiting in queue?
    const isInQueue = waitingQueue.includes(userId);
    if (isInQueue) {
        await sendMessage(userId, "⏳ Please wait...\nYou are already in the searching list!");
        return;
    }

    // ✅ Proceed to find partner
    const partnerId = waitingQueue.length > 0 ? waitingQueue.shift() : null;

    if (partnerId) {
        createChat(userId, partnerId);
    } else {
        await sendMessage(userId, 
            "🔍 **Searching for stranger...**\n" +
            "────────────────────\n" +
            "bla bla bla 🎶\n" +
            "looking for someone... ⏳"
        );
        waitingQueue.push(userId);
    }
}

// ==========================
// CREATE CHAT
// ==========================
async function createChat(user1, user2) {
    activeChats[user1] = user2;
    activeChats[user2] = user1;
    
    userMessageCount[user1] = 0;
    userMessageCount[user2] = 0;

    const connectMsg = 
        "🎉 **CONNECTED!**\n" +
        "────────────────────\n" +
        "✅ You are now chatting with stranger!\n" +
        "👤 Partner ID: ||`" + user2 + "`||\n\n" +
        "💬 reply 'stop' to stop conversation, have fun.";
    
    const connectMsg2 = 
        "🎉 **CONNECTED!**\n" +
        "────────────────────\n" +
        "✅ You are now chatting with stranger!\n" +
        "👤 Partner ID: ||`" + user1 + "`||\n\n" +
        "💬 reply 'stop' to stop conversation, have fun.";

    await sendMessage(user1, connectMsg);
    await sendMessage(user2, connectMsg2);
}

// ==========================
// STOP COMMAND
// ==========================
async function handleStopCommand(userId) {
    if (!activeChats[userId]) {
        await sendMessage(userId, "❌ You are not in any conversation.");
        return;
    }

    if ((userMessageCount[userId] || 0) < 5) {
        await sendMessage(userId, "⚠️ *Oops!*\nYou need to send at least **5 messages** before you can stop.\nKeep chatting! 💬");
        return;
    }

    const partnerId = activeChats[userId];
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

    await sendMessage(user1, 
        "👋 **CONVERSATION ENDED**\n" +
        "────────────────────\n" +
        "Hope you had fun! 😊\nType *start* to find new stranger."
    );
    
    await sendMessage(user2, 
        "👋 **STRANGER LEFT**\n" +
        "────────────────────\n" +
        "Your partner has left the chat.\nType *start* to find new stranger."
    );
}

// ==========================
// FUNCTIONS
// ==========================

async function sendMessage(recipientId, text) {
    if (!text) return;
    try {
        await axios.post('https://graph.facebook.com/v18.0/me/messages', {
            recipient: { id: recipientId },
            message: { text: text }
        }, {
            params: { access_token: PAGE_ACCESS_TOKEN }
        });
    } catch (error) {
        console.error("Error:", error.response?.data || error.message);
    }
}

async function markSeen(senderId) {
    try {
        await axios.post('https://graph.facebook.com/v18.0/me/messages', {
            recipient: { id: senderId },
            sender_action: "mark_seen"
        }, {
            params: { access_token: PAGE_ACCESS_TOKEN }
        });
    } catch (e) {}
}

// ==========================
// START SERVER
// ==========================
app.listen(PORT, () => {
    console.log(`🚀 Server Running on Port ${PORT}`);
    console.log(`📊 Queue: ${waitingQueue.length} | Active Chats: ${Object.keys(activeChats).length / 2}`);
});
                
