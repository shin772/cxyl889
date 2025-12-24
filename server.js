const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const cors = require('cors');
const bcrypt = require('bcryptjs'); // 用于密码加密
const jwt = require('jsonwebtoken'); // 用于生成Token
const multer = require('multer');   // 用于上传图片
const fs = require('fs');

const app = express();
const PORT = 3000;
const SECRET_KEY = 'tea_creek_secret_key_2025'; // 生产环境请放入环境变量

// === 1. 基础配置 ===
app.use(cors());
app.use(express.json({ limit: '50mb' })); // 允许大的JSON包
app.use(express.urlencoded({ extended: true }));
// 托管静态前端文件
app.use(express.static(path.join(__dirname, 'public')));
// 托管上传的图片
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// 确保上传目录存在
if (!fs.existsSync('./uploads')) {
    fs.mkdirSync('./uploads');
}

// === 2. 图片上传配置 (Multer) ===
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'uploads/'),
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

// === 3. 数据库初始化 ===
const db = new sqlite3.Database('./community.db');

db.serialize(() => {
    // 用户表
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE,
        password TEXT,
        avatar TEXT,
        phone TEXT,
        role TEXT DEFAULT 'user', -- user:村民, admin:管理员
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // 帖子表
    db.run(`CREATE TABLE IF NOT EXISTS posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        user_name TEXT,
        user_avatar TEXT,
        title TEXT,
        description TEXT,
        department TEXT, -- 板块/标签
        images TEXT,     -- 存JSON字符串
        views INTEGER DEFAULT 0,
        likes INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // 评论表
    db.run(`CREATE TABLE IF NOT EXISTS comments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        post_id INTEGER,
        user_id INTEGER,
        user_name TEXT,
        user_avatar TEXT,
        content TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // 初始化管理员账号 (如果不存在)
    const adminPass = bcrypt.hashSync('admin123', 10);
    db.run(`INSERT OR IGNORE INTO users (username, password, role, avatar, phone) 
            VALUES ('村委管理员', '${adminPass}', 'admin', 'https://api.dicebear.com/7.x/avataaars/svg?seed=Admin', '13800138000')`);
});

// === 4. 中间件：验证 Token ===
const authenticateToken = (req, res, next) => {
    // 简单处理：实际项目中前端要在 Header 传 Authorization: Bearer <token>
    // 这里为了配合你的前端代码，我们兼容直接传 user_id 的模拟方式，
    // 但为了安全性，建议后续前端改用 Token。
    // 目前阶段直接放行，依靠 user_id 参数，下一阶段升级。
    next();
};

// === 5. API 接口 ===

// [POST] 注册/登录 (二合一)
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    
    db.get("SELECT * FROM users WHERE username = ?", [username], (err, user) => {
        if (err) return res.status(500).json({ msg: "数据库错误" });

        if (user) {
            // 用户存在，校验密码 (如果是管理员或绑定了密码的用户)
            if (user.password && password) {
                const valid = bcrypt.compareSync(password, user.password);
                if (!valid) return res.json({ success: false, message: "密码错误" });
            }
            // 登录成功
            const token = jwt.sign({ id: user.id, role: user.role }, SECRET_KEY);
            res.json({ success: true, user, token });
        } else {
            // 用户不存在，自动注册 (普通村民)
            // 如果尝试注册管理员账号名称，拦截
            if(username === '村委管理员') return res.json({ success: false, message: "该账号受保护" });

            const defaultAvatar = `https://api.dicebear.com/7.x/avataaars/svg?seed=${Date.now()}`;
            // 普通用户默认无密码，或者你可以保存 password
            const hash = password ? bcrypt.hashSync(password, 10) : null;
            
            db.run("INSERT INTO users (username, password, role, avatar) VALUES (?, ?, 'user', ?)", 
                [username, hash, defaultAvatar], 
                function(err) {
                    if (err) return res.json({ success: false, message: "注册失败" });
                    const newUser = { id: this.lastID, username, role: 'user', avatar: defaultAvatar };
                    const token = jwt.sign({ id: newUser.id, role: 'user' }, SECRET_KEY);
                    res.json({ success: true, user: newUser, token });
                }
            );
        }
    });
});

// [POST] 绑定手机号
app.post('/api/user/bind-phone', (req, res) => {
    const { user_id, phone } = req.body;
    if (!/^1\d{10}$/.test(phone)) return res.json({ success: false, message: "手机号格式错误" });

    db.run("UPDATE users SET phone = ? WHERE id = ?", [phone, user_id], function(err) {
        if (err) return res.json({ success: false, message: "绑定失败或号码已被使用" });
        res.json({ success: true });
    });
});

