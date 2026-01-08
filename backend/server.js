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

// --- CẤU HÌNH CỘT CHÍNH THỐNG NHẤT VỚI FRONTEND ---
const MAIN_FIELDS = {
    'AA': [
        { key: 'MÀU', label: 'Màu' },
        { key: 'GHI CHÚ', label: 'Ghi chú 1' },
        { key: 'HỒI ẨM', label: 'Hồi ẩm' }, 
        { key: 'NGÀY XUỐNG ĐƠN', label: 'Ngày xuống đơn' },
        { key: 'SẢN PHẨM', label: 'Sản Phẩm' },
        { key: 'SỐ LÔ', label: 'Số Lô' },
        { key: 'CHI SỐ', label: 'Chi Số' },
        { key: 'SỐ LƯỢNG', label: 'Số Lượng' },
        { key: 'BẮT ĐẦU', label: 'Bắt đầu' },
        { key: 'KẾT THÚC', label: 'Kết Thúc' },
        { key: 'THAY ĐỔI', label: 'Thay Đổi' },
        { key: 'SO MÀU', label: 'So Màu' },
        { key: 'ghi chú', label: 'Ghi Chú 2' }, 
        { key: 'ghi chú (1)', label: 'Ghi Chú 3' },
        { key: 'updated_at', label: 'Cập Nhật' },
    ],
    'AB': [
        { key: 'MÀU', label: 'Màu' },
        { key: 'GHI CHÚ', label: 'Ghi chú 1' },
        { key: 'HỒI ẨM', label: 'Hồi ẩm' }, 
        { key: 'NGÀY XUỐNG ĐƠN', label: 'Ngày xuống đơn' },
        { key: 'SẢN PHẨM', label: 'Sản Phẩm' },
        { key: 'SỐ LÔ', label: 'Số Lô' },
        { key: 'CHI SỐ', label: 'Chi Số' },
        { key: 'SỐ LƯỢNG', label: 'Số Lượng' },
        { key: 'BẮT ĐẦU', label: 'Bắt đầu' },
        { key: 'KẾT THÚC', label: 'Kết Thúc' },
        { key: 'THAY ĐỔI', label: 'Thay Đổi' },
        { key: 'SO MÀU', label: 'So Màu' },
        { key: 'ghi chú', label: 'Ghi Chú 2' }, 
        { key: 'ghi chú (1)', label: 'Ghi Chú 3' },
        { key: 'updated_at', label: 'Cập Nhật' },
    ],
    'OE': [
        { key: 'MÀU', label: 'Màu' },
        { key: 'GHI CHÚ', label: 'Ghi chú 1' },
        { key: 'HỒI ẨM', label: 'Hồi ẩm' },
        { key: 'NGÀY XUỐNG ĐƠN', label: 'Ngày xuống đơn' },
        { key: 'SẢN PHẨM', label: 'Sản Phẩm' },
        { key: 'SỐ LÔ', label: 'Số Lô' },
        { key: 'CHI SỐ', label: 'Chi Số' },
        { key: 'SỐ LƯỢNG', label: 'Số Lượng' },
        { key: 'BẮT ĐẦU', label: 'Bắt đầu' },
        { key: 'KẾT THÚC', label: 'Kết Thúc' },
        { key: 'FU CUNG CÚI', label: 'Fu Cung Cúi' },
        { key: 'THỰC TẾ HOÀN THÀNH', label: 'Thực Tế' },
        { key: 'SO MÀU', label: 'So Màu' },
        { key: 'ghi chú', label: 'Ghi Chú 2' },
        { key: 'ghi chú (1)', label: 'Ghi Chú 3' },
        { key: 'updated_at', label: 'Cập Nhật' },
    ]
};

