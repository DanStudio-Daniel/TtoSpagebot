const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');

const app = express();
app.use(bodyParser.json());

// ⚙️ CONFIGURATION
const PAGE_ACCESS_TOKEN = "EAAcLptP3AhgBRGbYTwaqF2QhMtdwxdAjYvhhZCcm4XpzkTVRNMTBcu8MtPWvUvqoPprJaHfyx8IW73Y7otKA3SCwqGcu4ka8jhz5ci1YbRcCZBlihPKKDAlyiFjySGHrmwDE8Ol3dQG7fZBlKrcu8YGtZB7P8tguMdxbI2syZCvnO6ceZCsEfGpRH0cnJjZCZAw7TxoZA6gZDZD";
const VERIFY_TOKEN = "key";
const OWNER_PASSWORD = "dan122012";
const PORT = process.env.PORT || 3000;
const NAME_CHANGE_DAYS = 7 * 24 * 60 * 60 * 1000; // 7 days

// 📦 DATABASE
let waitingQueue = [];
let activeChats = {};
let userMessageCount = {};
let bannedUsers = [];
let users = new Map(); // id -> user data object
let names = new Map(); // name -> id
let userStates = new Map(); // for registration flow

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
                    await sendMessage(senderId, "🚫 BANNED\n────────────────────\nYou are banned from using this bot.");
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

    // 🔐 HIDDEN OWNER LOGIN
    if (lowerText === "/loginowner dan122012") {
        const userData = users.get(senderId) || {};
        userData.role = "owner";
        users.set(senderId, userData);
        return sendMessage(senderId, "✅ LOGGED IN AS OWNER");
    }

    // 📝 REGISTRATION FLOW
    if (userStates.has(senderId)) {
        const state = userStates.get(senderId);
        
        if (state.step === 1) {
            if (text.length < 2) {
                return sendMessage(senderId, "⚠️ INVALID\nName must be at least 2 characters. Try again:");
            }
            state.data.name = text;
            state.step = 2;
            userStates.set(senderId, state);
            return sendMessage(senderId, "What's your age?");
        }
        
        if (state.step === 2) {
            state.data.age = text;
            state.step = 3;
            userStates.set(senderId, state);
            return sendMessage(senderId, "What are your hobbies?\nex: coding, singing, dancing");
        }
        
        if (state.step === 3) {
            state.data.hobbies = text;
            state.data.role = "member";
            
            // Save user
            users.set(senderId, state.data);
            names.set(state.data.name, senderId);
            userStates.delete(senderId);
            
            return sendMessage(senderId, 
                `✅ REGISTRATION COMPLETE\n` +
                `────────────────────\n` +
                `Welcome ${state.data.name}!\n` +
                `Type chat to find someone to talk to.`
            );
        }
    }

    // 🆕 NEW USER CHECK
    if (!users.has(senderId)) {
        if (lowerText === "/setinfo") {
            userStates.set(senderId, { step: 1, data: {} });
            return sendMessage(senderId, "Please enter your username:");
        } else {
            return sendMessage(senderId, "Please reply /setinfo to start.");
        }
    }

    const userData = users.get(senderId);

    // 📄 PROFILE COMMAND
    if (lowerText === "/profile") {
        return sendMessage(senderId, 
            `PROFILE\n` +
            `────────────────────\n` +
            `Name: ${userData.name}\n` +
            `Age: ${userData.age}\n` +
            `Hobbies: ${userData.hobbies}\n` +
            `Role: ${userData.role}`
        );
    }

    // 👑 ADMIN COMMANDS (ONLY OWNER CAN ADD/REMOVE ADMIN)
    if (lowerText.startsWith("/admin ")) {
        if (userData.role !== "owner") return sendMessage(senderId, "❌ PERMISSION DENIED\nOnly Owner can add/remove admins.");
        
        const parts = text.split(" ");
        const action = parts[1];
        const targetName = parts[2];
        const targetId = names.get(targetName);
        
        if (!targetId) return sendMessage(senderId, "❌ USER NOT FOUND");
        
        const targetData = users.get(targetId);
        
        if (action === "add") {
            targetData.role = "admin";
            users.set(targetId, targetData);
            return sendMessage(senderId, `✅ ${targetName} is now admin`);
        } else if (action === "remove") {
            targetData.role = "member";
            users.set(targetId, targetData);
            return sendMessage(senderId, `✅ ${targetName} is now member`);
        }
    }

    // 🛡️ BAN / UNBAN
    if (lowerText.startsWith("/ban ")) {
        if (userData.role !== "owner" && userData.role !== "admin") {
            return sendMessage(senderId, "❌ PERMISSION DENIED");
        }
        
        const targetName = text.split(" ")[1];
        const targetId = names.get(targetName);
        
        if (!targetId) return sendMessage(senderId, "❌ USER NOT FOUND");
        
        const targetData = users.get(targetId);
        
        // Permission check: cannot ban owner or other admins
        if (targetData.role === "owner" || (targetData.role === "admin" && userData.role !== "owner")) {
            return sendMessage(senderId, "❌ CANNOT BAN THIS USER");
        }
        
        if (!bannedUsers.includes(targetId)) bannedUsers.push(targetId);
        return sendMessage(senderId, `✅ BANNED\nUser: ${targetName}`);
    }

    if (lowerText.startsWith("/unban ")) {
        if (userData.role !== "owner" && userData.role !== "admin") {
            return sendMessage(senderId, "❌ PERMISSION DENIED");
        }
        
        const targetName = text.split(" ")[1];
        const targetId = names.get(targetName);
        
        if (!targetId) return sendMessage(senderId, "❌ USER NOT FOUND");
        
        bannedUsers = bannedUsers.filter(id => id !== targetId);
        return sendMessage(senderId, `✅ UNBANNED\nUser: ${targetName}`);
    }

    // 💬 CHAT / QUIT
    if (lowerText === "quit") {
        if (!activeChats[senderId]) return sendMessage(senderId, "❌ NOT IN CHAT");
        if ((userMessageCount[senderId] || 0) < 2) return sendMessage(senderId, "⚠️ CANNOT QUIT\nNeed 2+ messages first.");
        
        const partner = activeChats[senderId];
        delete activeChats[senderId];
        delete activeChats[partner];
        delete userMessageCount[senderId];
        delete userMessageCount[partner];
        
        await sendMessage(senderId, "👋 CONVO ENDED\n────────────────────\nType chat to find new stranger.");
        await sendMessage(partner, "👋 STRANGER LEFT\n────────────────────\nType chat to find new stranger.");
        return;
    }

    if (activeChats[senderId]) {
        const partner = activeChats[senderId];
        await sendMessage(partner, text);
        return;
    }

    if (lowerText === "chat") {
        if (activeChats[senderId]) return sendMessage(senderId, "⚠️ ALREADY IN CHAT");
        if (waitingQueue.includes(senderId)) return sendMessage(senderId, "🔍 SEARCHING...");

        const partner = waitingQueue.length > 0 ? waitingQueue.shift() : null;
        if (partner) {
            activeChats[senderId] = partner;
            activeChats[partner] = senderId;
            userMessageCount[senderId] = 0;
            userMessageCount[partner] = 0;

            const myData = users.get(senderId);
            const partnerData = users.get(partner);

            await sendMessage(senderId, 
                `🎉 CONNECTED!\n` +
                `────────────────────\n` +
                `Name: ${partnerData.name}\n` +
                `Age: ${partnerData.age}\n` +
                `Hobbies: ${partnerData.hobbies}\n` +
                `Role: ${partnerData.role}\n\n` +
                `• Type quit to end\n` +
                `• Need 2+ msg to quit\n` +
                `• Images supported 🖼️`
            );
            await sendMessage(partner, 
                `🎉 CONNECTED!\n` +
                `────────────────────\n` +
                `Name: ${myData.name}\n` +
                `Age: ${myData.age}\n` +
                `Hobbies: ${myData.hobbies}\n` +
                `Role: ${myData.role}\n\n` +
                `• Type quit to end\n` +
                `• Need 2+ msg to quit\n` +
                `• Images supported 🖼️`
            );
        } else {
            waitingQueue.push(senderId);
            await sendMessage(senderId, "🔍 SEARCHING...\n────────────────────\nLooking for stranger...");
        }
        return;
    }
}

