const http = require('http');
const os = require('os');
const mineflayer = require('mineflayer');
const minecraftData = require('minecraft-data');

const SERVER_HOST = 'play.amorycraft.com';
const SERVER_PORT = 25565;
const DEFAULT_PASSWORD = '112233';
const MC_VERSION = '1.20.1';
const WEB_PORT = 3002;

const sharedData = minecraftData(MC_VERSION);

function log(msg) {
    const time = new Date().toLocaleTimeString('th-TH', { hour12: false });
    console.log(`[${time}] ${msg}`);
}

function logError(msg) {
    const time = new Date().toLocaleTimeString('th-TH', { hour12: false });
    console.error(`[${time}] ${msg}`);
}

function cleanColorCodes(str) {
    if (!str) return '';
    return str.replace(/§[0-9a-fk-orx]/gi, '').trim();
}

function generateHumanLikeEmail() {
    const firstNames = ['james', 'alex', 'oliver', 'noah', 'lucas', 'leo', 'jack', 'ethan', 'daniel', 'marcus', 'ryan', 'nathan', 'samuel', 'david', 'chris', 'kevin', 'jason', 'eric', 'brian', 'justin', 'somchai', 'thanawat', 'nattapon', 'kittisak', 'worapon'];
    const lastNames = ['miller', 'taylor', 'smith', 'brown', 'wilson', 'moore', 'clark', 'white', 'walker', 'hall', 'allen', 'young', 'king', 'wright', 'scott', 'green', 'baker', 'adams', 'nelson', 'hill'];
    const fn = firstNames[Math.floor(Math.random() * firstNames.length)];
    const ln = lastNames[Math.floor(Math.random() * lastNames.length)];
    const num = Math.floor(100 + Math.random() * 899);
    const sep = Math.random() > 0.5 ? '.' : '';
    return `${fn}${sep}${ln}${num}@gmail.com`;
}

const BOT_CONFIGS = [
    { name: 'KinKaoReuYang', pass: '112233' }
];

const BOT_NAMES = BOT_CONFIGS.map(b => b.name);
const activeBots = {};

const botStatusMap = {};
BOT_NAMES.forEach(name => {
    botStatusMap[name] = { 
        status: 'Stopped', 
        step: 'รอสั่งเปิดจากหน้าเว็บ...', 
        bits: 0,
        lastUpdate: new Date().toLocaleTimeString('th-TH', { hour12: false }),
        lastError: '-',
        enabled: false 
    };
});

function updateStatus(name, status, step, bits = null, errorReason = null) {
    if (!botStatusMap[name]) return;
    if (status) botStatusMap[name].status = status;
    if (step) botStatusMap[name].step = step;
    if (bits !== null) botStatusMap[name].bits = bits;
    if (errorReason) botStatusMap[name].lastError = errorReason;
    botStatusMap[name].lastUpdate = new Date().toLocaleTimeString('th-TH', { hour12: false });
}

function stopBotInstance(username) {
    if (activeBots[username]) {
        if (activeBots[username].compassTimer) clearTimeout(activeBots[username].compassTimer);
        if (activeBots[username].anvilCheckTimer) clearTimeout(activeBots[username].anvilCheckTimer);
        if (activeBots[username].afkInterval) clearInterval(activeBots[username].afkInterval);
        try { activeBots[username].quit(); } catch (e) {}
        delete activeBots[username];
    }
}

function extractAllStrings(obj, collector = []) {
    if (!obj) return collector;
    if (typeof obj === 'string') {
        collector.push(obj);
    } else if (typeof obj === 'object') {
        for (const key of Object.keys(obj)) {
            extractAllStrings(obj[key], collector);
        }
    }
    return collector;
}

