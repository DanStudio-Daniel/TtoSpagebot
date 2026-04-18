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
                    await sendMessage(senderId, "🚫 You are banned from using this bot.");
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

                        const replyTo = event.message.reply_to ? event.message.reply_to.mid : null;
                        await handleMessage(senderId, text, lowerText, replyTo);
                    }
                }
                // 😍 REACTION
                else if (event.reaction && activeChats[senderId]) {
                    await sendReaction(activeChats[senderId], event.reaction.message_id, event.reaction.emoji);
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
async function handleMessage(senderId, text, lowerText, replyTo) {

    if (lowerText === "stop") {
        if (!activeChats[senderId]) return sendMessage(senderId, "❌ Not in chat");
        if ((userMessageCount[senderId] || 0) < 5) return sendMessage(senderId, "⚠️ Need 5+ messages to stop!");
        const partner = activeChats[senderId];
        delete activeChats[senderId];
        delete activeChats[partner];
        delete userMessageCount[senderId];
        delete userMessageCount[partner];
        await sendMessage(senderId, "👋 Chat ended");
        await sendMessage(partner, "👋 Stranger left");
        return;
    }

    if (text.startsWith("/ban ")) {
        const p = text.split(" ");
        if (p[1] !== ADMIN_PASSWORD) return sendMessage(senderId, "❌ Wrong pass");
        bannedUsers.push(p[2]);
        await sendMessage(senderId, `✅ Banned ${p[2]}`);
        return;
    }

    if (text.startsWith("/unban ")) {
        const p = text.split(" ");
        if (p[1] !== ADMIN_PASSWORD) return sendMessage(senderId, "❌ Wrong pass");
        bannedUsers = bannedUsers.filter(id => id !== p[2]);
        await sendMessage(senderId, `✅ Unbanned ${p[2]}`);
        return;
    }

    if (text.startsWith("/noti ")) {
        const p = text.split(" ");
        if (p[1] !== ADMIN_PASSWORD) return sendMessage(senderId, "❌ Wrong pass");
        const msg = p.slice(2).join(" ");
        const all = [...new Set([...Object.keys(activeChats), ...waitingQueue])];
        all.forEach(u => sendMessage(u, `📢 [OWNER]: ${msg}`));
        await sendMessage(senderId, `✅ Broadcast sent!`);
        return;
    }

    if (activeChats[senderId]) {
        const partner = activeChats[senderId];
        if (replyTo) {
            await sendMessageReply(partner, replyTo, `💬 ${text}`);
        } else {
            await sendMessage(partner, `💬 ${text}`);
        }
        return;
    }

    if (lowerText === "start") {
        if (activeChats[senderId]) return sendMessage(senderId, "⚠️ Already in chat");
        if (waitingQueue.includes(senderId)) return sendMessage(senderId, "⏳ Already searching");

        const partner = waitingQueue.length > 0 ? waitingQueue.shift() : null;
        if (partner) {
            activeChats[senderId] = partner;
            activeChats[partner] = senderId;
            userMessageCount[senderId] = 0;
            userMessageCount[partner] = 0;

            await sendMessage(senderId, 
                `🎉 CONNECTED!\n` +
                `🆔 Your ID: ${senderId}\n` +
                `👤 Stranger ID: ${partner}\n` +
                `📝 Type stop to end (need 5+ msg)`
            );
            await sendMessage(partner, 
                `🎉 CONNECTED!\n` +
                `🆔 Your ID: ${partner}\n` +
                `👤 Stranger ID: ${senderId}\n` +
                `📝 Type stop to end (need 5+ msg)`
            );
        } else {
            waitingQueue.push(senderId);
            await sendMessage(senderId, "🔍 Searching... bla bla bla 🎶");
        }
        return;
    }

    await sendMessage(senderId, "👋 Type start to find stranger!");
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

async function sendMessageReply(id, replyTo, text) {
    try {
        await axios.post('https://graph.facebook.com/v18.0/me/messages', {
            recipient: { id },
            message: { text, reply_to: { mid: replyTo } }
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
            
