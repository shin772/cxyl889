const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const jwt = require('jsonwebtoken');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 5000;
const SECRET_KEY = process.env.SECRET_KEY || 'tea_creek_default_secret';

// === 中间件配置 ===
app.use(cors());
app.use(express.json());

// 确保必要的目录存在
const publicDir = path.join(__dirname, 'public');
const uploadsDir = path.join(__dirname, 'public/uploads');
if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir, { recursive: true });
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// 静态托管 public 目录 (前端页面) 和 uploads (图片)
app.use(express.static('public'));
app.use('/uploads', express.static(uploadsDir));

// === 数据库连接（使用绝对路径）===
const dbPath = path.join(__dirname, 'community.db');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('数据库连接失败:', err.message);
    } else {
        console.log('已连接至 SQLite 数据库');
        // 初始化数据库表
        initDatabase();
    }
});

// === 数据库初始化函数 ===
function initDatabase() {
    db.serialize(() => {
        // 创建用户表
        db.run(`CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            avatar TEXT,
            role TEXT DEFAULT 'villager',
            created_at INTEGER
        )`, (err) => {
            if (err) console.error('创建用户表失败:', err);
            else console.log('用户表已就绪');
        });

        // 创建帖子表
        db.run(`CREATE TABLE IF NOT EXISTS posts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            user_name TEXT,
            user_avatar TEXT,
            title TEXT,
            description TEXT,
            department TEXT,
            images TEXT,
            created_at INTEGER
        )`, (err) => {
            if (err) console.error('创建帖子表失败:', err);
            else console.log('帖子表已就绪');
        });

        // 创建评论表
        db.run(`CREATE TABLE IF NOT EXISTS comments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            post_id INTEGER,
            user_id INTEGER,
            user_name TEXT,
            user_avatar TEXT,
            content TEXT,
            created_at INTEGER
        )`, (err) => {
            if (err) console.error('创建评论表失败:', err);
            else console.log('评论表已就绪');
        });

        // 创建默认管理员账号（如果不存在）
        db.get("SELECT * FROM users WHERE role = 'admin'", (err, row) => {
            if (err) {
                console.error('查询管理员失败:', err);
            } else if (!row) {
                db.run(`INSERT INTO users (username, password, avatar, role, created_at) VALUES (?, ?, ?, ?, ?)`,
                    ['admin', 'admin123', '', 'admin', Date.now()],
                    (err) => {
                        if (err) console.error('创建管理员失败:', err);
                        else console.log('✅ 已创建默认管理员账号: admin / admin123');
                    }
                );
            } else {
                console.log('管理员账号已存在');
            }
        });
    });
}

// === 图片上传配置 (Multer) ===
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = path.join(__dirname, 'public/uploads');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

// === 鉴权中间件 ===
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN
    if (!token) return res.sendStatus(401);

    jwt.verify(token, SECRET_KEY, (err, user) => {
        if (err) return res.sendStatus(403);
        req.user = user;
        next();
    });
};

// ================= API 接口开发 =================

// 健康检查接口
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        message: '茶溪有灵社区后端服务运行正常',
        timestamp: Date.now()
    });
});

// 1. 图片上传 (支持多图)
app.post('/api/upload', upload.array('images',), (req, res) => {
    if (!req.files || req.files.length === 0) {
        return res.status(400).json({ success: false, message: '未上传文件' });
    }
    const imageUrls = req.files.map(file => `/uploads/${file.filename}`);
    res.json({ success: true, urls: imageUrls });
});

// 2. 用户登录 (自动注册)
app.post('/api/login', (req, res) => {
    const { username } = req.body;
    if (!username) return res.status(400).json({ message: '用户名必填' });

    db.get("SELECT * FROM users WHERE username = ?", [username], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });

        if (row) {
            // 登录成功
            const token = jwt.sign({ id: row.id, role: row.role, name: row.username }, SECRET_KEY, { expiresIn: '24h' });
            res.json({ success: true, token, userProfile: row });
        } else {
            // 自动注册
            const newUser = {
                username,
                password: 'password', // 默认密码
                avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${username}`,
                role: 'villager',
                created_at: Date.now()
            };
            db.run(`INSERT INTO users (username, password, avatar, role, created_at) VALUES (?, ?, ?, ?, ?)`,
                [newUser.username, newUser.password, newUser.avatar, newUser.role, newUser.created_at],
                function(err) {
                    if (err) return res.status(500).json({ error: err.message });
                    const token = jwt.sign({ id: this.lastID, role: 'villager', name: username }, SECRET_KEY, { expiresIn: '24h' });
                    res.json({ success: true, token, userProfile: { id: this.lastID, ...newUser } });
                }
            );
        }
    });
});

// 3. 发布动态 (需鉴权)
app.post('/api/submit', authenticateToken, (req, res) => {
    const { title, description, department, images } = req.body;
    // user info from jwt middleware
    const { id, name } = req.user; 
    
    // 获取用户当前头像 (为了数据一致性，也可以直接读库)
    db.get("SELECT avatar FROM users WHERE id = ?", [id], (err, userRow) => {
        if (err) return res.status(500).json({ success: false, error: err.message });
        
        const userAvatar = userRow ? userRow.avatar : '';
        const imageStr = JSON.stringify(images || []);
        const createdAt = Date.now();

        const stmt = db.prepare(`INSERT INTO posts (user_id, user_name, user_avatar, title, description, department, images, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
        stmt.run(id, name, userAvatar, title, description, department, imageStr, createdAt, function(err) {
            if (err) return res.status(500).json({ success: false, error: err.message });
            res.json({ success: true, postId: this.lastID });
        });
        stmt.finalize();
    });
});

