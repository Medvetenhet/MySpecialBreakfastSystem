const express = require('express');
const path    = require('path');
const fs      = require('fs');
const multer  = require('multer');

const app  = express();
const PORT = 3000;

/* ==========================================================================
   📂 檔案路徑常數
   ========================================================================== */
const MENU_FILE_PATH       = path.join(__dirname, 'menu.json');
const CATEGORIES_FILE_PATH = path.join(__dirname, 'categories.json');
const ORDERS_FILE_PATH     = path.join(__dirname, 'orders.json');
const UPLOADS_DIR          = path.join(__dirname, 'uploads');

/* ==========================================================================
   🛡️  工具函式
   ========================================================================== */

/** 安全讀取 JSON 檔，失敗時回傳預設值 */
function readJSON(filePath, defaultVal = []) {
    try {
        const raw = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(raw);
    } catch {
        return defaultVal;
    }
}

/** 原子寫入 JSON（先寫暫存檔再 rename，避免寫入中途崩潰導致資料損壞） */
function writeJSON(filePath, data) {
    const tmp = filePath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 4), 'utf8');
    fs.renameSync(tmp, filePath);
}

/** 過濾檔名：只保留中英文、數字、底線、連字號，防止路徑穿越 */
function sanitizeFilename(name) {
    return name.trim().replace(/[^\w\u4e00-\u9fa5\-]/g, '_');
}

/* ==========================================================================
   📦 初始化：確保持久化檔案與上傳目錄存在
   ========================================================================== */
if (!fs.existsSync(ORDERS_FILE_PATH)) writeJSON(ORDERS_FILE_PATH, []);
if (!fs.existsSync(UPLOADS_DIR))      fs.mkdirSync(UPLOADS_DIR, { recursive: true });

/* ==========================================================================
   📸 Multer 配置：自動檢查格式並強制更名為「餐點名.jpg」
   ========================================================================== */
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    filename: (req, file, cb) => {
        const productName = sanitizeFilename(req.body.name || 'unnamed');
        cb(null, `${productName}.jpg`);
    }
});

const imageFilter = (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    (ext === '.jpg' || ext === '.jpeg') ? cb(null, true) : cb(new Error('LIMIT_FILE_TYPE'), false);
};

const upload = multer({ storage, fileFilter: imageFilter });

/* ==========================================================================
   ⚙️  基本中介軟體
   ========================================================================== */
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname)));
app.use('/uploads', express.static(UPLOADS_DIR)); // 新增圖片由 uploads/ 提供

/* ==========================================================================
   🍳 菜單 API
   ========================================================================== */

// 【顧客】讀取菜單
app.get('/api/menu', (req, res) => {
    res.json(readJSON(MENU_FILE_PATH));
});

// 【管理員】新增餐點（含圖片上傳）
app.post('/api/admin/menu', (req, res) => {
    upload.single('menuImage')(req, res, (err) => {
        if (err?.message === 'LIMIT_FILE_TYPE')
            return res.json({ success: false, message: '🚨 只允許上傳 .jpg 或 .jpeg 檔案！' });
        if (err)
            return res.status(500).json({ success: false, message: '伺服器上傳組件異常' });

        const { name, price, category } = req.body;
        if (!name || !price || !category)
            return res.json({ success: false, message: '❌ 欄位填寫不完整！' });
        if (!req.file)
            return res.json({ success: false, message: '🚨 請選擇一張 .jpg 照片再進行上架！' });

        const safeFilename = sanitizeFilename(name);
        const menu         = readJSON(MENU_FILE_PATH);
        const newProduct   = {
            id:       'item-' + Date.now(),
            name:     name.trim(),
            price:    parseInt(price, 10),
            category,
            img:      `uploads/${safeFilename}.jpg`,
            active:   true
        };

        menu.push(newProduct);
        writeJSON(MENU_FILE_PATH, menu);
        res.json({ success: true, message: `🎉 【${name}】成功上架！` });
    });
});

// 【管理員】編輯餐點（名稱、價格、分類）
app.put('/api/admin/menu/:id', (req, res) => {
    const { name, price, category } = req.body;
    if (!name || !price || !category)
        return res.json({ success: false, message: '欄位不完整' });

    const menu    = readJSON(MENU_FILE_PATH);
    const product = menu.find(item => item.id === req.params.id);
    if (!product)
        return res.status(404).json({ success: false, message: '找不到餐點' });

    product.name     = name.trim();
    product.price    = parseInt(price, 10);
    product.category = category;

    writeJSON(MENU_FILE_PATH, menu);
    res.json({ success: true, message: `【${product.name}】已更新` });
});

// 【管理員】刪除餐點
app.delete('/api/admin/menu/:id', (req, res) => {
    let menu    = readJSON(MENU_FILE_PATH);
    const before = menu.length;
    menu = menu.filter(item => item.id !== req.params.id);
    if (menu.length === before)
        return res.status(404).json({ success: false, message: '找不到餐點' });
    writeJSON(MENU_FILE_PATH, menu);
    res.json({ success: true });
});