// [POST] 图片上传 (返回 URL)
app.post('/api/upload', upload.single('file'), (req, res) => {
    if (!req.file) return res.json({ success: false });
    // 返回图片访问路径
    const fileUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
    res.json({ success: true, url: fileUrl });
});

// [GET] 获取帖子列表 (支持搜索 & 筛选)
app.get('/api/feed', (req, res) => {
    const { tag, search } = req.query;
    let sql = `
        SELECT p.*, 
        (SELECT COUNT(*) FROM comments WHERE post_id = p.id) as comments_count
        FROM posts p 
        WHERE 1=1 
    `;
    let params = [];

    // 筛选板块
    if (tag && tag !== '全部') {
        sql += ` AND department = ?`;
        params.push(tag);
    }

    // 搜索 (标题、描述、作者名)
    if (search) {
        sql += ` AND (title LIKE ? OR description LIKE ? OR user_name LIKE ?)`;
        const likeStr = `%${search}%`;
        params.push(likeStr, likeStr, likeStr);
    }

    sql += ` ORDER BY created_at DESC`;

    db.all(sql, params, (err, rows) => {
        if (err) return res.json([]);
        const feed = rows.map(r => ({
            ...r,
            images: JSON.parse(r.images || '[]'),
            // 简单处理：SQLite没有布尔值，这里手动处理
            isLiked: false 
        }));
        res.json(feed);
    });
});

// [POST] 发布帖子
app.post('/api/submit', (req, res) => {
    const { user_id, title, description, department, images } = req.body;

    // 1. 获取用户信息
    db.get("SELECT * FROM users WHERE id = ?", [user_id], (err, user) => {
        if (!user) return res.json({ success: false, message: "用户未登录" });

        // 2. 权限拦截：只有管理员能发“村务公开”
        if (department === '村务公开' && user.role !== 'admin') {
            return res.json({ success: false, message: "权限不足：仅管理员可发布村务信息" });
        }

        // 3. 存入数据库
        const stmt = db.prepare(`INSERT INTO posts (user_id, user_name, user_avatar, title, description, department, images) VALUES (?, ?, ?, ?, ?, ?, ?)`);
        stmt.run(user_id, user.username, user.avatar, title, description, department, JSON.stringify(images), function(err) {
            if (err) return res.json({ success: false, message: "发布失败" });
            res.json({ success: true });
        });
    });
});

// [GET] 详情页
app.get('/api/post/:id', (req, res) => {
    const postId = req.params.id;
    // 增加浏览量
    db.run("UPDATE posts SET views = views + 1 WHERE id = ?", [postId]);

    db.get("SELECT * FROM posts WHERE id = ?", [postId], (err, post) => {
        if (!post) return res.json(null);
        
        // 获取评论
        db.all("SELECT * FROM comments WHERE post_id = ? ORDER BY created_at DESC", [postId], (err, comments) => {
            res.json({
                ...post,
                images: JSON.parse(post.images || '[]'),
                commentList: comments.map(c => ({
                    id: c.id,
                    user: c.user_name,
                    avatar: c.user_avatar,
                    content: c.content,
                    time: new Date(c.created_at).toLocaleString()
                })),
                likes: post.likes
            });
        });
    });
});

// [POST] 评论
app.post('/api/post/:id/comment', (req, res) => {
    const { user_id, content } = req.body;
    db.get("SELECT * FROM users WHERE id = ?", [user_id], (err, user) => {
        if (!user) return res.json({ success: false });
        db.run("INSERT INTO comments (post_id, user_id, user_name, user_avatar, content) VALUES (?, ?, ?, ?, ?)",
            [req.params.id, user_id, user.username, user.avatar, content],
            function(err) {
                res.json({ success: true });
            }
        );
    });
});

// [POST] 点赞
app.post('/api/post/:id/like', (req, res) => {
    const postId = req.params.id;
    const { isLiked } = req.body; // 前端传当前是点赞还是取消
    const change = isLiked ? 1 : -1;
    
    db.run(`UPDATE posts SET likes = likes + ? WHERE id = ?`, [change, postId], function(err) {
        res.json({ success: true });
    });
});

// 启动服务
app.listen(PORT, () => {
    console.log(`🚀 后端服务已启动: http://localhost:${PORT}`);
    console.log(`📂 前端页面请访问: http://localhost:${PORT}/index.html`);
});
