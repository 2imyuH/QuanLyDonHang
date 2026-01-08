const XLSX = require('xlsx');
const db = require('better-sqlite3')('production.db');
const fs = require('fs');

const FILE_PATH = './đơn hàng.xlsx'; 

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

const initDB = () => {
    console.log("🗑️  Đang xóa dữ liệu cũ...");
    db.exec("DROP TABLE IF EXISTS orders");
    db.exec(`CREATE TABLE orders (id INTEGER PRIMARY KEY AUTOINCREMENT, workshop TEXT, lot_number TEXT, data TEXT, status TEXT DEFAULT 'ACTIVE', created_at DATETIME DEFAULT CURRENT_TIMESTAMP);`);
    console.log("✅ Đã tạo lại Database sạch sẽ.");
};

const importExcel = (filePath) => {
    if (!fs.existsSync(filePath)) return console.log(`❌ Không tìm thấy file: ${filePath}`);
    const workbook = XLSX.readFile(filePath);
    const TARGET_SHEETS = [{ name: 'AA mới', type: 'AA' }, { name: 'AB mới', type: 'AB' }, { name: 'OE', type: 'OE' }];
    const stmt = db.prepare(`INSERT INTO orders (workshop, lot_number, data, status) VALUES (@workshop, @lot, @data, 'ACTIVE')`);
    const transaction = db.transaction((items) => { for (const item of items) stmt.run(item); });
    let allItems = [];

    TARGET_SHEETS.forEach(target => {
        const sheetName = workbook.SheetNames.find(s => s.trim().toUpperCase() === target.name.toUpperCase());
        if (!sheetName) return console.log(`⚠️ Không tìm thấy sheet: "${target.name}"`);
        console.log(`📂 Đang xử lý: ${sheetName} -> ${target.type}...`);
        
        const aoa = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: "" }); // defval="" để giữ cột
        let headerIdx = -1;
        for(let i=0; i < Math.min(aoa.length, 30); i++) {
            if(JSON.stringify(aoa[i]).toUpperCase().includes('SỐ LÔ')) { headerIdx = i; break; }
        }
        if (headerIdx === -1) return console.log(`⚠️ Bỏ qua ${sheetName}: Không có cột SỐ LÔ`);

        const rawHeaders = aoa[headerIdx];
        const mappedHeaders = [];
        const nameCount = {};
        
        // BIẾN ĐẾM RIÊNG CHO GHI CHÚ
        let noteCounter = 0; 

        rawHeaders.forEach((h, index) => {
            let name = (h && String(h).trim() !== '') ? String(h).trim() : ''; 
            const upperName = name.toUpperCase();

            // 1. MAP CÁC CỘT CHÍNH
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
            
            // 2. XỬ LÝ GHI CHÚ (QUAN TRỌNG: MAP CỨNG THEO TỪ KHÓA HOẶC THỨ TỰ)
            else if (upperName.includes('GHI CHÚ')) {
                // Nếu header có số rõ ràng (Ghi chú 1, Ghi chú 2...)
                if (upperName.includes('1')) name = 'GHI CHÚ';
                else if (upperName.includes('2')) name = 'ghi chú';
                else if (upperName.includes('3')) name = 'ghi chú (1)';
                else {
                    // Nếu chỉ là "Ghi chú" chung chung -> Tự động tăng
                    noteCounter++;
                    if (noteCounter === 1) name = 'GHI CHÚ';
                    else if (noteCounter === 2) name = 'ghi chú';
                    else if (noteCounter === 3) name = 'ghi chú (1)';
                    else name = 'GHI CHÚ'; // Fallback
                }
            }

            // 3. CỘT TRỐNG -> COT_...
            if (name === '' || name.startsWith('COT_')) name = name || `COT_${index}`;
            
            // 4. XỬ LÝ TRÙNG LẶP CHO CÁC CỘT KHÁC (Trừ các cột đã map key chuẩn)
            const SYSTEM_KEYS = ['GHI CHÚ', 'ghi chú', 'ghi chú (1)', 'SỐ LÔ', 'SẢN PHẨM', 'MÀU', 'SO MÀU', 'CHI SỐ', 'SỐ LƯỢNG', 'BẮT ĐẦU', 'KẾT THÚC', 'THAY ĐỔI', 'FU CUNG CÚI', 'THỰC TẾ HOÀN THÀNH', 'HỒI ẨM', 'NGÀY XUỐNG ĐƠN'];
            
            if (!SYSTEM_KEYS.includes(name)) {
                if (nameCount[name]) { nameCount[name]++; name = `${name} (${nameCount[name]})`; } 
                else { nameCount[name] = 1; }
            }
            
            mappedHeaders.push(name);
        });

        const lotColIndex = mappedHeaders.findIndex(h => h === 'SỐ LÔ');

        const sheetItems = [];
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
            sheetItems.push({ workshop: target.type, lot: String(lotVal).trim(), data: JSON.stringify(rowObject) });
        }
        allItems = allItems.concat(sheetItems);
        console.log(`   -> Tìm thấy ${sheetItems.length} dòng.`);
    });

    if(allItems.length > 0) { transaction(allItems); console.log(`✅ TỔNG: Đã import ${allItems.length} dòng.`); }
    else { console.log("⚠️ Không có dữ liệu."); }
};

try { initDB(); importExcel(FILE_PATH); } catch (e) { console.error(e); }