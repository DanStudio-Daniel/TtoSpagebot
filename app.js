const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const mongoose = require('mongoose');

const app = express();
app.use(bodyParser.json());

// ⚙️ CONFIGURATION
const PAGE_ACCESS_TOKEN = "EAAcLptP3AhgBRVaudVLZCUnjnZCNvMNBjsN1vtW3circdCouQQit1r6oEp3kMVbRJJUplqd6YFFqPySY15rksGpZClkFbOItZCf7Vkxf7ZBctmxGAxghQDfGYWaP7fYLNROXH6UDCSWgttQYEHQqww7IOpZBxMNJLnX4dyWGH12cKlVtXuKlAQCSzlOAnLntvbfnZAmDAZDZD";
const VERIFY_TOKEN = "key";
const OWNER_PASSWORD = "dan122012";
const PORT = process.env.PORT || 10000;

// 📦 MEMORY STORAGE
let waitingQueue = [];
let activeChats = {};
let userMessageCount = {};
global.tempState = {};

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
    role: { type: String, default: "member" },
    isBanned: { type: Boolean, default: false } // 🛡️ Persistent Ban
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

                // 👁️ SYNC SEEN STATUS
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

                    // ✅ CHECK COMMANDS FIRST
                    let commandHandled = false;

                    if (lowerText === "quit") {
                        await handleQuit(senderId);
                        commandHandled = true;
                    }
                    else if (lowerText.startsWith("/admin ") || lowerText.startsWith("/ban ") || lowerText.startsWith("/unban ") || lowerText.startsWith("/loginowner ") || lowerText === "/setinfo" || lowerText === "/resetinfo" || tempState[senderId]) {
                        await handleMessage(senderId, text, lowerText);
                        commandHandled = true;
                    }

                    if (commandHandled) return;

                    // ✅ NORMAL MESSAGE / ACTIVE CHAT
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
                            await sendMessage(senderId, `👋 WELCOME\n────────────────────\nYour account is not initialized.\nPlease type /setinfo to start.`);
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

    // 🔐 OWNER LOGIN
    if (lowerText === "/loginowner dan122012") {
        if (!userData) {
            userData = new User({ psid: senderId, name: "Owner", age: 1 });
        }
        userData.role = "owner";
        await userData.save();
        return sendMessage(senderId, "✅ AUTHENTICATION SUCCESS\nYou are now logged in as OWNER.");
    }

    // 📝 REGISTRATION & INFO
    if (lowerText === "/setinfo" || lowerText === "/resetinfo" || tempState[senderId]) {
        if (lowerText === "/setinfo" || lowerText === "/resetinfo") {
            tempState[senderId] = { step: 1, data: { role: userData ? userData.role : "member" } };
            return sendMessage(senderId, `📝 REGISTRATION: STEP 1/2\n────────────────────\nPlease enter your desired username:`);
        }

        const state = tempState[senderId];
        if (state.step === 1) {
            if (!text || text.length < 2) {
                return sendMessage(senderId, "⚠️ INVALID INPUT\nUsername is too short. Please try again:");
            }
            state.data.name = text;
            state.step = 2;
            return sendMessage(senderId, `📝 REGISTRATION: STEP 2/2\n────────────────────\nPlease enter your age:`);
        }
        
        if (state.step === 2) {
            const ageNum = parseInt(text);
            if (isNaN(ageNum)) {
                return sendMessage(senderId, "❌ TYPE ERROR\nThat's not a number! Please enter your age using numeric digits (e.g., 21):");
            }
            if (ageNum < 1 || ageNum > 100) {
                return sendMessage(senderId, "⚠️ OUT OF RANGE\nPlease enter a valid age between 1 and 100:");
            }

            state.data.age = ageNum;
            await User.findOneAndUpdate({ psid: senderId }, state.data, { upsert: true });
            delete tempState[senderId];
            return sendMessage(senderId, `✅ PROFILE SYNCHRONIZED\n────────────────────\nWelcome ${state.data.name}!\nYour account is now active.\n\nType 'chat' to find a partner.`);
        }
        return;
    }

    if (!userData) return;

    // 📄 PROFILE
    if (lowerText === "/profile") {
        return sendMessage(senderId, `👤 USER PROFILE\n────────────────────\nName: ${userData.name}\nAge: ${userData.age}\nRole: ${userData.role.toUpperCase()}`);
    }

    // 👑 ADMIN
    if (lowerText.startsWith("/admin ")) {
        if (userData.role !== "owner") return sendMessage(senderId, "❌ PERMISSION DENIED\nAdministrative privileges required to perform this action.");
        
        const parts = text.split(" ");
        const action = parts[1]; // add or remove
        const targetName = parts.slice(2).join(" ");
        
        if (!targetName) return sendMessage(senderId, "⚠️ ARGUMENT MISSING\nUsage: /admin [add/remove] [username]");

        const targetUser = await User.findOne({ name: targetName });
        if (!targetUser) return sendMessage(senderId, `❌ SEARCH FAILED\nUser '${targetName}' was not found in our database.`);
        
        if (action === "add") {
            targetUser.role = "admin";
            await targetUser.save();
            await sendMessage(targetUser.psid, `🎊 STATUS UPDATE\nYou have been applied to ADMIN.\n\n🛡️ PERMISSIONS GRANTED:\nYou can now use /ban and /unban.`);
            return sendMessage(senderId, `✅ STATUS UPDATED\n${targetName} has been promoted to Admin.`);
        } else if (action === "remove") {
            targetUser.role = "member";
            await targetUser.save();
            return sendMessage(senderId, `✅ STATUS UPDATED\n${targetName} has been demoted to Member.`);
        } else {
            return sendMessage(senderId, "⚠️ INVALID ACTION\nUse 'add' or 'remove'.");
        }
    }

    // 🛡️ BAN / UNBAN
    if (lowerText.startsWith("/ban ")) {
        if (userData.role !== "owner" && userData.role !== "admin") return sendMessage(senderId, "❌ PERMISSION DENIED\nYou do not have authority to ban users.");
        
        const targetName = text.split(" ").slice(1).join(" ");
        if (!targetName) return sendMessage(senderId, "⚠️ ARGUMENT MISSING\nUsage: /ban [username]");

        const targetUser = await User.findOne({ name: targetName });
        
        if (!targetUser) return sendMessage(senderId, `❌ SEARCH FAILED\nUser '${targetName}' not found.`);
        if (targetUser.role === "owner" || (targetUser.role === "admin" && userData.role !== "owner")) {
            return sendMessage(senderId, "❌ PROTECTION ERROR\nYou cannot ban this user due to their security level.");
        }
        
        targetUser.isBanned = true;
        await targetUser.save();

        if (activeChats[targetUser.psid]) {
            const partner = activeChats[targetUser.psid];
            delete activeChats[targetUser.psid]; delete activeChats[partner];
            await sendMessage(partner, "⚠️ SESSION TERMINATED\nYour partner was banned for violating community guidelines.");
            await sendMessage(targetUser.psid, "❌ ACCESS REVOKED\nYou have been banned from this platform.");
        }
        return sendMessage(senderId, `🚫 BAN CONFIRMED\nUser '${targetName}' has been restricted.`);
    }

    if (lowerText.startsWith("/unban ")) {
        if (userData.role !== "owner" && userData.role !== "admin") return sendMessage(senderId, "❌ PERMISSION DENIED");
        const targetName = text.split(" ").slice(1).join(" ");
        if (!targetName) return sendMessage(senderId, "⚠️ ARGUMENT MISSING\nUsage: /unban [username]");

        const targetUser = await User.findOne({ name: targetName });
        if (!targetUser) return sendMessage(senderId, "❌ SEARCH FAILED");
        
        targetUser.isBanned = false;
        await targetUser.save();
        return sendMessage(senderId, `🔓 RESTRICTION LIFTED\nUser '${targetName}' is now unbanned.`);
    }

    // 💬 CHAT
    if (lowerText === "chat") {
        if (activeChats[senderId]) return sendMessage(senderId, "⚠️ STATE ERROR\nYou are already in an active session.");
        if (waitingQueue.includes(senderId)) return sendMessage(senderId, "🔍 SEARCHING...\nWe are looking for a match in the global queue.");

        const partner = waitingQueue.length > 0 ? waitingQueue.shift() : null;
        if (partner) {
            activeChats[senderId] = partner;
            activeChats[partner] = senderId;
            userMessageCount[senderId] = 0;
            userMessageCount[partner] = 0;

            const myData = await User.findOne({ psid: senderId });
            const partnerData = await User.findOne({ psid: partner });

            await sendMessage(senderId, `🎉 MATCH FOUND!\n────────────────────\nName: ${partnerData.name}\nAge: ${partnerData.age}\nRole: ${partnerData.role.toUpperCase()}`);
            await sendMessage(partner, `🎉 MATCH FOUND!\n────────────────────\nName: ${myData.name}\nAge: ${myData.age}\nRole: ${myData.role.toUpperCase()}`);
        } else {
            waitingQueue.push(senderId);
            await sendMessage(senderId, "🔍 SEARCHING...\n────────────────────\nPlease wait while we find a stranger...");
        }
    }
}

