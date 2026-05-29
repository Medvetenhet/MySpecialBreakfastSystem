const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer'); // 處理實體圖片上傳
const app = express();
const PORT = 3000;

// 記憶體暫存：用來存顧客傳過來的「真實訂單」
let globalOrders = [];
let adminClients = [];
// 基本中介軟體設定
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname))); // 讓根目錄下的 圖片.jpg 都能被靜態讀取

const MENU_FILE_PATH = path.join(__dirname, 'menu.json');

/* ==========================================================================
   📸 Multer 配置：自動檢查格式並強制更名為「餐點名.jpg」
   ========================================================================== */
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, __dirname); // 圖片直接存放在專案根目錄
    },
    filename: function (req, file, cb) {
        const productName = req.body.name ? req.body.name.trim() : 'unnamed';
        cb(null, `${productName}.jpg`); // 強制改名為 [餐點名稱].jpg
    }
});

// 格式篩選器：只接受 .jpg 與 .jpeg
const imageFilter = function(req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.jpg' || ext === '.jpeg') {
        cb(null, true);
    } else {
        cb(new Error('LIMIT_FILE_TYPE'), false);
    }
};

const upload = multer({ 
    storage: storage,
    fileFilter: imageFilter
});

/* ==========================================================================
   🍳 菜單管理 API 專區
   ========================================================================== */

// 🔄 【讀取菜單】
app.get('/api/menu', (req, res) => {
    fs.readFile(MENU_FILE_PATH, 'utf8', (err, data) => {
        if (err) return res.status(500).json({ success: false, message: '無法讀取菜單' });
        res.json(JSON.parse(data));
    });
});

// 🔄 【新增餐點（含圖片上傳、格式檢查、自動更名、預設供應中）】
app.post('/api/admin/menu', (req, res) => {
    upload.single('menuImage')(req, res, function (err) {
        if (err && err.message === 'LIMIT_FILE_TYPE') {
            return res.json({ success: false, message: '🚨 上架失敗！圖片格式錯誤，只允許上傳 .jpg 或 .jpeg 檔案！' });
        } else if (err) {
            return res.status(500).json({ success: false, message: '伺服器上傳組件異常' });
        }

        try {
            const { name, price, category } = req.body;
            if (!name || !price || !category) {
                return res.json({ success: false, message: '❌ 欄位填寫不完整！' });
            }
            if (!req.file) {
                return res.json({ success: false, message: '🚨 請選擇一張該餐點的 .jpg 照片再進行上架！' });
            }

            fs.readFile(MENU_FILE_PATH, 'utf8', (err, data) => {
                let menu = [];
                if (!err && data) menu = JSON.parse(data);

                // 核心：圖片檔名自動對應餐點名稱
                const imgUrl = `${name}.jpg`;
                const newId = 'item-' + Date.now();

                const newProduct = {
                    id: newId,
                    name: name,
                    price: parseInt(price, 10),
                    category: category,
                    img: imgUrl,
                    active: true // 👥 統一默認設為正常供應
                };

                menu.push(newProduct);

                fs.writeFile(MENU_FILE_PATH, JSON.stringify(menu, null, 4), 'utf8', (err) => {
                    if (err) return res.status(500).json({ success: false, message: '寫入資料庫失敗' });
                    res.json({ success: true, message: `🎉 【${name}】成功上架！\n圖片已自動更名儲存為：${name}.jpg` });
                });
            });
        } catch (error) {
            res.status(500).json({ success: false, message: '伺服器異常' });
        }
    });
});
app.get('/api/admin/stream', (req, res) => { res.setHeader( 'Content-Type', 'text/event-stream' ); res.setHeader( 'Cache-Control', 'no-cache' ); res.setHeader( 'Connection', 'keep-alive' ); res.flushHeaders(); adminClients.push(res); console.log( '🟢 Admin 即時監聽已連線' ); req.on('close', () => { adminClients = adminClients.filter( client => client !== res ); console.log( '🔴 Admin 即時監聽已斷線' ); }); });
// 🔄 【切換完售 / 供應狀態】
app.put('/api/admin/menu/toggle/:id', (req, res) => {
    const productId = req.params.id;
    fs.readFile(MENU_FILE_PATH, 'utf8', (err, data) => {
        if (err) return res.status(500).json({ success: false });
        let menu = JSON.parse(data);
        const product = menu.find(item => item.id === productId);
        if (!product) return res.status(404).json({ success: false });

        product.active = !product.active;

        fs.writeFile(MENU_FILE_PATH, JSON.stringify(menu, null, 4), 'utf8', (err) => {
            if (err) return res.status(500).json({ success: false });
            res.json({ success: true, active: product.active });
        });
    });
});

