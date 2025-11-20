const TelegramBot = require('node-telegram-bot-api');
const { Octokit } = require('octokit');

// รับค่าจาก Railway
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = process.env.GITHUB_OWNER;
const GITHUB_REPO = process.env.GITHUB_REPO;

// เริ่มระบบ
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
const octokit = new Octokit({ auth: GITHUB_TOKEN });

console.log("🤖 Bridge Bot Ready (Waiting for JSON)...");

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    if (!text) return;

    try {
        // 1. พยายามแปลงข้อความที่ส่งมาเป็น JSON
        // บอทจะไมคิดเองแล้ว จะรอรับ JSON อย่างเดียว
        const data = JSON.parse(text);
        const { filename, content, message } = data;

        if (!filename || !content) {
            throw new Error("JSON ไม่ถูกต้อง ต้องมี 'filename' และ 'content'");
        }

        bot.sendMessage(chatId, `🚀 รับทราบ! กำลังนำโค้ดไปวางที่: ${filename}`);

        // 2. เช็กไฟล์เดิมใน GitHub (หา SHA)
        let sha;
        try {
            const { data: fileData } = await octokit.rest.repos.getContent({
                owner: GITHUB_OWNER,
                repo: GITHUB_REPO,
                path: filename,
            });
            sha = fileData.sha;
        } catch (e) {
            // ถ้าหาไม่เจอ แสดงว่าเป็นไฟล์ใหม่
            sha = undefined;
        }

        // 3. อัปโหลดลง GitHub
        await octokit.rest.repos.createOrUpdateFileContents({
            owner: GITHUB_OWNER,
            repo: GITHUB_REPO,
            path: filename,
            message: message || `Update ${filename} via Telegram Bot`,
            content: Buffer.from(content).toString('base64'),
            sha: sha,
        });

        bot.sendMessage(chatId, `✅ เรียบร้อย! บันทึกไฟล์ ${filename} แล้ว`);

    } catch (error) {
        // ถ้าส่งมาไม่ใช่ JSON หรือมี Error
        console.error(error);
        bot.sendMessage(chatId, `❌ Error: ส่งรูปแบบผิด หรือ JSON ไม่สมบูรณ์\n\nสาเหตุ: ${error.message}`);
    }
});
