require('dotenv').config(); // Đọc biến môi trường từ file .env
const XLSX = require('xlsx');
const { Pool } = require('pg'); // Dùng thư viện Postgres
const fs = require('fs');

const FILE_PATH = './đơn hàng.xlsx';

// --- KẾT NỐI SUPABASE ---
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false } // Bắt buộc cho Supabase
});

// --- HÀM XỬ LÝ NGÀY GIỜ ---
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

const initDB = async () => {
    const client = await pool.connect();
    try {
        console.log("🗑️  Đang XÓA bảng cũ trên Cloud...");
        await client.query("DROP TABLE IF EXISTS orders");
        
        console.log("🛠️  Đang TẠO bảng mới trên Cloud...");
        // Cú pháp Postgres khác SQLite một chút (SERIAL, TIMESTAMP)
        await client.query(`
            CREATE TABLE orders (
                id SERIAL PRIMARY KEY,
                workshop TEXT,
                lot_number TEXT,
                data TEXT,
                status TEXT DEFAULT 'ACTIVE',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log("✅ Database trên Cloud đã sẵn sàng.");
    } catch (e) {
        console.error("❌ Lỗi khởi tạo DB:", e);
    } finally {
        client.release();
    }
};

const importExcel = async (filePath) => {
    if (!fs.existsSync(filePath)) return console.log(`❌ Không tìm thấy file: ${filePath}`);
    
    // Reset DB trước khi nạp
    await initDB();

    const workbook = XLSX.readFile(filePath);
    const TARGET_SHEETS = [
        { name: 'AA mới', type: 'AA' },
        { name: 'AB mới', type: 'AB' }, 
        { name: 'OE', type: 'OE' }
    ];

    let totalCount = 0;
    const client = await pool.connect();

    try {
        // Bắt đầu Transaction (để đảm bảo an toàn dữ liệu)
        await client.query('BEGIN');

        for (const target of TARGET_SHEETS) {
            const sheetName = workbook.SheetNames.find(s => s.trim().toUpperCase() === target.name.toUpperCase());
            if (!sheetName) {
                console.log(`⚠️ Không tìm thấy sheet: "${target.name}"`);
                continue;
            }
            console.log(`📂 Đang xử lý: ${sheetName} -> ${target.type}...`);
            
            const aoa = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: "" });
            let headerIdx = -1;
            for(let i=0; i < Math.min(aoa.length, 30); i++) {
                if(JSON.stringify(aoa[i]).toUpperCase().includes('SỐ LÔ')) { headerIdx = i; break; }
            }
            
            if (headerIdx === -1) {
                console.log(`⚠️ Bỏ qua ${sheetName}: Không có cột SỐ LÔ`);
                continue;
            }

            const rawHeaders = aoa[headerIdx];
            const mappedHeaders = [];
            const nameCount = {};
            let noteCounter = 0;

            // --- LOGIC MAP HEADER ---
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
                else if (upperName.includes('FU CUNG')) name = 'FU CUNG CÚI';
                else if (upperName.includes('THỰC TẾ')) name = 'THỰC TẾ HOÀN THÀNH';
                else if (upperName.includes('HỒI ẨM') || upperName.includes('MOISTURE')) name = 'HỒI ẨM';
                else if (upperName.includes('NGÀY') && upperName.includes('ĐƠN')) name = 'NGÀY XUỐNG ĐƠN';
                else if (upperName.includes('GHI CHÚ')) {
                    noteCounter++;
                    if (noteCounter === 1) name = 'GHI CHÚ';
                    else if (noteCounter === 2) name = 'ghi chú';
                    else if (noteCounter === 3) name = 'ghi chú (1)';
                    else name = `GHI CHÚ (${noteCounter})`;
                }

                if (name === '' || name.startsWith('COT_')) name = name || `COT_${index}`;
                if (nameCount[name]) { nameCount[name]++; name = `${name} (${nameCount[name]})`; } else { nameCount[name] = 1; }
                mappedHeaders.push(name);
            });

            const lotColIndex = mappedHeaders.findIndex(h => h === 'SỐ LÔ');

            // --- DUYỆT VÀ INSERT ---
            for (let i = headerIdx + 1; i < aoa.length; i++) {
                const rowData = aoa[i];
                const lotVal = rowData[lotColIndex];
                if (!lotVal || String(lotVal).trim() === '') continue;

                const rowObject = {};
                mappedHeaders.forEach((header, index) => {
                    const val = rowData[index];
                    const isDateCol = /NGÀY|DATE|BẮT ĐẦU|KẾT THÚC|GIAO|THỜI GIAN/i.test(header);
                    const isSerialNum = typeof val === 'number' && val > 25569 && val < 2958465;

                    if (val && (isDateCol || isSerialNum)) {
                        rowObject[header] = excelDateToJSDate(val);
                    } else {
                        if (typeof val === 'boolean') rowObject[header] = String(val).toUpperCase();
                        else rowObject[header] = val;
                    }
                });
                delete rowObject['STT']; delete rowObject['stt'];

                // Insert vào Cloud DB
                const queryText = `INSERT INTO orders (workshop, lot_number, data, status) VALUES ($1, $2, $3, 'ACTIVE')`;
                const queryValues = [target.type, String(lotVal).trim(), JSON.stringify(rowObject)];
                
                await client.query(queryText, queryValues);
                totalCount++;
            }
        }

        await client.query('COMMIT');
        console.log(`🎉 TỔNG CỘNG: Đã đẩy ${totalCount} dòng lên Supabase thành công!`);

    } catch (e) {
        await client.query('ROLLBACK');
        console.error("❌ Lỗi Import, đã hoàn tác:", e);
    } finally {
        client.release();
        pool.end(); // Đóng kết nối
    }
};

importExcel(FILE_PATH);