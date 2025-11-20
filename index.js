/* ====================================================
   Kryp Ultimate AI Dev Bot v11 (Full Option)
   Features: List, Read, Write, Delete, Move, Upload, Backup, CheckAll
==================================================== */

const TelegramBot = require('node-telegram-bot-api');
const { Octokit } = require('octokit');
const AdmZip = require('adm-zip');
const fs = require('fs');
const path = require('path');
const https = require('https');

// --- รับค่าจาก Railway ---
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = process.env.GITHUB_OWNER;
const GITHUB_REPO = process.env.GITHUB_REPO;

// เช็กค่าความถูกต้อง
if (!TELEGRAM_TOKEN || !GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO) {
    console.error("❌ Error: Missing ENV Variables in Railway!");
    process.exit(1);
}

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
const octokit = new Octokit({ auth: GITHUB_TOKEN });

console.log("🤖 Kryp Bot v11 Started...");

// --- ฟังก์ชันช่วยดาวน์โหลดไฟล์ (แก้ปัญหา fetch) ---
const downloadFile = (url, dest) => {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest);
        https.get(url, (response) => {
            response.pipe(file);
            file.on('finish', () => {
                file.close(resolve);
            });
        }).on('error', (err) => {
            fs.unlink(dest, () => reject(err));
        });
    });
};

// --- 1. คำสั่ง /help (ช่วยเหลือ) ---
bot.onText(/^\/help$/i, (msg) => {
    const helpMsg = `
🤖 **คำสั่งบอท (Full Option):**

📂 **จัดการไฟล์:**
/list [path] - ดูรายชื่อไฟล์
/read <file> - อ่านเนื้อหาไฟล์
/delete <file> - ลบไฟล์
/move <old> <new> - ย้าย/เปลี่ยนชื่อ
/mkdir <folder> - สร้างโฟลเดอร์

🛠 **เครื่องมือ:**
/checkall - ตรวจสอบโครงสร้าง Repo
/upload - (แนบไฟล์มาพร้อมคำสั่งนี้) อัปขึ้น Repo
/backup - ดาวน์โหลดโค้ดทั้งโปรเจกต์ (Zip)
/raw <file> - ดาวน์โหลดไฟล์เดี่ยวๆ

🤖 **AI Mode:**
ส่ง JSON เพื่อเขียนโค้ด:
\`{"filename": "...", "content": "..."}\`
`;
    bot.sendMessage(msg.chat.id, helpMsg, { parse_mode: 'Markdown' });
});

// --- 2. คำสั่ง /list (ดูไฟล์) ---
bot.onText(/^\/list(?:\s+(.+))?$/i, async (msg, match) => {
    const p = (match && match[1]) ? match[1].trim() : "";
    try {
        const { data } = await octokit.rest.repos.getContent({ owner: GITHUB_OWNER, repo: GITHUB_REPO, path: p });
        if (!Array.isArray(data)) return bot.sendMessage(msg.chat.id, `📄 นี่คือไฟล์ครับ (ใช้ /read เพื่ออ่าน)`);
        
        let out = `📦 **Index of /${p}**\n\n`;
        data.forEach(i => {
            out += `${i.type === 'dir' ? '📁' : '📄'} ${i.name}\n`;
        });
        bot.sendMessage(msg.chat.id, out);
    } catch (e) {
        bot.sendMessage(msg.chat.id, `❌ ไม่พบโฟลเดอร์: ${e.message}`);
    }
});

// --- 3. คำสั่ง /read (อ่านไฟล์) ---
bot.onText(/^\/read\s+(.+)$/i, async (msg, match) => {
    const p = match[1].trim();
    bot.sendMessage(msg.chat.id, `📖 กำลังอ่าน: ${p}...`);
    try {
        const { data } = await octokit.rest.repos.getContent({ owner: GITHUB_OWNER, repo: GITHUB_REPO, path: p });
        if (!data.content) throw new Error("ไฟล์ใหญ่เกินไป หรือเป็นไฟล์ Binary");
        
        const text = Buffer.from(data.content, 'base64').toString('utf8');
        if (text.length > 3000) {
            // ถ้าไฟล์ยาว ตัดส่งบางส่วน
            bot.sendMessage(msg.chat.id, `\`\`\`\n${text.slice(0, 3000)}\n\`\`\`\n⚠️ (แสดงผลไม่ครบเพราะยาวเกินไป)`, { parse_mode: 'Markdown' });
        } else {
            bot.sendMessage(msg.chat.id, `\`\`\`\n${text}\n\`\`\``, { parse_mode: 'Markdown' });
        }
    } catch (e) {
        bot.sendMessage(msg.chat.id, `❌ อ่านไม่ได้: ${e.message}`);
    }
});

// --- 4. คำสั่ง /checkall (ตรวจสอบ Repo) ---
bot.onText(/^\/checkall$/i, async (msg) => {
    bot.sendMessage(msg.chat.id, "🔍 กำลังสแกนไฟล์ทั้งหมด (Recursive)...");
    
    async function scan(dir) {
        let count = 0;
        const { data } = await octokit.rest.repos.getContent({ owner: GITHUB_OWNER, repo: GITHUB_REPO, path: dir });
        for (const item of data) {
            if (item.type === 'dir') {
                count += await scan(item.path);
            } else {
                count++;
            }
        }
        return count;
    }

    try {
        const totalFiles = await scan("");
        bot.sendMessage(msg.chat.id, `✅ **สถานะปกติ**\n\n📁 เชื่อมต่อกับ: ${GITHUB_REPO}\n📄 จำนวนไฟล์ทั้งหมด: ${totalFiles} ไฟล์\n🤖 ระบบพร้อมทำงานเต็มรูปแบบ!`, {parse_mode: 'Markdown'});
    } catch (e) {
        bot.sendMessage(msg.chat.id, `❌ เกิดข้อผิดพลาดในการสแกน: ${e.message}`);
    }
});