/* ==========================================================================
   📋 顧客訂單 API 專區 (含下架嚴格防禦、取消訂單同步)
   ========================================================================== */

// 🔄 【顧客送出訂單（嚴格檢查下架防禦）】
app.post('/api/order', (req, res) => {
    const orderData = req.body;
    
    fs.readFile(MENU_FILE_PATH, 'utf8', (err, data) => {
        if (err) return res.status(500).json({ success: false, message: "菜單讀取異常" });
        const currentMenu = JSON.parse(data);

for (let itemStr of orderData.items) {

    // Parse product name from string
    // input:
    // "奶茶 (數量:1, 單價:25)"
    // output:
    // "奶茶"
    const match =
        itemStr.match(/^([^\(]+)/);

    if (!match) {

        console.log(
            '❌ 無法解析商品:',
            itemStr
        );

        continue;
    }

    const productName =
        match[1].trim();

    const dbProduct =
        currentMenu.find(
            p => p.name === productName
        );

    if (!dbProduct || !dbProduct.active) {

        console.log(
            `❌ 【防禦成功】攔截已下架商品：${productName}`
        );

        return res.json({

            success: false,

            message:
                `🚨 點餐失敗！\n【${productName}】今日已下架完售，請重新調整購物車！`

        });

    }

}


        // 通過檢查，成立訂單
        orderData.status = "pending";
        globalOrders.push(orderData);

        adminClients.forEach(client => { client.write( `data: new-order\n\n` ); });
        console.log(`🔔 【新訂單】編號: ${orderData.id}`);
        res.json({ success: true, message: "後端已成功記錄訂單！" });
    });
});

// 🔄 【後台撈取所有訂單】
app.get('/api/admin/orders', (req, res) => {
    res.json(globalOrders);
});

app.put('/api/admin/orders/:id', (req, res) => {

    const orderId = req.params.id;

    const order =
        globalOrders.find(
            o => o.id === orderId
        );

    if(order){

        order.status = "done";

        adminClients.forEach(client => {

            client.write(
                `data: refresh\n\n`
            );

        });

        return res.json({
            success: true
        });

    }

    res.status(404).json({
        success: false
    });

});


// 🔄 【顧客取消訂單：改為標記取消，不直接刪除】
app.delete('/api/order/:id', (req, res) => {

    const orderId =
        req.params.id;

    const order =
        globalOrders.find(
            o => o.id === orderId
        );

    if(order){

        order.status =
            'cancelled';

        console.log(
            `❌ 訂單 ${orderId} 已取消`
        );

        adminClients.forEach(client => {

            client.write(
                `data: refresh\n\n`
            );

        });

        return res.json({
            success:true
        });

    }

    res.status(404).json({
        success:false
    });

});



// 🔄 【後台清空所有訂單】
app.delete('/api/admin/orders/clearall', (req, res) => {
    globalOrders = [];
    res.json({ success: true });
});

app.listen(PORT, () => {
    console.log("=============================================");
    console.log(`🍳 早點到系統完全體已全面啟動！`);
    console.log(`👉 顧客前台: http://localhost:${PORT}`);
    console.log(`👉 店長後台: http://localhost:${PORT}/admin.html`);
    console.log("=============================================");
});