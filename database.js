const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// 数据库文件路径
const dbPath = path.resolve(__dirname, 'data', 'community.db');
// 确保存放 db 的目录存在（在 Docker 中会自动处理，本地需手动创建 data 文件夹或修改路径）
// 为简单起见，我们直接放在根目录或由 server.js 处理。这里我们直接生成在根目录。
const db = new sqlite3.Database('./community.db');

db.serialize(() => {
    console.log('正在初始化数据库...');

    // 1. 用户表
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE,
        password TEXT,
        avatar TEXT,
        role TEXT DEFAULT 'villager',
        created_at INTEGER
    )`);

    // 2. 帖子/动态表
    db.run(`CREATE TABLE IF NOT EXISTS posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        user_name TEXT,
        user_avatar TEXT,
        title TEXT,
        description TEXT,
        department TEXT,
        images TEXT, 
        views INTEGER DEFAULT 0,
        likes INTEGER DEFAULT 0,
        comments_count INTEGER DEFAULT 0,
        created_at INTEGER,
        FOREIGN KEY(user_id) REFERENCES users(id)
    )`);

    // 3. 预设管理员账号 (admin / admin123)
    const adminUser = 'admin';
    const adminPass = 'admin123';
    
    db.get("SELECT * FROM users WHERE username = ?", [adminUser], (err, row) => {
        if (!row) {
            db.run(`INSERT INTO users (username, password, avatar, role, created_at) VALUES (?, ?, ?, ?, ?)`, 
                [adminUser, adminPass, 'https://api.dicebear.com/7.x/avataaars/svg?seed=Admin', 'admin', Date.now()],
                (err) => {
                    if (err) console.error(err.message);
                    else console.log('管理员账号已创建: admin / admin123');
                }
            );
        } else {
            console.log('管理员账号已存在');
        }
    });
});

db.close(() => {
    console.log('数据库初始化完成。');
});
