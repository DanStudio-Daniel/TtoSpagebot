const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');

const app = express();
app.use(bodyParser.json());

// ⚙️ CONFIGURATION
const PAGE_ACCESS_TOKEN = "EAAcLptP3AhgBRA5CXWfCWha5BKBWjFC8CM0hZBMFCLG8ZCZATN1DNHtg0iGQJ3g2Y2Y4Gc5lH0y5bfFafFKuHlPTD0826zfsxc5buUWY0XIiHF9s7yD5Rr8AGmMEYsgQJoJaWzDYYZCP4xpZChqdrgFRIWNa2ZAuk4jDaMlEmwrU6v1ZAbSkN2AILZBjbTMIRHaF0199PQZDZD";
const VERIFY_TOKEN = "key"; // ✅ SET TO "key"
const ADMIN_PASSWORD = "dan122012";
const PORT = process.env.PORT || 3000;

// 📦 DATABASE
let waitingQueue = [];
let activeChats = {};
let userMessageCount = {};
let bannedUsers = [];

// ==========================
// 🏠 HOME PAGE
// ==========================
app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Stranger Chat Bot</title>
            <style>
                body {
                    font-family: Arial, sans-serif;
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    height: 100vh;
                    margin: 0;
                }
                .container {
                    background: white;
                    padding: 40px;
                    border-radius: 15px;
                    box-shadow: 0 10px 30px rgba(0,0,0,0.3);
                    text-align: center;
                }
                .status {
                    width: 80px;
                    height: 80px;
                    background: #2ecc71;
                    border-radius: 50%;
                    margin: 0 auto 20px;
                    position: relative;
                    animation: pulse 2s infinite;
                }
                @keyframes pulse {
                    0% { box-shadow: 0 0 0 0 rgba(46, 204, 113, 0.7); }
                    70% { box-shadow: 0 0 0 20px rgba(46, 204, 113, 0); }
                    100% { box-shadow: 0 0 0 0 rgba(46, 204, 113, 0); }
                }
                h1 { color: #2c3e50; margin-bottom: 10px; }
                p { color: #7f8c8d; font-size: 18px; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="status"></div>
                <h1>✅ BOT IS RUNNING</h1>
                <p>Stranger Chat System is Online!</p>
                <p>🔑 Verify Key: key</p>
            </div>
        </body>
        </html>
    `);
});

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

                if (bannedUsers.includes(senderId)) {
                    await sendMessage(senderId, "🚫 You are banned from using this bot.");
                    return;
                }

                await markSeen(senderId);

                if (event.message && event.message.text) {
                    const messageText = event.message.text.trim();
                    const lowerText = messageText.toLowerCase();
                    
                    userMessageCount[senderId] = (userMessageCount[senderId] || 0) + 1;
                    await handleMessage(senderId, messageText, lowerText);
                }
                else if (event.reaction) {
                    await handleReaction(event);
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
async function handleMessage(senderId, text, lowerText) {

    if (lowerText === "stop") {
        await handleStopCommand(senderId);
        return;
    }

    if (text.startsWith("/ban ")) {
        await handleBanCommand(senderId, text);
        return;
    }

    if (text.startsWith("/unban ")) {
        await handleUnbanCommand(senderId, text);
        return;
    }

    if (activeChats[senderId]) {
        const partnerId = activeChats[senderId];
        await sendMessage(partnerId, `💬 ${text}`);
        return;
    }

    if (lowerText === "start") {
        await handleStartCommand(senderId);
        return;
    }

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
    
    if (activeChats[userId]) {
        await sendMessage(userId, "⚠️ Already in conversation!\nType *stop* first.");
        return;
    }

    const isInQueue = waitingQueue.includes(userId);
    if (isInQueue) {
        await sendMessage(userId, "⏳ Already searching... wait!");
        return;
    }

    const partnerId = waitingQueue.length > 0 ? waitingQueue.shift() : null;

    if (partnerId) {
        createChat(userId, partnerId);
    } else {
        await sendMessage(userId, 
            "🔍 **Searching for stranger...**\n" +
            "────────────────────\n" +
            "bla bla bla 🎶\n" +
            "looking for someone... ⏳\n\n" +
            "📖 **Guide:** You can type *stop* anytime to end chat!"
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
        "🆔 Your ID: `" + user1 + "`\n" +
        "👤 Stranger ID: `" + user2 + "`\n\n" +
        "📖 **GUIDE**\n" +
        "• Type *stop* to end chat\n" +
        "• Need 5+ messages to use stop\n" +
        "• React messages are supported ❤️\n\n" +
        "💬 Start talking...";
    
    const connectMsg2 = 
        "🎉 **CONNECTED!**\n" +
        "────────────────────\n" +
        "🆔 Your ID: `" + user2 + "`\n" +
        "👤 Stranger ID: `" + user1 + "`\n\n" +
        "📖 **GUIDE**\n" +
        "• Type *stop* to end chat\n" +
        "• Need 5+ messages to use stop\n" +
        "• React messages are supported ❤️\n\n" +
        "💬 Start talking...";

    await sendMessage(user1, connectMsg);
    await sendMessage(user2, connectMsg2);
}

// ==========================
// STOP COMMAND
// ==========================
async function handleStopCommand(userId) {
    if (!activeChats[userId]) {
        await sendMessage(userId, "❌ Not in any conversation.");
        return;
    }

    if ((userMessageCount[userId] || 0) < 5) {
        await sendMessage(userId, "⚠️ Need **5 messages** first before you can stop!");
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
        "Type *start* to find new stranger."
    );
    
    await sendMessage(user2, 
        "👋 **STRANGER LEFT**\n" +
        "────────────────────\n" +
        "Type *start* to find new stranger."
    );
}

// ==========================
// 🔒 BAN & UNBAN SYSTEM
// ==========================
async function handleBanCommand(senderId, text) {
    const parts = text.split(" ");
    if (parts.length < 3) return await sendMessage(senderId, "❌ Use: /ban <pass> <id>");

    const inputPass = parts[1];
    const targetId = parts[2];

    if (inputPass !== ADMIN_PASSWORD) return await sendMessage(senderId, "❌ Wrong Password!");

    if (!bannedUsers.includes(targetId)) {
        bannedUsers.push(targetId);
        await sendMessage(senderId, `✅ **BANNED!**\nID: \`${targetId}\``);
    } else {
        await sendMessage(senderId, "⚠️ Already banned.");
    }
}

