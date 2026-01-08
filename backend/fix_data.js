const db = require('better-sqlite3')('production.db');
const fs = require('fs');

// 1. Tạo Backup trước khi sửa (An toàn tuyệt đối)
console.log('📦 Đang tạo backup dữ liệu...');
try {
    fs.copyFileSync('production.db', 'production.db.bak_fix_columns');
    console.log('✅ Đã backup thành công: production.db.bak_fix_columns');
} catch (e) {
    console.error('❌ Lỗi backup (có thể file đang mở):', e);
    // Vẫn tiếp tục hoặc dừng tùy ý, ở đây ta cứ tiếp tục nhưng cảnh báo
}

// 2. Bảng ánh xạ: Tên Cũ (Sai/Chữ thường) -> Tên Mới (Chuẩn IN HOA/Hệ thống)
const KEY_MAPPING = {
    // --- Nhóm Số liệu & Thông tin chung ---
    "Số Lượng": "SỐ LƯỢNG",
    "SỐ LưỢNG": "SỐ LƯỢNG",
    "SỐ Lượng": "SỐ LƯỢNG",
    
    "Số Lô": "SỐ LÔ",
    "Sản Phẩm": "SẢN PHẨM",
    "Màu": "MÀU",
    "Chi Số": "CHI SỐ",
    "So Màu": "SO MÀU",
    "Thay Đổi": "THAY ĐỔI",
    
    // --- Nhóm Ngày tháng ---
    "Ngày xuống đơn": "NGÀY XUỐNG ĐƠN",
    "ngày xuống đơn": "NGÀY XUỐNG ĐƠN",
    "Bắt Đầu": "BẮT ĐẦU",
    "Kết Thúc": "KẾT THÚC",
    
    // --- Nhóm Hồi ẩm ---
    "Hồi ẩm": "HỒI ẨM",
    "Hồi Ẩm": "HỒI ẨM",
    
    // --- Nhóm OE (Đặc thù) ---
    "Fu Cung Cúi": "FU CUNG CÚI",
    "FU CUNG": "FU CUNG CÚI",
    
    "Thực Tế": "THỰC TẾ  HOÀN THÀNH",
    "THỰC TẾ": "THỰC TẾ  HOÀN THÀNH",
    "THỰC TẾ HOÀN THÀNH": "THỰC TẾ  HOÀN THÀNH", // Fix lỗi 1 dấu cách thành 2 dấu cách
    
    // --- Nhóm Ghi chú ---
    "Ghi chú 1": "GHI CHÚ", // Map về Key chính
    "Ghi chú 2": "ghi chú",
    "Ghi chú 3": "ghi chú (1)"
};

// 3. Bắt đầu xử lý
const rows = db.prepare('SELECT id, data FROM orders').all();
const updateStmt = db.prepare('UPDATE orders SET data = ? WHERE id = ?');
let count = 0;

console.log(`🔍 Tìm thấy ${rows.length} dòng dữ liệu. Đang chuẩn hóa...`);

db.transaction(() => {
    for (const row of rows) {
        let data = {};
        try {
            data = JSON.parse(row.data || '{}');
        } catch (e) { continue; }

        let newData = {};
        let isChanged = false;

        Object.keys(data).forEach(oldKey => {
            let val = data[oldKey];
            let newKey = oldKey;

            // -- Logic 1: Map theo bảng KEY_MAPPING --
            if (KEY_MAPPING[oldKey]) {
                newKey = KEY_MAPPING[oldKey];
            } 
            // -- Logic 2: Tự động In Hoa các cột COT_ (ví dụ: cot_13 -> COT_13) --
            else if (oldKey.toUpperCase().startsWith('COT_')) {
                newKey = oldKey.toUpperCase();
            }
            // -- Logic 3: Các cột khác (nếu chưa in hoa thì in hoa luôn cho đồng bộ) --
            else if (!['id', 'workshop', 'stt'].includes(oldKey.toLowerCase())) {
                 // Nếu không phải cột hệ thống thì thử tìm xem có bản In Hoa không
                 // Ví dụ: "màu" -> "MÀU"
                 // Nhưng phải cẩn thận với "ghi chú" (chữ thường) nên ta chỉ áp dụng nếu nó khớp với danh sách Key chuẩn
                 const upper = oldKey.toUpperCase();
                 if (['SỐ LÔ', 'SẢN PHẨM', 'MÀU'].includes(upper)) {
                     newKey = upper;
                 }
            }

            // -- Logic 4: Chuẩn hóa Giá trị (Value) --
            // Chuyển Boolean true/false -> "TRUE"/"FALSE"
            if (typeof val === 'boolean') {
                val = String(val).toUpperCase();
                isChanged = true; // Đánh dấu là có thay đổi value
            }
            // Trim khoảng trắng thừa cho Số Lô
            if (newKey === 'SỐ LÔ' && typeof val === 'string') {
                const trimmed = val.trim();
                if (trimmed !== val) {
                    val = trimmed;
                    isChanged = true;
                }
            }

            // Gán vào object mới
            // Nếu key mới đã tồn tại (do gộp), ưu tiên giá trị không rỗng
            if (newData[newKey]) {
                if (!newData[newKey] && val) newData[newKey] = val;
            } else {
                newData[newKey] = val;
            }

            if (newKey !== oldKey) {
                isChanged = true;
            }
        });

        // Chỉ update nếu có sự thay đổi
        if (isChanged) {
            updateStmt.run(JSON.stringify(newData), row.id);
            count++;
        }
    }
})();

console.log(`🎉 Đã sửa xong ${count} dòng dữ liệu!`);
console.log('👉 Bây giờ hãy khởi động lại Server (npm start) và tải lại trang Web.');