// --- 5. คำสั่ง /delete (ลบไฟล์) ---
bot.onText(/^\/delete\s+(.+)$/i, async (msg, match) => {
    const p = match[1].trim();
    try {
        const { data } = await octokit.rest.repos.getContent({ owner: GITHUB_OWNER, repo: GITHUB_REPO, path: p });
        await octokit.rest.repos.deleteFile({
            owner: GITHUB_OWNER, repo: GITHUB_REPO, path: p,
            sha: data.sha, message: `Deleted ${p} via Bot`
        });
        bot.sendMessage(msg.chat.id, `🗑️ ลบเรียบร้อย: ${p}`);
    } catch (e) {
        bot.sendMessage(msg.chat.id, `❌ ลบไม่ได้: ${e.message}`);
    }
});

// --- 6. คำสั่ง /backup (Zip ทั้งโปรเจกต์) ---
bot.onText(/^\/backup$/i, async (msg) => {
    bot.sendMessage(msg.chat.id, "💾 กำลังสร้างไฟล์ Backup (อาจใช้เวลาสักครู่)...");
    const tmpDir = `/tmp/backup_${Date.now()}`;
    const zipPath = `/tmp/backup_${Date.now()}.zip`;

    try {
        fs.mkdirSync(tmpDir);
        
        // ฟังก์ชันโหลดไฟล์ทั้งหมดมาลงเครื่องชั่วคราว
        async function downloadRecursive(dir) {
            const { data } = await octokit.rest.repos.getContent({ owner: GITHUB_OWNER, repo: GITHUB_REPO, path: dir });
            for (const item of data) {
                if (item.type === 'dir') {
                    fs.mkdirSync(path.join(tmpDir, item.path), { recursive: true });
                    await downloadRecursive(item.path);
                } else {
                    try {
                        const f = await octokit.rest.repos.getContent({ owner: GITHUB_OWNER, repo: GITHUB_REPO, path: item.path });
                        if (f.data.content) {
                            fs.writeFileSync(path.join(tmpDir, item.path), Buffer.from(f.data.content, 'base64'));
                        }
                    } catch (err) {} // ข้ามไฟล์ที่มีปัญหา
                }
            }
        }

        await downloadRecursive("");

        // สร้าง Zip
        const zip = new AdmZip();
        zip.addLocalFolder(tmpDir);
        zip.writeZip(zipPath);

        await bot.sendDocument(msg.chat.id, zipPath);
        
    } catch (e) {
        bot.sendMessage(msg.chat.id, `❌ Backup Failed: ${e.message}`);
    } finally {
        // ล้างขยะ
        if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
        if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
    }
});

// --- 7. อัปโหลดไฟล์ (เมื่อแนบไฟล์มา) ---
bot.on('document', async (msg) => {
    const doc = msg.document;
    const fileName = doc.file_name;
    bot.sendMessage(msg.chat.id, `⏳ กำลังอัปโหลด ${fileName}...`);

    const tmpPath = `/tmp/${fileName}`;
    try {
        const fileLink = await bot.getFileLink(doc.file_id);
        await downloadFile(fileLink, tmpPath);
        
        const content = fs.readFileSync(tmpPath, { encoding: 'base64' });
        
        // หา SHA เดิม (ถ้ามี)
        let sha;
        try {
            const { data } = await octokit.rest.repos.getContent({ owner: GITHUB_OWNER, repo: GITHUB_REPO, path: `uploads/${fileName}` });
            sha = data.sha;
        } catch (e) {}

        await octokit.rest.repos.createOrUpdateFileContents({
            owner: GITHUB_OWNER, repo: GITHUB_REPO, path: `uploads/${fileName}`,
            message: `Upload ${fileName}`, content: content, sha: sha
        });
        
        bot.sendMessage(msg.chat.id, `✅ อัปโหลดเสร็จสิ้น! อยู่ที่: uploads/${fileName}`);
    } catch (e) {
        bot.sendMessage(msg.chat.id, `❌ Error: ${e.message}`);
    } finally {
        if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    }
});

// --- 8. โหมด JSON (รับโค้ดจาก AI) ---
bot.on('message', async (msg) => {
    if (!msg.text || msg.text.startsWith('/')) return;
    if (!msg.text.trim().startsWith('{')) return;

    try {
        const data = JSON.parse(msg.text);
        const { filename, content, message } = data;
        if (!filename || !content) return;

        bot.sendMessage(msg.chat.id, `🚀 กำลังเขียนไฟล์: ${filename}`);
        
        let sha;
        try {
            const { data } = await octokit.rest.repos.getContent({ owner: GITHUB_OWNER, repo: GITHUB_REPO, path: filename });
            sha = data.sha;
        } catch (e) {}

        await octokit.rest.repos.createOrUpdateFileContents({
            owner: GITHUB_OWNER, repo: GITHUB_REPO, path: filename,
            message: message || "Update via Bot",
            content: Buffer.from(content).toString('base64'),
            sha: sha
        });
        bot.sendMessage(msg.chat.id, `✅ บันทึก ${filename} เรียบร้อย!`);

    } catch (e) {
        // เงียบไว้ถ้าไม่ใช่ JSON
    }
});
