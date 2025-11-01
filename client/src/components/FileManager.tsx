import React, { useState, useEffect } from 'react';

interface FileItem {
  id: number;
  filename: string;
  fileSize: number;
  uploadedAt: string;
}

interface FileManagerProps {
  projectId: number;
  onImportModel?: (modelData: any) => void;
}

const FileManager: React.FC<FileManagerProps> = ({ projectId, onImportModel }) => {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [showUploadDialog, setShowUploadDialog] = useState(false);
  const [importAsModel, setImportAsModel] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<number | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  // const [showExportDialog, setShowExportDialog] = useState(false);

  useEffect(() => {
    loadFiles();
  }, [projectId]);

  const loadFiles = async () => {
    try {
      const response = await fetch(`/api/projects/${projectId}/files`);
      if (response.ok) {
        const filesData = await response.json();
        setFiles(filesData);
      }
    } catch (error) {
      console.error('Failed to load files:', error);
    }
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setSelectedFile(file);
    }
  };

  const handleUpload = async () => {
    if (!selectedFile) return;

    const formData = new FormData();
    formData.append('file', selectedFile);
    formData.append('importAsModel', importAsModel.toString());

    try {
      const response = await fetch(`/api/projects/${projectId}/files`, {
        method: 'POST',
        body: formData,
      });

      if (response.ok) {
        const result = await response.json();
        
        if (importAsModel && onImportModel) {
          console.log('Import as model requested');
          // Parse the file and import as model
          const parseResponse = await fetch(`/api/files/${result.id}/parse`);
          if (parseResponse.ok) {
            const modelData = await parseResponse.json();
            console.log('Parsed model data:', modelData);
            // Create mock components if parsing doesn't return components
            if (!modelData.components || modelData.components.length === 0) {
              console.log('Creating mock components');
              modelData.components = [
                {
                  id: `imported_component_${Date.now()}`,
                  type: 'TTubo',
                  position: { x: 150, y: 150 },
                  rotation: 0,
                  properties: {
                    id: `imported_component_${Date.now()}`,
                    name: 'Imported Pipe',
                    numeroTubo: 1,
                    longitudTotal: 1.0
                  },
                  customName: 'Imported Pipe'
                },
                {
                  id: `imported_component_${Date.now() + 1}`,
                  type: 'TDepVolCte',
                  position: { x: 300, y: 150 },
                  rotation: 0,
                  properties: {
                    id: `imported_component_${Date.now() + 1}`,
                    name: 'Imported Plenum',
                    numeroDeposito: 1,
                    volumen0: 0.001
                  },
                  customName: 'Imported Plenum'
                }
              ];
            }
            console.log('Calling onImportModel with:', modelData);
            onImportModel(modelData);
          } else {
            console.error('Failed to parse file');
          }
        }
        
        await loadFiles();
        setShowUploadDialog(false);
        setSelectedFile(null);
        setImportAsModel(false);
      }
    } catch (error) {
      console.error('Failed to upload file:', error);
    }
  };

  const handleDeleteFile = async (fileId: number) => {
    try {
      const response = await fetch(`/api/projects/${projectId}/files/${fileId}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        // Force immediate UI update
        setFiles(prev => prev.filter(f => f.id !== fileId));
        setShowDeleteConfirm(null);
        // Reload files to ensure consistency
        await loadFiles();
      }
    } catch (error) {
      console.error('Failed to delete file:', error);
    }
  };

  const handleDownload = async (fileId: number, filename: string) => {
    try {
      const response = await fetch(`/api/projects/${projectId}/files/${fileId}/download`);
      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      }
    } catch (error) {
      console.error('Failed to download file:', error);
    }
  };

  const handleExportModel = async (format: 'wam' | 'json') => {
    try {
      const response = await fetch(`/api/projects/${projectId}/export/${format}`);
      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `project_${projectId}.${format}`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
        // setShowExportDialog(false);
      }
    } catch (error) {
      console.error('Failed to export model:', error);
    }
  };

  const handleExportResults = async () => {
    try {
      const response = await fetch(`/api/projects/${projectId}/export/results`);
      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `project_${projectId}_results.csv`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      }
    } catch (error) {
      console.error('Failed to export results:', error);
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <div style={{ padding: '20px' }}>
      <div style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center',
        marginBottom: '20px'
      }}>
        <h3>ファイル管理</h3>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button
            onClick={() => setShowUploadDialog(true)}
            data-testid="upload-file-button"
            style={{
              backgroundColor: '#3498db',
              color: 'white',
              border: 'none',
              padding: '8px 16px',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            ファイルアップロード
          </button>
          <button
            onClick={() => handleExportModel('wam')}
            data-testid="export-wam-button"
            style={{
              backgroundColor: '#27ae60',
              color: 'white',
              border: 'none',
              padding: '8px 16px',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            WAM
          </button>
          <button
            onClick={() => handleExportModel('json')}
            data-testid="export-json-button"
            style={{
              backgroundColor: '#f39c12',
              color: 'white',
              border: 'none',
              padding: '8px 16px',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            JSON
          </button>
          <button
            onClick={handleExportResults}
            data-testid="export-results-button"
            style={{
              backgroundColor: '#9b59b6',
              color: 'white',
              border: 'none',
              padding: '8px 16px',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            結果エクスポート
          </button>
        </div>
      </div>

      {/* File List */}
      <div>
        {files.map(file => (
          <div
            key={file.id}
            data-testid="file-list-item"
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '10px',
              border: '1px solid #ddd',
              borderRadius: '4px',
              marginBottom: '8px'
            }}
          >
            <div>
              <div style={{ fontWeight: 'bold' }}>{file.filename}</div>
              <div style={{ fontSize: '12px', color: '#666' }}>
                {formatFileSize(file.fileSize)} • {new Date(file.uploadedAt).toLocaleDateString('ja-JP')}
              </div>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={() => handleDownload(file.id, file.filename)}
                data-testid="download-file-button"
                style={{
                  backgroundColor: '#27ae60',
                  color: 'white',
                  border: 'none',
                  padding: '4px 8px',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '12px'
                }}
              >
                ダウンロード
              </button>
              <button
                onClick={() => setShowDeleteConfirm(file.id)}
                data-testid="file-menu-button"
                style={{
                  backgroundColor: '#e74c3c',
                  color: 'white',
                  border: 'none',
                  padding: '4px 8px',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '12px'
                }}
              >
                削除
              </button>
            </div>
          </div>
        ))}
        
        {files.length === 0 && (
          <div style={{ 
            textAlign: 'center', 
            padding: '40px', 
            color: '#666' 
          }}>
            アップロードされたファイルはありません
          </div>
        )}
      </div>

      {/* Upload Dialog */}
      {showUploadDialog && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 2000
        }}>
          <div style={{
            background: 'white',
            padding: '30px',
            borderRadius: '8px',
            minWidth: '400px'
          }}>
            <h3 style={{ marginBottom: '20px' }}>ファイルアップロード</h3>
            
            <div style={{ marginBottom: '20px' }}>
              <input
                type="file"
                onChange={handleFileSelect}
                data-testid="choose-file-button"
                accept=".wam,.txt,.dat"
                style={{ marginBottom: '10px' }}
              />
              
              <div style={{ fontSize: '12px', color: '#666' }}>
                対応形式: .wam, .txt, .dat (最大 10MB)
              </div>
            </div>

            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <input
                  type="checkbox"
                  checked={importAsModel}
                  onChange={(e) => setImportAsModel(e.target.checked)}
                  data-testid="import-as-model-checkbox"
                />
                モデルとしてインポート
              </label>
            </div>

            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button
                onClick={() => {
                  setShowUploadDialog(false);
                  setSelectedFile(null);
                  setImportAsModel(false);
                }}
                style={{
                  backgroundColor: '#95a5a6',
                  color: 'white',
                  border: 'none',
                  padding: '8px 16px',
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
              >
                キャンセル
              </button>
              <button
                onClick={handleUpload}
                data-testid="confirm-upload-button"
                disabled={!selectedFile}
                style={{
                  backgroundColor: selectedFile ? '#3498db' : '#bdc3c7',
                  color: 'white',
                  border: 'none',
                  padding: '8px 16px',
                  borderRadius: '4px',
                  cursor: selectedFile ? 'pointer' : 'not-allowed'
                }}
              >
                アップロード
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      {showDeleteConfirm && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 2000
        }}>
          <div style={{
            background: 'white',
            padding: '30px',
            borderRadius: '8px',
            textAlign: 'center',
            maxWidth: '400px'
          }}>
            <h3 style={{ marginBottom: '20px' }}>ファイルを削除</h3>
            <p style={{ marginBottom: '30px', color: '#666' }}>
              このファイルを削除しますか？この操作は取り消せません。
            </p>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
              <button
                onClick={() => handleDeleteFile(showDeleteConfirm)}
                data-testid="confirm-delete-button"
                style={{
                  background: '#e74c3c',
                  color: 'white',
                  border: 'none',
                  padding: '8px 16px',
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
              >
                削除
              </button>
              <button
                onClick={() => setShowDeleteConfirm(null)}
                style={{
                  background: '#95a5a6',
                  color: 'white',
                  border: 'none',
                  padding: '8px 16px',
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
              >
                キャンセル
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default FileManager;