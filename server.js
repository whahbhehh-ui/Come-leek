const express = require('express');
const session = require('express-session');
const axios = require('axios');
const fs = require('fs');
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ตั้งค่า Session สำหรับจำสถานะการล็อกอิน
app.use(session({
    secret: 'YOUR_RANDOM_SESSION_SECRET_KEY',
    resave: false,
    saveUninitialized: false
}));

const DB_FILE = './scripts.json';

// ⚙️ ตั้งค่า Discord OAuth2 ของคุณตรงนี้
const CLIENT_ID = 'ใส่_Client_ID_ของคุณ';
const CLIENT_SECRET = 'ใส่_Client_Secret_ของคุณ';
const REDIRECT_URI = 'https://ชื่อ-api-ของคุณ.onrender.com/auth/discord/callback'; 
const ADMIN_DISCORD_ID = 'ใส่_Discord_ID_แท้ของคุณ_ที่เป็นแอดมิน';

function loadDB() {
    if (!fs.existsSync(DB_FILE)) return {};
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}

function saveDB(data) {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

// ----------------------------------------------------
// 1. ระบบ Login ด้วย Discord
// ----------------------------------------------------
app.get('/auth/discord', (req, res) => {
    const discordAuthUrl = `https://discord.com/api/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=identify`;
    res.redirect(discordAuthUrl);
});

app.get('/auth/discord/callback', async (req, res) => {
    const code = req.query.code;
    if (!code) return res.status(400).send('No code provided');

    try {
        // แลก Code เป็น Access Token
        const tokenResponse = await axios.post('https://discord.com/api/oauth2/token', new URLSearchParams({
            client_id: CLIENT_ID,
            client_secret: CLIENT_SECRET,
            grant_type: 'authorization_code',
            code: code,
            redirect_uri: REDIRECT_URI,
        }), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        const accessToken = tokenResponse.data.access_token;

        // ดึงข้อมูลไอดีผู้ใช้ Discord
        const userResponse = await axios.get('https://discord.com/api/users/@me', {
            headers: { Authorization: `Bearer ${accessToken}` }
        });

        const userData = userResponse.data;

        // เช็คว่าเป็นแอดมินตัวจริงไหม
        if (userData.id !== ADMIN_DISCORD_ID) {
            return res.status(403).send('❌ คุณไม่ใช่แอดมิน ไม่ได้รับอนุญาตให้เข้าใช้งานระบบนี้');
        }

        // บันทึกสถานะล็อกอินลง Session
        req.session.user = userData;
        res.redirect('/'); // กลับไปหน้าแรกหลังล็อกอินสำเร็จ
    } catch (error) {
        console.error(error);
        res.status(500).send('Authentication failed');
    }
});

// ตรวจสอบสถานะล็อกอิน
app.get('/api/check-auth', (req, res) => {
    if (req.session && req.session.user) {
        res.json({ loggedIn: true, user: req.session.user });
    } else {
        res.json({ loggedIn: false });
    }
});

// ----------------------------------------------------
// 2. API สำหรับจำลองลิงก์ Raw
// ----------------------------------------------------
app.get('/raw/:project/refs/heads/main/:filename', (req, res) => {
    const { project, filename } = req.params;
    const db = loadDB();

    if (!db[project] || !db[project][filename]) {
        return res.status(404).send('Script not found');
    }

    const scriptData = db[project][filename];
    if (!scriptData.active) {
        return res.status(403).send('-- This script is currently disabled by the owner.');
    }

    res.setHeader('X-Robots-Tag', 'noindex, nofollow, nosnippet');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send(scriptData.code);
});

// ----------------------------------------------------
// 3. API จัดการโค้ด (ต้องล็อกอินก่อนถึงจะบันทึกได้)
// ----------------------------------------------------
app.post('/api/manage', (req, res) => {
    if (!req.session || !req.session.user || req.session.user.id !== ADMIN_DISCORD_ID) {
        return res.status(401).json({ error: 'Unauthorized: Please login with Discord first' });
    }

    const { action, project, filename, code, active } = req.body;
    let db = loadDB();
    if (!db[project]) db[project] = {};

    if (action === 'save') {
        db[project][filename] = {
            code: code,
            active: active !== undefined ? active : true,
            updated_at: new Date().toISOString()
        };
        saveDB(db);
        return res.json({ success: true, message: 'Saved successfully!' });
    }

    res.status(400).json({ error: 'Invalid action' });
});

app.listen(3000, () => {
    console.log('Server is running on port 3000');
});
