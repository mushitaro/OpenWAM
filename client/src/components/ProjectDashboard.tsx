import React, { useState, useEffect } from 'react';

interface Project {
  id: number;
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
}

interface ProjectDashboardProps {
  onOpenProject: (projectId: number) => void;
  onCreateProject: (name: string, description: string) => void;
}

const ProjectDashboard: React.FC<ProjectDashboardProps> = ({
  onOpenProject,
  onCreateProject
}) => {
  const [projects, setProjects] = useState<Project[]>([]);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectDescription, setNewProjectDescription] = useState('');
  const [loading, setLoading] = useState(true);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<number | null>(null);

  // Load projects from API
  useEffect(() => {
    const loadProjects = async () => {
      try {
        const response = await fetch('/api/projects');
        if (response.ok) {
          const projectsData = await response.json();
          setProjects(projectsData);
        }
      } catch (error) {
        console.error('Failed to load projects:', error);
      } finally {
        setLoading(false);
      }
    };

    loadProjects();
  }, []);

  const handleCreateProject = async () => {
    if (!newProjectName.trim()) return;

    try {
      const response = await fetch('/api/projects', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: newProjectName,
          description: newProjectDescription,
        }),
      });

      if (response.ok) {
        const newProject = await response.json();
        setProjects(prev => [...prev, newProject]);
        setNewProjectName('');
        setNewProjectDescription('');
        setShowCreateForm(false);
        onCreateProject(newProject.name, newProject.description);
        onOpenProject(newProject.id);
      }
    } catch (error) {
      console.error('Failed to create project:', error);
    }
  };

  const handleDeleteProject = async (projectId: number) => {
    try {
      const response = await fetch(`/api/projects/${projectId}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        // Force immediate UI update
        setProjects(prev => prev.filter(p => p.id !== projectId));
        setShowDeleteConfirm(null);
        // Force re-render by reloading projects
        const reloadResponse = await fetch('/api/projects');
        if (reloadResponse.ok) {
          const projectsData = await reloadResponse.json();
          setProjects(projectsData);
        }
      }
    } catch (error) {
      console.error('Failed to delete project:', error);
    }
  };

  if (loading) {
    return (
      <div style={{ 
        display: 'flex', 
        justifyContent: 'center', 
        alignItems: 'center', 
        height: '100vh' 
      }}>
        <div>プロジェクトを読み込み中...</div>
      </div>
    );
  }

  return (
    <div style={{ 
      padding: '40px', 
      maxWidth: '1200px', 
      margin: '0 auto',
      backgroundColor: '#f8f9fa',
      minHeight: '100vh'
    }}>
      <div style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center',
        marginBottom: '30px'
      }}>
        <h1 style={{ 
          fontSize: '32px', 
          color: '#2c3e50',
          margin: 0
        }}>
          OpenWAM プロジェクト
        </h1>
        <button
          onClick={() => setShowCreateForm(true)}
          data-testid="new-project-button"
          style={{
            backgroundColor: '#3498db',
            color: 'white',
            border: 'none',
            padding: '12px 24px',
            borderRadius: '6px',
            fontSize: '16px',
            cursor: 'pointer',
            fontWeight: 'bold'
          }}
        >
          新規プロジェクト
        </button>
      </div>

      {showCreateForm && (
        <div style={{
          backgroundColor: 'white',
          padding: '30px',
          borderRadius: '8px',
          marginBottom: '30px',
          boxShadow: '0 2px 10px rgba(0,0,0,0.1)'
        }}>
          <h3 style={{ marginBottom: '20px', color: '#2c3e50' }}>新規プロジェクト作成</h3>
          <div style={{ marginBottom: '15px' }}>
            <label style={{ 
              display: 'block', 
              marginBottom: '5px', 
              fontWeight: 'bold',
              color: '#34495e'
            }}>
              プロジェクト名
            </label>
            <input
              type="text"
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              data-testid="project-name-input"
              style={{
                width: '100%',
                padding: '10px',
                border: '1px solid #ddd',
                borderRadius: '4px',
                fontSize: '16px'
              }}
              placeholder="プロジェクト名を入力"
            />
          </div>
          <div style={{ marginBottom: '20px' }}>
            <label style={{ 
              display: 'block', 
              marginBottom: '5px', 
              fontWeight: 'bold',
              color: '#34495e'
            }}>
              説明
            </label>
            <textarea
              value={newProjectDescription}
              onChange={(e) => setNewProjectDescription(e.target.value)}
              data-testid="project-description-input"
              style={{
                width: '100%',
                padding: '10px',
                border: '1px solid #ddd',
                borderRadius: '4px',
                fontSize: '16px',
                minHeight: '80px',
                resize: 'vertical'
              }}
              placeholder="プロジェクトの説明を入力（任意）"
            />
          </div>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              onClick={handleCreateProject}
              data-testid="create-project-button"
              style={{
                backgroundColor: '#27ae60',
                color: 'white',
                border: 'none',
                padding: '10px 20px',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '16px'
              }}
            >
              作成
            </button>
            <button
              onClick={() => {
                setShowCreateForm(false);
                setNewProjectName('');
                setNewProjectDescription('');
              }}
              style={{
                backgroundColor: '#95a5a6',
                color: 'white',
                border: 'none',
                padding: '10px 20px',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '16px'
              }}
            >
              キャンセル
            </button>
          </div>
        </div>
      )}

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))',
        gap: '20px'
      }}>
        {projects.map(project => (
          <div
            key={project.id}
            data-testid="project-list-item"
            style={{
              backgroundColor: 'white',
              padding: '25px',
              borderRadius: '8px',
              boxShadow: '0 2px 10px rgba(0,0,0,0.1)',
              cursor: 'pointer',
              transition: 'transform 0.2s, box-shadow 0.2s',
              position: 'relative'
            }}
            onClick={() => onOpenProject(project.id)}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-2px)';
              e.currentTarget.style.boxShadow = '0 4px 20px rgba(0,0,0,0.15)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0)';
              e.currentTarget.style.boxShadow = '0 2px 10px rgba(0,0,0,0.1)';
            }}
          >
            <div style={{ 
              position: 'absolute', 
              top: '15px', 
              right: '15px' 
            }}>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setShowDeleteConfirm(project.id);
                }}
                data-testid="delete-project-button"
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: '18px',
                  cursor: 'pointer',
                  color: '#7f8c8d',
                  padding: '5px'
                }}
                title="削除"
              >
                ×
              </button>
            </div>
            
            <h3 style={{ 
              marginBottom: '10px', 
              color: '#2c3e50',
              fontSize: '20px'
            }}>
              {project.name}
            </h3>
            
            {project.description && (
              <p style={{ 
                marginBottom: '15px', 
                color: '#7f8c8d',
                lineHeight: '1.5'
              }}>
                {project.description}
              </p>
            )}
            
            <div style={{ 
              fontSize: '12px', 
              color: '#95a5a6',
              borderTop: '1px solid #ecf0f1',
              paddingTop: '15px'
            }}>
              <div>作成日: {new Date(project.created_at).toLocaleDateString('ja-JP')}</div>
              <div>更新日: {new Date(project.updated_at).toLocaleDateString('ja-JP')}</div>
            </div>
          </div>
        ))}
      </div>

      {projects.length === 0 && (
        <div style={{
          textAlign: 'center',
          padding: '60px 20px',
          color: '#7f8c8d'
        }}>
          <h3 style={{ marginBottom: '15px' }}>プロジェクトがありません</h3>
          <p>「新規プロジェクト」ボタンをクリックして最初のプロジェクトを作成してください。</p>
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
            <h3 style={{ marginBottom: '20px', color: '#2c3e50' }}>
              プロジェクトを削除
            </h3>
            <p style={{ marginBottom: '30px', color: '#7f8c8d' }}>
              このプロジェクトを削除しますか？この操作は取り消せません。
            </p>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
              <button
                onClick={() => handleDeleteProject(showDeleteConfirm)}
                data-testid="confirm-delete-button"
                style={{
                  background: '#e74c3c',
                  color: 'white',
                  border: 'none',
                  padding: '10px 20px',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '16px'
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
                  padding: '10px 20px',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '16px'
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

export default ProjectDashboard;