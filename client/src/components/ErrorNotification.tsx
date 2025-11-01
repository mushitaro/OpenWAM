/**
 * エラー通知コンポーネント
 * ユーザーフレンドリーなエラーメッセージとアクションを表示
 */

import React, { useState, useEffect } from 'react';
import { Alert, Button, Collapse, Typography, Space, List } from 'antd';
import { 
  ExclamationCircleOutlined, 
  InfoCircleOutlined, 
  WarningOutlined,
  CloseOutlined,
  ReloadOutlined,
  CustomerServiceOutlined,
  FileTextOutlined
} from '@ant-design/icons';

const { Text, Paragraph } = Typography;

export interface ErrorNotificationProps {
  type: 'error' | 'warning' | 'info';
  title: string;
  message: string;
  suggestions?: string[];
  actions?: NotificationAction[];
  persistent?: boolean;
  autoClose?: number;
  onClose?: () => void;
  visible?: boolean;
}

export interface NotificationAction {
  label: string;
  action: 'retry' | 'dismiss' | 'contact_support' | 'view_logs' | 'custom';
  handler?: () => void;
}

export const ErrorNotification: React.FC<ErrorNotificationProps> = ({
  type,
  title,
  message,
  suggestions = [],
  actions = [],
  persistent = false,
  autoClose,
  onClose,
  visible = true
}) => {
  const [isVisible, setIsVisible] = useState(visible);
  const [showDetails, setShowDetails] = useState(false);

  useEffect(() => {
    setIsVisible(visible);
  }, [visible]);

  useEffect(() => {
    if (autoClose && !persistent && isVisible) {
      const timer = setTimeout(() => {
        handleClose();
      }, autoClose);

      return () => clearTimeout(timer);
    }
  }, [autoClose, persistent, isVisible]);

  const handleClose = () => {
    setIsVisible(false);
    onClose?.();
  };

  const handleAction = (action: NotificationAction) => {
    if (action.handler) {
      action.handler();
    } else {
      // デフォルトアクション
      switch (action.action) {
        case 'dismiss':
          handleClose();
          break;
        case 'retry':
          // 親コンポーネントで処理
          break;
        case 'contact_support':
          // サポート連絡機能
          window.open('mailto:support@example.com', '_blank');
          break;
        case 'view_logs':
          // ログ表示機能
          console.log('View logs requested');
          break;
      }
    }
  };

  const getIcon = () => {
    switch (type) {
      case 'error':
        return <ExclamationCircleOutlined />;
      case 'warning':
        return <WarningOutlined />;
      case 'info':
        return <InfoCircleOutlined />;
      default:
        return <InfoCircleOutlined />;
    }
  };

  const getActionIcon = (actionType: string) => {
    switch (actionType) {
      case 'retry':
        return <ReloadOutlined />;
      case 'contact_support':
        return <CustomerServiceOutlined />;
      case 'view_logs':
        return <FileTextOutlined />;
      case 'dismiss':
        return <CloseOutlined />;
      default:
        return null;
    }
  };

  if (!isVisible) {
    return null;
  }

  return (
    <Alert
      type={type}
      showIcon
      icon={getIcon()}
      message={
        <div>
          <Text strong>{title}</Text>
          {!persistent && (
            <Button
              type="text"
              size="small"
              icon={<CloseOutlined />}
              onClick={handleClose}
              style={{ float: 'right', marginTop: -4 }}
            />
          )}
        </div>
      }
      description={
        <div>
          <Paragraph style={{ marginBottom: 8 }}>
            {message}
          </Paragraph>

          {suggestions.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <Button
                type="link"
                size="small"
                onClick={() => setShowDetails(!showDetails)}
                style={{ padding: 0, height: 'auto' }}
              >
                {showDetails ? '詳細を隠す' : '解決方法を表示'}
              </Button>
              
              <Collapse ghost activeKey={showDetails ? ['suggestions'] : []}>
                <Collapse.Panel key="suggestions" header="" showArrow={false}>
                  <List
                    size="small"
                    dataSource={suggestions}
                    renderItem={(suggestion, index) => (
                      <List.Item style={{ padding: '4px 0' }}>
                        <Text type="secondary">
                          {index + 1}. {suggestion}
                        </Text>
                      </List.Item>
                    )}
                  />
                </Collapse.Panel>
              </Collapse>
            </div>
          )}

          {actions.length > 0 && (
            <Space wrap>
              {actions.map((action, index) => (
                <Button
                  key={index}
                  size="small"
                  type={action.action === 'retry' ? 'primary' : 'default'}
                  icon={getActionIcon(action.action)}
                  onClick={() => handleAction(action)}
                >
                  {action.label}
                </Button>
              ))}
            </Space>
          )}
        </div>
      }
      style={{
        marginBottom: 16,
        border: `1px solid ${
          type === 'error' ? '#ff4d4f' : 
          type === 'warning' ? '#faad14' : 
          '#1890ff'
        }`
      }}
    />
  );
};

export default ErrorNotification;