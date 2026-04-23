const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const mongoose = require('mongoose');

const app = express();
app.use(bodyParser.json());

// ⚙️ CONFIGURATION (RESTORED)
const PAGE_ACCESS_TOKEN = "EAAcLptP3AhgBRVaudVLZCUnjnZCNvMNBjsN1vtW3circdCouQQit1r6oEp3kMVbRJJUplqd6YFFqPySY15rksGpZClkFbOItZCf7Vkxf7ZBctmxGAxghQDfGYWaP7fYLNROXH6UDCSWgttQYEHQqww7IOpZBxMNJLnX4dyWGH12cKlVtXuKlAQCSzlOAnLntvbfnZAmDAZDZD";
const VERIFY_TOKEN = "key";
const PORT = process.env.PORT || 10000;
const mongoURI = "mongodb+srv://danielmojar84_db_user:nDG9hpTU0uHZtxYO@cluster0.wsk0egt.mongodb.net/?appName=Cluster0";

// 📦 MEMORY STORAGE
let waitingQueue = [];
let activeChats = {};
let userMessageCount = {};
global.tempState = {};

// ==========================
// 🗄️ MONGODB CONNECTION
// ==========================
mongoose.connect(mongoURI)
.then(() => console.log("✅ MongoDB Connected Successfully"))
.catch(err => console.log("❌ MongoDB Connection Error:", err));

const userSchema = new mongoose.Schema({
    psid: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    age: { type: Number, required: true },
    role: { type: String, default: "member" },
    isBanned: { type: Boolean, default: false }
});

const User = mongoose.model("User", userSchema);

// ==========================
// WEBHOOK VERIFICATION
// ==========================
app.get('/webhook', (req, res) => {
    if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === VERIFY_TOKEN) {
        res.status(200).send(req.query['hub.challenge']);
    } else {
        res.sendStatus(403);
    }
});

