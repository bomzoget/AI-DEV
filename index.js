/* ====================================================
   Kryp Ultimate AI Dev Bot v12 (Smart Lookup Enabled)
   Features: List, Read, Write, Delete, Move, Upload, Backup, CheckAll
==================================================== */

const TelegramBot = require('node-telegram-bot-api');
const { Octokit } = require('octokit');
const AdmZip = require('adm-zip');
const fs = require('fs');
const path = require('path');
const https = require('https');

// --- ENV from Railway ---
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = process.env.GITHUB_OWNER;
const GITHUB_REPO = process.env.GITHUB_REPO;

// Critical Paths to Check for Smart Lookup
const SEARCH_PATHS = [
    "contracts/core", 
    "contracts/interfaces", 
    "scripts",
    "cdk-validium-node/engine",
    "cdk-validium-node/cmd"
];

// Check ENV
if (!TELEGRAM_TOKEN || !GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO) {
    console.error("❌ Error: Missing ENV Variables in Railway!");
    process.exit(1);
}

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
const octokit = new Octokit({ auth: GITHUB_TOKEN });

console.log("🤖 Kryp Bot v12 Started with Smart Lookup...");

// ===============================
// Helper: Core File Lookup (New Logic)
// ===============================

async function findFileInRepo(targetName, isDir = false) {
    // 1. Check Root (Exact Path)
    try {
        const { data } = await octokit.rest.repos.getContent({ owner: GITHUB_OWNER, repo: GITHUB_REPO, path: targetName });
        const typeMatch = isDir ? data.type === 'dir' : data.type !== 'dir';
        if (typeMatch) return [targetName];
    } catch (e) { /* continue search */ }
    
    // 2. Check Common Development Paths
    const matches = [];
    for (const searchPath of SEARCH_PATHS) {
        try {
            const { data } = await octokit.rest.repos.getContent({ 
                owner: GITHUB_OWNER, 
                repo: GITHUB_REPO, 
                path: searchPath 
            });
            
            const item = data.find(i => i.name.toLowerCase() === targetName.toLowerCase());
            
            if (item) {
                const fullPath = `${searchPath}/${item.name}`;
                // Validate if the type matches the request (file or directory)
                const typeMatch = isDir ? item.type === 'dir' : item.type !== 'dir';
                if (typeMatch) matches.push(fullPath);
            }
        } catch (e) { 
            // Folder not found or API issue, safely continue
        }
    }
    return matches;
}


// ===============================
// Helper: Download File
// ===============================
const downloadFile = (url, dest) => {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest);
        https.get(url, (response) => {
            response.pipe(file);
            file.on('finish', () => file.close(resolve));
        }).on('error', (err) => {
            fs.unlink(dest, () => reject(err));
        });
    });
};

// ===============================
// State Management for L1 Import
// ===============================
let waitZip = false; 

// ===============================
// /help
// ===============================
bot.onText(/^\/(help|ช่วยเหลือ)$/i, (msg) => {
    const helpMsg = `
🤖 **Kryp Dev Bot (v12) Commands**

📂 **File Management**
/list [name] หรือ /รายการ [name] - ดูรายชื่อไฟล์/โฟลเดอร์ (รองรับ Smart Lookup)
/read <name> หรือ /อ่าน <name> - อ่านเนื้อหาไฟล์ (รองรับ Smart Lookup)
/delete <file> หรือ /ลบ <file> - ลบไฟล์
/move <old> <new> หรือ /ย้าย <old> <new> - ย้าย/เปลี่ยนชื่อ
/mkdir <folder> หรือ /สร้างโฟลเดอร์ <folder> - สร้างโฟลเดอร์

🛠 **System**
/checkall หรือ /ตรวจสอบทั้งหมด
/backup หรือ /สำรองข้อมูล

📤 **Upload**
/upload หรือ /อัปโหลด (แนบไฟล์)

🔥 **L1 Auto System**
/override_repo หรือ /ล้างrepo → ล้าง repo ทั้งอัน
/import_l1 หรือ /นำเข้าL1 → ส่ง ZIP แล้ว import L1-only อัตโนมัติ

🤖 **AI JSON Writer**
ส่ง JSON: {"filename":"..","content":".."}
`;
    bot.sendMessage(msg.chat.id, helpMsg, { parse_mode: 'Markdown' });
});

