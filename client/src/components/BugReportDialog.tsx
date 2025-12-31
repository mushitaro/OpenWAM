import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Chip,
  Box,
  Typography,
  Stepper,
  Step,
  StepLabel,
  IconButton,
  Alert
} from '@mui/material';
import { Add as AddIcon, Delete as DeleteIcon, BugReport as BugIcon } from '@mui/icons-material';
import { BugSeverity, BugCategory, BugType, CreateBugRequest, BugTemplate, BugReproductionStep } from '../../../src/shared/types/bugTracking';

interface BugReportDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (bugReport: CreateBugRequest) => Promise<void>;
  projectId?: number;
  componentIds?: string[];
  initialTemplate?: string;
}

const BugReportDialog: React.FC<BugReportDialogProps> = ({
  open,
  onClose,
  onSubmit,
  projectId,
  componentIds,
  initialTemplate
}) => {
  const [activeStep, setActiveStep] = useState(0);
  const [templates, setTemplates] = useState<BugTemplate[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');

  // Form state
  const [formData, setFormData] = useState<CreateBugRequest>({
    title: '',
    description: '',
    severity: BugSeverity.MEDIUM,
    category: BugCategory.FUNCTIONALITY,
    type: BugType.BUG,
    environment: {
      browser: '',
      browserVersion: '',
      os: '',
      osVersion: '',
      screenResolution: '',
      deviceType: 'desktop',
      userAgent: '',
      timestamp: ''
    },
    reproductionSteps: [
      {
        stepNumber: 1,
        action: '',
        expectedResult: '',
        actualResult: ''
      }
    ],
    expectedBehavior: '',
    actualBehavior: '',
    projectId,
    componentIds,
    tags: []
  });

  const steps = ['テンプレート選択', '基本情報', '再現手順', '詳細情報'];

  useEffect(() => {
    if (open) {
      loadTemplates();
      collectEnvironmentInfo();
    }
  }, [open]);

  useEffect(() => {
    if (initialTemplate && templates.length > 0) {
      setSelectedTemplate(initialTemplate);
      applyTemplate(initialTemplate);
    }
  }, [initialTemplate, templates]);

  const loadTemplates = async () => {
    try {
      const response = await fetch('/api/bugs/templates');
      const result = await response.json();
      setTemplates(result.data || []);
    } catch (error) {
      console.error('Failed to load bug templates:', error);
    }
  };

  const collectEnvironmentInfo = () => {
    const userAgent = navigator.userAgent;
    setFormData(prev => ({
      ...prev,
      environment: {
        browser: getBrowserName(userAgent),
        browserVersion: getBrowserVersion(userAgent),
        os: getOperatingSystem(userAgent),
        osVersion: 'Unknown',
        screenResolution: `${screen.width}x${screen.height}`,
        deviceType: getDeviceType(),
        userAgent,
        timestamp: new Date().toISOString()
      }
    }));
  };

  const getBrowserName = (userAgent: string): string => {
    if (userAgent.includes('Chrome')) return 'Chrome';
    if (userAgent.includes('Firefox')) return 'Firefox';
    if (userAgent.includes('Safari')) return 'Safari';
    if (userAgent.includes('Edge')) return 'Edge';
    return 'Unknown';
  };

  const getBrowserVersion = (userAgent: string): string => {
    const match = userAgent.match(/(Chrome|Firefox|Safari|Edge)\/([0-9.]+)/);
    return match ? match[2] : 'Unknown';
  };

  const getOperatingSystem = (userAgent: string): string => {
    if (userAgent.includes('Windows')) return 'Windows';
    if (userAgent.includes('Mac')) return 'macOS';
    if (userAgent.includes('Linux')) return 'Linux';
    return 'Unknown';
  };

  const getDeviceType = (): 'desktop' | 'tablet' | 'mobile' => {
    const width = screen.width;
    if (width < 768) return 'mobile';
    if (width < 1024) return 'tablet';
    return 'desktop';
  };

  const applyTemplate = (templateId: string) => {
    const template = templates.find(t => t.id === templateId);
    if (!template) return;

    setFormData(prev => ({
      ...prev,
      title: template.template.title,
      description: template.template.description,
      severity: template.defaultSeverity,
      category: template.category,
      type: template.type,
      reproductionSteps: template.template.reproductionSteps,
      expectedBehavior: template.template.expectedBehavior,
      tags: [...(prev.tags || []), ...template.template.tags]
    }));
  };

  const handleNext = () => {
    if (activeStep < steps.length - 1) {
      setActiveStep(activeStep + 1);
    }
  };

  const handleBack = () => {
    if (activeStep > 0) {
      setActiveStep(activeStep - 1);
    }
  };

  const handleSubmit = async () => {
    setLoading(true);
    setError('');

    try {
      await onSubmit(formData);
      onClose();
      resetForm();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'バグレポートの送信に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setActiveStep(0);
    setSelectedTemplate('');
    setFormData({
      title: '',
      description: '',
      severity: BugSeverity.MEDIUM,
      category: BugCategory.FUNCTIONALITY,
      type: BugType.BUG,
      environment: {
        browser: '',
        browserVersion: '',
        os: '',
        osVersion: '',
        screenResolution: '',
        deviceType: 'desktop',
        userAgent: '',
        timestamp: ''
      },
      reproductionSteps: [
        {
          stepNumber: 1,
          action: '',
          expectedResult: '',
          actualResult: ''
        }
      ],
      expectedBehavior: '',
      actualBehavior: '',
      projectId,
      componentIds,
      tags: []
    });
  };

  const addReproductionStep = () => {
    setFormData(prev => ({
      ...prev,
      reproductionSteps: [
        ...prev.reproductionSteps,
        {
          stepNumber: prev.reproductionSteps.length + 1,
          action: '',
          expectedResult: '',
          actualResult: ''
        }
      ]
    }));
  };

  const removeReproductionStep = (index: number) => {
    setFormData(prev => ({
      ...prev,
      reproductionSteps: prev.reproductionSteps
        .filter((_, i) => i !== index)
        .map((step, i) => ({ ...step, stepNumber: i + 1 }))
    }));
  };

  const updateReproductionStep = (index: number, field: keyof BugReproductionStep, value: string) => {
    setFormData(prev => ({
      ...prev,
      reproductionSteps: prev.reproductionSteps.map((step, i) =>
        i === index ? { ...step, [field]: value } : step
      )
    }));
  };

  const addTag = (tag: string) => {
    if (tag && !formData.tags?.includes(tag)) {
      setFormData(prev => ({
        ...prev,
        tags: [...(prev.tags || []), tag]
      }));
    }
  };

  const removeTag = (tag: string) => {
    setFormData(prev => ({
      ...prev,
      tags: (prev.tags || []).filter(t => t !== tag)
    }));
  };

  const renderStepContent = () => {
    switch (activeStep) {
      case 0: // テンプレート選択
        return (
          <Box>
            <Typography variant="h6" gutterBottom>
              バグレポートテンプレートを選択してください
            </Typography>
            <FormControl fullWidth margin="normal">
              <InputLabel>テンプレート</InputLabel>
              <Select
                value={selectedTemplate}
                onChange={(e) => {
                  setSelectedTemplate(e.target.value);
                  applyTemplate(e.target.value);
                }}
              >
                <MenuItem value="">カスタム（テンプレートなし）</MenuItem>
                {templates.map((template) => (
                  <MenuItem key={template.id} value={template.id}>
                    {template.name} - {template.description}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Box>
        );

      case 1: // 基本情報
        return (
          <Box>
            <TextField
              fullWidth
              label="タイトル"
              value={formData.title}
              onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
              margin="normal"
              required
            />
            <TextField
              fullWidth
              label="説明"
              value={formData.description}
              onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
              margin="normal"
              multiline
              rows={4}
              required
            />
            <Box display="flex" gap={2} mt={2}>
              <FormControl fullWidth>
                <InputLabel>深刻度</InputLabel>
                <Select
                  value={formData.severity}
                  onChange={(e) => setFormData(prev => ({ ...prev, severity: e.target.value as BugSeverity }))}
                >
                  <MenuItem value={BugSeverity.CRITICAL}>Critical - 緊急</MenuItem>
                  <MenuItem value={BugSeverity.HIGH}>High - 高</MenuItem>
                  <MenuItem value={BugSeverity.MEDIUM}>Medium - 中</MenuItem>
                  <MenuItem value={BugSeverity.LOW}>Low - 低</MenuItem>
                </Select>
              </FormControl>
              <FormControl fullWidth>
                <InputLabel>カテゴリ</InputLabel>
                <Select
                  value={formData.category}
                  onChange={(e) => setFormData(prev => ({ ...prev, category: e.target.value as BugCategory }))}
                >
                  <MenuItem value={BugCategory.UI_UX}>UI/UX</MenuItem>
                  <MenuItem value={BugCategory.FUNCTIONALITY}>機能</MenuItem>
                  <MenuItem value={BugCategory.PERFORMANCE}>パフォーマンス</MenuItem>
                  <MenuItem value={BugCategory.BROWSER_COMPATIBILITY}>ブラウザ互換性</MenuItem>
                  <MenuItem value={BugCategory.FILE_OPERATIONS}>ファイル操作</MenuItem>
                  <MenuItem value={BugCategory.SIMULATION}>シミュレーション</MenuItem>
                  <MenuItem value={BugCategory.VALIDATION}>バリデーション</MenuItem>
                  <MenuItem value={BugCategory.DATA_INTEGRITY}>データ整合性</MenuItem>
                  <MenuItem value={BugCategory.SECURITY}>セキュリティ</MenuItem>
                </Select>
              </FormControl>
            </Box>
          </Box>
        );

      case 2: // 再現手順
        return (
          <Box>
            <Typography variant="h6" gutterBottom>
              再現手順
            </Typography>
            {formData.reproductionSteps.map((step, index) => (
              <Box key={index} border={1} borderColor="grey.300" borderRadius={1} p={2} mb={2}>
                <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
                  <Typography variant="subtitle2">ステップ {step.stepNumber}</Typography>
                  {formData.reproductionSteps.length > 1 && (
                    <IconButton size="small" onClick={() => removeReproductionStep(index)}>
                      <DeleteIcon />
                    </IconButton>
                  )}
                </Box>
                <TextField
                  fullWidth
                  label="操作"
                  value={step.action}
                  onChange={(e) => updateReproductionStep(index, 'action', e.target.value)}
                  margin="dense"
                  required
                />
                <TextField
                  fullWidth
                  label="期待される結果"
                  value={step.expectedResult || ''}
                  onChange={(e) => updateReproductionStep(index, 'expectedResult', e.target.value)}
                  margin="dense"
                />
                <TextField
                  fullWidth
                  label="実際の結果"
                  value={step.actualResult || ''}
                  onChange={(e) => updateReproductionStep(index, 'actualResult', e.target.value)}
                  margin="dense"
                />
              </Box>
            ))}
            <Button
              startIcon={<AddIcon />}
              onClick={addReproductionStep}
              variant="outlined"
              fullWidth
            >
              ステップを追加
            </Button>
          </Box>
        );

      case 3: // 詳細情報
        return (
          <Box>
            <TextField
              fullWidth
              label="期待される動作"
              value={formData.expectedBehavior}
              onChange={(e) => setFormData(prev => ({ ...prev, expectedBehavior: e.target.value }))}
              margin="normal"
              multiline
              rows={2}
              required
            />
            <TextField
              fullWidth
              label="実際の動作"
              value={formData.actualBehavior}
              onChange={(e) => setFormData(prev => ({ ...prev, actualBehavior: e.target.value }))}
              margin="normal"
              multiline
              rows={2}
              required
            />
            <TextField
              fullWidth
              label="エラーメッセージ（任意）"
              value={formData.errorMessage || ''}
              onChange={(e) => setFormData(prev => ({ ...prev, errorMessage: e.target.value }))}
              margin="normal"
              multiline
              rows={2}
            />
            <Box mt={2}>
              <Typography variant="subtitle2" gutterBottom>
                タグ
              </Typography>
              <Box display="flex" flexWrap="wrap" gap={1} mb={1}>
                {formData.tags?.map((tag) => (
                  <Chip
                    key={tag}
                    label={tag}
                    onDelete={() => removeTag(tag)}
                    size="small"
                  />
                ))}
              </Box>
              <TextField
                label="タグを追加"
                size="small"
                onKeyPress={(e) => {
                  if (e.key === 'Enter') {
                    addTag((e.target as HTMLInputElement).value);
                    (e.target as HTMLInputElement).value = '';
                  }
                }}
              />
            </Box>
          </Box>
        );

      default:
        return null;
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        <Box display="flex" alignItems="center" gap={1}>
          <BugIcon />
          バグレポート作成
        </Box>
      </DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        
        <Stepper activeStep={activeStep} sx={{ mb: 3 }}>
          {steps.map((label) => (
            <Step key={label}>
              <StepLabel>{label}</StepLabel>
            </Step>
          ))}
        </Stepper>

        {renderStepContent()}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>キャンセル</Button>
        <Button onClick={handleBack} disabled={activeStep === 0}>
          戻る
        </Button>
        {activeStep < steps.length - 1 ? (
          <Button onClick={handleNext} variant="contained">
            次へ
          </Button>
        ) : (
          <Button
            onClick={handleSubmit}
            variant="contained"
            disabled={loading}
          >
            {loading ? '送信中...' : '送信'}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
};

export default BugReportDialog;