const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const mongoose = require('mongoose');

const app = express();
app.use(bodyParser.json());

// ⚙️ CONFIGURATION
const PAGE_ACCESS_TOKEN = "EAAcLptP3AhgBRGbYTwaqF2QhMtdwxdAjYvhhZCcm4XpzkTVRNMTBcu8MtPWvUvqoPprJaHfyx8IW73Y7otKA3SCwqGcu4ka8jhz5ci1YbRcCZBlihPKKDAlyiFjySGHrmwDE8Ol3dQG7fZBlKrcu8YGtZB7P8tguMdxbI2syZCvnO6ceZCsEfGpRH0cnJjZCZAw7TxoZA6gZDZD";
const VERIFY_TOKEN = "key";
const OWNER_PASSWORD = "dan122012";
const PORT = process.env.PORT || 3000;

// 📦 DATABASE - MEMORY STORAGE
let waitingQueue = [];
let activeChats = {};
let userMessageCount = {};
let bannedUsers = [];

// ==========================
// 🗄️ MONGODB CONNECTION
// ==========================
const mongoURI = "mongodb+srv://danielmojar84_db_user:nDG9hpTU0uHZtxYO@cluster0.wsk0egt.mongodb.net/?appName=Cluster0";

mongoose.connect(mongoURI)
.then(() => console.log("✅ MongoDB Connected Successfully"))
.catch(err => console.log("❌ MongoDB Connection Error:", err));

// 📋 SCHEMA & MODEL
const userSchema = new mongoose.Schema({
    psid: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    age: { type: Number, required: true },
    role: { type: String, default: "member" }
});