// ===============================
// /list (รองรับภาษาไทย + Smart Lookup)
// ===============================
bot.onText(/^\/(list|ดูไฟล์|รายการ)(?:\s+(.+))?$/i, async (msg, match) => {
    // Check if a specific path/name was provided
    const inputName = (match && match[2]) ? match[2].trim() : "";
    
    // If no input, list root directly
    if (!inputName) {
        return handleList(msg, "");
    }
    
    // Attempt Smart Lookup
    const matches = await findFileInRepo(inputName, true); // Search for directory

    if (matches.length === 1) {
        // Unique match found, list contents of that directory
        return handleList(msg, matches[0]);
    } else if (matches.length > 1) {
        // Ambiguous match, ask user to clarify
        const pathList = matches.join('\n');
        return bot.sendMessage(msg.chat.id, `⚠️ พบโฟลเดอร์ที่ชื่อ "${inputName}" มากกว่าหนึ่งแห่ง:\n${pathList}\n\nโปรดระบุ Path เต็ม.`);
    } else {
        // No match found, list root contents for context (or just error)
        return bot.sendMessage(msg.chat.id, `❌ ไม่พบโฟลเดอร์ "${inputName}" ใน Path หลัก. (ลองใช้ /list [path/folder])`);
    }
});

async function handleList(msg, p) {
    try {
        const { data } = await octokit.rest.repos.getContent({ owner: GITHUB_OWNER, repo: GITHUB_REPO, path: p });

        if (!Array.isArray(data)) return bot.sendMessage(msg.chat.id, `📄 นี่คือไฟล์ (ใช้ /read เพื่ออ่าน)`);

        let out = `📦 Index of /${p}\n\n`;
        data.forEach(i => out += `${i.type === 'dir' ? '📁' : '📄'} ${i.name}\n`);

        bot.sendMessage(msg.chat.id, out);

    } catch (e) {
        bot.sendMessage(msg.chat.id, `❌ Error: ${e.message}`);
    }
}


// ===============================
// /read (รองรับภาษาไทย + Smart Lookup)
// ===============================
bot.onText(/^\/(read|อ่าน)\s+(.+)$/i, async (msg, match) => {
    const inputName = (match && match[2]) ? match[2].trim() : "";
    if (!inputName) return bot.sendMessage(msg.chat.id, "❌ โปรดระบุชื่อไฟล์ที่ต้องการอ่าน");

    bot.sendMessage(msg.chat.id, `📖 กำลังค้นหา: ${inputName}...`);
    
    // Attempt Smart Lookup (searching for a file, not a directory)
    const matches = await findFileInRepo(inputName, false); 
    
    if (matches.length === 0) {
        return bot.sendMessage(msg.chat.id, `❌ ไม่พบไฟล์ชื่อ "${inputName}" ใน Path หลัก หรือโฟลเดอร์พัฒนาหลัก`);
    }
    
    let targetPath = matches[0];
    
    if (matches.length > 1) {
        const pathList = matches.join('\n');
        return bot.sendMessage(msg.chat.id, `⚠️ พบไฟล์ "${inputName}" มากกว่าหนึ่งแห่ง:\n${pathList}\n\nโปรดระบุ Path เต็ม.`);
    }
    
    // Proceed with reading the unique target path
    const p = targetPath;
    const tmpPath = path.join('/tmp', path.basename(p));

    try {
        const { data } = await octokit.rest.repos.getContent({ owner: GITHUB_OWNER, repo: GITHUB_REPO, path: p });

        if (!data.content) throw new Error("ไฟล์ใหญ่เกินไป หรือเป็นไฟล์ Binary");

        const text = Buffer.from(data.content, 'base64').toString('utf8');

        if (text.length > 3000) {
            fs.writeFileSync(tmpPath, text);
            await bot.sendDocument(msg.chat.id, tmpPath, {
                caption: `✅ แสดงผลไฟล์ไม่ครบในแชท: ${p} (ส่งเป็นเอกสารฉบับเต็ม)`
            });
        } else {
            bot.sendMessage(msg.chat.id, `\`\`\`\n${text}\n\`\`\``, { parse_mode: 'Markdown' });
        }
    } catch (e) {
        bot.sendMessage(msg.chat.id, `❌ Error: ${e.message}`);
    } finally {
        if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    }
});


