const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');

const app = express();
app.use(bodyParser.json());

// ⚙️ CONFIGURATION
const PAGE_ACCESS_TOKEN = "EAAcLptP3AhgBRA5CXWfCWha5BKBWjFC8CM0hZBMFCLG8ZCZATN1DNHtg0iGQJ3g2Y2Y4Gc5lH0y5bfFafFKuHlPTD0826zfsxc5buUWY0XIiHF9s7yD5Rr8AGmMEYsgQJoJaWzDYYZCP4xpZChqdrgFRIWNa2ZAuk4jDaMlEmwrU6v1ZAbSkN2AILZBjbTMIRHaF0199PQZDZD";
const VERIFY_TOKEN = "key";
const ADMIN_PASSWORD = "dan122012";
const PORT = process.env.PORT || 3000;

// 📦 DATABASE
let waitingQueue = [];
let activeChats = {};
let userMessageCount = {};
let bannedUsers = [];
let users = new Map();
let names = new Map();

// ==========================
// 🏠 HOME PAGE
// ==========================
app.get('/', (req, res) => {
    res.send('<h1>Bot is running</h1>');
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
                    await sendMessage(senderId, "🚫 **BANNED**\n────────────────────\nYou are banned from using this bot.");
                    return;
                }

                await markSeen(senderId);

                if (event.message) {
                    if (event.message.attachments) {
                        const att = event.message.attachments[0];
                        if (att.type === 'image' && activeChats[senderId]) {
                            await sendImage(activeChats[senderId], att.payload.url);
                        }
                    }
                    else if (event.message.text) {
                        const text = event.message.text.trim();
                        const lowerText = text.toLowerCase();
                        userMessageCount[senderId] = (userMessageCount[senderId] || 0) + 1;
                        await handleMessage(senderId, text, lowerText);
                    }
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

    // 📝 SET USERNAME (NEW USER ONLY)
    if (!users.has(senderId)) {
        await sendMessage(senderId, 
            `👋 **WELCOME**\n` +
            `────────────────────\n` +
            `Please send your username only`
        );
        if (names.has(text)) {
            return sendMessage(senderId, "❌ **USERNAME TAKEN**\n────────────────────\nChoose another name.");
        }
        users.set(senderId, text);
        names.set(text, senderId);
        return sendMessage(senderId, `✅ **NAME SET**\n────────────────────\n${text}`);
    }

    if (lowerText === "stop") {
        if (!activeChats[senderId]) return sendMessage(senderId, "❌ **NOT IN CHAT**");
        if ((userMessageCount[senderId] || 0) < 5) return sendMessage(senderId, "⚠️ **CANNOT STOP**\n────────────────────\nNeed 5+ messages first.");
        const partner = activeChats[senderId];
        delete activeChats[senderId];
        delete activeChats[partner];
        delete userMessageCount[senderId];
        delete userMessageCount[partner];
        await sendMessage(senderId, "👋 **CONVO ENDED**\n────────────────────\nType start to find new.");
        await sendMessage(partner, "👋 **STRANGER LEFT**\n────────────────────\nType start to find new.");
        return;
    }

    if (text.startsWith("/ban ")) {
        const p = text.split(" ");
        if (p[1] !== ADMIN_PASSWORD) return sendMessage(senderId, "❌ **WRONG PASSWORD**");
        const targetId = names.get(p[2]) || p[2];
        if (!bannedUsers.includes(targetId)) bannedUsers.push(targetId);
        await sendMessage(senderId, `✅ **BANNED**\n────────────────────\nUser: ${p[2]}`);
        return;
    }

    if (text.startsWith("/unban ")) {
        const p = text.split(" ");
        if (p[1] !== ADMIN_PASSWORD) return sendMessage(senderId, "❌ **WRONG PASSWORD**");
        const targetId = names.get(p[2]) || p[2];
        bannedUsers = bannedUsers.filter(id => id !== targetId);
        await sendMessage(senderId, `✅ **UNBANNED**\n────────────────────\nUser: ${p[2]}`);
        return;
    }

    if (activeChats[senderId]) {
        const partner = activeChats[senderId];
        await sendMessage(partner, text);
        return;
    }

    if (lowerText === "start") {
        if (activeChats[senderId]) return sendMessage(senderId, "⚠️ **ALREADY IN CHAT**");
        if (waitingQueue.includes(senderId)) return sendMessage(senderId, "🔍 **SEARCHING...**");

        const partner = waitingQueue.length > 0 ? waitingQueue.shift() : null;
        if (partner) {
            activeChats[senderId] = partner;
            activeChats[partner] = senderId;
            userMessageCount[senderId] = 0;
            userMessageCount[partner] = 0;

            const myName = users.get(senderId);
            const partnerName = users.get(partner);

            await sendMessage(senderId, 
                `🎉 **CONNECTED!**\n` +
                `────────────────────\n` +
                `You are talking to: ${partnerName}\n\n` +
                `📖 • Type stop to end\n` +
                `📖 • Need 5+ msg to stop\n` +
                `📖 • Images supported 🖼️`
            );
            await sendMessage(partner, 
                `🎉 **CONNECTED!**\n` +
                `────────────────────\n` +
                `You are talking to: ${myName}\n\n` +
                `📖 • Type stop to end\n` +
                `📖 • Need 5+ msg to stop\n` +
                `📖 • Images supported 🖼️`
            );
        } else {
            waitingQueue.push(senderId);
            await sendMessage(senderId, "🔍 **SEARCHING...**\n────────────────────\nLooking for stranger...");
        }
        return;
    }

    // No welcome here, only for new users
}

// ==========================
// FUNCTIONS
// ==========================
async function sendMessage(id, text) {
    try {
        await axios.post('https://graph.facebook.com/v18.0/me/messages', {
            recipient: { id }, message: { text }
        }, { params: { access_token: PAGE_ACCESS_TOKEN } });
    } catch (e) {}
}

async function sendImage(id, url) {
    try {
        await axios.post('https://graph.facebook.com/v18.0/me/messages', {
            recipient: { id },
            message: { attachment: { type: "image", payload: { url } } }
        }, { params: { access_token: PAGE_ACCESS_TOKEN } });
    } catch (e) {}
}

async function markSeen(id) {
    try {
        await axios.post('https://graph.facebook.com/v18.0/me/messages', {
            recipient: { id }, sender_action: "mark_seen"
        }, { params: { access_token: PAGE_ACCESS_TOKEN } });
    } catch (e) {}
}

// ==========================
// START SERVER
// ==========================
app.listen(PORT, () => {
    console.log(`🚀 Bot Running on port ${PORT}`);
});
        
