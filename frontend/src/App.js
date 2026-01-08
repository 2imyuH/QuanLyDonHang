import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Layout, Table, Tabs, Button, Form, Input, Popconfirm, Select, message, Space, Modal, Row, Col, Tag, Card, Divider, Tooltip, DatePicker, Upload, notification, Grid } from 'antd'; // Thêm Grid
import { CheckCircleOutlined, RollbackOutlined, EditOutlined, DeleteOutlined, FileExcelOutlined, PlusOutlined, QuestionCircleOutlined, SearchOutlined, DownloadOutlined, UploadOutlined, SnippetsOutlined, WarningOutlined } from '@ant-design/icons';
import axios from 'axios';
import dayjs from 'dayjs';

const { Header, Content } = Layout;
const { Option } = Select;
const { TextArea } = Input;
const { useBreakpoint } = Grid; // Hook để check màn hình

// === CẤU HÌNH API URL ===
const API_URL = 'https://quanlydonhang-f6xq.onrender.com';

const App = () => {
  const screens = useBreakpoint(); // Lấy kích thước màn hình hiện tại (xs, sm, md, lg...)
  
  const [activeWorkshop, setActiveWorkshop] = useState('AA');
  const [activeStatus, setActiveStatus] = useState('ACTIVE');
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [dataCache, setDataCache] = useState({});

  const [inputValue, setInputValue] = useState('');
  const [searchText, setSearchText] = useState('');
  
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [editingRecord, setEditingRecord] = useState(null);
  const [form] = Form.useForm();

  const [isPasteModalVisible, setIsPasteModalVisible] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [previewData, setPreviewData] = useState([]);

  useEffect(() => { setInputValue(''); setSearchText(''); }, [activeWorkshop]);
  useEffect(() => { const t = setTimeout(() => setSearchText(inputValue), 600); return () => clearTimeout(t); }, [inputValue]);

  // --- CẤU HÌNH CỘT CHÍNH ---
  const MAIN_FIELDS = useMemo(() => ({
    'AA': [
      { key: 'MÀU', label: 'Màu', span: 6 },
      { key: 'GHI CHÚ', label: 'Ghi chú 1', span: 12, type: 'area' },
      { key: 'HỒI ẨM', label: 'Hồi ẩm', span: 6 }, 
      { key: 'NGÀY XUỐNG ĐƠN', label: 'Ngày xuống đơn', span: 8, type: 'date' },
      { key: 'SẢN PHẨM', label: 'Sản Phẩm', span: 16 },
      { key: 'SỐ LÔ', label: 'Số Lô', span: 12, required: true },
      { key: 'CHI SỐ', label: 'Chi Số', span: 6 },
      { key: 'SỐ LƯỢNG', label: 'Số Lượng', span: 6 },
      { key: 'BẮT ĐẦU', label: 'Bắt Đầu', span: 12, type: 'date' },
      { key: 'KẾT THÚC', label: 'Kết Thúc', span: 12, type: 'date' },
      { key: 'THAY ĐỔI', label: 'Thay Đổi', span: 12 },
      { key: 'SO MÀU', label: 'So Màu', span: 12 },
      { key: 'ghi chú', label: 'Ghi Chú 2', span: 12, type: 'area' }, 
      { key: 'ghi chú (1)', label: 'Ghi Chú 3', span: 12, type: 'area' },
      { key: 'updated_at', label: 'Cập Nhật', span: 12 },
    ],
    'AB': [
      { key: 'MÀU', label: 'Màu', span: 6 },
      { key: 'GHI CHÚ', label: 'Ghi chú 1', span: 12, type: 'area' },
      { key: 'HỒI ẨM', label: 'Hồi ẩm', span: 6 }, 
      { key: 'NGÀY XUỐNG ĐƠN', label: 'Ngày xuống đơn', span: 8, type: 'date' },
      { key: 'SẢN PHẨM', label: 'Sản Phẩm', span: 16 },
      { key: 'SỐ LÔ', label: 'Số Lô', span: 12, required: true },
      { key: 'CHI SỐ', label: 'Chi Số', span: 6 },
      { key: 'SỐ LƯỢNG', label: 'Số Lượng', span: 6 },
      { key: 'BẮT ĐẦU', label: 'Bắt Đầu', span: 12, type: 'date' },
      { key: 'KẾT THÚC', label: 'Kết Thúc', span: 12, type: 'date' },
      { key: 'THAY ĐỔI', label: 'Thay Đổi', span: 12 },
      { key: 'SO MÀU', label: 'So Màu', span: 12 },
      { key: 'ghi chú', label: 'Ghi Chú 2', span: 12, type: 'area' }, 
      { key: 'ghi chú (1)', label: 'Ghi Chú 3', span: 12, type: 'area' },
      { key: 'updated_at', label: 'Cập Nhật', span: 12 },
    ],
    'OE': [
      { key: 'MÀU', label: 'Màu', span: 6 },
      { key: 'GHI CHÚ', label: 'Ghi chú 1', span: 12, type: 'area' },
      { key: 'HỒI ẨM', label: 'Hồi ẩm', span: 6 },
      { key: 'NGÀY XUỐNG ĐƠN', label: 'Ngày xuống đơn', span: 8, type: 'date' },
      { key: 'SẢN PHẨM', label: 'Sản Phẩm', span: 16 },
      { key: 'SỐ LÔ', label: 'Số Lô', span: 12, required: true },
      { key: 'CHI SỐ', label: 'Chi Số', span: 6 },
      { key: 'SỐ LƯỢNG', label: 'Số Lượng', span: 6 },
      { key: 'BẮT ĐẦU', label: 'Bắt Đầu', span: 12, type: 'date' },
      { key: 'KẾT THÚC', label: 'Kết Thúc', span: 12, type: 'date' },
      { key: 'FU CUNG CÚI', label: 'Fu Cung Cúi', span: 12 },
      { key: 'THỰC TẾ HOÀN THÀNH', label: 'Thực Tế', span: 12 },
      { key: 'SO MÀU', label: 'So Màu', span: 12 },
      { key: 'ghi chú', label: 'Ghi Chú 2', span: 12, type: 'area' },
      { key: 'ghi chú (1)', label: 'Ghi Chú 3', span: 12, type: 'area' },
      { key: 'updated_at', label: 'Cập Nhật', span: 12 },
    ]
  }), []);

  const fetchOrders = useCallback(async (forceReload = false) => {
    const cacheKey = `${activeWorkshop}_${activeStatus}`;
    if (!forceReload && dataCache[cacheKey]) { setData(dataCache[cacheKey]); return; }
    setLoading(true); if(!forceReload) setData([]);
    try {
      if(!forceReload) await new Promise(r => setTimeout(r, 300));
      const res = await axios.get(`${API_URL}/api/orders?workshop=${activeWorkshop}&status=${activeStatus}`);
      setData(res.data); setDataCache(prev => ({ ...prev, [cacheKey]: res.data }));
    } catch (err) { console.error(err); message.error("Lỗi kết nối Server!"); }
    setLoading(false);
  }, [activeWorkshop, activeStatus, dataCache]); 

  useEffect(() => { fetchOrders(false); }, [fetchOrders]);

  const invalidateCache = useCallback(() => {
      setDataCache(prev => {
          const newCache = { ...prev };
          delete newCache[`${activeWorkshop}_ACTIVE`];
          delete newCache[`${activeWorkshop}_COMPLETED`];
          return newCache;
      });
      fetchOrders(true);
  }, [activeWorkshop, fetchOrders]);

  const handleDelete = useCallback(async (id) => {
      try { await axios.delete(`${API_URL}/api/orders/${id}`); message.success("Đã xóa!"); invalidateCache(); } 
      catch (e) { message.error("Lỗi xóa"); }
  }, [invalidateCache]);

  const switchStatus = useCallback(async (id, status) => {
      try { await axios.patch(`${API_URL}/api/orders/${id}/status`, { status }); message.success("Đã cập nhật!"); invalidateCache(); } 
      catch (e) { message.error("Lỗi cập nhật"); }
  }, [invalidateCache]);

  const handleEdit = useCallback((record) => {
    setIsAdding(false); setEditingRecord(record);
    const formValues = { ...record };
    const configCols = MAIN_FIELDS[activeWorkshop] || [];
    configCols.forEach(field => {
        if (field.type === 'date' && formValues[field.key]) {
            const dateVal = dayjs(formValues[field.key]);
            formValues[field.key] = dateVal.isValid() ? dateVal : null;
        }
    });
    form.setFieldsValue(formValues); setIsModalVisible(true);
  }, [activeWorkshop, MAIN_FIELDS, form]);

  const handleAddNew = () => { setIsAdding(true); setEditingRecord(null); form.resetFields(); setIsModalVisible(true); };

  const showResultNotification = (result, type = 'Thao tác') => {
      if (result.inserted > 0) {
          notification.success({ message: `${type} thành công!`, description: `Đã thêm mới ${result.inserted} dòng.`, placement: 'topRight' });
      } else if (result.updated > 0) {
          notification.warning({ message: `${type} thành công!`, description: `Đã CẬP NHẬT ${result.updated} dòng (có thay đổi).`, placement: 'topRight' });
      } else if (result.skipped > 0) {
          notification.info({ message: 'Không có thay đổi', description: `Đã bỏ qua ${result.skipped} dòng trùng lặp.`, placement: 'topRight' });
      }
  };

  const handleSave = async () => { 
      try { 
          const values = await form.validateFields(); 
          const configCols = MAIN_FIELDS[activeWorkshop] || []; 
          configCols.forEach(field => { 
              if (field.type === 'date' && values[field.key]) values[field.key] = values[field.key].format('YYYY-MM-DD'); 
          }); 
          
          const payload = isAdding 
            ? { workshop: activeWorkshop, lot_number: values['SỐ LÔ'], data: values } 
            : { ...values, id: editingRecord.id }; 
          
          if (isAdding) {
              const res = await axios.post(`${API_URL}/api/orders`, payload);
              showResultNotification(res.data, 'Thêm mới');
          } else {
              await axios.put(`${API_URL}/api/orders/${editingRecord.id}`, payload);
              message.success("Cập nhật thành công!");
          }

          setIsModalVisible(false); 
          invalidateCache(); 
      } catch (error) { message.error("Lỗi lưu dữ liệu"); } 
  };

  // --- SỬA LOGIC XUẤT EXCEL: Gửi cột sang server ---
const handleExport = async () => {
    try {
        message.loading("Đang xuất file...", 1);
        
        // 1. Lấy cấu hình cột Chính (AA, AB, OE)
        const configCols = MAIN_FIELDS[activeWorkshop] || [];
        
        // 2. Quét toàn bộ dữ liệu hiện tại để tìm tất cả các cột COT_ (để không bị sót)
        const extraKeysSet = new Set();
        data.forEach(record => {
            Object.keys(record).forEach(key => {
                // record chứa cả dữ liệu đã flatten, nên check trực tiếp
                if (key && key.startsWith('COT_')) {
                    extraKeysSet.add(key);
                }
            });
        });

        // Sắp xếp cột COT_ theo số (COT_1, COT_2... thay vì COT_1, COT_10)
        const sortedExtraKeys = Array.from(extraKeysSet).sort((a, b) => {
            const numA = parseInt(a.replace('COT_', '') || 0);
            const numB = parseInt(b.replace('COT_', '') || 0);
            return numA - numB;
        });

        // 3. Tạo mảng cấu hình cột gửi xuống Server
        // Format: { key: 'KEY_TRONG_DATA', header: 'TÊN_HIỂN_THỊ_TRÊN_EXCEL' }
        const exportColumns = [
            { key: 'STT', header: 'STT' }, // Luôn có STT đầu tiên
            ...configCols.map(c => ({ key: c.key, header: c.label })), // Các cột chính
            ...sortedExtraKeys.map(k => ({ key: k, header: k })) // Các cột COT_
        ];

        // Chuyển object thành string để gửi qua query param
        const columnsJson = JSON.stringify(exportColumns);

        const res = await axios.get(
            `${API_URL}/api/export`, 
            { 
                params: {
                    workshop: activeWorkshop,
                    status: activeStatus,
                    colConfig: columnsJson // Gửi cấu hình cột xuống
                },
                responseType: 'blob' 
            }
        );
        
        const url = window.URL.createObjectURL(new Blob([res.data]));
        const link = document.createElement('a');
        link.href = url;
        const prefix = activeStatus === 'COMPLETED' ? 'DonOK' : 'DonSanXuat';
        const fileName = `${prefix}_${activeWorkshop}_${dayjs().format('DDMM')}.xlsx`;
        link.setAttribute('download', fileName);
        document.body.appendChild(link);
        link.click();
        
        message.success("Xuất file thành công!");
    } catch (e) {
        console.error(e);
        message.error("Lỗi khi xuất file");
    }
  };

  const handleImport = async (file, paramForce) => {
      const formData = new FormData();
      formData.append('file', file);
      const isForce = (paramForce === true); 
      const queryParams = new URLSearchParams({ workshop: activeWorkshop, force: isForce ? 'true' : 'false' }).toString();

      try {
          message.loading("Đang tải lên...", 0);
          const res = await axios.post(`${API_URL}/api/import?${queryParams}`, formData, { headers: { 'Content-Type': 'multipart/form-data' } });
          message.destroy();

          if (res.data.warning) {
              Modal.confirm({
                  title: <span style={{color: 'orange'}}><WarningOutlined /> Cảnh báo lệch xưởng</span>,
                  content: (<div><p><b>{res.data.message}</b></p><br/><p>Bạn có chắc chắn muốn tiếp tục nhập excel không?</p></div>),
                  okText: "Vẫn Import", okType: 'danger', cancelText: "Hủy bỏ",
                  onOk: () => { handleImport(file, true); }
              });
              return false; 
          }
          showResultNotification(res.data, 'Import file');
          invalidateCache(); 
      } catch (e) { 
          message.destroy();
          if (e.response && e.response.data && e.response.data.error) message.error(e.response.data.error);
          else message.error("Lỗi kết nối hoặc lỗi server");
      }
      return false; 
  };

  const handleProcessPaste = () => {
      if (!pasteText.trim()) return message.warning("Chưa có dữ liệu!");
      const rows = pasteText.split(/\r\n|\n|\r/); 
      const validRows = rows.filter(r => r.trim());
      if (validRows.length === 0) return;

      const firstRow = validRows[0];
      let delimiter = '\t'; 
      if (firstRow.split('\t').length <= 1 && firstRow.split(',').length > 1) delimiter = ',';

      const firstRowCells = firstRow.split(delimiter).map(c => c.trim().toUpperCase().replace(/["']/g, ''));
      if (firstRowCells.length < 2) return Modal.error({ title: "Lỗi định dạng", content: "Dữ liệu dính liền. Hãy Copy lại." });

      const isHeaderRow = firstRowCells.some(h => h.includes('SỐ LÔ') || h.includes('SẢN PHẨM') || h.includes('HỒI ẨM'));
      const headerString = firstRowCells.join('___'); 
      const hasOESignature = headerString.includes('FU CUNG') || headerString.includes('THỰC TẾ') || headerString.includes('THUC TE');

      if (isHeaderRow) {
          if (activeWorkshop !== 'OE' && hasOESignature) {
              Modal.confirm({
                  title: <span style={{color: 'red'}}><WarningOutlined /> Cảnh báo lệch xưởng!</span>,
                  content: `Bạn đang ở xưởng ${activeWorkshop}, nhưng dữ liệu có cột của xưởng OE. Bạn có chắc muốn tiếp tục?`,
                  okText: "Tiếp tục", okType: 'danger', cancelText: "Hủy",
                  onOk: () => processPasteData(firstRowCells, validRows, delimiter, isHeaderRow)
              });
              return;
          }
          if (activeWorkshop === 'OE' && !hasOESignature) {
              Modal.confirm({
                  title: <span style={{color: 'orange'}}><WarningOutlined /> Nghi ngờ sai dữ liệu</span>,
                  content: `Bạn đang ở xưởng OE, nhưng dữ liệu thiếu cột đặc thù (Fu Cung...). Có thể bạn đang dán nhầm dữ liệu AA/AB?`,
                  okText: "Tiếp tục", cancelText: "Kiểm tra lại",
                  onOk: () => processPasteData(firstRowCells, validRows, delimiter, isHeaderRow)
              });
              return;
          }
      }
      processPasteData(firstRowCells, validRows, delimiter, isHeaderRow);
  };

  const processPasteData = (firstRowCells, validRows, delimiter, isHeaderRow) => {
      let columnMapping = []; 
      if (isHeaderRow) {
          message.success(`Đã nhận diện tiêu đề!`);
          let noteCounter = 0; 
          columnMapping = firstRowCells.map(header => {
              if (!header) return null;
              const cleanHeader = header.replace(/"/g, '').trim(); 
              const upperName = cleanHeader.toUpperCase();

              if (upperName.includes('SỐ LÔ')) return 'SỐ LÔ'; 
              if (upperName.includes('SẢN PHẨM')) return 'SẢN PHẨM';
              if (upperName.includes('MÀU') && !upperName.includes('SO')) return 'MÀU';
              if (upperName.includes('SO MÀU')) return 'SO MÀU';
              if (upperName.includes('CHI SỐ')) return 'CHI SỐ';
              if (upperName.includes('SỐ LƯỢNG')) return 'SỐ LƯỢNG'; 
              if (upperName.includes('BẮT ĐẦU')) return 'BẮT ĐẦU';
              if (upperName.includes('KẾT THÚC')) return 'KẾT THÚC';
              if (upperName.includes('THAY ĐỔI')) return 'THAY ĐỔI';
              if (upperName.includes('FU CUNG')) return 'FU CUNG CÚI';
              if (upperName.includes('THỰC TẾ')) return 'THỰC TẾ HOÀN THÀNH';
              if (upperName.includes('HỒI ẨM')) return 'HỒI ẨM';
              if (upperName.includes('NGÀY') && upperName.includes('ĐƠN')) return 'NGÀY XUỐNG ĐƠN';

              if (upperName.includes('GHI CHÚ')) {
                  noteCounter++;
                  if (noteCounter === 1) return 'GHI CHÚ';
                  if (noteCounter === 2) return 'ghi chú';
                  if (noteCounter === 3) return 'ghi chú (1)';
                  return `GHI CHÚ (${noteCounter})`;
              }
              if (upperName.startsWith('COT_')) return cleanHeader;
              return null;
          });
      } else {
          message.warning("Không tìm thấy tiêu đề! Map mặc định.");
          columnMapping = (MAIN_FIELDS[activeWorkshop] || []).map(f => f.key);
      }

      const startIdx = isHeaderRow ? 1 : 0; 
      const parsedItems = [];
      for(let i = startIdx; i < validRows.length; i++) {
          const rowStr = validRows[i];
          const cells = rowStr.split(delimiter); 
          const rowObj = {};
          let lotNumber = '';

          columnMapping.forEach((key, colIndex) => {
              if (!key) return; 
              let val = cells[colIndex] ? cells[colIndex].trim() : '';
              if (val.startsWith('"') && val.endsWith('"')) val = val.substring(1, val.length - 1).replace(/""/g, '"');
              const fieldDef = (MAIN_FIELDS[activeWorkshop] || []).find(f => f.key === key);
              if (fieldDef) {
                  if (fieldDef.type === 'date' && val) {
                       if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(val)) { const [d, m, y] = val.split('/'); val = `${y}-${m}-${d}`; }
                  }
                  if (['SỐ LƯỢNG', 'HỒI ẨM', 'CHI SỐ', 'LBS'].includes(key) && val) val = val.replace(/,/g, '');
              }
              rowObj[key] = val;
              if (key === 'SỐ LÔ') lotNumber = val; 
          });
          if (lotNumber) parsedItems.push({ workshop: activeWorkshop, lot_number: lotNumber, data: rowObj });
      }
      if (parsedItems.length === 0) return message.error("Không tìm thấy dữ liệu.");
      setPreviewData(parsedItems);
  };

  const handleSavePaste = async () => {
      try {
          message.loading("Đang lưu...", 0);
          const res = await axios.post(`${API_URL}/api/orders/batch`, { items: previewData });
          message.destroy();
          showResultNotification(res.data, 'Paste dữ liệu');
          setIsPasteModalVisible(false); setPasteText(''); setPreviewData([]); invalidateCache();
      } catch (e) { message.error("Lỗi khi lưu dữ liệu"); }
  };

  // --- RESPONSIVE FORM RENDER ---
  const renderForm = () => {
    const configCols = MAIN_FIELDS[activeWorkshop] || [];
    const configKeys = configCols.map(c => c.key);
    let extraKeys = []; if (editingRecord) extraKeys = Object.keys(editingRecord).filter(k => !configKeys.includes(k) && !['id', 'workshop', 'lot_number', 'status', 'created_at', 'updated_at'].includes(k));
    
    return (
      <Form form={form} layout="vertical">
        <Divider orientation="left" style={{marginTop: 0, color: '#1890ff'}}>Thông tin chi tiết</Divider>
        <Row gutter={[16, 0]}> {/* Gutter responsive */}
          {configCols.map((field) => (
            // XS: 24 (Full dòng), SM: 12 (1/2 dòng), MD: theo config
            <Col xs={24} sm={12} md={field.span || 12} key={field.key}>
              <Form.Item name={field.key} label={field.label} rules={[{ required: field.required, message: '!' }]}>
                {field.key === 'updated_at' ? <Input disabled />
                : field.type === 'area' ? <TextArea rows={2} /> 
                : field.type === 'date' ? <DatePicker style={{width: '100%'}} format="DD/MM/YYYY" placeholder="Chọn ngày" />
                : <Input disabled={!isAdding && field.key === 'SỐ LÔ'} />}
              </Form.Item>
            </Col>
          ))}
          {extraKeys.map(key => (
            <Col xs={24} sm={12} md={8} key={key}>
                <Form.Item name={key} label={<span style={{fontSize: 12, color: '#888'}}>{key} (Excel)</span>}>
                    <Input size="small" style={{background: '#fffbe6'}} />
                </Form.Item>
            </Col>
          ))}
        </Row>
      </Form>
    );
  };

  const filteredData = useMemo(() => {
    if (!searchText) return data;
    const lower = searchText.toLowerCase();
    return data.filter(item => {
        const lot = item['SỐ LÔ'] || item.lot_number || '';
        const prod = item['SẢN PHẨM'] || '';
        return String(lot).toLowerCase().includes(lower) || String(prod).toLowerCase().includes(lower);
    });
  }, [data, searchText]);

  const columns = useMemo(() => {
    const configCols = MAIN_FIELDS[activeWorkshop] || [];
    const configKeys = configCols.map(c => c.key);
    const systemKeys = ['id', 'workshop', 'lot_number', 'status', 'created_at', 'updated_at', 'data'];
    const extraKeysSet = new Set();
    data.slice(0, 50).forEach(record => { Object.keys(record).forEach(key => { if (!configKeys.includes(key) && !systemKeys.includes(key)) extraKeysSet.add(key); }); });

    const sttCol = { title: 'STT', key: 'stt', width: 50, align: 'center', fixed: 'left', render: (t, r, i) => <b>{i + 1}</b> };
    const mainTableCols = configCols.map(f => ({
      title: f.label, dataIndex: f.key, width: f.key === 'SỐ LÔ' ? 120 : 140, fixed: f.key === 'SỐ LÔ' ? 'left' : false,
      render: (text) => {
          if (f.key === 'updated_at' && text) return <span style={{color: '#888', fontSize: 11}}>{dayjs(text).format('HH[h]mm DD/MM')}</span>;
          if (f.key === 'SỐ LÔ') return <b style={{color: '#1890ff'}}>{text}</b>;
          if (f.key === 'HỒI ẨM' && text) return <span style={{fontWeight: 500}}>{!isNaN(parseFloat(text)) ? parseFloat(text).toFixed(2) : text}</span>;
          if (f.type === 'date' && text) { const d = dayjs(text); return d.isValid() ? d.format('DD/MM/YYYY') : text; }
          return <span style={{fontWeight: 500}}>{text}</span>;
      }
    }));

    const extraTableCols = Array.from(extraKeysSet).sort().map(key => ({
        title: <Tooltip title={key}><span style={{color: '#888'}}>{key.substring(0, 10)}..</span></Tooltip>,
        dataIndex: key, width: 100, 
        render: (text) => {
            let displayVal = text;
            if (typeof text === 'boolean') displayVal = String(text).toUpperCase();
            return <span style={{color: '#666', fontSize: 13}}>{displayVal}</span>;
        }
    }));

    const actionCol = { title: 'Thao tác', key: 'action', fixed: 'right', width: 90, render: (_, rec) => ( <Space size={2}> <Button size="small" icon={<EditOutlined style={{color: '#faad14'}}/>} onClick={() => handleEdit(rec)} /> <Popconfirm title="Xóa?" onConfirm={() => handleDelete(rec.id)}><Button size="small" icon={<DeleteOutlined style={{color: 'red'}}/>}/></Popconfirm> {activeStatus === 'ACTIVE' ? <Popconfirm title="Xong?" onConfirm={() => switchStatus(rec.id, 'COMPLETED')}><Button size="small" icon={<CheckCircleOutlined style={{color: 'green'}}/>}/></Popconfirm> : <Popconfirm title="Khôi phục?" onConfirm={() => switchStatus(rec.id, 'ACTIVE')}><Button size="small" icon={<RollbackOutlined style={{color: 'blue'}}/>}/></Popconfirm> } </Space> ) };
    return [sttCol, ...mainTableCols, ...extraTableCols, actionCol];
  }, [data, activeWorkshop, activeStatus, MAIN_FIELDS, handleDelete, handleEdit, switchStatus]);

  const getPreviewColumns = () => {
      const baseCols = (MAIN_FIELDS[activeWorkshop] || []).map(f => ({ title: f.label, dataIndex: ['data', f.key], width: 100, render: (t) => <span style={{fontSize: 12}}>{t}</span> }));
      if (previewData.length > 0) {
          const firstItem = previewData[0].data;
          const extraKeys = Object.keys(firstItem).filter(k => k.startsWith('COT_')).sort((a, b) => (parseInt(a.replace('COT_', '')||0) - parseInt(b.replace('COT_', '')||0)));
          const extraCols = extraKeys.map(key => ({ title: key, dataIndex: ['data', key], width: 80 }));
          return [...baseCols, ...extraCols];
      }
      return baseCols;
  };

  // --- RESPONSIVE LAYOUT MAIN ---
  return (
    <Layout style={{ minHeight: '100vh', background: '#f0f2f5' }}>
       {/* HEADER: Cho phép wrap trên mobile */}
       <Header style={{ background: '#001529', padding: '0 10px', height: 'auto', minHeight: 64, display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ color: 'white', fontSize: 18, fontWeight: 'bold', marginRight: 10 }}>
            <FileExcelOutlined /> {screens.md ? 'QUẢN LÝ SX' : 'QLSX'}
          </div>
          <Select value={activeWorkshop} onChange={setActiveWorkshop} size="middle" style={{ width: 120 }}>
            <Option value="AA">Xưởng AA</Option> <Option value="AB">Xưởng AB</Option> <Option value="OE">Xưởng OE</Option>
          </Select>
       </Header>

       <Content style={{ padding: screens.md ? '20px' : '10px 5px' }}>
          <Card variant="borderless" style={{ borderRadius: 8 }} bodyStyle={{ padding: screens.md ? 24 : 10 }}>
            
            {/* TOOLBAR: Dùng Row/Col để stack trên mobile */}
            <Row gutter={[10, 10]} style={{ marginBottom: 16 }} align="middle">
                <Col xs={24} md={8}>
                    <Tabs activeKey={activeStatus} onChange={setActiveStatus} type="card" style={{marginBottom: 0}}
                        items={[{ key: 'ACTIVE', label: 'Đang SX' }, { key: 'COMPLETED', label: 'Hoàn thành' }]}
                    />
                </Col>
                
                <Col xs={24} md={16} style={{ textAlign: screens.md ? 'right' : 'left' }}>
                    <Space wrap style={{ width: '100%', justifyContent: screens.md ? 'flex-end' : 'flex-start' }}>
                        <Button icon={<SnippetsOutlined />} onClick={() => setIsPasteModalVisible(true)}>{screens.md ? 'Paste Excel' : 'Paste'}</Button>
                        <Button icon={<DownloadOutlined />} onClick={handleExport}>{screens.md ? 'Xuất Excel' : 'Xuất'}</Button>
                        <Upload beforeUpload={handleImport} showUploadList={false}>
                            <Button icon={<UploadOutlined />}>{screens.md ? 'Nhập Excel' : 'Nhập'}</Button>
                        </Upload>
                        <Divider type="vertical" style={{ borderColor: '#999', display: screens.md ? 'inline' : 'none' }} />
                        
                        <Input 
                            placeholder="Tìm kiếm..." 
                            prefix={<SearchOutlined style={{color: '#555'}} />} 
                            value={inputValue} 
                            onChange={e => setInputValue(e.target.value)} 
                            allowClear 
                            style={{ width: screens.md ? 200 : '100%', minWidth: 150 }} // Full width mobile
                        />
                        <Button type="primary" icon={<PlusOutlined />} onClick={handleAddNew}>Thêm</Button>
                    </Space>
                </Col>
            </Row>

            {/* TABLE: Tự động scroll ngang */}
            <Table 
                dataSource={filteredData} 
                columns={columns} 
                rowKey="id" 
                loading={loading} 
                bordered 
                size="small" // Thu nhỏ table
                scroll={{ x: 'max-content', y: 'calc(100vh - 280px)' }} // Tính toán chiều cao
                pagination={false} 
            />
          </Card>
       </Content>
       
       {/* MODAL: Full width trên mobile */}
       <Modal 
            title={isAdding ? "Thêm Mới" : <span>Sửa: <Tag color="blue">{editingRecord?.['SỐ LÔ']}</Tag></span>} 
            open={isModalVisible} 
            onOk={handleSave} 
            onCancel={() => setIsModalVisible(false)} 
            width={screens.md ? 900 : '100%'} // Responsive width
            style={{ top: screens.md ? 100 : 0, padding: screens.md ? 0 : 10 }}
            okText="Lưu" cancelText="Hủy" maskClosable={false}
        >
            {renderForm()}
        </Modal>
       
       <Modal 
            title="Dán dữ liệu Excel" 
            open={isPasteModalVisible} 
            onCancel={() => setIsPasteModalVisible(false)} 
            width={screens.md ? 1000 : '100%'} // Responsive width
            style={{ top: 20 }}
            footer={[
                <Button key="close" onClick={() => setIsPasteModalVisible(false)}>Hủy</Button>, 
                <Button key="parse" onClick={handleProcessPaste} type="primary" ghost>Phân tích</Button>, 
                <Button key="save" type="primary" onClick={handleSavePaste} disabled={previewData.length === 0}>Lưu</Button>
            ]}
        >
          <div style={{marginBottom: 10, color: 'red', fontStyle: 'italic', background: '#fff1f0', padding: '10px', border: '1px solid #ffa39e', borderRadius: '4px'}}>
             <b>CHÚ Ý:</b> Copy cả dòng <b>TIÊU ĐỀ</b>.
          </div>
          <TextArea rows={5} placeholder="Paste (Ctrl + V)..." value={pasteText} onChange={e => setPasteText(e.target.value)} style={{whiteSpace: 'pre', overflow: 'auto'}} />
          {previewData.length > 0 && (<div style={{marginTop: 20}}><h4>Kết quả:</h4><Table dataSource={previewData} rowKey="lot_number" size="small" scroll={{y: 200, x: 'max-content'}} pagination={false} columns={getPreviewColumns()} /></div>)}
       </Modal>
    </Layout>
  );
};

export default App;