// ===============================
// /checkall (รองรับภาษาไทย)
// ===============================
bot.onText(/^\/(checkall|ตรวจสอบทั้งหมด)$/i, async (msg) => {
    async function scan(dir) {
        let count = 0;
        const { data } = await octokit.rest.repos.getContent({ owner: GITHUB_OWNER, repo: GITHUB_REPO, path: dir });
        for (const i of data) {
            if (i.type === "dir") count += await scan(i.path);
            else count++;
        }
        return count;
    }

    try {
        const n = await scan("");
        bot.sendMessage(msg.chat.id, `📁 Files in repo: ${n}\n✔ พร้อมใช้งาน`);
    } catch (e) {
        bot.sendMessage(msg.chat.id, `❌ Error: ${e.message}`);
    }
});

// ===============================
// /delete (รองรับภาษาไทย)
// ===============================
bot.onText(/^\/(delete|ลบ)\s+(.+)$/i, async (msg, match) => {
    // Note: match[2] contains the path/name
    const inputName = match[2].trim();
    
    // Attempt Smart Lookup
    const matches = await findFileInRepo(inputName, false); // Try finding a file

    let p;
    if (matches.length === 1) {
        p = matches[0];
    } else {
        // If 0 or >1 match, assume user gave the full path as a fallback
        p = inputName;
    }

    try {
        const { data } = await octokit.rest.repos.getContent({ owner: GITHUB_OWNER, repo: GITHUB_REPO, path: p });

        await octokit.rest.repos.deleteFile({
            owner: GITHUB_OWNER,
            repo: GITHUB_REPO,
            path: p,
            sha: data.sha,
            message: `Deleted ${p} via bot`
        });

        bot.sendMessage(msg.chat.id, `🗑 ลบแล้ว: ${p}`);

    } catch (e) {
        bot.sendMessage(msg.chat.id, `❌ Error: ${e.message}`);
    }
});

// ===============================
// /backup (ZIP ทั้ง repo) (รองรับภาษาไทย)
// ===============================
bot.onText(/^\/(backup|สำรองข้อมูล)$/i, async (msg) => {
    bot.sendMessage(msg.chat.id, "💾 กำลังสร้างไฟล์ Backup...");
    const tmpDir = `/tmp/backup_${Date.now()}`;
    const zipPath = `/tmp/backup_${Date.now()}.zip`;

    fs.mkdirSync(tmpDir);

    async function downloadAll(dir) {
        const { data } = await octokit.rest.repos.getContent({ owner: GITHUB_OWNER, repo: GITHUB_REPO, path: dir });
        for (const i of data) {
            const p = path.join(tmpDir, i.path);
            if (i.type === "dir") {
                fs.mkdirSync(p, { recursive: true });
                await downloadAll(i.path);
            } else {
                const file = await octokit.rest.repos.getContent({
                    owner: GITHUB_OWNER, repo: GITHUB_REPO, path: i.path
                });
                if (file.data.content) {
                    fs.writeFileSync(p, Buffer.from(file.data.content, 'base64'));
                }
            }
        }
    }

    try {
        await downloadAll("");
        const zip = new AdmZip();
        zip.addLocalFolder(tmpDir);
        zip.writeZip(zipPath);
        await bot.sendDocument(msg.chat.id, zipPath);
    } catch (e) {
        bot.sendMessage(msg.chat.id, `❌ Error: ${e.message}`);
    } finally {
        if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true });
        if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
    }
});

// ===============================
// L1 Auto Import Helpers
// ===============================

// Recursive delete helper (called by /override_repo and /import_l1)
async function deleteRecursive(p = "") {
    try {
        const { data } = await octokit.rest.repos.getContent({ owner: GITHUB_OWNER, repo: GITHUB_REPO, path: p });

        for (const i of data) {
            if (i.type === "dir") {
                await deleteRecursive(i.path);
            } else {
                await octokit.rest.repos.deleteFile({
                    owner: GITHUB_OWNER, repo: GITHUB_REPO, path: i.path, sha: i.sha, message: `override delete ${i.path}`
                });
            }
        }
    } catch (err) {}
}

