const TelegramBot = require('node-telegram-bot-api');
const { Octokit } = require('octokit');

// --- CONFIG (รับค่าจาก Railway) ---
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = process.env.GITHUB_OWNER;
const GITHUB_REPO = process.env.GITHUB_REPO;

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
const octokit = new Octokit({ auth: GITHUB_TOKEN });

console.log("🤖 Ultimate Bot Ready...");

// --- HELPER FUNCTIONS ---
async function getFileSha(path) {
    try {
        const { data } = await octokit.rest.repos.getContent({
            owner: GITHUB_OWNER, repo: GITHUB_REPO, path: path
        });
        return data.sha;
    } catch (e) { return null; }
}

// --- MAIN LOGIC ---
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    if (!text) return;

    // 1. คำสั่ง /list (ดูรายชื่อไฟล์)
    // ตัวอย่าง: /list หรือ /list src
    if (text.startsWith('/list')) {
        const path = text.split(' ')[1] || ''; // ถ้าไม่ใส่ path ให้ดูหน้าแรก
        bot.sendMessage(chatId, `📂 กำลังดูไฟล์ในโฟลเดอร์: ${path || 'Root'} ...`);
        
        try {
            const { data } = await octokit.rest.repos.getContent({
                owner: GITHUB_OWNER, repo: GITHUB_REPO, path: path
            });

            if (Array.isArray(data)) {
                let msgList = `📦 **Files in ${path || '/'}:**\n`;
                data.forEach(file => {
                    const icon = file.type === 'dir' ? '📁' : '📄';
                    msgList += `${icon} ${file.name}\n`;
                });
                bot.sendMessage(chatId, msgList);
            } else {
                bot.sendMessage(chatId, "📄 นี่คือไฟล์ครับ ไม่ใช่โฟลเดอร์ (ใช้ /read เพื่ออ่าน)");
            }
        } catch (err) {
            bot.sendMessage(chatId, `❌ ไม่พบโฟลเดอร์นี้: ${err.message}`);
        }
        return;
    }

    // 2. คำสั่ง /read (อ่านเนื้อหาไฟล์)
    // ตัวอย่าง: /read package.json
    if (text.startsWith('/read')) {
        const path = text.split(' ')[1];
        if (!path) return bot.sendMessage(chatId, "⚠️ กรุณาระบุชื่อไฟล์ เช่น /read index.js");

        bot.sendMessage(chatId, `📖 กำลังอ่านไฟล์: ${path}...`);
        try {
            const { data } = await octokit.rest.repos.getContent({
                owner: GITHUB_OWNER, repo: GITHUB_REPO, path: path
            });
            
            // GitHub ส่งเนื้อหามาเป็น base64 ต้องแปลงกลับ
            const content = Buffer.from(data.content, 'base64').toString('utf-8');
            
            // Telegram จำกัดข้อความไม่เกิน 4096 ตัวอักษร ถ้าเกินต้องตัด
            if (content.length > 4000) {
                bot.sendMessage(chatId, `📄 **เนื้อหาไฟล์ (ตัดมาบางส่วน):**\n\n\`\`\`\n${content.substring(0, 4000)}\n\`\`\``, {parse_mode: 'Markdown'});
                bot.sendMessage(chatId, "⚠️ ไฟล์ยาวเกินไปครับ แสดงผลไม่ครบ");
            } else {
                bot.sendMessage(chatId, `\`\`\`\n${content}\n\`\`\``, {parse_mode: 'Markdown'});
            }
        } catch (err) {
            bot.sendMessage(chatId, `❌ อ่านไม่ได้ (อาจไม่มีไฟล์นี้): ${err.message}`);
        }
        return;
    }

    // 3. คำสั่ง /delete (ลบไฟล์)
    // ตัวอย่าง: /delete test.txt
    if (text.startsWith('/delete')) {
        const path = text.split(' ')[1];
        if (!path) return bot.sendMessage(chatId, "⚠️ กรุณาระบุไฟล์ที่จะลบ เช่น /delete test.txt");

        try {
            const sha = await getFileSha(path);
            if (!sha) return bot.sendMessage(chatId, "❌ หาไฟล์นี้ไม่เจอ ลบไม่ได้ครับ");

            await octokit.rest.repos.deleteFile({
                owner: GITHUB_OWNER, repo: GITHUB_REPO, path: path,
                message: `Deleted ${path} via Bot`, sha: sha
            });
            bot.sendMessage(chatId, `🗑️ ลบไฟล์ ${path} เรียบร้อย!`);
        } catch (err) {
            bot.sendMessage(chatId, `❌ ลบไม่สำเร็จ: ${err.message}`);
        }
        return;
    }

    // 4. คำสั่ง /move (ย้ายหรือเปลี่ยนชื่อ)
    // ตัวอย่าง: /move old.js new.js
    if (text.startsWith('/move')) {
        const parts = text.split(' ');
        const oldPath = parts[1];
        const newPath = parts[2];

        if (!oldPath || !newPath) return bot.sendMessage(chatId, "⚠️ ใช้คำสั่งผิด\nตัวอย่าง: `/move file_old.js file_new.js`", {parse_mode: 'Markdown'});

        bot.sendMessage(chatId, `🚚 กำลังย้าย ${oldPath} -> ${newPath}...`);

        try {
            // A. อ่านไฟล์เก่า
            const { data } = await octokit.rest.repos.getContent({
                owner: GITHUB_OWNER, repo: GITHUB_REPO, path: oldPath
            });
            const oldSha = data.sha;
            const content = data.content; // base64 content

            // B. สร้างไฟล์ใหม่
            await octokit.rest.repos.createOrUpdateFileContents({
                owner: GITHUB_OWNER, repo: GITHUB_REPO, path: newPath,
                message: `Moved from ${oldPath}`, content: content // ใช้ content เดิม
            });

            // C. ลบไฟล์เก่า
            await octokit.rest.repos.deleteFile({
                owner: GITHUB_OWNER, repo: GITHUB_REPO, path: oldPath,
                message: `Moved to ${newPath}`, sha: oldSha
            });

            bot.sendMessage(chatId, `✅ ย้ายไฟล์สำเร็จ!`);
        } catch (err) {
            bot.sendMessage(chatId, `❌ ย้ายไม่ได้: ${err.message}`);
        }
        return;
    }

    // 5. โหมดรับ JSON (สร้าง/แก้ไขไฟล์)
    try {
        if (!text.trim().startsWith('{')) return; // ถ้าไม่เริ่มด้วย { ก็ไม่ใช่ JSON

        const data = JSON.parse(text);
        const { filename, content, message } = data;

        if (!filename || !content) return;

        bot.sendMessage(chatId, `🚀 รับ JSON แล้ว! กำลังเขียนไฟล์: ${filename}`);

        const sha = await getFileSha(filename);

        await octokit.rest.repos.createOrUpdateFileContents({
            owner: GITHUB_OWNER, repo: GITHUB_REPO, path: filename,
            message: message || `Update via Bot`,
            content: Buffer.from(content).toString('base64'),
            sha: sha || undefined,
        });

        bot.sendMessage(chatId, `✅ บันทึกไฟล์ ${filename} เสร็จสมบูรณ์!`);

    } catch (error) {
        // เงียบไว้ถ้าไม่ใช่ JSON หรือ JSON ผิด format
    }
});
