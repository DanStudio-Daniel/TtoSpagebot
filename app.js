const express = require('express');
const axios = require('axios');
const mongoose = require('mongoose');
const fs = require('fs');
const app = express();
app.use(express.json());

// --- CONFIG ---
const PAGE_ACCESS_TOKEN = "EAAcLptP3AhgBRA5CXWfCWha5BKBWjFC8CM0hZBMFCLG8ZCZATN1DNHtg0iGQJ3g2Y2Y4Gc5lH0y5bfFafFKuHlPTD0826zfsxc5buUWY0XIiHF9s7yD5Rr8AGmMEYsgQJoJaWzDYYZCP4xpZChqdrgFRIWNa2ZAuk4jDaMlEmwrU6v1ZAbSkN2AILZBjbTMIRHaF0199PQZDZD";
const VERIFY_TOKEN = "key";
const GRAPH_API_URL = "https://graph.facebook.com/v18.0/me/messages";

// --- MONGO DB CONNECTION ---
mongoose.connect("mongodb+srv://danielmojar84_db_user:nDG9hpTU0uHZtxYO@cluster0.wsk0egt.mongodb.net/economybot?retryWrites=true&w=majority&appName=Cluster0", {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(() => console.log("MongoDB Connected"))
  .catch(err => console.log(err));

// --- USER SCHEMA ---
const userSchema = new mongoose.Schema({
    senderId: String,
    coins: { type: Number, default: 100 }
});
const User = mongoose.model("User", userSchema);

// --- LOAD COMMANDS ---
let commands = [];
const commandFiles = fs.readdirSync('./cmds').filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
    const command = require(`./cmds/${file}`);
    commands.push(command);
}

// --- SEND MESSAGE FUNCTION ---
function sendMessage(senderId, text) {
    axios.post(GRAPH_API_URL, {
        recipient: { id: senderId },
        message: { text: text }
    }, {
        params: { access_token: PAGE_ACCESS_TOKEN }
    }).catch(err => console.log(err));
}

// --- WEBHOOK ---
app.get('/webhook', (req, res) => {
    if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === VERIFY_TOKEN) {
        res.status(200).send(req.query['hub.challenge']);
    } else {
        res.sendStatus(403);
    }
});

app.post('/webhook', (req, res) => {
    const data = req.body;
    if (data.object === 'page') {
        data.entry.forEach(entry => {
            entry.messaging.forEach(async event => {
                if (event.message && event.message.text) {
                    const senderId = event.sender.id;
                    const message = event.message.text.trim().toLowerCase();
                    const args = message.split(" ");
                    const command = args[0].toLowerCase();

                    // Secret Admin Unlock
                    if (message === "unlockadmin dan122012") {
                        sendMessage(senderId, "Admin access granted!");
                        return;
                    }

                    // Find Command
                    const cmd = commands.find(c => c.name === command);
                    if (cmd) {
                        try {
                            await cmd.run(senderId, args, User, sendMessage);
                        } catch (e) {
                            console.error(e);
                        }
                    }
                }
            });
        });
        res.sendStatus(200);
    }
});

// --- START SERVER ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
                                          