function parseBitsFromString(rawString) {
    if (!rawString) return null;
    const text = cleanColorCodes(rawString);

    if (/บิท|bit/i.test(text)) {
        const hexMatch = text.match(/#12DBF6\s*([0-9,]+)/i);
        if (hexMatch) return parseInt(hexMatch[1].replace(/,/g, ''), 10);
        
        const normalMatch = text.match(/(?:บิท|bit)\s*[:：]?\s*([0-9,]+)/i);
        if (normalMatch) return parseInt(normalMatch[1].replace(/,/g, ''), 10);
    }
    return null;
}

function triggerLobbyCompass(bot, username) {
    if (bot.compassTimer) clearTimeout(bot.compassTimer);
    if (bot.anvilCheckTimer) clearTimeout(bot.anvilCheckTimer);
    bot.authStage = 'IN_LOBBY';
    log(`[🏠] [${username}] เข้าสู่ Lobby แล้ว -> รอ 12s ก่อนหาเข็มทิศ...`);
    updateStatus(username, 'In Lobby', 'วาร์ปเข้า Lobby (รอ 12s)');

    bot.compassTimer = setTimeout(() => {
        useCompass(bot, username);
    }, 12000);
}

async function useCompass(bot, username) {
    if (!bot || !bot.inventory) return;
    updateStatus(username, 'In Lobby', 'สแกนถือเข็มทิศ');
    
    const compass = bot.inventory.items().find(i => i.name.includes('compass'));
    if (compass) {
        try {
            await bot.equip(compass, 'hand');
            await bot.sleep(2500);
            bot.authStage = 'WAIT_COMPASS_MENU';
            bot.activateItem();
            log(`[🧭] [${username}] คลิกขวาใช้งานเข็มทิศเรียบร้อย!`);
        } catch (e) {
            bot.authStage = 'WAIT_COMPASS_MENU';
            bot.activateItem();
        }
    } else {
        try {
            await bot.sleep(2500);
            bot.authStage = 'WAIT_COMPASS_MENU';
            bot.activateItem();
        } catch (e) {}
    }
}

function createBotInstance(username, delayMs = 0) {
    const currentStatus = botStatusMap[username]?.status || 'Stopped';
    const isAlreadyRunning = activeBots[username] && (currentStatus.includes('Online') || currentStatus === 'Connecting' || currentStatus === 'Logging in' || currentStatus === 'In Lobby' || currentStatus.includes('Registering'));

    if (isAlreadyRunning) return;

    if (!botStatusMap[username]?.enabled) {
        updateStatus(username, 'Stopped', 'ระงับการทำงาน (User Disabled)');
        return;
    }

    setTimeout(() => {
        if (!botStatusMap[username]?.enabled) return;

        stopBotInstance(username);

        log(`[+] [${username}] กำลังเชื่อมต่อเข้าเซิร์ฟเวอร์...`);
        updateStatus(username, 'Connecting', 'กำลังเชื่อมต่อ...');

        const botConfig = BOT_CONFIGS.find(b => b.name === username);
        const botPassword = botConfig ? botConfig.pass : DEFAULT_PASSWORD;
        const randomEmail = generateHumanLikeEmail();

        // ⚡ ปรับแต่ง Client ให้กินทรัพยากรต่ำที่สุดเท่าที่จะทำได้
        const bot = mineflayer.createBot({
            host: SERVER_HOST,
            port: SERVER_PORT,
            username: username,
            version: MC_VERSION,
            data: sharedData,
            physicsEnabled: false,      // ปิดระบบฟิสิกส์ทั้งหมด
            viewDistance: 'tiny',       // โหลด Chunk สั้นสุด
            checkTimeoutInterval: 60000
        });

        // ⚡ ป้องกัน Memory Leak: ไม่เก็บข้อมูล Entity ตัวอื่นในเซิร์ฟเวอร์
        bot.on('entitySpawn', (entity) => {
            if (entity !== bot.entity) delete bot.entities[entity.id];
        });

        if (bot._client) {
            bot._client.on('packet', (data, metadata) => {
                // ⚡ ตรวจจับบิทด้วย Event Driven ทันทีที่แพ็กเก็ตมา ไม่ต้องใช้ setInterval วนลูป
                if (metadata.name === 'teams' || metadata.name === 'scoreboard_team' || metadata.name === 'scoreboard_score') {
                    try {
                        const rawStrings = extractAllStrings(data).join(' ');
                        const parsed = parseBitsFromString(rawStrings);
                        if (parsed !== null && parsed > 0) {
                            if (botStatusMap[username].bits !== parsed) {
                                log(`🪙 [${username}] อัปเดตบิท: ${parsed.toLocaleString()} บิท`);
                                updateStatus(username, null, null, parsed);
                            }
                        }
                    } catch (e) {}
                }

                // ⚡ ทิ้งแพ็กเก็ตเอฟเฟกต์และเสียงเพื่อลดโหลด CPU
                if (metadata.name.includes('particle') || metadata.name.includes('sound') || metadata.name.includes('light')) {
                    metadata.size = 0;
                    return false;
                }
            });
        }

        activeBots[username] = bot;
        bot.authStage = 'START';
        let isRegisterMode = false;

        bot.on('message', (jsonMsg) => {
            const raw = jsonMsg.toString().trim();
            if (!raw) return;

            const isSpam = /\[ᴄʀᴀᴛᴇ\]|\[crate\]|แก๊ง|ประมูล|กิลด์|ดิสคอร์ด|discord|shout/i.test(raw);
            const isPlayerChat = /^\[.*?\]\s*.*?:/.test(raw) || /^<.*?>/.test(raw);

            if (!isSpam && !isPlayerChat) {
                if (/เข้าสู่ระบบ|สมัคร|รหัส|afk|kick|ban|error|กรุณา/i.test(raw)) {
                    log(`[💬 SYSTEM] [${username}]: "${raw}"`);
                }
            }
        });

        bot.on('kicked', (reason) => {
            let kickReasonStr = reason;
            try { kickReasonStr = JSON.parse(reason).text || reason; } catch (e) {}
            logError(`[🚨 KICKED] [${username}] โดนเตะ: ${kickReasonStr}`);
            updateStatus(username, 'Kicked', `โดนเตะ: ${kickReasonStr}`, null, kickReasonStr);
        });

        bot.on('spawn', () => {
            if (bot.authStage === 'TYPING_PASSWORD' && !isRegisterMode) {
                log(`[⚡ BYPASS] [${username}] โหลดเข้า Lobby สำเร็จ`);
                triggerLobbyCompass(bot, username);
            }
        });

        bot.on('windowOpen', async (window) => {
            if (window.type === 'minecraft:generic_9x3') {

                if (bot.authStage === 'WAIT_COMPASS_MENU') {
                    bot.authStage = 'SURVIVAL_DONE';
                    log(`[4/4] [${username}] เลือก Survival (Slot 10)...`);
                    updateStatus(username, 'Selecting Mode', 'เลือก Survival (Slot 10)');

                    setTimeout(async () => {
                        try {
                            await bot.clickWindow(10, 0, 0);
                            log(`[🚀] [${username}] วาร์ปเข้า Survival (รอโหลด 12s)...`);
                            updateStatus(username, 'Entering Survival', 'กำลังวาร์ปเข้า Survival');

                            setTimeout(() => {
                                bot.chat('/afk');
                                log(`[✓] [${username}] ประจำการใน Survival และพิมพ์ /afk เรียบร้อย!`);
                                updateStatus(username, 'Online (AFK)', 'ออนไลน์ปกติ (/afk)');

                                // ขยับมุมมองเบาๆ ทุก 60 วินาทีป้องกัน Timeout
                                if (bot.afkInterval) clearInterval(bot.afkInterval);
                                bot.afkInterval = setInterval(() => {
                                    try { bot.look(bot.entity.yaw + 0.05, bot.entity.pitch, true); } catch (e) {}
                                }, 60000);

                            }, 12000);
                        } catch (err) {
                            logError(`[-] กดเลือก Survival ล้มเหลว: ${err.message}`);
                        }
                    }, 2500);
                    return;
                }

                const hasPassSlot = window.slots[1] && window.slots[1].name.includes('book');
                const hasEmailSlot = window.slots[2] && window.slots[2].name.includes('book');

                isRegisterMode = Boolean(hasPassSlot && hasEmailSlot);

                if (bot.authStage === 'START') {
                    bot.authStage = 'TYPING_PASSWORD';
                    log(`[1] [${username}] เข้าหน้า ${isRegisterMode ? 'REGISTER' : 'LOGIN'} -> กด Slot 1...`);
                    updateStatus(username, isRegisterMode ? 'Registering' : 'Logging in', 'กรอกรหัสผ่าน (Slot 1)');

                    setTimeout(async () => {
                        try {
                            await bot.clickWindow(1, 0, 0);
                            bot.anvilCheckTimer = setTimeout(() => {
                                if (bot.authStage === 'TYPING_PASSWORD') {
                                    triggerLobbyCompass(bot, username);
                                }
                            }, 3500);
                        } catch (e) {}
                    }, 1200);
                }
                else if (bot.authStage === 'PASSWORD_DONE' && isRegisterMode) {
                    bot.authStage = 'TYPING_EMAIL';
                    log(`[2] [${username}] กรอกอีเมล (Slot 2)...`);
                    updateStatus(username, 'Registering', 'กรอกอีเมล (Slot 2)');

                    setTimeout(async () => {
                        try {
                            await bot.clickWindow(2, 0, 0);
                        } catch (e) {}
                    }, 1500);
                }
                else if (bot.authStage === 'EMAIL_DONE' && isRegisterMode) {
                    bot.authStage = 'SUBMITTING_REGISTER';
                    log(`[3] [${username}] ติ๊กยอมรับ (Slot 3) และกดยืนยัน (Slot 4)...`);
                    updateStatus(username, 'Registering', 'ติ๊กยอมรับ & กดยืนยัน');

                    setTimeout(async () => {
                        try {
                            await bot.clickWindow(3, 0, 0);
                            setTimeout(async () => {
                                try {
                                    await bot.clickWindow(4, 0, 0);
                                    log(`[✓] [${username}] สมัครสมาชิกสำเร็จ!`);
                                    triggerLobbyCompass(bot, username);
                                } catch (errSubmit) {}
                            }, 1200);
                        } catch (e) {}
                    }, 1500);
                }
                else if (bot.authStage === 'PASSWORD_DONE' && !isRegisterMode) {
                    bot.authStage = 'SUBMITTED';
                    log(`[3] [${username}] กดยืนยันเข้าสู่ระบบ (Slot 2)...`);
                    updateStatus(username, 'Logging in', 'กดยืนยัน (Slot 2)');

                    setTimeout(async () => {
                        try {
                            await bot.clickWindow(2, 0, 0);
                            log(`[✓] [${username}] ล็อกอินสำเร็จ`);
                            triggerLobbyCompass(bot, username);
                        } catch (e) {}
                    }, 1500);
                }
            }
            else if (window.type === 'minecraft:anvil') {
                if (bot.anvilCheckTimer) clearTimeout(bot.anvilCheckTimer);

                if (bot.authStage === 'TYPING_PASSWORD') {
                    setTimeout(() => {
                        try {
                            bot._client.write('name_item', { name: botPassword });
                            setTimeout(async () => {
                                await bot.clickWindow(2, 0, 0);
                                bot.authStage = 'PASSWORD_DONE';
                            }, 1200);
                        } catch (e) {}
                    }, 1500);
                }
                else if (bot.authStage === 'TYPING_EMAIL') {
                    setTimeout(() => {
                        try {
                            bot._client.write('name_item', { name: randomEmail });
                            setTimeout(async () => {
                                await bot.clickWindow(2, 0, 0);
                                bot.authStage = 'EMAIL_DONE';
                            }, 1200);
                        } catch (e) {}
                    }, 1500);
                }
            }
        });

        bot.on('error', (err) => {
            logError(`[❌ Error] [${username}]: ${err.message}`);
            updateStatus(username, 'Error', err.message, null, err.message);
        });

        bot.on('end', (reason) => {
            if (bot.compassTimer) clearTimeout(bot.compassTimer);
            if (bot.anvilCheckTimer) clearTimeout(bot.anvilCheckTimer);
            if (bot.afkInterval) clearInterval(bot.afkInterval);
            delete activeBots[username];
            log(`[!] [${username}] หลุดการเชื่อมต่อ (${reason})`);
            
            if (botStatusMap[username]?.enabled) {
                updateStatus(username, 'Offline', `หลุด (${reason})`, null, botStatusMap[username]?.lastError || reason);
                log(`[i] [${username}] จะต่อใหม่ใน 30 วินาที...`);
                createBotInstance(username, 30000);
            } else {
                updateStatus(username, 'Stopped', 'ระงับการทำงาน');
            }
        });

    }, delayMs);
}

// ==========================================
// Web Server + REST API
// ==========================================
const server = http.createServer((req, res) => {
    const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
    const path = parsedUrl.pathname;

    if (path === '/api/status') {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify(botStatusMap));
        return;
    }

    if (path === '/api/control') {
        const action = parsedUrl.searchParams.get('action');
        const name = parsedUrl.searchParams.get('name');

        if (action === 'start-range') {
            const startVal = parseInt(parsedUrl.searchParams.get('start'), 10);
            const endVal = parseInt(parsedUrl.searchParams.get('end'), 10);
            
            const start = isNaN(startVal) ? 0 : Math.max(0, startVal);
            const end = isNaN(endVal) ? BOT_NAMES.length : Math.min(BOT_NAMES.length, endVal);

            log(`[Batch Command] สั่งเปิดช่วงลำดับที่ ${start + 1} ถึง ${end}`);

            const targetBots = BOT_NAMES.slice(start, end);
            let launchIndex = 0;

            targetBots.forEach((bName) => {
                const currStatus = botStatusMap[bName]?.status || 'Stopped';
                const isRunning = activeBots[bName] && (currStatus.includes('Online') || currStatus === 'Connecting' || currStatus === 'Logging in' || currStatus === 'In Lobby' || currStatus.includes('Registering'));

                if (!isRunning) {
                    botStatusMap[bName].enabled = true;
                    createBotInstance(bName, launchIndex * 12000);
                    launchIndex++;
                }
            });
        }
        else if (action === 'start-all') {
            let launchIndex = 0;
            BOT_NAMES.forEach((bName) => {
                const currStatus = botStatusMap[bName]?.status || 'Stopped';
                const isRunning = activeBots[bName] && (currStatus.includes('Online') || currStatus === 'Connecting' || currStatus === 'Logging in' || currStatus === 'In Lobby' || currStatus.includes('Registering'));

                if (!isRunning) {
                    botStatusMap[bName].enabled = true;
                    createBotInstance(bName, launchIndex * 12000);
                    launchIndex++;
                }
            });
        } 
        else if (action === 'stop-all') {
            BOT_NAMES.forEach(bName => {
                botStatusMap[bName].enabled = false;
                stopBotInstance(bName);
                updateStatus(bName, 'Stopped', 'ระงับการทำงาน');
            });
        } 
        else if (name && botStatusMap[name]) {
            if (action === 'start') {
                botStatusMap[name].enabled = true;
                botStatusMap[name].lastError = '-';
                createBotInstance(name, 0);
            } else if (action === 'stop') {
                botStatusMap[name].enabled = false;
                stopBotInstance(name);
                updateStatus(name, 'Stopped', 'ระงับการทำงาน (User Disabled)');
            }
        }

        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ success: true }));
        return;
    }

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`
<!DOCTYPE html>
<html lang="th">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Minecraft Multi-Bot Panel (80 Bots)</title>
    <style>
        body { font-family: monospace, sans-serif; background: #121212; color: #e0e0e0; margin: 15px; }
        h2 { color: #4caf50; margin: 0 0 10px 0; }
        .toolbar { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 10px; margin-bottom: 15px; }
        .btn-group { display: flex; gap: 6px; flex-wrap: wrap; }
        .custom-range { display: flex; align-items: center; gap: 6px; background: #1e1e1e; padding: 4px 8px; border-radius: 4px; border: 1px solid #333; }
        .custom-range input { width: 50px; background: #2a2a2a; border: 1px solid #444; color: #fff; padding: 4px; border-radius: 3px; text-align: center; }
        button { background: #333; color: #fff; border: 1px solid #555; padding: 6px 10px; cursor: pointer; border-radius: 4px; font-weight: bold; font-size: 12px; }
        button:hover { background: #444; }
        .btn-start { background: #2e7d32; border-color: #4caf50; }
        .btn-batch { background: #1565c0; border-color: #42a5f5; }
        .btn-custom { background: #e65100; border-color: #ff9800; }
        .btn-stop { background: #c62828; border-color: #ef5350; }
        .stats { margin-bottom: 12px; font-size: 14px; }
        table { width: 100%; border-collapse: collapse; background: #1e1e1e; font-size: 13px; }
        th, td { border: 1px solid #333; padding: 6px 10px; text-align: left; }
        th { background: #2a2a2a; color: #aaa; }
        .Online { color: #4caf50; font-weight: bold; }
        .Connecting, .Logging, .Selecting, .In, .Registering, .Submitting { color: #ffeb3b; }
        .Offline, .Kicked, .Error { color: #f44336; }
        .Stopped { color: #757575; }
        .bits-val { color: #12dbf6; font-weight: bold; font-size: 14px; text-shadow: 0 0 5px rgba(18,219,246,0.3); }
        .err-log { color: #ff9800; font-size: 11px; max-width: 200px; word-break: break-all; }
    </style>
</head>
<body>
    <div class="toolbar">
        <h2>🤖 Control Panel (80 Bots - Low Resource)</h2>
        <div class="btn-group">
            <button class="btn-batch" onclick="controlBot('', 'start-range&start=0&end=10')">1-10</button>
            <button class="btn-batch" onclick="controlBot('', 'start-range&start=10&end=20')">11-20</button>
            <button class="btn-batch" onclick="controlBot('', 'start-range&start=20&end=30')">21-30</button>
            <button class="btn-batch" onclick="controlBot('', 'start-range&start=30&end=40')">31-40</button>
            <button class="btn-batch" onclick="controlBot('', 'start-range&start=40&end=50')">41-50</button>
            <button class="btn-batch" onclick="controlBot('', 'start-range&start=50&end=60')">51-60</button>
            <button class="btn-batch" onclick="controlBot('', 'start-range&start=60&end=70')">61-70</button>
            <button class="btn-batch" onclick="controlBot('', 'start-range&start=70&end=80')">71-80</button>
            <div class="custom-range">
                <span>จาก:</span><input type="number" id="rStart" min="1" max="80" value="1">
                <span>ถึง:</span><input type="number" id="rEnd" min="1" max="80" value="20">
                <button class="btn-custom" onclick="launchCustomRange()">▶ เปิดช่วงนี้</button>
            </div>
            <button class="btn-start" onclick="controlBot('', 'start-all')">▶ Start All</button>
            <button class="btn-stop" onclick="controlBot('', 'stop-all')">⏹ Stop All</button>
        </div>
    </div>
    <div class="stats" id="summary">กำลังโหลดข้อมูล...</div>
    <table>
        <thead>
            <tr>
                <th>#</th>
                <th>ชื่อบอท</th>
                <th>สถานะ</th>
                <th>ขั้นตอนล่าสุด</th>
                <th>💎 ยอดบิท</th>
                <th>ข้อผิดพลาด (Error Log)</th>
                <th>อัปเดตเมื่อ</th>
                <th>จัดการ</th>
            </tr>
        </thead>
        <tbody id="bot-table"></tbody>
    </table>

    <script>
        async function controlBot(name, action) {
            await fetch(\`/api/control?name=\${name}&action=\${action}\`);
            fetchStatus();
        }

        function launchCustomRange() {
            const startVal = parseInt(document.getElementById('rStart').value, 10);
            const endVal = parseInt(document.getElementById('rEnd').value, 10);
            if (isNaN(startVal) || isNaN(endVal) || startVal < 1 || endVal < startVal) {
                alert('กรุณาระบุช่วงตัวเลขให้ถูกต้อง');
                return;
            }
            controlBot('', \`start-range&start=\${startVal - 1}&end=\${endVal}\`);
        }

        async function fetchStatus() {
            try {
                const res = await fetch('/api/status');
                const data = await res.json();
                const tbody = document.getElementById('bot-table');
                
                let onlineCount = 0;
                let totalBits = 0;
                let total = 0;
                let html = '';

                Object.keys(data).forEach((name, index) => {
                    total++;
                    const bot = data[name];
                    const isOnline = bot.status.includes('Online');
                    if (isOnline) onlineCount++;

                    const bitVal = Number(bot.bits || 0);
                    totalBits += bitVal;

                    let statusClass = 'Offline';
                    if (isOnline) statusClass = 'Online';
                    else if (bot.status === 'Stopped') statusClass = 'Stopped';
                    else if (bot.status !== 'Offline') statusClass = 'Connecting';

                    const toggleBtn = bot.enabled ? 
                        \`<button class="btn-stop" onclick="controlBot('\${name}', 'stop')">Stop</button>\` : 
                        \`<button class="btn-start" onclick="controlBot('\${name}', 'start')">Start</button>\`;

                    html += \`<tr>
                        <td>\${index + 1}</td>
                        <td><b>\${name}</b></td>
                        <td class="\${statusClass}">\${bot.status}</td>
                        <td>\${bot.step}</td>
                        <td class="bits-val">💎 \${bitVal.toLocaleString()} บิท</td>
                        <td class="err-log">\${bot.lastError}</td>
                        <td>\${bot.lastUpdate}</td>
                        <td>\${toggleBtn}</td>
                    </tr>\`;
                });

                tbody.innerHTML = html;
                document.getElementById('summary').innerHTML = 
                    \`ออนไลน์ทั้งหมด: <b>\${onlineCount}/\${total}</b> ตัว | บิทรวมทั้งหมด: <b style="color:#12dbf6">💎 \${totalBits.toLocaleString()} บิท</b> | อัปเดตอัตโนมัติทุก 3 วินาที\`;
            } catch (e) {}
        }

        fetchStatus();
        setInterval(fetchStatus, 3000);
    </script>
</body>
</html>
    `);
});

function getLocalIP() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return '127.0.0.1';
}

server.listen(WEB_PORT, () => {
    log(`==================================================`);
    log(`🚀 LOW-RESOURCE BOT SERVER RUNNING ON PORT ${WEB_PORT}`);
    log(`🌐 Dashboard URL: http://${getLocalIP()}:${WEB_PORT}`);
    log(`==================================================`);
});