const User = mongoose.model("User", userSchema);

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
                    return;
                }

                await markSeen(senderId);

                if (event.message) {
                    // ✅ HANDLE LINKS / URLs
                    if (event.message.text && event.message.text.startsWith("http")) {
                        if (!activeChats[senderId]) return;
                        const partner = activeChats[senderId];
                        await sendMessage(partner, event.message.text);
                        return;
                    }

                    if (event.message.attachments) {
                        const att = event.message.attachments[0];
                        if (att.type === 'image' && activeChats[senderId]) {
                            await sendImage(activeChats[senderId], att.payload.url);
                        }
                    }
                    else if (event.message.text) {
                        const text = event.message.text; // Preserve spaces & new lines
                        const lowerText = text.toLowerCase();
                        userMessageCount[senderId] = (userMessageCount[senderId] || 0) + 1;
                        
                        if (activeChats[senderId]) {
                            // Forward message exactly as it is
                            const partner = activeChats[senderId];
                            await sendMessage(partner, text);
                        } else {
                            await handleMessage(senderId, text.trim(), lowerText.trim());
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

    // 🔐 HIDDEN OWNER LOGIN
    if (lowerText === "/loginowner dan122012") {
        let userData = await User.findOne({ psid: senderId });
        if (!userData) {
            userData = new User({ psid: senderId, name: "Owner", age: 1 });
        }
        userData.role = "owner";
        await userData.save();
        return sendMessage(senderId, "✅ LOGGED IN AS OWNER");
    }

    // 📝 RESET INFO COMMAND
    if (lowerText === "/resetinfo") {
        const oldData = await User.findOne({ psid: senderId });
        global.tempState = global.tempState || {};
        tempState[senderId] = { step: 1, data: { role: oldData ? oldData.role : "member" } };
        return sendMessage(senderId, 
            `🔄 RESETTING INFO\n` +
            `────────────────────\n` +
            `Please enter your new username:`
        );
    }

    // 📝 REGISTRATION FLOW
    global.tempState = global.tempState || {};
    if (tempState[senderId]) {
        const state = tempState[senderId];
        
        if (state.step === 1) {
            // Validation
            if (text.length < 2 || text.length > 20) {
                return sendMessage(senderId, "⚠️ INVALID\nName must be 2-20 characters. Try again:");
            }
            const regex = /^[a-zA-Z0-9 _@]+$/;
            if (!regex.test(text)) {
                return sendMessage(senderId, "⚠️ INVALID\nOnly letters, numbers, space, _ and @ allowed. Try again:");
            }
            // Check duplicate in DB
            const existing = await User.findOne({ name: text });
            if (existing && existing.psid !== senderId) {
                return sendMessage(senderId, "❌ USERNAME TAKEN\nChoose another name:");
            }

            // Remove old name
            const oldData = users.get(senderId);
            if (oldData && oldData.name) {
                names.delete(oldData.name);
            }

            state.data.name = text;
            state.step = 2;
            userStates.set(senderId, state);
            return sendMessage(senderId, 
                `📝 QUESTION 2/2\n` +
                `────────────────────\n` +
                `Please enter your age, or fake it if you're not comfortable`
            );
        }
        
        if (state.step === 2) {
            const ageNum = parseInt(text);
            if (isNaN(ageNum) || ageNum < 1 || ageNum > 50) {
                return sendMessage(senderId, "⚠️ INVALID\nAge must be a number between 1-50. Try again:");
            }

            state.data.age = ageNum;
            
            // Save or Update in DB
            await User.findOneAndUpdate(
                { psid: senderId },
                state.data,
                { upsert: true, new: true }
            );
            
            delete tempState[senderId];
            
            return sendMessage(senderId, 
                `✅ REGISTRATION COMPLETE\n` +
                `────────────────────\n` +
                `Welcome ${state.data.name}!\n` +
                `Type chat to find someone to talk to.`
            );
        }
    }

    // 🆕 NEW USER CHECK
    const userData = await User.findOne({ psid: senderId });
    if (!userData) {
        if (lowerText === "/setinfo") {
            global.tempState = global.tempState || {};
            tempState[senderId] = { step: 1, data: {} };
            return sendMessage(senderId, 
                `📝 QUESTION 1/2\n` +
                `────────────────────\n` +
                `Please enter your username:\n` +
                `(2-20 chars, letters & numbers only)`
            );
        } else {
            return sendMessage(senderId, 
                `👋 WELCOME\n` +
                `────────────────────\n` +
                `Please type /setinfo to start\n\n` +
                `📋 COMMANDS:\n` +
                `/setinfo - Create your account\n` +
                `/resetinfo - Change your info\n` +
                `/profile - View your profile\n` +
                `chat - Find someone to talk\n` +
                `quit - End conversation`
            );
        }
    }

    // 📄 PROFILE COMMAND
    if (lowerText === "/profile") {
        return sendMessage(senderId, 
            `PROFILE\n` +
            `────────────────────\n` +
            `Name: ${userData.name}\n` +
            `Age: ${userData.age}\n` +
            `Role: ${userData.role}`
        );
    }

    // 👑 ADMIN COMMANDS
    if (lowerText.startsWith("/admin ")) {
        if (userData.role !== "owner") return sendMessage(senderId, "❌ PERMISSION DENIED\nOnly Owner can add/remove admins.");
        
        const parts = text.split(" ");
        const action = parts[1];
        const targetName = parts.slice(2).join(" ");
        const targetUser = await User.findOne({ name: targetName });
        
        if (!targetUser) return sendMessage(senderId, "❌ USER NOT FOUND");
        
        if (action === "add") {
            targetUser.role = "admin";
            await targetUser.save();
            return sendMessage(senderId, `✅ ${targetName} is now admin`);
        } else if (action === "remove") {
            targetUser.role = "member";
            await targetUser.save();
            return sendMessage(senderId, `✅ ${targetName} is now member`);
        }
    }

    // 🛡️ BAN / UNBAN
    if (lowerText.startsWith("/ban ")) {
        if (userData.role !== "owner" && userData.role !== "admin") {
            return sendMessage(senderId, "❌ PERMISSION DENIED");
        }
        
        const targetName = text.split(" ").slice(1).join(" ");
        const targetUser = await User.findOne({ name: targetName });
        
        if (!targetUser) return sendMessage(senderId, "❌ USER NOT FOUND");
        
        if (targetUser.role === "owner" || (targetUser.role === "admin" && userData.role !== "owner")) {
            return sendMessage(senderId, "❌ CANNOT BAN THIS USER");
        }
        
        if (!bannedUsers.includes(targetUser.psid)) bannedUsers.push(targetUser.psid);
        return sendMessage(senderId, `✅ BANNED\nUser: ${targetName}`);
    }

    if (lowerText.startsWith("/unban ")) {
        if (userData.role !== "owner" && userData.role !== "admin") {
            return sendMessage(senderId, "❌ PERMISSION DENIED");
        }
        
        const targetName = text.split(" ").slice(1).join(" ");
        const targetUser = await User.findOne({ name: targetName });
        
        if (!targetId) return sendMessage(senderId, "❌ USER NOT FOUND");
        
        bannedUsers = bannedUsers.filter(id => id !== targetUser.psid);
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

    if (lowerText === "chat") {
        if (activeChats[senderId]) return sendMessage(senderId, "⚠️ ALREADY IN CHAT");
        if (waitingQueue.includes(senderId)) return sendMessage(senderId, "🔍 SEARCHING...");

        const partner = waitingQueue.length > 0 ? waitingQueue.shift() : null;
        if (partner) {
            activeChats[senderId] = partner;
            activeChats[partner] = senderId;
            userMessageCount[senderId] = 0;
            userMessageCount[partner] = 0;

            const myData = await User.findOne({ psid: senderId });
            const partnerData = await User.findOne({ psid: partner });

            await sendMessage(senderId, 
                `🎉 CONNECTED!\n` +
                `────────────────────\n` +
                `Name: ${partnerData.name}\n` +
                `Age: ${partnerData.age}\n` +
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
            data: {
                recipient: { id: id },
                message: { text: text }
            }
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
                    attachment: {
                        type: "image",
                        payload: { url: url }
                    }
                }
            }
        });
    } catch (e) {
        console.log("❌ Error sending image:", e.response?.data || e.message);
    }
}

async function markSeen(id) {
    try {
        await axios({
            method: 'POST',
            url: 'https://graph.facebook.com/v18.0/me/messages',
            params: { access_token: PAGE_ACCESS_TOKEN },
            data: {
                recipient: { id: id },
                sender_action: "mark_seen"
            }
        });
    } catch (e) {}
}

// ==========================
// START SERVER
// ==========================
app.listen(PORT, () => {
    console.log(`🚀 Bot Running on port ${PORT}`);
});
                        
