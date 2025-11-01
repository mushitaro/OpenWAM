/**
 * システム監視コンポーネント
 * ヘルス状態、クラッシュ履歴、バックアップ管理を表示
 */

import React, { useState, useEffect } from 'react';
import { 
  Card, 
  Row, 
  Col, 
  Statistic, 
  Progress, 
  Alert, 
  Button, 
  Table, 
  Tabs, 
  Space,
  Tag,
  Modal,
  Form,
  Switch,
  InputNumber,
  message
} from 'antd';
import {
  HeartOutlined,
  WarningOutlined,
  ExclamationCircleOutlined,
  ReloadOutlined,
  DownloadOutlined,
  UploadOutlined,
  DeleteOutlined,
  SettingOutlined
} from '@ant-design/icons';
import { Line } from '@ant-design/plots';
import { useErrorHandler } from '../hooks/useErrorHandler';

const { TabPane } = Tabs;

interface SystemHealth {
  status: 'healthy' | 'warning' | 'critical' | 'down';
  score: number;
  issues: HealthIssue[];
  metrics: SystemMetrics;
  lastCheck: Date;
}

interface HealthIssue {
  type: 'cpu' | 'memory' | 'disk' | 'process' | 'network';
  severity: 'warning' | 'critical';
  message: string;
  value: number;
  threshold: number;
  suggestions: string[];
}

interface SystemMetrics {
  timestamp: Date;
  cpu: {
    usage: number;
    loadAverage: number[];
    cores: number;
  };
  memory: {
    total: number;
    free: number;
    used: number;
    usagePercentage: number;
  };
  process: {
    pid: number;
    uptime: number;
    memoryUsage: any;
  };
  disk: {
    total: number;
    free: number;
    used: number;
    usagePercentage: number;
  };
}

interface CrashReport {
  id: string;
  timestamp: Date;
  processId: number;
  exitCode: number | null;
  signal: string | null;
  recoveryAttempts: number;
  recovered: boolean;
}

interface BackupMetadata {
  id: string;
  timestamp: Date;
  version: string;
  size: number;
  compressed: boolean;
  files: any[];
}