// 4. 获取动态列表 (Feed)
app.get('/api/feed', (req, res) => {
    const { tag, user_id } = req.query;
    let sql = "SELECT * FROM posts WHERE 1=1";
    let params = [];

    if (tag && tag !== '全部') {
        sql += " AND department = ?";
        params.push(tag);
    }
    if (user_id) {
        sql += " AND user_id = ?";
        params.push(user_id);
    }

    // 逻辑：村务公开置顶 (department='村务公开' 排在前面)，其余按时间倒序
    sql += " ORDER BY CASE WHEN department = '村务公开' THEN 0 ELSE 1 END, created_at DESC";

    db.all(sql, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        // 解析 images JSON 字符串
        const posts = rows.map(post => ({
            ...post,
            images: JSON.parse(post.images || '[]')
        }));
        res.json(posts);
    });
});

// 5. 获取帖子详情
app.get('/api/post/:id', (req, res) => {
    db.get("SELECT * FROM posts WHERE id = ?", [req.params.id], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(404).json({ message: '帖子不存在' });
        row.images = JSON.parse(row.images || '[]');
        res.json(row);
    });
});

// 6. 获取评论列表
app.get('/api/comments/:postId', (req, res) => {
    const { postId } = req.params;
    db.all("SELECT * FROM comments WHERE post_id = ? ORDER BY created_at DESC", [postId], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows || []);
    });
});

// 7. 发布评论 (需鉴权)
app.post('/api/comments', authenticateToken, (req, res) => {
    const { postId, content } = req.body;
    const { id, name } = req.user;

    if (!content || !postId) {
        return res.status(400).json({ success: false, message: '内容和帖子ID必填' });
    }

    db.get("SELECT avatar FROM users WHERE id = ?", [id], (err, userRow) => {
        if (err) return res.status(500).json({ success: false, error: err.message });
        
        const userAvatar = userRow ? userRow.avatar : '';
        const createdAt = Date.now();

        const stmt = db.prepare(`INSERT INTO comments (post_id, user_id, user_name, user_avatar, content, created_at) VALUES (?, ?, ?, ?, ?, ?)`);
        stmt.run(postId, id, name, userAvatar, content, createdAt, function(err) {
            if (err) return res.status(500).json({ success: false, error: err.message });
            res.json({ success: true, commentId: this.lastID });
        });
        stmt.finalize();
    });
});

// 8. 删除评论 (需鉴权)
app.delete('/api/comments/:id', authenticateToken, (req, res) => {
    const commentId = req.params.id;
    const userId = req.user.id;

    db.get("SELECT user_id FROM comments WHERE id = ?", [commentId], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(404).json({ message: '评论不存在' });

        if (row.user_id !== userId && req.user.role !== 'admin') {
            return res.status(403).json({ message: '无权删除此评论' });
        }

        db.run("DELETE FROM comments WHERE id = ?", [commentId], function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true });
        });
    });
});

// ================= 管理员接口 =================

// Admin Login
app.post('/api/admin/login', (req, res) => {
    const { username, password } = req.body;
    db.get("SELECT * FROM users WHERE username = ? AND password = ? AND role = 'admin'", [username, password], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(401).json({ success: false, message: '认证失败' });

        const token = jwt.sign({ id: row.id, role: 'admin', name: row.username }, SECRET_KEY, { expiresIn: '12h' });
        res.json({ success: true, token });
    });
});

// Admin Stats
app.get('/api/admin/stats', authenticateToken, (req, res) => {
    if (req.user.role !== 'admin') return res.sendStatus(403);

    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

    const p1 = new Promise(resolve => db.get("SELECT COUNT(*) as count FROM posts", (err, r) => resolve(r ? r.count : 0)));
    const p2 = new Promise(resolve => db.get("SELECT COUNT(*) as count FROM posts WHERE created_at >= ?", [startOfDay], (err, r) => resolve(r ? r.count : 0)));
    const p3 = new Promise(resolve => db.all("SELECT department, COUNT(*) as count FROM posts GROUP BY department", (err, r) => resolve(r || [])));

    Promise.all([p1, p2, p3]).then(([total, today, cats]) => {
        res.json({ total, today, categories: cats });
    });
});

// Admin List & Delete
app.get('/api/admin/list', authenticateToken, (req, res) => {
    if (req.user.role !== 'admin') return res.sendStatus(403);
    db.all("SELECT * FROM posts ORDER BY created_at DESC", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        rows.forEach(r => r.images = JSON.parse(r.images || '[]'));
        res.json(rows);
    });
});

app.delete('/api/admin/post/:id', authenticateToken, (req, res) => {
    if (req.user.role !== 'admin') return res.sendStatus(403);
    db.run("DELETE FROM posts WHERE id = ?", [req.params.id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, deleted: this.changes });
    });
});

// 路由兜底：访问 /admin 返回 admin.html
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/admin.html'));
});

// 根路径返回首页
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/index.html'));
});

// 启动服务（监听所有网络接口）
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 茶溪有灵服务端运行在端口 ${PORT}`);
    console.log(`📱 村民端入口: http://localhost:${PORT}/`);
    console.log(`🔧 管理端入口: http://localhost:${PORT}/admin`);
    console.log(`💚 健康检查: http://localhost:${PORT}/api/health`);
});

// 优雅关闭
process.on('SIGTERM', () => {
    console.log('收到 SIGTERM 信号，正在关闭数据库连接...');
    db.close((err) => {
        if (err) console.error('关闭数据库失败:', err);
        else console.log('数据库连接已关闭');
        process.exit(0);
    });
});
