const TelegramBot = require('node-telegram-bot-api');
const { OpenAI } = require('openai');
const { Octokit } = require('octokit');

// รับค่าจาก Railway
const token = process.env.TELEGRAM_TOKEN;
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

// ข้อมูล Repo เป้าหมาย (งาน Blockchain ของคุณ)
const GITHUB_OWNER = process.env.GITHUB_OWNER; 
const GITHUB_REPO = process.env.GITHUB_REPO;   

const bot = new TelegramBot(token, { polling: true });

console.log("🤖 AI Agent พร้อมทำงาน...");

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    if (!text) return;

    // แจ้งเตือนว่าได้รับคำสั่งแล้ว
    bot.sendMessage(chatId, "🧠 รับทราบครับ กำลังวิเคราะห์และเขียนโค้ด...");

    try {
        // 1. ให้ AI เขียนโค้ดและส่งกลับมาเป็น JSON
        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini", // หรือ gpt-4o
            messages: [
                { 
                    role: "system", 
                    content: `You are an expert Blockchain Developer. 
                    You will receive a request to create or modify code.
                    You must respond with a JSON object ONLY.
                    Format: { "filename": "path/to/file.sol", "content": "FULL_CODE_HERE", "message": "commit message" }
                    If modifying, ensure you include the FULL updated code, not just snippets.` 
                },
                { role: "user", content: text }
            ],
            response_format: { type: "json_object" }
        });

        const aiResponse = JSON.parse(completion.choices[0].message.content);
        const { filename, content, message } = aiResponse;

        bot.sendMessage(chatId, `📝 กำลังอัปเดตไฟล์: ${filename} ...`);

        // 2. เช็กว่าไฟล์เดิมมีอยู่ไหม (ต้องใช้ sha เพื่ออัปเดต)
        let sha;
        try {
            const { data } = await octokit.rest.repos.getContent({
                owner: GITHUB_OWNER,
                repo: GITHUB_REPO,
                path: filename,
            });
            sha = data.sha;
        } catch (err) {
            // ถ้าไม่เจอไฟล์ แปลว่าเป็นไฟล์ใหม่ (sha = undefined)
        }

        // 3. บันทึกลง GitHub (Repo งาน Blockchain)
        await octokit.rest.repos.createOrUpdateFileContents({
            owner: GITHUB_OWNER,
            repo: GITHUB_REPO,
            path: filename,
            message: message || `Update ${filename} by AI Agent`,
            content: Buffer.from(content).toString('base64'),
            sha: sha,
        });

        bot.sendMessage(chatId, `✅ เรียบร้อย! อัปเดตไฟล์บน GitHub แล้ว\nไฟล์: ${filename}`);

    } catch (error) {
        console.error(error);
        bot.sendMessage(chatId, `❌ เกิดข้อผิดพลาด: ${error.message}`);
    }
});
