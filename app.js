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
                    await sendMessage(senderId, "🚫 You are banned from using this bot. if you think this is a mistake please contact owner.");
                    return;
                }

                await markSeen(senderId);

                if (event.message) {
                    // 🖼️ IMAGE
                    if (event.message.attachments) {
                        const att = event.message.attachments[0];
                        if (att.type === 'image' && activeChats[senderId]) {
                            await sendImage(activeChats[senderId], att.payload.url);
                        }
                    }
                    // 📝 TEXT
                    else if (event.message.text) {
                        const text = event.message.text.trim();
                        const lowerText = text.toLowerCase();
                        userMessageCount[senderId] = (userMessageCount[senderId] || 0) + 1;
                        await handleMessage(senderId, text, lowerText);
                    }
                }
                // 😍 REACTION TO TARGET MESSAGE
                else if (event.reaction && activeChats[senderId]) {
                    if (event.reaction.action === "react") {
                        await sendReaction(activeChats[senderId], event.reaction.message_id, event.reaction.emoji);
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

    if (lowerText === "stop") {
        if (!activeChats[senderId]) return sendMessage(senderId, "❌ Not in any conversation.");
        if ((userMessageCount[senderId] || 0) < 5) return sendMessage(senderId, "⚠️ Need **5 messages** first before you can stop!");
        const partner = activeChats[senderId];
        delete activeChats[senderId];
        delete activeChats[partner];
        delete userMessageCount[senderId];
        delete userMessageCount[partner];
        await sendMessage(senderId, "👋 **CONVERSATION ENDED**\n────────────────────\nType *start* to find new stranger.");
        await sendMessage(partner, "👋 **STRANGER LEFT**\n────────────────────\nType *start* to find new stranger.");
        return;
    }

    if (text.startsWith("/ban ")) {
        const p = text.split(" ");
        if (p[1] !== ADMIN_PASSWORD) return sendMessage(senderId, "❌ Wrong Password!");
        if (!bannedUsers.includes(p[2])) bannedUsers.push(p[2]);
        await sendMessage(senderId, `✅ **BANNED!**\nID: \`${p[2]}\``);
        return;
    }

    if (text.startsWith("/unban ")) {
        const p = text.split(" ");
        if (p[1] !== ADMIN_PASSWORD) return sendMessage(senderId, "❌ Wrong Password!");
        bannedUsers = bannedUsers.filter(id => id !== p[2]);
        await sendMessage(senderId, `✅ **UNBANNED!**\nID: \`${p[2]}\``);
        return;
    }

    if (text.startsWith("/noti ")) {
        const p = text.split(" ");
        if (p[1] !== ADMIN_PASSWORD) return sendMessage(senderId, "❌ Wrong Password!");
        const msg = p.slice(2).join(" ");
        const all = [...new Set([...Object.keys(activeChats), ...waitingQueue])];
        all.forEach(u => sendMessage(u, `📢 [announcement] 📢\n\n${msg}`));
        await sendMessage(senderId, `✅ Broadcast sent!`);
        return;
    }

    if (activeChats[senderId]) {
        const partner = activeChats[senderId];
        await sendMessage(partner, text); // ❌ Removed 💬
        return;
    }

    if (lowerText === "start") {
        if (activeChats[senderId]) return sendMessage(senderId, "⚠️ Already in conversation!\nType *stop* first.");
        if (waitingQueue.includes(senderId)) return sendMessage(senderId, "⏳ Already searching... wait!");

        const partner = waitingQueue.length > 0 ? waitingQueue.shift() : null;
        if (partner) {
            activeChats[senderId] = partner;
            activeChats[partner] = senderId;
            userMessageCount[senderId] = 0;
            userMessageCount[partner] = 0;

            await sendMessage(senderId, 
                `🎉 **CONNECTED!**\n` +
                `────────────────────\n` +
                `🆔 Your ID: \`${senderId}\`\n` +
                `👤 Stranger ID: \`${partner}\`\n\n` +
                `📖 **GUIDE**\n` +
                `• Type *stop* to end chat\n` +
                `• Need 5+ messages to use stop\n` +
                `• Images & Reactions supported ❤️\n\n` +
                `Start talking...`
            );
            await sendMessage(partner, 
                `🎉 **CONNECTED!**\n` +
                `────────────────────\n` +
                `🆔 Your ID: \`${partner}\`\n` +
                `👤 Stranger ID: \`${senderId}\`\n\n` +
                `📖 **GUIDE**\n` +
                `• Type *stop* to end chat\n` +
                `• Need 5+ messages to use stop\n` +
                `• Images & Reactions supported ❤️\n\n` +
                `Start talking...`
            );
        } else {
            waitingQueue.push(senderId);
            await sendMessage(senderId, 
                `🔍 **Searching for stranger...**\n` +
                `────────────────────\n` +
                `bla bla bla 🎶\n` +
                `looking for someone... ⏳`
            );
        }
        return;
    }

    await sendMessage(senderId, 
        `👋 **Welcome to Stranger Chat!**\n\n` +
        `🔍 Type *start* to find partner\n` +
        `🛑 Type *stop* to end chat\n` +
        `📝 Need 5+ messages to use stop`
    );
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

async function sendReaction(id, mid, emoji) {
    try {
        await axios.post('https://graph.facebook.com/v18.0/me/messages', {
            recipient: { id }, message_id: mid, reaction: { emoji }
        }, { params: { access_token: PAGE_ACCESS_TOKEN } });
    } catch (e) {}
}

// ==========================
// START SERVER
// ==========================
app.listen(PORT, () => {
    console.log(`🚀 Bot Running on port ${PORT}`);
});