// 【管理員】切換供應 / 完售狀態
app.put('/api/admin/menu/toggle/:id', (req, res) => {
    const menu    = readJSON(MENU_FILE_PATH);
    const product = menu.find(item => item.id === req.params.id);
    if (!product)
        return res.status(404).json({ success: false });
    product.active = !product.active;
    writeJSON(MENU_FILE_PATH, menu);
    res.json({ success: true, active: product.active });
});

/* ==========================================================================
   🏷️  分類 API
   ========================================================================== */

// 讀取分類
app.get('/api/categories', (req, res) => {
    res.json(readJSON(CATEGORIES_FILE_PATH));
});

// 【管理員】新增分類
app.post('/api/admin/categories', (req, res) => {
    const { id, label } = req.body;
    if (!id || !label)
        return res.json({ success: false, message: '欄位不完整' });

    const cats = readJSON(CATEGORIES_FILE_PATH);
    if (cats.find(c => c.id === id))
        return res.json({ success: false, message: '分類 ID 已存在' });

    cats.push({ id: id.trim(), label: label.trim() });
    writeJSON(CATEGORIES_FILE_PATH, cats);
    res.json({ success: true });
});

// 【管理員】刪除分類
app.delete('/api/admin/categories/:id', (req, res) => {
    let cats = readJSON(CATEGORIES_FILE_PATH);
    cats     = cats.filter(c => c.id !== req.params.id);
    writeJSON(CATEGORIES_FILE_PATH, cats);
    res.json({ success: true });
});

/* ==========================================================================
   📋 訂單 API（orders.json 持久化）
   ========================================================================== */

// SSE：管理員即時推播通道
let adminClients = [];

app.get('/api/admin/stream', (req, res) => {
    res.setHeader('Content-Type',  'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection',    'keep-alive');
    res.flushHeaders();
    adminClients.push(res);
    console.log('🟢 Admin 即時監聽已連線');
    req.on('close', () => {
        adminClients = adminClients.filter(client => client !== res);
        console.log('🔴 Admin 即時監聽已斷線');
    });
});

function broadcastSSE(event) {
    adminClients.forEach(client => client.write(`data: ${event}\n\n`));
}

// 【顧客】送出訂單（防禦下架商品）
app.post('/api/order', (req, res) => {
    const orderData  = req.body;
    const currentMenu = readJSON(MENU_FILE_PATH);

    for (const itemStr of orderData.items) {
        const match       = itemStr.match(/^([^(]+)/);
        if (!match) continue;
        const productName = match[1].trim();
        const dbProduct   = currentMenu.find(p => p.name === productName);

        if (!dbProduct || !dbProduct.active) {
            console.log(`❌ 【防禦成功】攔截已下架商品：${productName}`);
            return res.json({
                success: false,
                message: `🚨 點餐失敗！\n【${productName}】今日已下架完售，請重新調整購物車！`
            });
        }
    }

    orderData.status    = 'pending';
    orderData.createdAt = new Date().toISOString();

    const orders = readJSON(ORDERS_FILE_PATH);
    orders.push(orderData);
    writeJSON(ORDERS_FILE_PATH, orders);

    broadcastSSE('new-order');
    console.log(`🔔 【新訂單】編號: ${orderData.id}`);
    res.json({ success: true, message: '訂單已成立！' });
});

// 【顧客】取消訂單
app.delete('/api/order/:id', (req, res) => {
    const orders = readJSON(ORDERS_FILE_PATH);
    const order  = orders.find(o => o.id === req.params.id);
    if (!order)
        return res.status(404).json({ success: false });

    order.status = 'cancelled';
    writeJSON(ORDERS_FILE_PATH, orders);
    broadcastSSE('refresh');
    console.log(`❌ 訂單 ${req.params.id} 已取消`);
    res.json({ success: true });
});

// 【管理員】取得所有訂單
app.get('/api/admin/orders', (req, res) => {
    res.json(readJSON(ORDERS_FILE_PATH));
});

// 【管理員】標記訂單完成
app.put('/api/admin/orders/:id', (req, res) => {
    const orders = readJSON(ORDERS_FILE_PATH);
    const order  = orders.find(o => o.id === req.params.id);
    if (!order)
        return res.status(404).json({ success: false });

    order.status = 'done';
    writeJSON(ORDERS_FILE_PATH, orders);
    broadcastSSE('refresh');
    res.json({ success: true });
});

// 【管理員】清空所有訂單
app.delete('/api/admin/orders/clearall', (req, res) => {
    writeJSON(ORDERS_FILE_PATH, []);
    res.json({ success: true });
});

/* ==========================================================================
   🚀 啟動伺服器
   ========================================================================== */
app.listen(PORT, () => {
    console.log('=============================================');
    console.log('🍳 早點到系統已全面啟動！');
    console.log(`👉 顧客前台: http://localhost:${PORT}`);
    console.log(`👉 店長後台: http://localhost:${PORT}/admin.html`);
    console.log('=============================================');
});