// --- 1. KẾT NỐI DATABASE VỚI CONNECTION POOLING TỐI ƯU ---
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
            connectionTimeoutMillis: 15000,
            max: 20, // Tăng số connection tối đa
            idleTimeoutMillis: 30000,
            allowExitOnIdle: false
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
        CREATE INDEX IF NOT EXISTS idx_workshop_status ON orders(workshop, status);
        CREATE INDEX IF NOT EXISTS idx_lot_number ON orders(lot_number);
    `;
    try { 
        await pool.query(createTableQuery); 
        console.log("✅ Đã kiểm tra bảng orders và index."); 
    } catch (err) { 
        console.error("❌ Lỗi tạo bảng:", err); 
    }
};

// --- HELPER: FORMAT & CHUẨN HÓA DỮ LIỆU ---
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
    // Excel Serial
    if (typeof val === 'number' && val > 25569 && val < 2958465) {
        const utc_days = Math.floor(val - 25569);
        const date_info = new Date(utc_days * 86400 * 1000);
        const year = date_info.getFullYear();
        const month = String(date_info.getMonth() + 1).padStart(2, '0');
        const day = String(date_info.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }
    // String DD/MM/YYYY -> YYYY-MM-DD
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

const toStr = (val) => { 
    if (val === null || val === undefined) return ""; 
    return String(val).trim().toUpperCase(); 
};

const normalizeData = (obj) => {
    const cleanObj = {};
    Object.keys(obj).sort().forEach(key => {
        if (['STT', 'stt', 'id', 'workshop', 'lot_number', 'status', 'created_at', 'updated_at', 'SKIP_UPDATE', 'Ngày Cập Nhật'].includes(key)) return;
        if (key.startsWith('Hội ẩm (')) return;
        let val = toStr(obj[key]);
        if (val !== "") cleanObj[key] = val;
    });
    return JSON.stringify(cleanObj);
};

// --- LOGIC ĐỊNH DANH (IDENTITY CHECK) ---
const isIdentityMatch = (dbData, excelData) => {
    const keys = ['SẢN PHẨM', 'MÀU', 'CHI SỐ'];
    for (const key of keys) {
        if (toStr(dbData[key]) !== toStr(excelData[key])) return false;
    }
    return true; 
};

// --- XỬ LÝ IMPORT BATCH VỚI TRANSACTION TỐI ƯU ---
const processImportLogic = async (workshop, rows) => {
    let inserted = 0, skipped = 0, updated = 0;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        // Gom nhóm theo Số Lô
        const rowsByLot = {};
        for(const item of rows) {
            const lot = item.lot_number;
            if(!rowsByLot[lot]) rowsByLot[lot] = [];
            rowsByLot[lot].push(item);
        }

        // Lấy tất cả records một lần (tối ưu query)
        const allLots = Object.keys(rowsByLot);
        const res = await client.query(
            "SELECT id, lot_number, data FROM orders WHERE workshop = $1 AND lot_number = ANY($2)", 
            [workshop, allLots]
        );
        
        // Index records theo lot_number để tra cứu nhanh
        const dbRecordsByLot = {};
        res.rows.forEach(r => {
            if (!dbRecordsByLot[r.lot_number]) dbRecordsByLot[r.lot_number] = [];
            dbRecordsByLot[r.lot_number].push({
                id: r.id,
                lot_number: r.lot_number,
                parsedData: JSON.parse(r.data)
            });
        });

        // Xử lý từng lot
        for (const lot of allLots) {
            const excelItems = rowsByLot[lot];
            const dbRecords = dbRecordsByLot[lot] || [];
            const usedDbIds = new Set();

            for (const item of excelItems) {
                const { data } = item;
                delete data['STT']; 
                delete data['stt']; 
                delete data['SKIP_UPDATE']; 
                delete data['updated_at']; 
                delete data['Ngày Cập Nhật'];

                const newSig = normalizeData(data);
                const newDataFull = JSON.stringify(data);
                let matchFound = false;
                
                // 1. Tìm trùng 100%
                for (const dbRecord of dbRecords) {
                    if (usedDbIds.has(dbRecord.id)) continue;
                    const oldSig = normalizeData(dbRecord.parsedData);
                    if (oldSig === newSig) {
                        usedDbIds.add(dbRecord.id);
                        skipped++;
                        matchFound = true;
                        break;
                    }
                }
                
                if (matchFound) continue;

                // 2. Tìm cùng định danh
                for (const dbRecord of dbRecords) {
                    if (usedDbIds.has(dbRecord.id)) continue;
                    if (isIdentityMatch(dbRecord.parsedData, data)) {
                        await client.query(
                            "UPDATE orders SET data = $1, updated_at = NOW() WHERE id = $2", 
                            [newDataFull, dbRecord.id]
                        );
                        usedDbIds.add(dbRecord.id);
                        updated++;
                        matchFound = true;
                        break;
                    }
                }

                if (matchFound) continue;

                // 3. Insert mới
                await client.query(
                    "INSERT INTO orders (workshop, lot_number, data, status) VALUES ($1, $2, $3, 'ACTIVE')", 
                    [workshop, lot, newDataFull]
                );
                inserted++;
            }
        }
        
        await client.query('COMMIT');
    } catch (e) { 
        await client.query('ROLLBACK'); 
        throw e; 
    } finally { 
        client.release(); 
    }
    return { inserted, skipped, updated };
};

// --- API ROUTES ---
app.get('/api/orders', async (req, res) => {
    const { workshop, status } = req.query;
    try {
        const result = await pool.query(
            `SELECT * FROM orders WHERE workshop = $1 AND status = $2 ORDER BY id ASC`, 
            [workshop || 'AA', status || 'ACTIVE']
        );
        const rows = result.rows.map(row => ({
            id: row.id, 
            workshop: row.workshop, 
            lot_number: row.lot_number, 
            status: row.status, 
            updated_at: row.updated_at,
            ...JSON.parse(row.data || '{}')
        }));
        res.json(rows);
    } catch (e) { 
        res.status(500).json({ error: e.message }); 
    }
});

app.post('/api/orders', async (req, res) => {
    const { workshop, lot_number, data } = req.body;
    try {
        const cleanLot = String(lot_number).trim();
        const singleItem = [{ workshop, lot_number: cleanLot, data }];
        const result = await processImportLogic(workshop, singleItem);
        res.json({ success: true, ...result });
    } catch (e) { 
        res.status(500).json({ error: e.message }); 
    }
});

app.put('/api/orders/:id', async (req, res) => {
    const { id } = req.params;
    const { id: _id, workshop, lot_number, status, created_at, updated_at, ...excelData } = req.body;
    try {
        await pool.query(
            'UPDATE orders SET data = $1, updated_at = NOW() WHERE id = $2', 
            [JSON.stringify(excelData), id]
        );
        res.json({ success: true });
    } catch (e) { 
        res.status(500).json({ error: e.message }); 
    }
});

app.delete('/api/orders/:id', async (req, res) => {
    try { 
        await pool.query("DELETE FROM orders WHERE id = $1", [req.params.id]); 
        res.json({ success: true }); 
    } catch (e) { 
        res.status(500).json({ error: e.message }); 
    }
});

app.patch('/api/orders/:id/status', async (req, res) => {
    try { 
        await pool.query(
            "UPDATE orders SET status = $1, updated_at = NOW() WHERE id = $2", 
            [req.body.status, req.params.id]
        ); 
        res.json({ success: true }); 
    } catch (e) { 
        res.status(500).json({ error: e.message }); 
    }
});

// --- API EXPORT - KHỚP 100% VỚI GIAO DIỆN ---
app.get('/api/export', async (req, res) => {
    try {
        const { workshop, status, colConfig } = req.query;
        const currentWorkshop = workshop || 'AA';
        
        // 1. Parse cấu hình cột từ Client gửi lên
        let columnsDef = [];
        try {
            if (colConfig) {
                columnsDef = JSON.parse(colConfig);
            }
        } catch (e) {
            console.error("Lỗi parse colConfig", e);
        }

        // Nếu không có config từ client (trường hợp fallback), dùng config mặc định server
        if (columnsDef.length === 0) {
             const workshopFields = MAIN_FIELDS[currentWorkshop] || MAIN_FIELDS['AA'];
             columnsDef = [
                 { key: 'STT', header: 'STT' },
                 ...workshopFields.map(f => ({ key: f.key, header: f.label }))
             ];
        }

        // 2. Query dữ liệu
        const result = await pool.query(
            `SELECT * FROM orders WHERE workshop = $1 AND status = $2 ORDER BY id ASC`, 
            [currentWorkshop, status]
        );

        // 3. Chuẩn bị dữ liệu Excel
        const wb = new ExcelJS.Workbook();
        const worksheet = wb.addWorksheet(currentWorkshop);

        // Định nghĩa cột cho ExcelJS dựa trên columnsDef
        worksheet.columns = columnsDef.map(col => ({
            header: col.header,
            key: col.key,
            width: col.key === 'STT' ? 6 : (String(col.header).length > 15 ? 25 : 15)
        }));

        // Map dữ liệu vào từng dòng
        const rowsToAdd = result.rows.map((row, index) => {
            const parsedData = JSON.parse(row.data || '{}');
            const rowObject = {};

            columnsDef.forEach(col => {
                const key = col.key;
                
                // Xử lý các trường đặc biệt
                if (key === 'STT') {
                    rowObject[key] = index + 1;
                } 
                else if (key === 'updated_at') {
                    rowObject[key] = row.updated_at ? formatDateTimeVN(row.updated_at) : '';
                } 
                else if (key === 'SỐ LÔ') {
                    // Ưu tiên lấy từ root record, nếu không có thì tìm trong json data
                    rowObject[key] = row.lot_number || parsedData['SỐ LÔ'] || '';
                } 
                else {
                    // Lấy dữ liệu từ JSON data
                    // Cần xử lý trường hợp key khác nhau chút (ví dụ chữ hoa thường) nếu cần, 
                    // nhưng logic hiện tại key đã đồng bộ từ frontend.
                    let val = parsedData[key];
                    if (val === undefined || val === null) val = '';
                    rowObject[key] = val;
                }
            });
            return rowObject;
        });

        worksheet.addRows(rowsToAdd);

        // 4. Định dạng (Style) - Giữ nguyên logic đẹp như cũ
        const fontStyle = { name: 'Times New Roman', size: 12 };
        const borderStyle = { 
            top: { style: 'thin' }, 
            left: { style: 'thin' }, 
            bottom: { style: 'thin' }, 
            right: { style: 'thin' } 
        };
        const alignStyle = { 
            vertical: 'middle', 
            horizontal: 'center', 
            wrapText: true 
        }; 

        worksheet.eachRow((row, rowNumber) => {
            row.eachCell((cell) => { 
                cell.font = fontStyle; 
                cell.border = borderStyle; 
                cell.alignment = alignStyle; 
            });
            
            // Header Style
            if (rowNumber === 1) { 
                row.height = 30;
                row.eachCell((cell) => { 
                    cell.font = { 
                        ...fontStyle, 
                        bold: true, 
                        color: { argb: 'FFFFFFFF' } 
                    }; 
                    cell.fill = { 
                        type: 'pattern', 
                        pattern: 'solid', 
                        fgColor: { argb: 'FF1F4E78' } // Màu xanh đậm như file mẫu
                    }; 
                });
            }
        });

        // 5. Gửi file về client
        const buffer = await wb.xlsx.writeBuffer();
        res.setHeader('Content-Disposition', `attachment; filename="${currentWorkshop}_Export.xlsx"`);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.send(buffer);

    } catch (e) { 
        console.error(e); 
        res.status(500).send(e.message); 
    }
});

// --- API IMPORT ĐA SHEET TỐI ƯU ---
app.post('/api/import', upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).send("No file.");
    const filePath = req.file.path;
    
    try {
        const workbook = XLSX.readFile(filePath, { 
            cellDates: true,
            cellNF: false,
            cellText: false
        });
        
        const sheetNames = workbook.SheetNames;
        let totalInserted = 0; 
        let totalUpdated = 0; 
        let totalSkipped = 0; 
        let processedSheets = [];

        console.log(`📂 Bắt đầu xử lý file với ${sheetNames.length} sheets...`);

        for (const sheetName of sheetNames) {
            const aoa = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { 
                header: 1, 
                defval: "",
                raw: false // Convert tất cả về string
            });
            
            // Tìm header
            let headerIdx = -1;
            for (let i = 0; i < Math.min(aoa.length, 50); i++) { 
                const rowStr = JSON.stringify(aoa[i]).toUpperCase();
                if (rowStr.includes('SỐ LÔ') || rowStr.includes('SO LO')) { 
                    headerIdx = i; 
                    break; 
                } 
            }
            
            if (headerIdx === -1) {
                console.log(`⚠️ Bỏ qua sheet "${sheetName}" - Không tìm thấy header`);
                continue;
            }

            // Xác định workshop
            let currentWorkshop = 'AA';
            const nameUp = sheetName.toUpperCase();
            if (nameUp.includes('AA')) currentWorkshop = 'AA';
            else if (nameUp.includes('AB')) currentWorkshop = 'AB';
            else if (nameUp.includes('OE')) currentWorkshop = 'OE';

            // Map headers
            const rawHeaders = aoa[headerIdx];
            const mappedHeaders = [];
            let noteCounter = 0;

            rawHeaders.forEach((h, index) => {
                let name = (h && String(h).trim() !== '') ? String(h).trim() : '';
                const upperName = name.toUpperCase();
                
                if (upperName.includes('SỐ LÔ') || upperName.includes('SO LO')) name = 'SỐ LÔ';
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
                else if (name === '' || name.startsWith('COT_')) { 
                    if (name === '') name = `COT_${index}`; 
                }

                mappedHeaders.push(name);
            });

            const lotColIndex = mappedHeaders.findIndex(h => h === 'SỐ LÔ');
            if (lotColIndex === -1) {
                console.log(`⚠️ Bỏ qua sheet "${sheetName}" - Không có cột Số Lô`);
                continue;
            }

            const processedRows = [];

            // Parse rows
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
                    
                    if (val && (isDateCol || isSerialNum)) { 
                        rowObject[header] = normalizeDateValue(val); 
                    } else { 
                        rowObject[header] = typeof val === 'boolean' ? String(val).toUpperCase() : val; 
                    }
                });
                
                processedRows.push({ 
                    workshop: currentWorkshop, 
                    lot_number: String(lotVal).trim(), 
                    data: rowObject 
                });
            }

            if (processedRows.length > 0) {
                const result = await processImportLogic(currentWorkshop, processedRows);
                totalInserted += result.inserted; 
                totalUpdated += result.updated; 
                totalSkipped += result.skipped;
                processedSheets.push(sheetName);
                console.log(`✅ Sheet "${sheetName}": +${result.inserted} ~${result.updated} =${result.skipped}`);
            }
        }

        fs.unlinkSync(filePath);
        res.json({ 
            success: true, 
            message: `Đã xử lý ${processedSheets.length} sheets.`, 
            inserted: totalInserted, 
            updated: totalUpdated, 
            skipped: totalSkipped 
        });
    } catch (e) { 
        console.error('❌ Lỗi import:', e); 
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath); 
        res.status(500).json({ error: e.message }); 
    }
});

app.post('/api/orders/batch', async (req, res) => {
    const { items } = req.body;
    if (!items || !Array.isArray(items)) return res.status(400).json({ error: "Data error" });
    
    try {
        const workshop = items[0]?.workshop || 'AA';
        const cleanedItems = items.map(i => ({ 
            ...i, 
            lot_number: String(i.lot_number).trim() 
        }));
        const result = await processImportLogic(workshop, cleanedItems);
        res.json({ success: true, ...result });
    } catch (e) { 
        res.status(500).json({ error: e.message }); 
    }
});

app.get('/health', (req, res) => { 
    res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        connections: pool.totalCount,
        idle: pool.idleCount,
        waiting: pool.waitingCount
    }); 
});

const PORT = process.env.PORT || 3001;
initPool().then(() => { 
    app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`)); 
}).catch(err => { 
    console.error('❌ Không thể khởi động server:', err); 
    process.exit(1); 
});