// Recursive upload helper (called by /import_l1)
async function uploadRecursive(localDir, repoPath = "") {
    const files = fs.readdirSync(localDir);

    for (const f of files) {
        const local = path.join(localDir, f);
        const remote = repoPath ? `${repoPath}/${f}` : f;

        if (fs.lstatSync(local).isDirectory()) {
            await uploadRecursive(local, remote);
        } else {
            const content = fs.readFileSync(local);
            let sha;

            try {
                const { data } = await octokit.rest.repos.getContent({ owner: GITHUB_OWNER, repo: GITHUB_REPO, path: remote });
                sha = data.sha;
            } catch (e) {}

            await octokit.rest.repos.createOrUpdateFileContents({
                owner: GITHUB_OWNER, repo: GITHUB_REPO, path: remote, message: `import L1: ${remote}`,
                content: content.toString('base64'), sha
            });
        }
    }
}

// ===============================
// EXTENDED MODULES
// ===============================

// ========== /override_repo (รองรับภาษาไทย) ==========
bot.onText(/^\/(override_repo|ล้างrepo)$/i, async (msg) => {
    bot.sendMessage(msg.chat.id, "⚠️ ล้าง repo ทั้งหมด...");
    try {
        await deleteRecursive("");
        bot.sendMessage(msg.chat.id, "🧹 ล้าง repo เสร็จแล้ว!");
    } catch (e) {
        bot.sendMessage(msg.chat.id, `❌ Error: ${e.message}`);
    }
});

// ========== /import_l1 (START ZIP PROCESS) (รองรับภาษาไทย) ==========
bot.onText(/^\/(import_l1|นำเข้าL1)$/i, async (msg) => {
    waitZip = true;
    bot.sendMessage(msg.chat.id, "📦 ส่ง ZIP L1-only มาเลย เดี๋ยวบอทจัดให้ครบชุด");
});


// ========== Handle DOCUMENT Upload (Combined Logic) ==========
bot.on("document", async (msg) => {
    const doc = msg.document;

    // --- LOGIC 1: L1 Auto Import (ZIP) ---
    if (waitZip) {
        if (!doc.file_name.endsWith(".zip")) {
            bot.sendMessage(msg.chat.id, "❌ ต้องเป็น ZIP เท่านั้น");
            return;
        }

        const tmpZip = `/tmp/${doc.file_name}`;
        const extractDir = `/tmp/extract_${Date.now()}`;
        
        try {
            bot.sendMessage(msg.chat.id, "⏳ โหลดไฟล์...");
            const link = await bot.getFileLink(doc.file_id);
            await downloadFile(link, tmpZip);

            bot.sendMessage(msg.chat.id, "📤 แตก ZIP...");
            fs.mkdirSync(extractDir);
            const zip = new AdmZip(tmpZip);
            zip.extractAllTo(extractDir, true);

            bot.sendMessage(msg.chat.id, "🧹 ล้าง repo เดิม...");
            await deleteRecursive("");

            bot.sendMessage(msg.chat.id, "🚀 อัปโหลดไฟล์ L1 ทั้งหมด...");
            await uploadRecursive(extractDir);

            bot.sendMessage(msg.chat.id, "🎉 เสร็จแล้ว! Repo ถูกอัปเดตตาม L1-only ใหม่");

        } catch (e) {
            bot.sendMessage(msg.chat.id, `❌ Import error: ${e.message}`);
        } finally {
            waitZip = false;
            if (fs.existsSync(tmpZip)) fs.unlinkSync(tmpZip);
            if (fs.existsSync(extractDir)) fs.rmSync(extractDir, { recursive: true, force: true });
        }
        return; // Exit after handling L1 Import
    }
    
    // --- LOGIC 2: Standard Upload (Default) ---
    
    // Fallback: If not waiting for ZIP, treat as standard upload to 'uploads/' folder
    
    const tmp = `/tmp/${doc.file_name}`;
    try {
        const fileLink = await bot.getFileLink(doc.file_id);
        await downloadFile(fileLink, tmp);

        const content = fs.readFileSync(tmp).toString('base64');

        await octokit.rest.repos.createOrUpdateFileContents({
            owner: GITHUB_OWNER,
            repo: GITHUB_REPO,
            path: `uploads/${doc.file_name}`,
            message: `Upload ${doc.file_name}`,
            content: content
        });

        bot.sendMessage(msg.chat.id, `📤 Uploaded: uploads/${doc.file_name}`);

    } catch (e) {
        bot.sendMessage(msg.chat.id, `❌ Upload error: ${e.message}`);
    } finally {
        if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    }
});


// ===============================
// AI JSON Writer
// ===============================
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
