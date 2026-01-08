require('dotenv').config(); // Đọc file .env
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg'); // Dùng Pool của Postgres
const XLSX = require('xlsx');
const ExcelJS = require('exceljs');
const fs = require('fs');
const multer = require('multer');

const app = express();
const upload = multer({ dest: 'uploads/' });

app.use(cors({ origin: '*', methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'] }));
app.use(express.json());

// --- KẾT NỐI DATABASE CLOUD ---
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false } // Bắt buộc khi dùng Cloud (Supabase/Neon)
});

// Kiểm tra kết nối
pool.connect((err) => {
    if (err) console.error('❌ Lỗi kết nối Database:', err);
    else console.log('✅ Đã kết nối PostgreSQL thành công!');
});

// --- KHỞI TẠO BẢNG (NẾU CHƯA CÓ) ---
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
    `;
    try {
        await pool.query(createTableQuery);
        console.log("✅ Đã kiểm tra/tạo bảng orders.");
    } catch (err) {
        console.error("❌ Lỗi tạo bảng:", err);
    }
};
initDB();

// --- HELPER FUNCTIONS ---
const excelDateToJSDate = (serial) => {
    if (!serial) return "";
    if (typeof serial === 'number' && serial > 25569 && serial < 2958465) {
        const utc_days = Math.floor(serial - 25569);
        const utc_value = utc_days * 86400;
        const date_info = new Date(utc_value * 1000);
        const fractional_day = serial - Math.floor(serial) + 0.0000001;
        const total_seconds = Math.floor(86400 * fractional_day);
        const seconds = total_seconds % 60;
        const hours = Math.floor(total_seconds / 3600);
        const minutes = Math.floor(total_seconds / 60) % 60;
        date_info.setUTCHours(hours, minutes, seconds);
        const day = String(date_info.getDate()).padStart(2, '0');
        const month = String(date_info.getMonth() + 1).padStart(2, '0');
        const year = date_info.getFullYear();
        const hourStr = String(hours).padStart(2, '0');
        const minStr = String(minutes).padStart(2, '0');
        if (hours !== 0 || minutes !== 0) return `${day}/${month}/${year} ${hourStr}:${minStr}`;
        return `${year}-${month}-${day}`;
    }
    return String(serial).trim();
};

const toStr = (val) => {
    if (val === null || val === undefined) return "";
    return String(val).trim().toUpperCase();
};

const normalizeData = (obj) => {
    const cleanObj = {};
    Object.keys(obj).sort().forEach(key => {
        if (['STT', 'stt', 'id', 'workshop', 'lot_number', 'status', 'created_at', 'updated_at'].includes(key)) return;
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
    for (let key of allCotKeys) {
        if (toStr(obj1[key]) !== toStr(obj2[key])) return false;
    }
    return true;
};

// --- LOGIC XỬ LÝ (ASYNC/AWAIT CHO POSTGRES) ---
const processImportLogic = async (workshop, rows) => {
    let inserted = 0, skipped = 0, updated = 0;
    const client = await pool.connect(); // Lấy client từ pool để chạy transaction

    try {
        await client.query('BEGIN'); // Bắt đầu transaction

        for (const item of rows) {
            const { lot_number, data } = item;
            delete data['STT']; delete data['stt'];

            const newSig = normalizeData(data);
            const newDataFull = JSON.stringify(data);

            // Tìm trong DB (Dùng $1, $2 thay vì ?)
            const res = await client.query("SELECT id, data FROM orders WHERE workshop = $1 AND lot_number = $2", [workshop, lot_number]);
            const existingRecords = res.rows;
            
            let handled = false;

            for (const record of existingRecords) {
                const oldData = JSON.parse(record.data);
                if (isSameIdentity(oldData, data)) {
                    const oldSig = normalizeData(oldData);
                    if (oldSig === newSig) {
                        skipped++;
                    } else {
                        await client.query("UPDATE orders SET data = $1, updated_at = NOW() WHERE id = $2", [newDataFull, record.id]);
                        updated++;
                    }
                    handled = true;
                    break;
                }
            }

            if (!handled) {
                await client.query("INSERT INTO orders (workshop, lot_number, data, status) VALUES ($1, $2, $3, 'ACTIVE')", [workshop, lot_number, newDataFull]);
                inserted++;
            }
        }

        await client.query('COMMIT'); // Lưu thay đổi
    } catch (e) {
        await client.query('ROLLBACK'); // Hoàn tác nếu lỗi
        throw e;
    } finally {
        client.release(); // Trả client về pool
    }
    return { inserted, skipped, updated };
};

// --- API ROUTES (ASYNC) ---
app.get('/api/orders', async (req, res) => {
    const { workshop, status } = req.query;
    try {
        const result = await pool.query(`SELECT * FROM orders WHERE workshop = $1 AND status = $2 ORDER BY id ASC`, [workshop || 'AA', status || 'ACTIVE']);
        const rows = result.rows.map(row => ({
            id: row.id,
            workshop: row.workshop,
            lot_number: row.lot_number,
            status: row.status,
            updated_at: row.updated_at,
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
    try {
        await pool.query("DELETE FROM orders WHERE id = $1", [req.params.id]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/orders/:id/status', async (req, res) => {
    try {
        await pool.query("UPDATE orders SET status = $1, updated_at = NOW() WHERE id = $2", [req.body.status, req.params.id]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/export', async (req, res) => {
    try {
        const { workshop, status } = req.query;
        const result = await pool.query(`SELECT data, lot_number, updated_at FROM orders WHERE workshop = $1 AND status = $2`, [workshop, status]);
        const jsonData = result.rows.map((r, index) => {
            const parsed = JSON.parse(r.data || '{}');
            delete parsed['STT']; delete parsed['stt'];
            return { "STT": index + 1, "SỐ LÔ": r.lot_number, ...parsed };
        });

        const wb = new ExcelJS.Workbook();
        const worksheet = wb.addWorksheet('Data');

        const ORDER_KEYS = ["STT", "MÀU", "GHI CHÚ", "HỒI ẨM", "NGÀY XUỐNG ĐƠN", "SẢN PHẨM", "SỐ LÔ", "CHI SỐ", "SỐ LƯỢNG", "BẮT ĐẦU", "KẾT THÚC", "FU CUNG CÚI", "THỰC TẾ HOÀN THÀNH", "SO MÀU", "THAY ĐỔI", "LBS", "ghi chú", "ghi chú (1)"];
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
            const indexA = ORDER_KEYS.indexOf(a.toUpperCase());
            const indexB = ORDER_KEYS.indexOf(b.toUpperCase());
            if (indexA !== -1 && indexB !== -1) return indexA - indexB;
            if (indexA !== -1) return -1; if (indexB !== -1) return 1;
            const isCotA = a.startsWith('COT_'), isCotB = b.startsWith('COT_');
            if (isCotA && isCotB) return (parseInt(a.replace('COT_', '') || 0) - parseInt(b.replace('COT_', '') || 0));
            if (isCotA) return -1; if (isCotB) return 1;
            return a.localeCompare(b);
        });

        worksheet.columns = sortedKeys.map(key => ({ header: HEADER_MAP[key] || key, key: key }));
        worksheet.addRows(jsonData);

        const buffer = await wb.xlsx.writeBuffer();
        const dateStr = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit' }).replace('/', '');
        res.setHeader('Content-Disposition', `attachment; filename="${workshop}_${dateStr}.xlsx"`);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.send(buffer);
    } catch (e) { console.error(e); res.status(500).send(e.message); }
});

app.post('/api/import', upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).send("No file.");
    const filePath = req.file.path;

    try {
        const workshopType = req.query.workshop || 'AA';
        const isForce = req.query.force === 'true';

        const workbook = XLSX.readFile(filePath);
        const sheetName = workbook.SheetNames[0];
        const aoa = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: "" });

        let headerIdx = -1;
        for (let i = 0; i < Math.min(aoa.length, 30); i++) {
            if (JSON.stringify(aoa[i]).toUpperCase().includes('SỐ LÔ')) { headerIdx = i; break; }
        }

        if (headerIdx === -1) { fs.unlinkSync(filePath); return res.status(400).json({ error: "Lỗi file: Không tìm thấy cột SỐ LÔ" }); }

        const rawHeaders = aoa[headerIdx];
        if (!isForce) {
            const headerStr = JSON.stringify(rawHeaders).toUpperCase();
            const isOESignature = headerStr.includes("FU CUNG") || headerStr.includes("THỰC TẾ") || headerStr.includes("THUC TE");
            if (workshopType === 'OE' && !isOESignature) { fs.unlinkSync(filePath); return res.json({ warning: true, message: "Cảnh báo: Bạn đang ở OE nhưng file thiếu cột đặc thù." }); }
            if (workshopType !== 'OE' && isOESignature) { fs.unlinkSync(filePath); return res.json({ warning: true, message: `Cảnh báo: Bạn đang ở ${workshopType} nhưng file có cột OE.` }); }
        }

        const uniqueHeaders = [];
        const nameCount = {};

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
                if (upperName.includes('1')) name = 'GHI CHÚ';
                else if (upperName.includes('2')) name = 'ghi chú';
                else if (upperName.includes('3')) name = 'ghi chú (1)';
                else name = 'GHI CHÚ';
            }

            if (name === '' || name.startsWith('COT_')) { if (name === '') name = `COT_${index}`; }
            if (nameCount[name]) { nameCount[name]++; name = `${name} (${nameCount[name]})`; } else { nameCount[name] = 1; }
            uniqueHeaders.push(name);
        });

        const lotColIndex = uniqueHeaders.findIndex(h => h === 'SỐ LÔ');
        const processedRows = [];

        for (let i = headerIdx + 1; i < aoa.length; i++) {
            const rowData = aoa[i];
            const lotVal = rowData[lotColIndex];
            if (!lotVal || String(lotVal).trim() === '') continue;

            const rowObject = {};
            uniqueHeaders.forEach((header, index) => {
                const val = rowData[index];
                const isDateCol = /NGÀY|DATE|BẮT ĐẦU|KẾT THÚC|GIAO|THỜI GIAN/i.test(header);
                const isSerialNum = typeof val === 'number' && val > 25569 && val < 2958465;
                if (val && (isDateCol || isSerialNum)) { rowObject[header] = excelDateToJSDate(val); }
                else { rowObject[header] = typeof val === 'boolean' ? String(val).toUpperCase() : val; }
            });
            processedRows.push({ workshop: workshopType, lot_number: String(lotVal).trim(), data: rowObject });
        }

        const result = await processImportLogic(workshopType, processedRows);
        fs.unlinkSync(filePath);
        res.json({ success: true, ...result });

    } catch (e) {
        console.error(e);
        if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
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

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));