export const SystemMonitor: React.FC = () => {
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [healthTrends, setHealthTrends] = useState<any>(null);
  const [crashes, setCrashes] = useState<CrashReport[]>([]);
  const [backups, setBackups] = useState<BackupMetadata[]>([]);
  const [loading, setLoading] = useState(false);
  const [configModalVisible, setConfigModalVisible] = useState(false);
  const [activeTab, setActiveTab] = useState('health');
  
  const { handleApiError } = useErrorHandler();

  useEffect(() => {
    loadSystemData();
    
    // 定期更新
    const interval = setInterval(loadSystemData, 30000);
    return () => clearInterval(interval);
  }, []);

  const loadSystemData = async () => {
    try {
      setLoading(true);
      
      // ヘルス状態取得
      const healthResponse = await fetch('/api/system/health');
      if (healthResponse.ok) {
        const healthData = await healthResponse.json();
        setHealth(healthData);
      }

      // ヘルストレンド取得
      const trendsResponse = await fetch('/api/system/health/trends?hours=24');
      if (trendsResponse.ok) {
        const trendsData = await trendsResponse.json();
        setHealthTrends(trendsData);
      }

      // クラッシュ履歴取得
      const crashesResponse = await fetch('/api/system/crashes?limit=20');
      if (crashesResponse.ok) {
        const crashesData = await crashesResponse.json();
        setCrashes(crashesData.crashes);
      }

      // バックアップ一覧取得
      const backupsResponse = await fetch('/api/system/backups');
      if (backupsResponse.ok) {
        const backupsData = await backupsResponse.json();
        setBackups(backupsData.backups);
      }

    } catch (error) {
      handleApiError(error);
    } finally {
      setLoading(false);
    }
  };

  const createBackup = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/system/backups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: 'Manual backup' })
      });

      if (response.ok) {
        message.success('バックアップが作成されました');
        loadSystemData();
      } else {
        throw new Error('Backup creation failed');
      }
    } catch (error) {
      handleApiError(error);
    } finally {
      setLoading(false);
    }
  };

  const restoreBackup = async (backupId: string) => {
    Modal.confirm({
      title: 'バックアップの復元',
      content: 'このバックアップを復元しますか？現在のデータは上書きされます。',
      okText: '復元',
      cancelText: 'キャンセル',
      onOk: async () => {
        try {
          const response = await fetch(`/api/system/backups/${backupId}/restore`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              includeDatabase: true,
              includeUploads: true,
              overwriteExisting: true
            })
          });

          if (response.ok) {
            message.success('バックアップが復元されました');
          } else {
            throw new Error('Backup restore failed');
          }
        } catch (error) {
          handleApiError(error);
        }
      }
    });
  };

  const deleteBackup = async (backupId: string) => {
    Modal.confirm({
      title: 'バックアップの削除',
      content: 'このバックアップを削除しますか？',
      okText: '削除',
      cancelText: 'キャンセル',
      onOk: async () => {
        try {
          const response = await fetch(`/api/system/backups/${backupId}`, {
            method: 'DELETE'
          });

          if (response.ok) {
            message.success('バックアップが削除されました');
            loadSystemData();
          } else {
            throw new Error('Backup deletion failed');
          }
        } catch (error) {
          handleApiError(error);
        }
      }
    });
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'healthy': return 'success';
      case 'warning': return 'warning';
      case 'critical': return 'error';
      case 'down': return 'error';
      default: return 'default';
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatUptime = (seconds: number) => {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    
    if (days > 0) return `${days}日 ${hours}時間`;
    if (hours > 0) return `${hours}時間 ${minutes}分`;
    return `${minutes}分`;
  };

  const renderHealthOverview = () => (
    <Row gutter={[16, 16]}>
      <Col span={6}>
        <Card>
          <Statistic
            title="システム状態"
            value={health?.status || 'unknown'}
            valueStyle={{ color: health?.status === 'healthy' ? '#3f8600' : '#cf1322' }}
            prefix={<HeartOutlined />}
          />
        </Card>
      </Col>
      <Col span={6}>
        <Card>
          <Statistic
            title="ヘルススコア"
            value={health?.score || 0}
            suffix="/ 100"
            valueStyle={{ color: (health?.score || 0) > 80 ? '#3f8600' : '#cf1322' }}
          />
        </Card>
      </Col>
      <Col span={6}>
        <Card>
          <Statistic
            title="CPU使用率"
            value={health?.metrics.cpu.usage.toFixed(1) || 0}
            suffix="%"
            valueStyle={{ color: (health?.metrics.cpu.usage || 0) > 80 ? '#cf1322' : '#3f8600' }}
          />
        </Card>
      </Col>
      <Col span={6}>
        <Card>
          <Statistic
            title="メモリ使用率"
            value={health?.metrics.memory.usagePercentage.toFixed(1) || 0}
            suffix="%"
            valueStyle={{ color: (health?.metrics.memory.usagePercentage || 0) > 80 ? '#cf1322' : '#3f8600' }}
          />
        </Card>
      </Col>
    </Row>
  );

  const renderHealthIssues = () => {
    if (!health?.issues.length) {
      return <Alert message="問題は検出されていません" type="success" showIcon />;
    }

    return (
      <Space direction="vertical" style={{ width: '100%' }}>
        {health.issues.map((issue, index) => (
          <Alert
            key={index}
            message={issue.message}
            description={
              <div>
                <p>現在値: {issue.value.toFixed(2)} / 閾値: {issue.threshold}</p>
                <ul>
                  {issue.suggestions.map((suggestion, i) => (
                    <li key={i}>{suggestion}</li>
                  ))}
                </ul>
              </div>
            }
            type={issue.severity === 'critical' ? 'error' : 'warning'}
            showIcon
          />
        ))}
      </Space>
    );
  };

  const renderHealthTrends = () => {
    if (!healthTrends) return null;

    const data = healthTrends.timestamps.map((timestamp: string, index: number) => ({
      time: new Date(timestamp).toLocaleTimeString(),
      CPU: healthTrends.cpu[index],
      メモリ: healthTrends.memory[index],
      ディスク: healthTrends.disk[index]
    }));

    const config = {
      data,
      xField: 'time',
      yField: 'value',
      seriesField: 'category',
      smooth: true,
      animation: {
        appear: {
          animation: 'path-in',
          duration: 1000,
        },
      },
    };

    return <Line {...config} />;
  };

  const crashColumns = [
    {
      title: 'タイムスタンプ',
      dataIndex: 'timestamp',
      key: 'timestamp',
      render: (timestamp: string) => new Date(timestamp).toLocaleString()
    },
    {
      title: 'プロセスID',
      dataIndex: 'processId',
      key: 'processId'
    },
    {
      title: '終了コード',
      dataIndex: 'exitCode',
      key: 'exitCode'
    },
    {
      title: 'シグナル',
      dataIndex: 'signal',
      key: 'signal'
    },
    {
      title: '復旧試行',
      dataIndex: 'recoveryAttempts',
      key: 'recoveryAttempts'
    },
    {
      title: '状態',
      dataIndex: 'recovered',
      key: 'recovered',
      render: (recovered: boolean) => (
        <Tag color={recovered ? 'green' : 'red'}>
          {recovered ? '復旧済み' : '未復旧'}
        </Tag>
      )
    }
  ];

  const backupColumns = [
    {
      title: 'ID',
      dataIndex: 'id',
      key: 'id'
    },
    {
      title: 'タイムスタンプ',
      dataIndex: 'timestamp',
      key: 'timestamp',
      render: (timestamp: string) => new Date(timestamp).toLocaleString()
    },
    {
      title: 'サイズ',
      dataIndex: 'size',
      key: 'size',
      render: (size: number) => formatBytes(size)
    },
    {
      title: 'ファイル数',
      dataIndex: 'files',
      key: 'files',
      render: (files: any[]) => files.length
    },
    {
      title: 'アクション',
      key: 'actions',
      render: (record: BackupMetadata) => (
        <Space>
          <Button
            size="small"
            icon={<UploadOutlined />}
            onClick={() => restoreBackup(record.id)}
          >
            復元
          </Button>
          <Button
            size="small"
            danger
            icon={<DeleteOutlined />}
            onClick={() => deleteBackup(record.id)}
          >
            削除
          </Button>
        </Space>
      )
    }
  ];

  return (
    <div style={{ padding: 24 }}>
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between' }}>
        <h2>システム監視</h2>
        <Space>
          <Button
            icon={<ReloadOutlined />}
            onClick={loadSystemData}
            loading={loading}
          >
            更新
          </Button>
          <Button
            icon={<SettingOutlined />}
            onClick={() => setConfigModalVisible(true)}
          >
            設定
          </Button>
        </Space>
      </div>

      <Tabs activeKey={activeTab} onChange={setActiveTab}>
        <TabPane tab="ヘルス状態" key="health">
          <Space direction="vertical" style={{ width: '100%' }} size="large">
            {renderHealthOverview()}
            
            <Card title="システム問題">
              {renderHealthIssues()}
            </Card>
            
            <Card title="パフォーマンストレンド">
              {renderHealthTrends()}
            </Card>
          </Space>
        </TabPane>

        <TabPane tab="クラッシュ履歴" key="crashes">
          <Card
            title="クラッシュ履歴"
            extra={
              <Button
                icon={<ReloadOutlined />}
                onClick={loadSystemData}
                loading={loading}
              >
                更新
              </Button>
            }
          >
            <Table
              columns={crashColumns}
              dataSource={crashes}
              rowKey="id"
              pagination={{ pageSize: 10 }}
            />
          </Card>
        </TabPane>

        <TabPane tab="バックアップ" key="backups">
          <Card
            title="バックアップ管理"
            extra={
              <Button
                type="primary"
                icon={<DownloadOutlined />}
                onClick={createBackup}
                loading={loading}
              >
                バックアップ作成
              </Button>
            }
          >
            <Table
              columns={backupColumns}
              dataSource={backups}
              rowKey="id"
              pagination={{ pageSize: 10 }}
            />
          </Card>
        </TabPane>
      </Tabs>
    </div>
  );
};

export default SystemMonitor;