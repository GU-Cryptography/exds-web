import React, { useState, useRef } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  Box,
  Alert,
  CircularProgress,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  TableContainer,
  Paper,
  Chip,
  IconButton,
  Tabs,
  Tab,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Divider,
  Grid
} from '@mui/material';
import {
  Download as DownloadIcon,
  Close as CloseIcon,
  Description as FileIcon,
  PictureAsPdf as PdfIcon,
  CheckCircle as CheckCircleIcon,
  Warning as WarningIcon,
  Error as ErrorIcon
} from '@mui/icons-material';
import {
  importContracts,
  ImportResult,
  ImportError,
  uploadContractPdfs,
  PdfUploadResult,
  parseContractPdf,
  ParsePdfResponse,
  importAndCreateContract,
  uploadContractPdf
} from '../api/retail-contracts';

interface ContractImportDialogProps {
  open: boolean;
  onClose: () => void;
  onSuccess: (result: ImportResult) => void;
  canEdit?: boolean;
}

export const ContractImportDialog: React.FC<ContractImportDialogProps> = ({
  open,
  onClose,
  onSuccess,
  canEdit = true
}) => {

  // 导入类型：excel 或 pdf 或 pdf_create
  const [importType, setImportType] = useState<'excel' | 'pdf' | 'pdf_create'>('excel');

  // Excel导入相关状态
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // PDF批量导入相关状态
  const [selectedPdfFiles, setSelectedPdfFiles] = useState<File[]>([]);
  const [pdfUploadResult, setPdfUploadResult] = useState<PdfUploadResult | null>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);

  // 导入创建合同(PDF)相关状态
  const [createPdfFile, setCreatePdfFile] = useState<File | null>(null);
  const [parseResult, setParseResult] = useState<ParsePdfResponse | null>(null);
  const [createSuccess, setCreateSuccess] = useState<boolean>(false);
  const createPdfRef = useRef<HTMLInputElement>(null);

  // Excel文件选择处理
  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (!canEdit) return;
    const file = event.target.files?.[0];
    if (file) {
      const validTypes = [
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-excel',
        'application/octet-stream'
      ];

      if (!validTypes.includes(file.type) && !file.name.match(/\.(xlsx|xls)$/i)) {
        setError('请选择有效的Excel文件（.xlsx或.xls格式）');
        return;
      }

      if (file.size > 10 * 1024 * 1024) {
        setError('文件大小不能超过10MB');
        return;
      }

      setSelectedFile(file);
      setError(null);
      setImportResult(null);
    }
  };

  // PDF文件选择处理
  const handlePdfFilesSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (!canEdit) return;
    const files = event.target.files;
    if (files) {
      const pdfFiles: File[] = [];
      const invalidFiles: string[] = [];

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (file.name.toLowerCase().endsWith('.pdf')) {
          pdfFiles.push(file);
        } else {
          invalidFiles.push(file.name);
        }
      }

      if (invalidFiles.length > 0) {
        setError(`以下文件不是PDF格式：${invalidFiles.join(', ')}`);
      } else {
        setError(null);
      }

      setSelectedPdfFiles(prev => [...prev, ...pdfFiles]);
      setPdfUploadResult(null);
    }
  };

  // Excel导入处理
  const handleImport = async () => {
    if (!canEdit) return;
    if (!selectedFile) {
      setError('请先选择要导入的Excel文件');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await importContracts(selectedFile);
      setImportResult(result.data);
      onSuccess(result.data);
    } catch (err: any) {
      console.error('导入失败:', err);
      const errorMessage = err.response?.data?.detail || err.message || '导入失败，请重试';
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  // PDF上传处理
  const handlePdfUpload = async () => {
    if (!canEdit) return;
    if (selectedPdfFiles.length === 0) {
      setError('请先选择要上传的PDF文件');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await uploadContractPdfs(selectedPdfFiles);
      setPdfUploadResult(result.data);

      // 如果有匹配成功的，通知父组件刷新
      if (result.data.matched.length > 0) {
        // 创建一个模拟的ImportResult通知成功
        onSuccess({
          total: result.data.summary.total,
          success: result.data.summary.matched_count,
          failed: result.data.summary.pending_count + result.data.summary.error_count,
          errors: []
        });
      }
    } catch (err: any) {
      console.error('上传失败:', err);
      const errorMessage = err.response?.data?.detail || err.message || '上传失败，请重试';
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  // 导入创建合同(PDF)选择处理
  const handleCreatePdfSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (!canEdit) return;
    const file = event.target.files?.[0];
    if (file) {
      if (!file.name.toLowerCase().endsWith('.pdf')) {
        setError('请选择PDF文件');
        return;
      }
      setCreatePdfFile(file);
      setError(null);
      setParseResult(null);
      setCreateSuccess(false);

      // 自动开始解析
      setLoading(true);
      try {
        const res = await parseContractPdf(file);
        setParseResult(res.data);
      } catch (err: any) {
        console.error('解析失败:', err);
        setError(err.response?.data?.detail || err.message || '解析失败，请检查文件格式');
        setCreatePdfFile(null);
      } finally {
        setLoading(false);
        if (createPdfRef.current) {
          createPdfRef.current.value = '';
        }
      }
    }
  };

  // 确认创建合同处理
  const handleConfirmCreateContract = async () => {
    if (!canEdit) return;
    if (!parseResult || !createPdfFile) return;

    if (!parseResult.customer_name || !parseResult.package_name || !parseResult.period) {
      setError('PDF 解析信息不全，无法创建合同 (需包含客户名称、套餐名称、购电时间)');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const createRes = await importAndCreateContract({
        customer_name: parseResult.customer_name,
        customer_short_name: parseResult.customer_short_name || parseResult.customer_name,
        location: parseResult.location,
        period: parseResult.period,
        package_name: parseResult.package_name,
        total_electricity: parseResult.total_electricity || 0.0,
        attachment2: parseResult.attachment2 || []
      });

      const contractId = createRes.data.contract_id;
      // 上传对应的PDF原件
      await uploadContractPdf(contractId, createPdfFile);

      setCreateSuccess(true);
      // 触发列表刷新
      onSuccess({
        total: 1,
        success: 1,
        failed: 0,
        errors: []
      });
    } catch (err: any) {
      console.error('创建失败:', err);
      setError(err.response?.data?.detail || err.message || '创建合同或上传原件失败');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setSelectedFile(null);
    setImportResult(null);
    setSelectedPdfFiles([]);
    setPdfUploadResult(null);
    setCreatePdfFile(null);
    setParseResult(null);
    setCreateSuccess(false);
    setError(null);
    setImportType('excel');
    onClose();
  };

  const handleDragOver = (event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };

  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault();
    event.stopPropagation();

    const files = event.dataTransfer.files;
    if (importType === 'excel' && files[0]) {
      const fakeEvent = { target: { files: [files[0]] } } as any;
      handleFileSelect(fakeEvent);
    } else if (importType === 'pdf') {
      const fakeEvent = { target: { files } } as any;
      handlePdfFilesSelect(fakeEvent);
    } else if (importType === 'pdf_create' && files[0]) {
      const fakeEvent = { target: { files: [files[0]] } } as any;
      handleCreatePdfSelect(fakeEvent);
    }
  };

  const removeFile = () => {
    setSelectedFile(null);
    setError(null);
    setImportResult(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const removePdfFile = (index: number) => {
    setSelectedPdfFiles(prev => prev.filter((_, i) => i !== index));
    setPdfUploadResult(null);
  };

  const clearAllPdfFiles = () => {
    setSelectedPdfFiles([]);
    setPdfUploadResult(null);
    if (pdfInputRef.current) {
      pdfInputRef.current.value = '';
    }
  };

  const removeCreatePdfFile = () => {
    setCreatePdfFile(null);
    setParseResult(null);
    setCreateSuccess(false);
    setError(null);
  };

  const handleTabChange = (_: React.SyntheticEvent, newValue: 'excel' | 'pdf' | 'pdf_create') => {
    setImportType(newValue);
    setError(null);
  };

  // 渲染Excel导入结果
  const renderImportResult = () => {
    if (!importResult) return null;

    const { total, success, failed, errors } = importResult;

    return (
      <Box sx={{ mt: 2 }}>
        <Box sx={{ display: 'flex', gap: 2, mb: 2, flexWrap: 'wrap' }}>
          <Chip label={`总计: ${total}`} color="default" variant="outlined" />
          <Chip label={`成功: ${success}`} color="success" variant="outlined" />
          <Chip label={`失败: ${failed}`} color={failed > 0 ? "error" : "default"} variant="outlined" />
        </Box>

        {errors.length > 0 && (
          <Box>
            <Typography variant="subtitle2" gutterBottom color="error">
              错误详情 ({errors.length}条):
            </Typography>
            <TableContainer component={Paper} variant="outlined">
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>行号</TableCell>
                    <TableCell>字段</TableCell>
                    <TableCell>错误原因</TableCell>
                    <TableCell>修改建议</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {errors.slice(0, 10).map((error: ImportError, index: number) => (
                    <TableRow key={index}>
                      <TableCell>{error.row}</TableCell>
                      <TableCell>{error.field}</TableCell>
                      <TableCell sx={{ color: 'error.main' }}>{error.message}</TableCell>
                      <TableCell>{error.suggestion || '-'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {errors.length > 10 && (
                <Box sx={{ p: 1, textAlign: 'center', color: 'text.secondary' }}>
                  <Typography variant="body2">显示前10条错误，共{errors.length}条错误</Typography>
                </Box>
              )}
            </TableContainer>
          </Box>
        )}

        {success > 0 && failed === 0 && (
          <Alert severity="success" sx={{ mt: 2 }}>
            <Typography variant="body2">成功导入 {success} 条合同数据！</Typography>
          </Alert>
        )}

        {success > 0 && failed > 0 && (
          <Alert severity="warning" sx={{ mt: 2 }}>
            <Typography variant="body2">
              部分导入成功：成功 {success} 条，失败 {failed} 条。请根据错误详情修正数据后重新导入失败的记录。
            </Typography>
          </Alert>
        )}
      </Box>
    );
  };

  // 渲染PDF上传结果
  const renderPdfUploadResult = () => {
    if (!pdfUploadResult) return null;

    const { matched, pending, errors, summary } = pdfUploadResult;

    return (
      <Box sx={{ mt: 2 }}>
        <Box sx={{ display: 'flex', gap: 2, mb: 2, flexWrap: 'wrap' }}>
          <Chip label={`总计: ${summary.total}`} color="default" variant="outlined" />
          <Chip label={`自动导入: ${summary.matched_count}`} color="success" variant="outlined" />
          <Chip label={`待确认: ${summary.pending_count}`} color="warning" variant="outlined" />
          <Chip label={`错误: ${summary.error_count}`} color={summary.error_count > 0 ? "error" : "default"} variant="outlined" />
        </Box>

        {/* 匹配成功列表 */}
        {matched.length > 0 && (
          <Box sx={{ mb: 2 }}>
            <Typography variant="subtitle2" gutterBottom color="success.main">
              自动导入成功 ({matched.length}份):
            </Typography>
            <List dense>
              {matched.map((item, index) => (
                <ListItem key={index}>
                  <ListItemIcon><CheckCircleIcon color="success" /></ListItemIcon>
                  <ListItemText
                    primary={item.filename}
                    secondary={`关联合同: ${item.contract_name}`}
                  />
                </ListItem>
              ))}
            </List>
          </Box>
        )}

        {/* 待确认列表 */}
        {pending.length > 0 && (
          <Box sx={{ mb: 2 }}>
            <Typography variant="subtitle2" gutterBottom color="warning.main">
              待确认 ({pending.length}份):
            </Typography>
            <List dense>
              {pending.map((item, index) => (
                <ListItem key={index}>
                  <ListItemIcon><WarningIcon color="warning" /></ListItemIcon>
                  <ListItemText
                    primary={item.filename}
                    secondary={item.reason}
                  />
                </ListItem>
              ))}
            </List>
            <Alert severity="info" sx={{ mt: 1 }}>
              <Typography variant="body2">
                待确认的文件需要在合同详情页手动上传关联。
              </Typography>
            </Alert>
          </Box>
        )}

        {/* 错误列表 */}
        {errors.length > 0 && (
          <Box>
            <Typography variant="subtitle2" gutterBottom color="error">
              错误 ({errors.length}份):
            </Typography>
            <List dense>
              {errors.map((item, index) => (
                <ListItem key={index}>
                  <ListItemIcon><ErrorIcon color="error" /></ListItemIcon>
                  <ListItemText
                    primary={item.filename}
                    secondary={item.error}
                  />
                </ListItem>
              ))}
            </List>
          </Box>
        )}
      </Box>
    );
  };

  // 渲染Excel导入内容
  const renderExcelContent = () => (
    <>
      <Alert severity="info" sx={{ mb: 2 }}>
        <Typography variant="body2" component="div">
          <strong>导入说明：</strong><br />
          • 请上传从交易中心平台下载的标准Excel文件<br />
          • 必需字段：套餐、购买用户、购买电量、购买时间-开始、购买时间-结束<br />
          • 系统将自动忽略：序号、代理销售费模型、签章状态字段<br />
          • 文件大小限制：10MB
        </Typography>
      </Alert>

      {!selectedFile && !importResult && (
        <Box
          sx={{
            border: '2px dashed',
            borderColor: 'grey.300',
            borderRadius: 1,
            p: 3,
            textAlign: 'center',
            cursor: 'pointer',
            transition: 'all 0.2s ease-in-out',
            '&:hover': { borderColor: 'primary.main', backgroundColor: 'action.hover' }
          }}
          onClick={() => canEdit && fileInputRef.current?.click()}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            onChange={handleFileSelect}
            style={{ display: 'none' }}
          />
          <DownloadIcon sx={{ fontSize: 48, color: 'text.secondary', mb: 1 }} />
          <Typography variant="h6" color="text.secondary" gutterBottom>
            点击或拖拽文件到此处上传
          </Typography>
          <Typography variant="body2" color="text.secondary">
            支持 .xlsx 和 .xls 格式
          </Typography>
        </Box>
      )}

      {selectedFile && !importResult && (
        <Box>
          <Paper variant="outlined" sx={{ p: 2, display: 'flex', alignItems: 'center', gap: 2 }}>
            <FileIcon color="primary" />
            <Box sx={{ flex: 1 }}>
              <Typography variant="body1" fontWeight="medium">{selectedFile.name}</Typography>
              <Typography variant="body2" color="text.secondary">
                {(selectedFile.size / 1024).toFixed(2)} KB
              </Typography>
            </Box>
            <IconButton onClick={removeFile} size="small" color="error">
              <CloseIcon />
            </IconButton>
          </Paper>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            确认文件无误后，点击"开始导入"按钮进行数据导入。
          </Typography>
        </Box>
      )}

      {importResult && renderImportResult()}
    </>
  );

  // 渲染PDF导入内容
  const renderPdfContent = () => (
    <>
      <Alert severity="info" sx={{ mb: 2 }}>
        <Typography variant="body2" component="div">
          <strong>上传说明：</strong><br />
          • 请上传合同原件PDF文件<br />
          • 文件命名规范：<strong>客户名称-合同描述.pdf</strong><br />
          • 例如：富联精密科技（赣州）有限公司-26年零售平台电子合同.pdf<br />
          • 系统将根据文件名自动匹配已有合同记录
        </Typography>
      </Alert>

      {selectedPdfFiles.length === 0 && !pdfUploadResult && (
        <Box
          sx={{
            border: '2px dashed',
            borderColor: 'grey.300',
            borderRadius: 1,
            p: 3,
            textAlign: 'center',
            cursor: 'pointer',
            transition: 'all 0.2s ease-in-out',
            '&:hover': { borderColor: 'primary.main', backgroundColor: 'action.hover' }
          }}
          onClick={() => canEdit && pdfInputRef.current?.click()}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        >
          <input
            ref={pdfInputRef}
            type="file"
            accept=".pdf"
            multiple
            onChange={handlePdfFilesSelect}
            style={{ display: 'none' }}
          />
          <PdfIcon sx={{ fontSize: 48, color: 'text.secondary', mb: 1 }} />
          <Typography variant="h6" color="text.secondary" gutterBottom>
            点击或拖拽PDF文件到此处上传
          </Typography>
          <Typography variant="body2" color="text.secondary">
            支持批量选择多个PDF文件
          </Typography>
        </Box>
      )}

      {selectedPdfFiles.length > 0 && !pdfUploadResult && (
        <Box>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
            <Typography variant="subtitle2">已选择 {selectedPdfFiles.length} 个文件:</Typography>
            <Button size="small" onClick={clearAllPdfFiles} color="error">清空</Button>
          </Box>
          <Paper variant="outlined" sx={{ maxHeight: 200, overflow: 'auto' }}>
            <List dense>
              {selectedPdfFiles.map((file, index) => (
                <ListItem
                  key={index}
                  secondaryAction={
                    <IconButton edge="end" size="small" onClick={() => removePdfFile(index)}>
                      <CloseIcon fontSize="small" />
                    </IconButton>
                  }
                >
                  <ListItemIcon><PdfIcon color="error" /></ListItemIcon>
                  <ListItemText
                    primary={file.name}
                    secondary={`${(file.size / 1024).toFixed(2)} KB`}
                  />
                </ListItem>
              ))}
            </List>
          </Paper>
          <Button
            size="small"
            sx={{ mt: 1 }}
            onClick={() => canEdit && pdfInputRef.current?.click()}
          >
            继续添加文件
          </Button>
          <input
            ref={pdfInputRef}
            type="file"
            accept=".pdf"
            multiple
            onChange={handlePdfFilesSelect}
            style={{ display: 'none' }}
          />
        </Box>
      )}

      {pdfUploadResult && renderPdfUploadResult()}
    </>
  );

  // 渲染导入创建合同 (PDF_CREATE) 结果确认界面
  const renderPdfCreateContent = () => (
    <>
      <Alert severity="info" sx={{ mb: 2 }}>
        <Typography variant="body2" component="div">
          <strong>功能说明：</strong><br />
          • 选择一份PDF签章合同进行智能识别。<br />
          • 自动提取客户资料及合同细节，若客户不存在则自动建立客户档案。<br />
          • 用户经核对无误后提交创建，并自动绑定上传该原件PDF。<br />
        </Typography>
      </Alert>

      {!createPdfFile && !parseResult && !createSuccess && (
        <Box
          sx={{
            border: '2px dashed',
            borderColor: 'grey.300',
            borderRadius: 1,
            p: 3,
            textAlign: 'center',
            cursor: 'pointer',
            transition: 'all 0.2s ease-in-out',
            '&:hover': { borderColor: 'primary.main', backgroundColor: 'action.hover' }
          }}
          onClick={() => canEdit && createPdfRef.current?.click()}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        >
          <input
            ref={createPdfRef}
            type="file"
            accept=".pdf"
            onChange={handleCreatePdfSelect}
            style={{ display: 'none' }}
          />
          <PdfIcon sx={{ fontSize: 48, color: 'text.secondary', mb: 1 }} />
          <Typography variant="h6" color="text.secondary" gutterBottom>
            选择或拖拽需要解析的 PDF 文件
          </Typography>
          <Typography variant="body2" color="text.secondary">
            仅限单份合同
          </Typography>
        </Box>
      )}

      {createPdfFile && parseResult && !createSuccess && (
        <Box>
          <Paper variant="outlined" sx={{ p: 2, display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
            <FileIcon color="primary" />
            <Box sx={{ flex: 1 }}>
              <Typography variant="body1" fontWeight="medium">{createPdfFile.name}</Typography>
              <Typography variant="body2" color="text.secondary">
                {(createPdfFile.size / 1024).toFixed(2)} KB
              </Typography>
            </Box>
            <IconButton onClick={removeCreatePdfFile} size="small" color="error">
              <CloseIcon />
            </IconButton>
          </Paper>

          {parseResult.is_contract_duplicate && (
            <Alert severity="error" sx={{ mb: 2 }}>
              系统中已存在该客户此时期的同名合同，请仔细核对是否重录！
            </Alert>
          )}

          <Grid container spacing={2}>
            <Grid size={{ xs: 12, sm: 6 }}>
              <Paper variant="outlined" sx={{ p: 2, height: '100%' }}>
                <Typography variant="subtitle2" color="primary" gutterBottom>解析结果摘要</Typography>
                <Divider sx={{ mb: 1 }} />

                <Typography variant="body2" sx={{ mt: 1, mb: 0.5 }}>
                  <strong>客户名称：</strong> {parseResult.customer_name || '无法解析'}
                  {parseResult.is_customer_new ? (
                    <Chip label="将新建客户" color="info" size="small" sx={{ ml: 1, height: 20 }} />
                  ) : (
                    <Chip label="系统已有" color="success" size="small" sx={{ ml: 1, height: 20 }} />
                  )}
                </Typography>

                <Typography variant="body2" sx={{ mb: 0.5 }}>
                  <strong>购电时间：</strong> {parseResult.period || '无法解析'}
                </Typography>

                <Typography variant="body2" sx={{ mb: 0.5 }}>
                  <strong>关联套餐：</strong> {parseResult.package_name || '未提取到套餐名'}
                  {parseResult.is_package_new && parseResult.package_name && (
                    <Chip label="将建为草稿" color="warning" size="small" sx={{ ml: 1, height: 20 }} />
                  )}
                </Typography>

                <Typography variant="body2">
                  <strong>代理电量：</strong> {parseResult.total_electricity ? `${parseResult.total_electricity} 千瓦时` : '未解析到电量'}
                </Typography>

                <Typography variant="body2" sx={{ mt: 0.5 }}>
                  <strong>推断地市：</strong> {parseResult.location || '-'}
                </Typography>
              </Paper>
            </Grid>

            <Grid size={{ xs: 12, sm: 6 }}>
              <Paper variant="outlined" sx={{ p: 2, height: '100%', maxHeight: 200, overflow: 'auto' }}>
                <Typography variant="subtitle2" color="primary" gutterBottom>附件中发现的户号/计量点</Typography>
                <Divider sx={{ mb: 1 }} />
                {(parseResult.attachment2 && parseResult.attachment2.length > 0) ? (
                  <List dense disablePadding>
                    {parseResult.attachment2.map((item, index) => (
                      <ListItem key={index} disableGutters sx={{ py: 0 }}>
                        <ListItemText
                          primary={`户号: ${item.meter_id || '-'} / 资产: ${item.measuring_point || '-'}`}
                          secondaryTypographyProps={{ fontSize: '0.7rem' }}
                        />
                      </ListItem>
                    ))}
                  </List>
                ) : (
                  <Typography variant="body2" color="text.secondary">未解析到计量点配置表</Typography>
                )}
              </Paper>
            </Grid>
          </Grid>
        </Box>
      )}

      {createSuccess && (
        <Alert severity="success" sx={{ mt: 2 }}>
          <Typography variant="body2">合同与客户信息创建成功，并已绑定该文件为主合同原件！</Typography>
        </Alert>
      )}
    </>
  );

  const hasResult = importResult !== null || pdfUploadResult !== null || createSuccess;
  const isProcessDoneAndHasSuccessMessage = (importType === 'excel' && importResult) || (importType === 'pdf' && pdfUploadResult) || (importType === 'pdf_create' && createSuccess);

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="md" fullWidth>
      <DialogTitle>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Typography variant="h6">导入合同数据</Typography>
          <IconButton onClick={handleClose} size="small">
            <CloseIcon />
          </IconButton>
        </Box>
      </DialogTitle>

      <DialogContent>
        {/* Tab切换 */}
        <Tabs value={importType} onChange={handleTabChange} sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}>
          <Tab label="导入订单列表 (Excel)" value="excel" disabled={loading || createSuccess || !canEdit} />
          <Tab label="批量上传合同 (PDF)" value="pdf" disabled={loading || createSuccess || !canEdit} />
          <Tab label="导入创建合同 (PDF)" value="pdf_create" disabled={loading || createSuccess || !canEdit} />
        </Tabs>

        <Box sx={{ minHeight: 300 }}>
          {/* 错误提示 */}
          {error && (
            <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
              {error}
            </Alert>
          )}

          {/* 根据Tab显示不同内容 */}
          {importType === 'excel' && renderExcelContent()}
          {importType === 'pdf' && renderPdfContent()}
          {importType === 'pdf_create' && renderPdfCreateContent()}

          {/* 加载状态 */}
          {loading && (
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', py: 4 }}>
              <CircularProgress size={40} />
              <Typography variant="body2" sx={{ mt: 2 }} color="text.secondary">
                {importType === 'excel' ? '正在导入数据，请稍候...' : (importType === 'pdf' ? '正在上传文件，请稍候...' : '正在处理中...')}
              </Typography>
            </Box>
          )}
        </Box>
      </DialogContent>

      <DialogActions sx={{ p: 2, pt: 0 }}>
        {!isProcessDoneAndHasSuccessMessage && (
          <>
            <Button onClick={handleClose} disabled={loading}>
              取消
            </Button>
            {importType === 'excel' && (
              <Button
                onClick={handleImport}
                variant="contained"
                disabled={!selectedFile || loading || !canEdit}
                startIcon={loading ? <CircularProgress size={16} /> : <DownloadIcon />}
              >
                {loading ? '导入中...' : '开始导入'}
              </Button>
            )}

            {importType === 'pdf' && (
              <Button
                onClick={handlePdfUpload}
                variant="contained"
                disabled={selectedPdfFiles.length === 0 || loading || !canEdit}
                startIcon={loading ? <CircularProgress size={16} /> : <PdfIcon />}
              >
                {loading ? '上传中...' : '开始上传'}
              </Button>
            )}

            {importType === 'pdf_create' && (
              <Button
                onClick={handleConfirmCreateContract}
                variant="contained"
                disabled={!createPdfFile || !parseResult || loading || parseResult.is_contract_duplicate || !canEdit}
                startIcon={loading ? <CircularProgress size={16} /> : <CheckCircleIcon />}
              >
                {loading ? '创建中...' : '确认导入创建'}
              </Button>
            )}
          </>
        )}

        {isProcessDoneAndHasSuccessMessage && (
          <Button onClick={handleClose} variant="contained">
            完成
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
};

export default ContractImportDialog;