async function handleUnbanCommand(senderId, text) {
    const parts = text.split(" ");
    if (parts.length < 3) return await sendMessage(senderId, "❌ Use: /unban <pass> <id>");

    const inputPass = parts[1];
    const targetId = parts[2];

    if (inputPass !== ADMIN_PASSWORD) return await sendMessage(senderId, "❌ Wrong Password!");

    if (bannedUsers.includes(targetId)) {
        bannedUsers = bannedUsers.filter(id => id !== targetId);
        await sendMessage(senderId, `✅ **UNBANNED!**\nID: \`${targetId}\``);
    } else {
        await sendMessage(senderId, "⚠️ User not banned.");
    }
}

// ==========================
// 😍 REACTION SYSTEM
// ==========================
async function handleReaction(event) {
    const senderId = event.sender.id;
    if (!activeChats[senderId]) return;

    const partnerId = activeChats[senderId];
    const emoji = event.reaction.emoji || "👍";

    if (event.reaction.action === "react") {
        await sendReaction(partnerId, event.reaction.message_id, emoji);
    }
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
        }, { params: { access_token: PAGE_ACCESS_TOKEN } });
    } catch (error) {
        console.error("Error:", error.response?.data || error.message);
    }
}

async function markSeen(senderId) {
    try {
        await axios.post('https://graph.facebook.com/v18.0/me/messages', {
            recipient: { id: senderId },
            sender_action: "mark_seen"
        }, { params: { access_token: PAGE_ACCESS_TOKEN } });
    } catch (e) {}
}

async function sendReaction(recipientId, messageId, emoji) {
    try {
        await axios.post('https://graph.facebook.com/v18.0/me/messages', {
            recipient: { id: recipientId },
            message_id: messageId,
            reaction: { emoji: emoji }
        }, { params: { access_token: PAGE_ACCESS_TOKEN } });
    } catch (error) {
        console.error("Reaction Error:", error.response?.data || error.message);
    }
}

// ==========================
// START SERVER
// ==========================
app.listen(PORT, () => {
    console.log(`🚀 Server Running on Port ${PORT}`);
    console.log(`🔑 Verify Key: ${VERIFY_TOKEN}`);
    console.log(`🔐 Admin Pass: ${ADMIN_PASSWORD}`);
    console.log(`📊 Queue: ${waitingQueue.length} | Banned: ${bannedUsers.length}`);
});
    