// ==========================
// HANDLE INCOMING EVENTS
// ==========================
app.post('/webhook', async (req, res) => {
    const body = req.body;

    if (body.object === 'page') {
        body.entry.forEach(entry => {
            entry.messaging.forEach(async event => {
                const senderId = event.sender.id;

                // 👁️ SYNC SEEN STATUS (User1 seen -> Bot marks seen on User2)
                if (event.read) {
                    if (activeChats[senderId]) {
                        await markSeen(activeChats[senderId]);
                    }
                    return;
                }

                // 🛑 CHECK BAN STATUS
                const userData = await User.findOne({ psid: senderId });
                if (userData && userData.isBanned) return;

                await markSeen(senderId);

                if (event.message) {
                    const text = event.message.text;
                    const lowerText = text ? text.toLowerCase() : "";

                    // Command Priority
                    if (lowerText === "quit") return handleQuit(senderId);
                    
                    if (lowerText.startsWith("/admin ") || 
                        lowerText.startsWith("/ban ") || 
                        lowerText.startsWith("/unban ") || 
                        lowerText.startsWith("/loginowner ") ||
                        lowerText === "/setinfo" ||
                        lowerText === "/resetinfo" ||
                        tempState[senderId]) {
                        return handleMessage(senderId, text, lowerText);
                    }

                    // Chatting logic
                    if (activeChats[senderId]) {
                        if (event.message.attachments) {
                            const att = event.message.attachments[0];
                            if (att.type === 'image') await sendImage(activeChats[senderId], att.payload.url);
                        } else if (text) {
                            userMessageCount[senderId] = (userMessageCount[senderId] || 0) + 1;
                            await sendMessage(activeChats[senderId], text);
                        }
                    } else {
                        if (lowerText === "chat" || lowerText === "/profile") {
                            await handleMessage(senderId, text, lowerText);
                        } else if (!userData) {
                            await sendMessage(senderId, "👋 Welcome! Type /setinfo to start.");
                        }
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
    let userData = await User.findOne({ psid: senderId });

    // Login Owner
    if (lowerText === "/loginowner dan122012") {
        if (!userData) userData = new User({ psid: senderId, name: "Owner", age: 1 });
        userData.role = "owner";
        await userData.save();
        return sendMessage(senderId, "✅ LOGGED IN AS OWNER");
    }

    // Registration Flow
    if (lowerText === "/setinfo" || lowerText === "/resetinfo" || tempState[senderId]) {
        if (lowerText === "/setinfo" || lowerText === "/resetinfo") {
            tempState[senderId] = { step: 1, data: { role: userData ? userData.role : "member" } };
            return sendMessage(senderId, "📝 Question 1/2: Enter your username:");
        }

        const state = tempState[senderId];
        if (state.step === 1) {
            state.data.name = text;
            state.step = 2;
            return sendMessage(senderId, "📝 Question 2/2: Enter your age:");
        }
        if (state.step === 2) {
            const age = parseInt(text);
            if (isNaN(age)) return sendMessage(senderId, "⚠️ Numbers only for age.");
            state.data.age = age;
            await User.findOneAndUpdate({ psid: senderId }, state.data, { upsert: true });
            delete tempState[senderId];
            return sendMessage(senderId, "✅ Profile saved! Type 'chat' to find someone.");
        }
        return;
    }

    if (!userData) return;

    // Profile
    if (lowerText === "/profile") {
        return sendMessage(senderId, `👤 PROFILE\nName: ${userData.name}\nAge: ${userData.age}\nRole: ${userData.role}`);
    }

    // Admin Management
    if (lowerText.startsWith("/admin ")) {
        if (userData.role !== "owner") return sendMessage(senderId, "❌ DENIED");
        const parts = text.split(" ");
        const targetUser = await User.findOne({ name: parts.slice(2).join(" ") });
        if (!targetUser) return sendMessage(senderId, "❌ Not found");
        
        if (parts[1] === "add") {
            targetUser.role = "admin";
            await targetUser.save();
            await sendMessage(targetUser.psid, "🎊 You applied to ADMIN! You can now use /ban and /unban.");
            return sendMessage(senderId, `✅ ${targetUser.name} is now Admin.`);
        }
    }

    // Ban/Unban
    if (lowerText.startsWith("/ban ") || lowerText.startsWith("/unban ")) {
        if (userData.role !== "owner" && userData.role !== "admin") return sendMessage(senderId, "❌ DENIED");
        const targetName = text.split(" ").slice(1).join(" ");
        const targetUser = await User.findOne({ name: targetName });
        if (!targetUser) return sendMessage(senderId, "❌ Not found");

        if (lowerText.startsWith("/ban ")) {
            if (targetUser.role === "owner") return sendMessage(senderId, "❌ Cannot ban owner");
            targetUser.isBanned = true;
            await targetUser.save();
            if (activeChats[targetUser.psid]) {
                const p = activeChats[targetUser.psid];
                delete activeChats[targetUser.psid]; delete activeChats[p];
                await sendMessage(p, "⚠️ Partner was banned.");
            }
            return sendMessage(senderId, `🚫 Banned ${targetName}`);
        } else {
            targetUser.isBanned = false;
            await targetUser.save();
            return sendMessage(senderId, `🔓 Unbanned ${targetName}`);
        }
    }

    // Chat
    if (lowerText === "chat") {
        if (activeChats[senderId]) return sendMessage(senderId, "⚠️ Already chatting.");
        if (waitingQueue.includes(senderId)) return sendMessage(senderId, "🔍 Searching...");
        
        const partner = waitingQueue.shift();
        if (partner) {
            activeChats[senderId] = partner; activeChats[partner] = senderId;
            userMessageCount[senderId] = 0; userMessageCount[partner] = 0;
            const pData = await User.findOne({ psid: partner });
            await sendMessage(senderId, `🎉 Connected to ${pData.name}!`);
            await sendMessage(partner, `🎉 Connected to ${userData.name}!`);
        } else {
            waitingQueue.push(senderId);
            await sendMessage(senderId, "🔍 Searching for stranger...");
        }
    }
}

// ==========================
// HELPERS
// ==========================
async function handleQuit(id) {
    const partner = activeChats[id];
    if (!partner) return sendMessage(id, "❌ Not in a chat.");
    if ((userMessageCount[id] || 0) < 2) return sendMessage(id, "⚠️ Send 2+ msgs first.");
    delete activeChats[id]; delete activeChats[partner];
    await sendMessage(id, "👋 End."); await sendMessage(partner, "👋 Stranger left.");
}

async function sendMessage(id, text) {
    try { await axios.post(`https://graph.facebook.com/v18.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, { recipient: { id }, message: { text } }); } catch (e) {}
}

async function sendImage(id, url) {
    try { await axios.post(`https://graph.facebook.com/v18.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, { recipient: { id }, message: { attachment: { type: "image", payload: { url } } } }); } catch (e) {}
}

async function markSeen(id) {
    try { await axios.post(`https://graph.facebook.com/v18.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, { recipient: { id }, sender_action: "mark_seen" }); } catch (e) {}
}

app.listen(PORT, () => console.log(`🚀 Online on port ${PORT}`));
