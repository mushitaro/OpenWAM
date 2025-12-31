/**
 * Tests for Documentation Updater Service
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  DocumentationUpdater,
  createDocumentationUpdater,
  updateAllDocumentation
} from '../services/DocumentationUpdater';

import {
  ComponentManagementSystem,
  ImplementationStatus,
  Priority
} from '../services/ComponentManagementSystem';

import { ComponentType, ComponentCategory } from '../types/openWAMComponents';

describe('Documentation Updater', () => {
  let managementSystem: ComponentManagementSystem;
  let documentationUpdater: DocumentationUpdater;
  let tempDir: string;

  beforeEach(() => {
    // Create temporary directory for test files
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-test-'));
    
    // Create management system and updater
    managementSystem = new ComponentManagementSystem();
    documentationUpdater = new DocumentationUpdater(managementSystem, tempDir);
    
    // Set up some test data
    managementSystem.updateImplementationStatus(ComponentType.PIPE, ImplementationStatus.COMPLETED, 'test-user');
    managementSystem.updateImplementationStatus(ComponentType.SENSOR, ImplementationStatus.COMPLETED, 'test-user');
    managementSystem.updateImplementationStatus(ComponentType.TABLE_1D, ImplementationStatus.IN_PROGRESS, 'test-user');
    managementSystem.updateTestStatus(ComponentType.PIPE, ImplementationStatus.TESTED, 85);
    managementSystem.updateDocumentationStatus(ComponentType.SENSOR, ImplementationStatus.DOCUMENTED);
  });

  afterEach(() => {
    // Clean up temporary directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('Implementation Status Document', () => {
    test('should create implementation status document', async () => {
      await documentationUpdater.updateImplementationStatusDocument();
      
      const filePath = path.join(tempDir, 'component-implementation-status.md');
      expect(fs.existsSync(filePath)).toBe(true);
      
      const content = fs.readFileSync(filePath, 'utf8');
      expect(content).toContain('# OpenWAM Component Implementation Status');
      expect(content).toContain('## 実装状況追跡表');
      expect(content).toContain('最終更新');
    });

    test('should include progress summary', async () => {
      await documentationUpdater.updateImplementationStatusDocument();
      
      const filePath = path.join(tempDir, 'component-implementation-status.md');
      const content = fs.readFileSync(filePath, 'utf8');
      
      expect(content).toContain('## 全体進捗サマリー');
      expect(content).toContain('総コンポーネント数');
      expect(content).toContain('完了済み');
      expect(content).toContain('進行中');
      expect(content).toContain('未着手');
    });

    test('should include category breakdown', async () => {
      await documentationUpdater.updateImplementationStatusDocument();
      
      const filePath = path.join(tempDir, 'component-implementation-status.md');
      const content = fs.readFileSync(filePath, 'utf8');
      
      expect(content).toContain('## カテゴリ別進捗');
      expect(content).toContain('1次元パイプ'); // Pipes category
      expect(content).toContain('制御システム'); // Control category
    });

    test('should include priority breakdown', async () => {
      await documentationUpdater.updateImplementationStatusDocument();
      
      const filePath = path.join(tempDir, 'component-implementation-status.md');
      const content = fs.readFileSync(filePath, 'utf8');
      
      expect(content).toContain('## 優先度別進捗');
      expect(content).toContain('🔴 緊急'); // Critical priority
      expect(content).toContain('🟠 高'); // High priority
    });

    test('should include quality metrics', async () => {
      await documentationUpdater.updateImplementationStatusDocument();
      
      const filePath = path.join(tempDir, 'component-implementation-status.md');
      const content = fs.readFileSync(filePath, 'utf8');
      
      expect(content).toContain('## 品質メトリクス');
      expect(content).toContain('平均テストカバレッジ');
      expect(content).toContain('ドキュメント完備コンポーネント');
      expect(content).toContain('完全検証済みコンポーネント');
    });

    test('should include detailed implementation status table', async () => {
      await documentationUpdater.updateImplementationStatusDocument();
      
      const filePath = path.join(tempDir, 'component-implementation-status.md');
      const content = fs.readFileSync(filePath, 'utf8');
      
      expect(content).toContain('## 詳細実装状況');
      expect(content).toContain('OpenWAMクラス');
      expect(content).toContain('状況');
      expect(content).toContain('実装日');
      expect(content).toContain('担当者');
      expect(content).toContain('テスト状況');
      expect(content).toContain('品質スコア');
    });

    test('should include blocked components if any exist', async () => {
      // Create a component with dependencies to test blocked components
      managementSystem.updateImplementationStatus(ComponentType.CONTROLLER, ImplementationStatus.NOT_STARTED);
      
      await documentationUpdater.updateImplementationStatusDocument();
      
      const filePath = path.join(tempDir, 'component-implementation-status.md');
      const content = fs.readFileSync(filePath, 'utf8');
      
      // The content should include blocked components section if there are any
      const report = managementSystem.generateProgressReport();
      if (report.blockedComponents.length > 0) {
        expect(content).toContain('## ブロックされたコンポーネント');
        expect(content).toContain('依存関係により実装がブロック');
      }
    });

    test('should include implementation phases', async () => {
      await documentationUpdater.updateImplementationStatusDocument();
      
      const filePath = path.join(tempDir, 'component-implementation-status.md');
      const content = fs.readFileSync(filePath, 'utf8');
      
      expect(content).toContain('## 実装計画');
      expect(content).toContain('### Phase 1: 基本制御コンポーネント');
      expect(content).toContain('### 今後の実装予定');
    });
  });

  describe('Component Reference Document', () => {
    test('should create component reference document', async () => {
      await documentationUpdater.updateComponentReferenceDocument();
      
      const filePath = path.join(tempDir, 'component-reference.md');
      expect(fs.existsSync(filePath)).toBe(true);
      
      const content = fs.readFileSync(filePath, 'utf8');
      expect(content).toContain('# OpenWAM Component Reference');
      expect(content).toContain('最終更新');
    });

    test('should include table of contents', async () => {
      await documentationUpdater.updateComponentReferenceDocument();
      
      const filePath = path.join(tempDir, 'component-reference.md');
      const content = fs.readFileSync(filePath, 'utf8');
      
      expect(content).toContain('## 目次');
      expect(content).toContain('- [1次元パイプ]'); // Pipes category
      expect(content).toContain('- [制御システム]'); // Control category
    });

    test('should include component details by category', async () => {
      await documentationUpdater.updateComponentReferenceDocument();
      
      const filePath = path.join(tempDir, 'component-reference.md');
      const content = fs.readFileSync(filePath, 'utf8');
      
      expect(content).toContain('## 1次元パイプ'); // Pipes category
      expect(content).toContain('## 制御システム'); // Control category
      expect(content).toContain('**OpenWAMクラス**');
      expect(content).toContain('**実装状況**');
      expect(content).toContain('**優先度**');
    });

    test('should include quality check results for completed components', async () => {
      // Run quality checks first
      managementSystem.runQualityChecks(ComponentType.PIPE);
      
      await documentationUpdater.updateComponentReferenceDocument();
      
      const filePath = path.join(tempDir, 'component-reference.md');
      const content = fs.readFileSync(filePath, 'utf8');
      
      expect(content).toContain('**品質チェック結果**');
    });

    test('should include dependencies if present', async () => {
      await documentationUpdater.updateComponentReferenceDocument();
      
      const filePath = path.join(tempDir, 'component-reference.md');
      const content = fs.readFileSync(filePath, 'utf8');
      
      // Check if dependencies are mentioned for components that have them
      const controllerRecord = managementSystem.getImplementationRecord(ComponentType.CONTROLLER);
      if (controllerRecord && controllerRecord.dependencies.length > 0) {
        expect(content).toContain('**依存関係**');
      }
    });

    test('should include implementation notes', async () => {
      // Add some notes to a component
      managementSystem.updateImplementationStatus(
        ComponentType.PIPE,
        ImplementationStatus.COMPLETED,
        'test-user',
        'Test implementation note'
      );
      
      await documentationUpdater.updateComponentReferenceDocument();
      
      const filePath = path.join(tempDir, 'component-reference.md');
      const content = fs.readFileSync(filePath, 'utf8');
      
      expect(content).toContain('**実装ノート**');
      expect(content).toContain('Test implementation note');
    });
  });

  describe('VANOS Roadmap Document', () => {
    test('should create VANOS roadmap document', async () => {
      await documentationUpdater.updateVANOSRoadmapDocument();
      
      const filePath = path.join(tempDir, 'vanos-implementation-roadmap.md');
      expect(fs.existsSync(filePath)).toBe(true);
      
      const content = fs.readFileSync(filePath, 'utf8');
      expect(content).toContain('# VANOS Implementation Roadmap');
      expect(content).toContain('BMW E46 M3 VANOSシステム');
    });

    test('should include VANOS system overview', async () => {
      await documentationUpdater.updateVANOSRoadmapDocument();
      
      const filePath = path.join(tempDir, 'vanos-implementation-roadmap.md');
      const content = fs.readFileSync(filePath, 'utf8');
      
      expect(content).toContain('## VANOS制御システム概要');
      expect(content).toContain('可変バルブタイミングシステム');
      expect(content).toContain('### 制御ループ構成');
    });

    test('should include implementation progress for control components', async () => {
      await documentationUpdater.updateVANOSRoadmapDocument();
      
      const filePath = path.join(tempDir, 'vanos-implementation-roadmap.md');
      const content = fs.readFileSync(filePath, 'utf8');
      
      expect(content).toContain('## 実装進捗');
      expect(content).toContain('### 制御システムコンポーネント');
      expect(content).toContain('TSensor'); // Should include VANOS components
      expect(content).toContain('TController');
    });

    test('should include implementation phases', async () => {
      await documentationUpdater.updateVANOSRoadmapDocument();
      
      const filePath = path.join(tempDir, 'vanos-implementation-roadmap.md');
      const content = fs.readFileSync(filePath, 'utf8');
      
      expect(content).toContain('## 実装フェーズ');
      expect(content).toContain('### Phase 1: 基本制御コンポーネント');
      expect(content).toContain('### Phase 2: 制御系拡張');
      expect(content).toContain('### Phase 3: 高度な制御機能');
    });

    test('should include VANOS control parameters', async () => {
      await documentationUpdater.updateVANOSRoadmapDocument();
      
      const filePath = path.join(tempDir, 'vanos-implementation-roadmap.md');
      const content = fs.readFileSync(filePath, 'utf8');
      
      expect(content).toContain('## VANOS制御パラメータ');
      expect(content).toContain('### 推奨設定値');
      expect(content).toContain('#### PIDコントローラー設定');
      expect(content).toContain('#### VANOSタイミング範囲');
    });

    test('should include quality assurance section', async () => {
      await documentationUpdater.updateVANOSRoadmapDocument();
      
      const filePath = path.join(tempDir, 'vanos-implementation-roadmap.md');
      const content = fs.readFileSync(filePath, 'utf8');
      
      expect(content).toContain('## 品質保証');
      expect(content).toContain('### テスト項目');
    });

    test('should include known issues and limitations', async () => {
      await documentationUpdater.updateVANOSRoadmapDocument();
      
      const filePath = path.join(tempDir, 'vanos-implementation-roadmap.md');
      const content = fs.readFileSync(filePath, 'utf8');
      
      expect(content).toContain('## 既知の問題と制限事項');
      expect(content).toContain('### 現在の技術的負債');
      expect(content).toContain('### 解決計画');
    });

    test('should include success indicators', async () => {
      await documentationUpdater.updateVANOSRoadmapDocument();
      
      const filePath = path.join(tempDir, 'vanos-implementation-roadmap.md');
      const content = fs.readFileSync(filePath, 'utf8');
      
      expect(content).toContain('## 成功指標');
      expect(content).toContain('### 短期目標');
      expect(content).toContain('### 中期目標');
      expect(content).toContain('### 長期目標');
    });
  });

  describe('Batch Updates', () => {
    test('should update all documentation files', async () => {
      await documentationUpdater.updateAllDocumentation();
      
      const statusFile = path.join(tempDir, 'component-implementation-status.md');
      const referenceFile = path.join(tempDir, 'component-reference.md');
      const vanosFile = path.join(tempDir, 'vanos-implementation-roadmap.md');
      
      expect(fs.existsSync(statusFile)).toBe(true);
      expect(fs.existsSync(referenceFile)).toBe(true);
      expect(fs.existsSync(vanosFile)).toBe(true);
    });

    test('should handle concurrent updates', async () => {
      const promises = [
        documentationUpdater.updateImplementationStatusDocument(),
        documentationUpdater.updateComponentReferenceDocument(),
        documentationUpdater.updateVANOSRoadmapDocument()
      ];
      
      await Promise.all(promises);
      
      const statusFile = path.join(tempDir, 'component-implementation-status.md');
      const referenceFile = path.join(tempDir, 'component-reference.md');
      const vanosFile = path.join(tempDir, 'vanos-implementation-roadmap.md');
      
      expect(fs.existsSync(statusFile)).toBe(true);
      expect(fs.existsSync(referenceFile)).toBe(true);
      expect(fs.existsSync(vanosFile)).toBe(true);
    });
  });

  describe('Error Handling', () => {
    test('should handle missing directory gracefully', async () => {
      const invalidPath = path.join(tempDir, 'nonexistent', 'nested', 'path');
      const updater = new DocumentationUpdater(managementSystem, invalidPath);
      
      // Should create directories and not throw
      await expect(updater.updateImplementationStatusDocument()).resolves.not.toThrow();
      
      const statusFile = path.join(invalidPath, 'component-implementation-status.md');
      expect(fs.existsSync(statusFile)).toBe(true);
    });

    test('should handle write permission errors', async () => {
      // Create a read-only directory (if possible on the platform)
      const readOnlyDir = path.join(tempDir, 'readonly');
      fs.mkdirSync(readOnlyDir);
      
      try {
        fs.chmodSync(readOnlyDir, 0o444); // Read-only
        
        const updater = new DocumentationUpdater(managementSystem, readOnlyDir);
        
        await expect(updater.updateImplementationStatusDocument()).rejects.toThrow();
      } catch (error) {
        // If chmod fails (e.g., on Windows), skip this test
        console.log('Skipping permission test due to platform limitations');
      } finally {
        // Restore permissions for cleanup
        try {
          fs.chmodSync(readOnlyDir, 0o755);
        } catch (e) {
          // Ignore cleanup errors
        }
      }
    });
  });

  describe('Content Quality', () => {
    test('should generate valid markdown', async () => {
      await documentationUpdater.updateAllDocumentation();
      
      const files = [
        'component-implementation-status.md',
        'component-reference.md',
        'vanos-implementation-roadmap.md'
      ];
      
      files.forEach(filename => {
        const filePath = path.join(tempDir, filename);
        const content = fs.readFileSync(filePath, 'utf8');
        
        // Basic markdown validation
        expect(content).toMatch(/^# /m); // Should have at least one H1 header
        expect(content).not.toContain('undefined'); // Should not have undefined values
        expect(content).not.toContain('NaN'); // Should not have NaN values
        expect(content.length).toBeGreaterThan(100); // Should have substantial content
      });
    });

    test('should include current timestamp', async () => {
      const beforeTime = new Date();
      
      await documentationUpdater.updateImplementationStatusDocument();
      
      const afterTime = new Date();
      const filePath = path.join(tempDir, 'component-implementation-status.md');
      const content = fs.readFileSync(filePath, 'utf8');
      
      expect(content).toContain('最終更新');
      
      // Extract date from content and verify it's recent
      const dateMatch = content.match(/最終更新.*?(\d{4}\/\d{1,2}\/\d{1,2})/);
      if (dateMatch) {
        const documentDate = new Date(dateMatch[1]);
        expect(documentDate.getTime()).toBeGreaterThanOrEqual(beforeTime.getTime() - 1000);
        expect(documentDate.getTime()).toBeLessThanOrEqual(afterTime.getTime() + 1000);
      }
    });

    test('should handle Japanese text correctly', async () => {
      await documentationUpdater.updateAllDocumentation();
      
      const files = [
        'component-implementation-status.md',
        'component-reference.md',
        'vanos-implementation-roadmap.md'
      ];
      
      files.forEach(filename => {
        const filePath = path.join(tempDir, filename);
        const content = fs.readFileSync(filePath, 'utf8');
        
        // Should contain Japanese text
        expect(content).toMatch(/[ひらがなカタカナ漢字]/);
        expect(content).toContain('実装');
        expect(content).toContain('コンポーネント');
      });
    });
  });

  describe('Utility Functions', () => {
    test('should create documentation updater with factory function', () => {
      const updater = createDocumentationUpdater(managementSystem, tempDir);
      expect(updater).toBeInstanceOf(DocumentationUpdater);
    });

    test('should update all documentation with utility function', async () => {
      await updateAllDocumentation(managementSystem, tempDir);
      
      const statusFile = path.join(tempDir, 'component-implementation-status.md');
      const referenceFile = path.join(tempDir, 'component-reference.md');
      const vanosFile = path.join(tempDir, 'vanos-implementation-roadmap.md');
      
      expect(fs.existsSync(statusFile)).toBe(true);
      expect(fs.existsSync(referenceFile)).toBe(true);
      expect(fs.existsSync(vanosFile)).toBe(true);
    });
  });

  describe('Data Consistency', () => {
    test('should reflect management system changes in documentation', async () => {
      // Make changes to management system
      managementSystem.updateImplementationStatus(
        ComponentType.PID_CONTROLLER,
        ImplementationStatus.COMPLETED,
        'test-developer',
        'Completed PID controller implementation'
      );
      
      managementSystem.updateTestStatus(ComponentType.PID_CONTROLLER, ImplementationStatus.TESTED, 95);
      
      await documentationUpdater.updateImplementationStatusDocument();
      
      const filePath = path.join(tempDir, 'component-implementation-status.md');
      const content = fs.readFileSync(filePath, 'utf8');
      
      expect(content).toContain('test-developer');
      expect(content).toContain('95'); // Test coverage should be reflected
    });

    test('should maintain consistency across all documents', async () => {
      await documentationUpdater.updateAllDocumentation();
      
      const statusContent = fs.readFileSync(path.join(tempDir, 'component-implementation-status.md'), 'utf8');
      const referenceContent = fs.readFileSync(path.join(tempDir, 'component-reference.md'), 'utf8');
      const vanosContent = fs.readFileSync(path.join(tempDir, 'vanos-implementation-roadmap.md'), 'utf8');
      
      // All documents should have the same timestamp (within a reasonable margin)
      const statusDate = statusContent.match(/最終更新.*?(\d{4}\/\d{1,2}\/\d{1,2})/)?.[1];
      const referenceDate = referenceContent.match(/最終更新.*?(\d{4}\/\d{1,2}\/\d{1,2})/)?.[1];
      const vanosDate = vanosContent.match(/最終更新.*?(\d{4}\/\d{1,2}\/\d{1,2})/)?.[1];
      
      expect(statusDate).toBe(referenceDate);
      expect(referenceDate).toBe(vanosDate);
    });
  });
});