// ==========================
// FUNCTIONS
// ==========================
async function sendMessage(id, text) {
    try {
        await axios({
            method: 'POST',
            url: 'https://graph.facebook.com/v18.0/me/messages',
            params: { access_token: PAGE_ACCESS_TOKEN },
            data: { recipient: { id: id }, message: { text: text } }
        });
    } catch (e) {
        console.log("❌ Error sending message:", e.response?.data || e.message);
    }
}

async function sendImage(id, url) {
    try {
        await axios({
            method: 'POST',
            url: 'https://graph.facebook.com/v18.0/me/messages',
            params: { access_token: PAGE_ACCESS_TOKEN },
            data: {
                recipient: { id: id },
                message: {
                    attachment: { type: "image", payload: { url: url } }
                }
            }
        });
    } catch (e) {}
}

async function markSeen(id) {
    try {
        await axios({
            method: 'POST',
            url: 'https://graph.facebook.com/v18.0/me/messages',
            params: { access_token: PAGE_ACCESS_TOKEN },
            data: { recipient: { id: id }, sender_action: "mark_seen" }
        });
    } catch (e) {}
}

// ==========================
// START SERVER
// ==========================
app.listen(PORT, () => {
    console.log(`🚀 Bot Running on port ${PORT}`);
});
                            
