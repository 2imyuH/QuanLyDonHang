const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');
// --------------------------------------------------
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const ExcelJS = require('exceljs');
const fs = require('fs');
const multer = require('multer');
const XLSX = require('xlsx');

const app = express();
const upload = multer({ dest: 'uploads/' });

app.use(cors({ origin: '*', methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'] }));
app.use(express.json());

// --- 1. KẾT NỐI DATABASE ---
let pool;
const initPool = async () => {
    try {
        let connectionString = process.env.DATABASE_URL;
        if (!connectionString.includes('family=')) {
            const separator = connectionString.includes('?') ? '&' : '?';
            connectionString = `${connectionString}${separator}family=4`;
        }
        console.log('🔗 Đang kết nối database...');
        pool = new Pool({
            connectionString: connectionString,
            ssl: { rejectUnauthorized: false },
            connectionTimeoutMillis: 30000,
        });
        const client = await pool.connect();
        await client.query('SELECT NOW()');
        client.release();
        console.log('✅ Đã kết nối PostgreSQL thành công!');
        await initDB();
    } catch (err) {
        console.error('❌ Lỗi kết nối Database:', err);
        process.exit(1);
    }
};

const initDB = async () => {
    const createTableQuery = `
        CREATE TABLE IF NOT EXISTS orders (
            id SERIAL PRIMARY KEY,
            workshop TEXT,
            lot_number TEXT,
            data TEXT,
            status TEXT DEFAULT 'ACTIVE',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_workshop_lot ON orders(workshop, lot_number);
    `;
    try { await pool.query(createTableQuery); console.log("✅ Đã kiểm tra bảng orders."); } 
    catch (err) { console.error("❌ Lỗi tạo bảng:", err); }
};

// --- HELPER FUNCTIONS ---
const formatDateTimeVN = (isoString) => {
    if (!isoString) return "";
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString;
    const vnTime = new Date(d.getTime() + 7 * 60 * 60 * 1000); 
    const hh = String(vnTime.getUTCHours()).padStart(2, '0');
    const mm = String(vnTime.getUTCMinutes()).padStart(2, '0');
    const DD = String(vnTime.getUTCDate()).padStart(2, '0');
    const MM = String(vnTime.getUTCMonth() + 1).padStart(2, '0');
    const YYYY = vnTime.getUTCFullYear();
    return `${hh}h${mm} ${DD}/${MM}/${YYYY}`;
};

const normalizeDateValue = (val) => {
    if (!val) return "";
    if (typeof val === 'number' && val > 25569 && val < 2958465) {
        const utc_days = Math.floor(val - 25569);
        const date_info = new Date(utc_days * 86400 * 1000);
        const year = date_info.getFullYear();
        const month = String(date_info.getMonth() + 1).padStart(2, '0');
        const day = String(date_info.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }
    if (typeof val === 'string' && /^\d{1,2}\/\d{1,2}\/\d{4}/.test(val)) {
        const parts = val.split('/'); 
        if (parts.length === 3) {
            const day = parts[0].padStart(2, '0');
            const month = parts[1].padStart(2, '0');
            const year = parts[2];
            return `${year}-${month}-${day}`.substring(0, 10);
        }
    }
    return String(val).trim();
};

const excelDateToJSDate = (val) => normalizeDateValue(val);

const toStr = (val) => { if (val === null || val === undefined) return ""; return String(val).trim().toUpperCase(); };

const normalizeData = (obj) => {
    const cleanObj = {};
    Object.keys(obj).sort().forEach(key => {
        if (['STT', 'stt', 'id', 'workshop', 'lot_number', 'status', 'created_at', 'updated_at', 'SKIP_UPDATE', 'Ngày Cập Nhật'].includes(key)) return;
        if (key.startsWith('Hồi ẩm (')) return;
        let val = toStr(obj[key]);
        if (val !== "") cleanObj[key] = val;
    });
    return JSON.stringify(cleanObj);
};

const isSameIdentity = (obj1, obj2) => {
    if (toStr(obj1['SẢN PHẨM']) !== toStr(obj2['SẢN PHẨM'])) return false;
    const keys1 = Object.keys(obj1).filter(k => k.startsWith('COT_'));
    const keys2 = Object.keys(obj2).filter(k => k.startsWith('COT_'));
    const allCotKeys = new Set([...keys1, ...keys2]);
    for (let key of allCotKeys) { if (toStr(obj1[key]) !== toStr(obj2[key])) return false; }
    return true;
};

// --- LOGIC XỬ LÝ IMPORT TỐI ƯU (CACHING + BATCH QUERY) ---
const processImportLogic = async (workshop, rows) => {
    let inserted = 0, skipped = 0, updated = 0;
    const client = await pool.connect();
    
    try {
        // BƯỚC 1: LẤY DANH SÁCH SỐ LÔ CẦN XỬ LÝ
        const lotNumbers = [...new Set(rows.map(r => r.lot_number))];

        // BƯỚC 2: TẢI DỮ LIỆU TỪ DB VỀ RAM (CHỈ 1 LỆNH SELECT)
        // Thay vì gọi DB 1000 lần, ta gọi 1 lần lấy hết các lô có liên quan
        const dbRes = await client.query(
            `SELECT id, lot_number, data FROM orders 
             WHERE workshop = $1 AND lot_number = ANY($2::text[])`,
            [workshop, lotNumbers]
        );

        // BƯỚC 3: TẠO MAP ĐỂ TRA CỨU NHANH
        const dbRecordsMap = {};
        dbRes.rows.forEach(row => {
            if (!dbRecordsMap[row.lot_number]) dbRecordsMap[row.lot_number] = [];
            dbRecordsMap[row.lot_number].push({
                id: row.id,
                parsedData: JSON.parse(row.data)
            });
        });

        await client.query('BEGIN');
        
        // Theo dõi các ID đã được sử dụng trong phiên này để tránh trùng lặp
        const usedDbIds = new Set(); 

        for (const item of rows) {
            const { lot_number, data } = item;
            
            // Dọn dẹp dữ liệu
            delete data['STT']; delete data['stt']; 
            delete data['SKIP_UPDATE']; delete data['updated_at']; delete data['Ngày Cập Nhật'];

            const newSig = normalizeData(data);
            const newDataFull = JSON.stringify(data);
            
            // Lấy danh sách ứng viên từ RAM (Không gọi DB)
            const candidates = dbRecordsMap[lot_number] || [];
            
            let handled = false;

            // Logic 1: Tìm bản ghi GIỐNG HỆT (Skip)
            for (const dbRecord of candidates) {
                if (usedDbIds.has(dbRecord.id)) continue;

                const oldSig = normalizeData(dbRecord.parsedData);
                if (oldSig === newSig) {
                    skipped++;
                    usedDbIds.add(dbRecord.id); // Đánh dấu đã dùng
                    handled = true;
                    break;
                }
            }

            if (handled) continue;

            // Logic 2: Tìm bản ghi CÙNG ĐỊNH DANH (Update)
            for (const dbRecord of candidates) {
                if (usedDbIds.has(dbRecord.id)) continue;

                if (isSameIdentity(dbRecord.parsedData, data)) {
                    await client.query("UPDATE orders SET data = $1, updated_at = NOW() WHERE id = $2", [newDataFull, dbRecord.id]);
                    updated++;
                    usedDbIds.add(dbRecord.id);
                    handled = true;
                    break;
                }
            }

            // Logic 3: Insert mới
            if (!handled) {
                await client.query("INSERT INTO orders (workshop, lot_number, data, status) VALUES ($1, $2, $3, 'ACTIVE')", [workshop, lot_number, newDataFull]);
                inserted++;
            }
        }
        await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK'); throw e; } 
    finally { client.release(); }
    return { inserted, skipped, updated };
};

// --- API ROUTES ---
app.get('/api/orders', async (req, res) => {
    const { workshop, status } = req.query;
    try {
        const result = await pool.query(`SELECT * FROM orders WHERE workshop = $1 AND status = $2 ORDER BY id ASC`, [workshop || 'AA', status || 'ACTIVE']);
        const rows = result.rows.map(row => ({
            id: row.id, workshop: row.workshop, lot_number: row.lot_number, status: row.status, updated_at: row.updated_at,
            ...JSON.parse(row.data || '{}')
        }));
        res.json(rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/orders', async (req, res) => {
    const { workshop, lot_number, data } = req.body;
    try {
        const cleanLot = String(lot_number).trim();
        const singleItem = [{ workshop, lot_number: cleanLot, data }];
        const result = await processImportLogic(workshop, singleItem);
        res.json({ success: true, ...result });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/orders/:id', async (req, res) => {
    const { id } = req.params;
    const { id: _id, workshop, lot_number, status, created_at, updated_at, ...excelData } = req.body;
    try {
        await pool.query('UPDATE orders SET data = $1, updated_at = NOW() WHERE id = $2', [JSON.stringify(excelData), id]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/orders/:id', async (req, res) => {
    try { await pool.query("DELETE FROM orders WHERE id = $1", [req.params.id]); res.json({ success: true }); } 
    catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/orders/:id/status', async (req, res) => {
    try { await pool.query("UPDATE orders SET status = $1, updated_at = NOW() WHERE id = $2", [req.body.status, req.params.id]); res.json({ success: true }); } 
    catch (e) { res.status(500).json({ error: e.message }); }
});

// --- API EXPORT ---
app.get('/api/export', async (req, res) => {
    try {
        const { workshop, status } = req.query;
        const currentWorkshop = workshop || 'AA';
        const result = await pool.query(`SELECT data, lot_number FROM orders WHERE workshop = $1 AND status = $2`, [currentWorkshop, status]);
        
        const jsonData = result.rows.map((r, index) => {
            const parsed = JSON.parse(r.data || '{}');
            delete parsed['STT']; delete parsed['stt'];
            return { "STT": index + 1, "SỐ LÔ": r.lot_number, ...parsed };
        });

        const wb = new ExcelJS.Workbook();
        const worksheet = wb.addWorksheet('Data');

        const COLUMNS_CONFIG = {
            'AA': ["STT", "MÀU", "GHI CHÚ", "HỒI ẨM", "NGÀY XUỐNG ĐƠN", "SẢN PHẨM", "SỐ LÔ", "CHI SỐ", "SỐ LƯỢNG", "BẮT ĐẦU", "KẾT THÚC", "THAY ĐỔI", "SO MÀU", "ghi chú", "ghi chú (1)"],
            'AB': ["STT", "MÀU", "GHI CHÚ", "HỒI ẨM", "NGÀY XUỐNG ĐƠN", "SẢN PHẨM", "SỐ LÔ", "CHI SỐ", "SỐ LƯỢNG", "BẮT ĐẦU", "KẾT THÚC", "THAY ĐỔI", "SO MÀU", "ghi chú", "ghi chú (1)"],
            'OE': ["STT", "MÀU", "GHI CHÚ", "HỒI ẨM", "NGÀY XUỐNG ĐƠN", "SẢN PHẨM", "SỐ LÔ", "CHI SỐ", "SỐ LƯỢNG", "BẮT ĐẦU", "KẾT THÚC", "FU CUNG CÚI", "THỰC TẾ HOÀN THÀNH", "SO MÀU", "ghi chú", "ghi chú (1)"]
        };
        const targetOrder = COLUMNS_CONFIG[currentWorkshop] || COLUMNS_CONFIG['AA'];

        const HEADER_MAP = {
            "GHI CHÚ": "Ghi chú 1", "ghi chú": "Ghi chú 2", "ghi chú (1)": "Ghi chú 3",
            "NGÀY XUỐNG ĐƠN": "Ngày xuống đơn", "SỐ LƯỢNG": "Số Lượng",
            "BẮT ĐẦU": "Bắt Đầu", "KẾT THÚC": "Kết Thúc", "SỐ LÔ": "Số Lô", "SẢN PHẨM": "Sản Phẩm",
            "CHI SỐ": "Chi Số", "MÀU": "Màu", "THAY ĐỔI": "Thay Đổi", "SO MÀU": "So Màu", "HỒI ẨM": "Hồi ẩm",
            "FU CUNG CÚI": "Fu Cung Cúi", "THỰC TẾ HOÀN THÀNH": "Thực Tế"
        };

        let allKeys = new Set();
        jsonData.forEach(item => Object.keys(item).forEach(k => allKeys.add(k)));
        
        const sortedKeys = Array.from(allKeys).sort((a, b) => {
            const indexA = targetOrder.findIndex(key => key === a || key === a.toUpperCase());
            const indexB = targetOrder.findIndex(key => key === b || key === b.toUpperCase());
            if (indexA !== -1 && indexB !== -1) return indexA - indexB;
            if (indexA !== -1) return -1; if (indexB !== -1) return 1;
            const isCotA = a.startsWith('COT_'); const isCotB = b.startsWith('COT_');
            if (isCotA && isCotB) return (parseInt(a.replace('COT_', '') || 0) - parseInt(b.replace('COT_', '') || 0));
            if (isCotA) return 1; if (isCotB) return -1;
            return a.localeCompare(b);
        });

        worksheet.columns = sortedKeys.map(key => ({ header: HEADER_MAP[key] || key, key: key }));
        worksheet.addRows(jsonData);

        const fontStyle = { name: 'Times New Roman', size: 12 };
        const borderStyle = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
        const alignStyle = { vertical: 'middle', horizontal: 'center', wrapText: true }; 

        worksheet.eachRow((row, rowNumber) => {
            row.eachCell((cell) => { cell.font = fontStyle; cell.border = borderStyle; cell.alignment = alignStyle; });
            if (rowNumber === 1) { 
                row.height = 30;
                row.eachCell((cell) => { cell.font = { ...fontStyle, bold: true, color: { argb: 'FFFFFFFF' } }; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E78' } }; cell.alignment = { ...alignStyle, horizontal: 'center' }; });
            }
        });
        worksheet.columns.forEach(column => { 
            let maxLength = 0; if (column.header) maxLength = column.header.length; 
            column.eachCell({ includeEmpty: true }, (cell, rowNumber) => { if (rowNumber > 50) return; const val = cell.value ? cell.value.toString() : ""; if (val.length > maxLength) maxLength = val.length; }); 
            column.width = Math.min(maxLength + 5, 60); 
        });

        const buffer = await wb.xlsx.writeBuffer();
        res.setHeader('Content-Disposition', `attachment; filename="${workshop}_Export.xlsx"`);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.send(buffer);
    } catch (e) { console.error(e); res.status(500).send(e.message); }
});

// --- API IMPORT ĐA SHEET ---
app.post('/api/import', upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).send("No file.");
    const filePath = req.file.path;
    try {
        const workbook = XLSX.readFile(filePath);
        const sheetNames = workbook.SheetNames;
        let totalInserted = 0; let totalUpdated = 0; let totalSkipped = 0; let processedSheets = [];

        console.log(`📂 Bắt đầu xử lý file với ${sheetNames.length} sheets...`);

        for (const sheetName of sheetNames) {
            const aoa = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: "" });
            let headerIdx = -1;
            for (let i = 0; i < Math.min(aoa.length, 50); i++) { 
                if (JSON.stringify(aoa[i]).toUpperCase().includes('SỐ LÔ')) { headerIdx = i; break; } 
            }
            if (headerIdx === -1) continue;

            let currentWorkshop = 'AA';
            const nameUp = sheetName.toUpperCase();
            if (nameUp.includes('AA')) currentWorkshop = 'AA';
            else if (nameUp.includes('AB')) currentWorkshop = 'AB';
            else if (nameUp.includes('OE')) currentWorkshop = 'OE';
            else currentWorkshop = sheetName.trim();

            const rawHeaders = aoa[headerIdx];
            const mappedHeaders = [];
            const nameCount = {};
            let noteCounter = 0;

            rawHeaders.forEach((h, index) => {
                let name = (h && String(h).trim() !== '') ? String(h).trim() : '';
                const upperName = name.toUpperCase();
                
                if (upperName.includes('SỐ LÔ')) name = 'SỐ LÔ';
                else if (upperName.includes('SẢN PHẨM')) name = 'SẢN PHẨM';
                else if (upperName.includes('MÀU') && !upperName.includes('SO')) name = 'MÀU';
                else if (upperName.includes('SO MÀU')) name = 'SO MÀU';
                else if (upperName.includes('CHI SỐ')) name = 'CHI SỐ';
                else if (upperName.includes('SỐ LƯỢNG')) name = 'SỐ LƯỢNG';
                else if (upperName.includes('BẮT ĐẦU')) name = 'BẮT ĐẦU';
                else if (upperName.includes('KẾT THÚC')) name = 'KẾT THÚC';
                else if (upperName.includes('THAY ĐỔI')) name = 'THAY ĐỔI';
                else if (upperName.includes('HỒI ẨM') || upperName.includes('MOISTURE')) name = 'HỒI ẨM';
                else if (upperName.includes('NGÀY') && upperName.includes('ĐƠN')) name = 'NGÀY XUỐNG ĐƠN';
                else if (upperName.includes('FU CUNG')) name = 'FU CUNG CÚI';
                else if (upperName.includes('THỰC TẾ')) name = 'THỰC TẾ HOÀN THÀNH';
                else if (upperName.includes('GHI CHÚ')) {
                    noteCounter++;
                    if (noteCounter === 1) name = 'GHI CHÚ';
                    else if (noteCounter === 2) name = 'ghi chú';
                    else if (noteCounter === 3) name = 'ghi chú (1)';
                    else name = `GHI CHÚ (${noteCounter})`;
                }
                else if (upperName.includes('CẬP NHẬT') || upperName.includes('UPDATED')) {
                    name = 'SKIP_UPDATE';
                }

                if (name === '' || name.startsWith('COT_')) { if (name === '') name = `COT_${index}`; }
                if (!['GHI CHÚ', 'ghi chú', 'ghi chú (1)', 'SKIP_UPDATE'].includes(name)) {
                    if (nameCount[name]) { nameCount[name]++; name = `${name} (${nameCount[name]})`; } else { nameCount[name] = 1; }
                }
                mappedHeaders.push(name);
            });

            const lotColIndex = mappedHeaders.findIndex(h => h === 'SỐ LÔ');
            const processedRows = [];

            for (let i = headerIdx + 1; i < aoa.length; i++) {
                const rowData = aoa[i];
                const lotVal = rowData[lotColIndex];
                if (!lotVal || String(lotVal).trim() === '') continue;

                const rowObject = {};
                mappedHeaders.forEach((header, index) => {
                    if (header === 'SKIP_UPDATE') return;

                    const val = rowData[index];
                    if (header.startsWith('COT_') && (val === '' || val == null)) return;
                    
                    const isDateCol = /NGÀY|DATE|BẮT ĐẦU|KẾT THÚC|GIAO|THỜI GIAN/i.test(header);
                    const isSerialNum = typeof val === 'number' && val > 25569 && val < 2958465;
                    
                    if (val && (isDateCol || isSerialNum)) { rowObject[header] = excelDateToJSDate(val); }
                    else { rowObject[header] = typeof val === 'boolean' ? String(val).toUpperCase() : val; }
                });
                processedRows.push({ workshop: currentWorkshop, lot_number: String(lotVal).trim(), data: rowObject });
            }

            const result = await processImportLogic(currentWorkshop, processedRows);
            totalInserted += result.inserted; totalUpdated += result.updated; totalSkipped += result.skipped;
            processedSheets.push(sheetName);
        }

        fs.unlinkSync(filePath);
        res.json({ success: true, message: `Đã xử lý ${processedSheets.length} sheets.`, inserted: totalInserted, updated: totalUpdated, skipped: totalSkipped });
    } catch (e) { 
        console.error(e); 
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath); 
        res.status(500).json({ error: e.message }); 
    }
});

app.post('/api/orders/batch', async (req, res) => {
    const { items } = req.body;
    if (!items || !Array.isArray(items)) return res.status(400).json({ error: "Data error" });
    try {
        const workshop = items[0]?.workshop || 'AA';
        const cleanedItems = items.map(i => ({ ...i, lot_number: String(i.lot_number).trim() }));
        const result = await processImportLogic(workshop, cleanedItems);
        res.json({ success: true, ...result });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/health', (req, res) => { res.json({ status: 'ok', timestamp: new Date().toISOString() }); });

const PORT = process.env.PORT || 3001;
initPool().then(() => { app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`)); }).catch(err => { console.error('❌ Không thể khởi động server:', err); process.exit(1); });