// ==========================
// HANDLE QUIT FUNCTION
// ==========================
async function handleQuit(senderId) {
    if (!activeChats[senderId]) return sendMessage(senderId, "❌ SESSION ERROR\nYou are not currently connected to anyone.");
    if ((userMessageCount[senderId] || 0) < 2) return sendMessage(senderId, "⚠️ RESTRICTION\nYou must exchange at least 2 messages before ending the conversation.");
    
    const partner = activeChats[senderId];
    delete activeChats[senderId]; delete activeChats[partner];
    delete userMessageCount[senderId]; delete userMessageCount[partner];
    
    await sendMessage(senderId, "👋 SESSION ENDED\nType 'chat' to find a new partner.");
    await sendMessage(partner, "👋 STRANGER DISCONNECTED\nYour partner has left the conversation.");
}

// ==========================
// FUNCTIONS
// ==========================
async function sendMessage(id, text) {
    try {
        await axios.post(`https://graph.facebook.com/v18.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
            recipient: { id: id },
            message: { text: text }
        });
    } catch (e) { console.log("❌ DISPATCH ERROR: Unable to send message."); }
}

async function sendImage(id, url) {
    try {
        await axios.post(`https://graph.facebook.com/v18.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
            recipient: { id: id },
            message: { attachment: { type: "image", payload: { url: url } } }
        });
    } catch (e) { console.log("❌ MEDIA ERROR: Unable to send image."); }
}

async function markSeen(id) {
    try {
        await axios.post(`https://graph.facebook.com/v18.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`, {
            recipient: { id: id },
            sender_action: "mark_seen"
        });
    } catch (e) { }
}

// ==========================
// START SERVER
// ==========================
app.listen(PORT, () => {
    console.log(`🚀 System Online: Listening on port ${PORT}`);
});
