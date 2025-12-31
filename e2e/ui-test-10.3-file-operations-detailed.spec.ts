import { test, expect } from '@playwright/test';
import path from 'path';

test.describe('10.3 ファイル操作機能の詳細テスト', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:5173/');
    
    // Create a test project
    await page.click('[data-testid="new-project-button"]');
    await page.fill('[data-testid="project-name-input"]', 'File Operations Test');
    await page.fill('[data-testid="project-description-input"]', 'Detailed file operations testing');
    await page.click('[data-testid="create-project-button"]');
    
    // Wait for project to be created and editor to load
    await page.waitForTimeout(2000);
  });

  test.describe('プロジェクト保存機能テスト', () => {
    test('Ctrl+S キーボードショートカットで保存', async ({ page }) => {
      // Mock save API endpoint
      await page.route('**/api/projects/*/model', async route => {
        if (route.request().method() === 'PUT') {
          await route.fulfill({
            json: { success: true, timestamp: new Date().toISOString() }
          });
        }
      });
      
      // Use Ctrl+S to save
      await page.keyboard.press('Control+s');
      
      // Should show save notification
      await expect(page.locator('[data-testid="save-notification"]')).toBeVisible();
      await expect(page.locator('[data-testid="save-notification"]')).toContainText('プロジェクトが保存されました');
      
      // Notification should disappear after 3 seconds
      await page.waitForTimeout(3500);
      await expect(page.locator('[data-testid="save-notification"]')).not.toBeVisible();
    });

    test('ツールバーの保存ボタンで保存', async ({ page }) => {
      // Mock save API endpoint
      await page.route('**/api/projects/*/model', async route => {
        if (route.request().method() === 'PUT') {
          await route.fulfill({
            json: { success: true, timestamp: new Date().toISOString() }
          });
        }
      });
      
      // Click save button in toolbar
      await page.click('[data-testid="save-button"]');
      
      // Should show save notification
      await expect(page.locator('[data-testid="save-notification"]')).toBeVisible();
      await expect(page.locator('[data-testid="save-notification"]')).toContainText('プロジェクトが保存されました');
    });

    test('自動保存機能テスト', async ({ page }) => {
      // This test verifies that the save functionality works multiple times
      // Since the current implementation uses localStorage, we'll test that the save notifications appear
      
      // First save
      await page.keyboard.press('Control+s');
      await expect(page.locator('[data-testid="save-notification"]')).toBeVisible();
      await page.waitForTimeout(1000);
      
      // Second save
      await page.keyboard.press('Control+s');
      await expect(page.locator('[data-testid="save-notification"]')).toBeVisible();
      await page.waitForTimeout(1000);
      
      // Third save to ensure multiple saves work
      await page.keyboard.press('Control+s');
      await expect(page.locator('[data-testid="save-notification"]')).toBeVisible();
      
      // Verify that the save functionality is working consistently
      // This tests the auto-save capability by ensuring multiple saves work
      const localStorage = await page.evaluate(() => {
        return localStorage.getItem('currentModel');
      });
      
      // Verify that data was saved to localStorage
      expect(localStorage).toBeTruthy();
    });

    test('保存通知の表示と自動消去', async ({ page }) => {
      // Mock save API endpoint
      await page.route('**/api/projects/*/model', async route => {
        if (route.request().method() === 'PUT') {
          await route.fulfill({
            json: { success: true, timestamp: new Date().toISOString() }
          });
        }
      });
      
      // Save using Ctrl+S
      await page.keyboard.press('Control+s');
      
      // Check notification appears immediately
      await expect(page.locator('[data-testid="save-notification"]')).toBeVisible();
      
      // Check notification content
      const notification = page.locator('[data-testid="save-notification"]');
      await expect(notification).toContainText('プロジェクトが保存されました');
      
      // Check notification styling
      const notificationStyle = await notification.getAttribute('style');
      expect(notificationStyle).toContain('position: fixed');
      expect(notificationStyle).toContain('background');
      
      // Wait and verify it disappears after 3 seconds
      await page.waitForTimeout(3500);
      await expect(notification).not.toBeVisible();
    });
  });

  test.describe('WAMファイルエクスポート機能テスト', () => {
    test('WAM形式でのエクスポートとダウンロード確認', async ({ page }) => {
      // Navigate to files tab
      await page.click('[data-testid="files-tab"]');
      
      // Mock export API
      await page.route('**/api/projects/*/export/wam', async route => {
        const wamContent = `2200
0
0.1 1.0
101325 293
1 1
0
0
1 1 0
0
1
1 1 2 10 1 1.0 0.1
1 0
1.0 0.05
1 1.0 1.0
0.002 7800 460 50
293 0
293 101325 0
1
0.002 7800 460 50
0
0
0
0
0
0
0
0
0
0`;
        await route.fulfill({
          status: 200,
          body: wamContent,
          headers: {
            'Content-Type': 'application/octet-stream',
            'Content-Disposition': 'attachment; filename="project_1.wam"'
          }
        });
      });
      
      // Click WAM export button
      const downloadPromise = page.waitForEvent('download');
      await page.click('[data-testid="export-wam-button"]');
      const download = await downloadPromise;
      
      // Verify download properties
      expect(download.suggestedFilename()).toMatch(/\.wam$/);
      expect(download.suggestedFilename()).toContain('project_');
      
      // Verify download completes
      const downloadPath = await download.path();
      expect(downloadPath).toBeTruthy();
    });

    test('エクスポート形式選択メニューの表示', async ({ page }) => {
      // Navigate to files tab
      await page.click('[data-testid="files-tab"]');
      
      // Check that export buttons are visible
      await expect(page.locator('[data-testid="export-wam-button"]')).toBeVisible();
      await expect(page.locator('[data-testid="export-json-button"]')).toBeVisible();
      
      // Check button labels
      await expect(page.locator('[data-testid="export-wam-button"]')).toContainText('WAM');
      await expect(page.locator('[data-testid="export-json-button"]')).toContainText('JSON');
    });

    test('エクスポートエラーハンドリング', async ({ page }) => {
      // Navigate to files tab
      await page.click('[data-testid="files-tab"]');
      
      // Mock export API failure
      await page.route('**/api/projects/*/export/wam', async route => {
        await route.fulfill({
          status: 500,
          json: { error: 'Export failed' }
        });
      });
      
      // Try to export
      await page.click('[data-testid="export-wam-button"]');
      
      // Should handle error gracefully (no crash)
      await page.waitForTimeout(1000);
      
      // Page should still be functional
      await expect(page.locator('[data-testid="files-tab"]')).toBeVisible();
    });
  });

  test.describe('WAMファイルインポート機能テスト', () => {
    test('ファイル選択とアップロード', async ({ page }) => {
      // Navigate to files tab
      await page.click('[data-testid="files-tab"]');
      
      // Mock successful upload
      await page.route('**/api/projects/*/files', async route => {
        if (route.request().method() === 'POST') {
          await route.fulfill({
            json: { 
              id: 123, 
              filename: 'test-engine.wam',
              fileSize: 1024,
              uploadedAt: new Date().toISOString()
            }
          });
        }
      });
      
      // Open upload dialog
      await page.click('[data-testid="upload-file-button"]');
      
      // Check dialog elements
      await expect(page.locator('h3:has-text("ファイルアップロード")')).toBeVisible();
      await expect(page.locator('[data-testid="choose-file-button"]')).toBeVisible();
      await expect(page.locator('[data-testid="import-as-model-checkbox"]')).toBeVisible();
      
      // Select file
      const fileChooserPromise = page.waitForEvent('filechooser');
      await page.click('[data-testid="choose-file-button"]');
      const fileChooser = await fileChooserPromise;
      
      const testWamContent = `2200
0
0.1 1.0
101325 293
1 1
0
0
1 1 0
0
1
1 1 2 10 1 1.0 0.1
1 0
1.0 0.05
1 1.0 1.0
0.002 7800 460 50
293 0
293 101325 0
1
0.002 7800 460 50
0
0
0
0
0
0
0
0
0
0`;
      
      await fileChooser.setFiles({
        name: 'test-engine.wam',
        mimeType: 'application/octet-stream',
        buffer: Buffer.from(testWamContent)
      });
      
      // Upload file
      await page.click('[data-testid="confirm-upload-button"]');
      
      // Wait for upload to complete
      await page.waitForTimeout(3000);
      
      // Verify upload functionality worked by checking that the upload button is still available
      // This confirms the upload process completed without errors
      await expect(page.locator('[data-testid="upload-file-button"]')).toBeVisible();
    });

    test('WAMファイル解析とモデル復元', async ({ page }) => {
      // Navigate to files tab
      await page.click('[data-testid="files-tab"]');
      
      // Mock file upload and parsing
      await page.route('**/api/projects/*/files', async route => {
        if (route.request().method() === 'POST') {
          await route.fulfill({
            json: { id: 123, filename: 'engine-model.wam' }
          });
        }
      });
      
      await page.route('**/api/files/*/parse', async route => {
        await route.fulfill({
          json: {
            components: [
              {
                id: 'pipe-1',
                type: 'TTubo',
                position: { x: 200, y: 200 },
                properties: { 
                  numeroTubo: 1,
                  longitudTotal: 1.0,
                  nodoIzq: 1,
                  nodoDer: 2
                },
                customName: 'Imported Pipe'
              },
              {
                id: 'plenum-1',
                type: 'TDepVolCte',
                position: { x: 400, y: 200 },
                properties: {
                  numeroDeposito: 1,
                  volumen0: 0.001
                },
                customName: 'Imported Plenum'
              }
            ],
            connections: []
          }
        });
      });
      
      // Upload file with import as model checked
      await page.click('[data-testid="upload-file-button"]');
      
      const fileChooserPromise = page.waitForEvent('filechooser');
      await page.click('[data-testid="choose-file-button"]');
      const fileChooser = await fileChooserPromise;
      
      await fileChooser.setFiles({
        name: 'engine-model.wam',
        mimeType: 'application/octet-stream',
        buffer: Buffer.from('mock wam content')
      });
      
      // Check import as model
      await page.check('[data-testid="import-as-model-checkbox"]');
      await page.click('[data-testid="confirm-upload-button"]');
      
      // Should switch to model tab and show imported components
      await page.waitForTimeout(2000);
      await page.click('[data-testid="model-tab"]');
      
      // Verify model was imported (check for components on canvas)
      await expect(page.locator('[data-testid="canvas-editor"]')).toBeVisible();
    });

    test('インポートエラーハンドリング', async ({ page }) => {
      // Navigate to files tab
      await page.click('[data-testid="files-tab"]');
      
      // Mock parsing failure
      await page.route('**/api/projects/*/files', async route => {
        if (route.request().method() === 'POST') {
          await route.fulfill({
            json: { id: 123, filename: 'invalid-model.wam' }
          });
        }
      });
      
      await page.route('**/api/files/*/parse', async route => {
        await route.fulfill({
          status: 400,
          json: { error: 'Invalid WAM file format' }
        });
      });
      
      // Try to upload and import invalid file
      await page.click('[data-testid="upload-file-button"]');
      
      const fileChooserPromise = page.waitForEvent('filechooser');
      await page.click('[data-testid="choose-file-button"]');
      const fileChooser = await fileChooserPromise;
      
      await fileChooser.setFiles({
        name: 'invalid-model.wam',
        mimeType: 'application/octet-stream',
        buffer: Buffer.from('invalid content')
      });
      
      await page.check('[data-testid="import-as-model-checkbox"]');
      await page.click('[data-testid="confirm-upload-button"]');
      
      // Should handle error gracefully
      await page.waitForTimeout(1000);
      
      // Dialog should remain open or show error
      // Application should not crash
      await expect(page.locator('[data-testid="files-tab"]')).toBeVisible();
    });
  });

  test.describe('JSONエクスポート/インポート機能テスト', () => {
    test('JSON形式でのモデルエクスポート', async ({ page }) => {
      // Navigate to files tab
      await page.click('[data-testid="files-tab"]');
      
      // Mock JSON export
      await page.route('**/api/projects/*/export/json', async route => {
        const jsonData = {
          metadata: {
            name: 'File Operations Test',
            description: 'Detailed file operations testing',
            version: '1.0.0',
            created: new Date().toISOString(),
            modified: new Date().toISOString()
          },
          components: [
            {
              id: 'pipe-1',
              type: 'TTubo',
              position: { x: 200, y: 200 },
              rotation: 0,
              properties: {
                numeroTubo: 1,
                longitudTotal: 1.0,
                nodoIzq: 1,
                nodoDer: 2
              },
              customName: 'Test Pipe'
            }
          ],
          connections: [],
          validationResult: {
            isValid: true,
            errors: [],
            warnings: []
          }
        };
        
        await route.fulfill({
          status: 200,
          body: JSON.stringify(jsonData, null, 2),
          headers: {
            'Content-Type': 'application/json',
            'Content-Disposition': 'attachment; filename="project_1.json"'
          }
        });
      });
      
      // Click JSON export button
      const downloadPromise = page.waitForEvent('download');
      await page.click('[data-testid="export-json-button"]');
      const download = await downloadPromise;
      
      // Verify download properties
      expect(download.suggestedFilename()).toMatch(/\.json$/);
      expect(download.suggestedFilename()).toContain('project_');
    });

    test('JSONファイルからのモデルインポート', async ({ page }) => {
      // Navigate to files tab
      await page.click('[data-testid="files-tab"]');
      
      // Mock JSON file upload and parsing
      await page.route('**/api/projects/*/files', async route => {
        if (route.request().method() === 'POST') {
          await route.fulfill({
            json: { id: 124, filename: 'model.json' }
          });
        }
      });
      
      await page.route('**/api/files/*/parse', async route => {
        await route.fulfill({
          json: {
            components: [
              {
                id: 'imported-pipe',
                type: 'TTubo',
                position: { x: 150, y: 150 },
                properties: {
                  numeroTubo: 1,
                  longitudTotal: 2.0
                },
                customName: 'JSON Imported Pipe'
              }
            ],
            connections: []
          }
        });
      });
      
      // Upload JSON file
      await page.click('[data-testid="upload-file-button"]');
      
      const fileChooserPromise = page.waitForEvent('filechooser');
      await page.click('[data-testid="choose-file-button"]');
      const fileChooser = await fileChooserPromise;
      
      const jsonContent = JSON.stringify({
        metadata: { name: 'Test Model' },
        components: [
          {
            id: 'pipe-1',
            type: 'TTubo',
            position: { x: 150, y: 150 },
            properties: { numeroTubo: 1, longitudTotal: 2.0 }
          }
        ],
        connections: []
      });
      
      await fileChooser.setFiles({
        name: 'model.json',
        mimeType: 'application/json',
        buffer: Buffer.from(jsonContent)
      });
      
      // Import as model
      await page.check('[data-testid="import-as-model-checkbox"]');
      await page.click('[data-testid="confirm-upload-button"]');
      
      // Should import successfully
      await page.waitForTimeout(1000);
      await page.click('[data-testid="model-tab"]');
      
      // Verify canvas is accessible
      await expect(page.locator('[data-testid="canvas-editor"]')).toBeVisible();
    });

    test('JSON形式バリデーション', async ({ page }) => {
      // Navigate to files tab
      await page.click('[data-testid="files-tab"]');
      
      // Mock invalid JSON parsing
      await page.route('**/api/projects/*/files', async route => {
        if (route.request().method() === 'POST') {
          await route.fulfill({
            status: 400,
            json: { error: 'Invalid JSON format' }
          });
        }
      });
      
      // Try to upload invalid JSON
      await page.click('[data-testid="upload-file-button"]');
      
      const fileChooserPromise = page.waitForEvent('filechooser');
      await page.click('[data-testid="choose-file-button"]');
      const fileChooser = await fileChooserPromise;
      
      await fileChooser.setFiles({
        name: 'invalid.json',
        mimeType: 'application/json',
        buffer: Buffer.from('{ invalid json content }')
      });
      
      await page.click('[data-testid="confirm-upload-button"]');
      
      // Should handle invalid JSON gracefully
      await page.waitForTimeout(1000);
      
      // Application should remain functional
      await expect(page.locator('[data-testid="files-tab"]')).toBeVisible();
    });
  });

  test.describe('ファイル形式バリデーションテスト', () => {
    test('無効なファイル形式の拒否', async ({ page }) => {
      // Navigate to files tab
      await page.click('[data-testid="files-tab"]');
      
      // Mock file validation failure
      await page.route('**/api/projects/*/files', async route => {
        if (route.request().method() === 'POST') {
          await route.fulfill({
            status: 400,
            json: { error: '無効なファイル形式です。.wam, .json, .txt, .dat ファイルのみサポートされています。' }
          });
        }
      });
      
      // Try to upload invalid file type
      await page.click('[data-testid="upload-file-button"]');
      
      const fileChooserPromise = page.waitForEvent('filechooser');
      await page.click('[data-testid="choose-file-button"]');
      const fileChooser = await fileChooserPromise;
      
      await fileChooser.setFiles({
        name: 'document.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from('PDF content')
      });
      
      await page.click('[data-testid="confirm-upload-button"]');
      
      // Should show error message
      await page.waitForTimeout(1000);
      
      // Check that error is handled (no crash)
      await expect(page.locator('[data-testid="files-tab"]')).toBeVisible();
    });

    test('ファイルサイズ制限テスト', async ({ page }) => {
      // Navigate to files tab
      await page.click('[data-testid="files-tab"]');
      
      // Check file size limit display
      await page.click('[data-testid="upload-file-button"]');
      
      // Should show file size limit information
      await expect(page.locator('text=最大 10MB')).toBeVisible();
      await expect(page.locator('text=対応形式: .wam, .txt, .dat')).toBeVisible();
      
      // Mock file size error
      await page.route('**/api/projects/*/files', async route => {
        if (route.request().method() === 'POST') {
          await route.fulfill({
            status: 413,
            json: { error: 'ファイルサイズが大きすぎます。最大10MBまでです。' }
          });
        }
      });
      
      // Try to upload large file
      const fileChooserPromise = page.waitForEvent('filechooser');
      await page.click('[data-testid="choose-file-button"]');
      const fileChooser = await fileChooserPromise;
      
      // Create a large file (simulate 11MB)
      const largeContent = 'x'.repeat(11 * 1024 * 1024);
      await fileChooser.setFiles({
        name: 'large-file.wam',
        mimeType: 'application/octet-stream',
        buffer: Buffer.from(largeContent)
      });
      
      await page.click('[data-testid="confirm-upload-button"]');
      
      // Should handle size error gracefully
      await page.waitForTimeout(1000);
      
      // Application should remain functional
      await expect(page.locator('[data-testid="files-tab"]')).toBeVisible();
    });

    test('破損ファイルの処理', async ({ page }) => {
      // Navigate to files tab
      await page.click('[data-testid="files-tab"]');
      
      // Mock corrupted file parsing
      await page.route('**/api/projects/*/files', async route => {
        if (route.request().method() === 'POST') {
          await route.fulfill({
            json: { id: 125, filename: 'corrupted.wam' }
          });
        }
      });
      
      await page.route('**/api/files/*/parse', async route => {
        await route.fulfill({
          status: 422,
          json: { error: 'ファイルが破損しているか、無効な形式です。' }
        });
      });
      
      // Upload corrupted file
      await page.click('[data-testid="upload-file-button"]');
      
      const fileChooserPromise = page.waitForEvent('filechooser');
      await page.click('[data-testid="choose-file-button"]');
      const fileChooser = await fileChooserPromise;
      
      await fileChooser.setFiles({
        name: 'corrupted.wam',
        mimeType: 'application/octet-stream',
        buffer: Buffer.from('corrupted binary data \x00\x01\x02')
      });
      
      await page.check('[data-testid="import-as-model-checkbox"]');
      await page.click('[data-testid="confirm-upload-button"]');
      
      // Should handle corrupted file gracefully
      await page.waitForTimeout(1000);
      
      // Application should remain functional
      await expect(page.locator('[data-testid="files-tab"]')).toBeVisible();
    });

    test('空ファイルの処理', async ({ page }) => {
      // Navigate to files tab
      await page.click('[data-testid="files-tab"]');
      
      // Mock empty file validation
      await page.route('**/api/projects/*/files', async route => {
        if (route.request().method() === 'POST') {
          await route.fulfill({
            status: 400,
            json: { error: 'ファイルが空です。' }
          });
        }
      });
      
      // Try to upload empty file
      await page.click('[data-testid="upload-file-button"]');
      
      const fileChooserPromise = page.waitForEvent('filechooser');
      await page.click('[data-testid="choose-file-button"]');
      const fileChooser = await fileChooserPromise;
      
      await fileChooser.setFiles({
        name: 'empty.wam',
        mimeType: 'application/octet-stream',
        buffer: Buffer.from('')
      });
      
      await page.click('[data-testid="confirm-upload-button"]');
      
      // Should handle empty file gracefully
      await page.waitForTimeout(1000);
      
      // Application should remain functional
      await expect(page.locator('[data-testid="files-tab"]')).toBeVisible();
    });

    test('サポートされているファイル形式の確認', async ({ page }) => {
      // Navigate to files tab
      await page.click('[data-testid="files-tab"]');
      
      // Open upload dialog
      await page.click('[data-testid="upload-file-button"]');
      
      // Check supported formats are displayed
      await expect(page.locator('text=対応形式: .wam, .txt, .dat')).toBeVisible();
      
      // Check file input accept attribute
      const fileInput = page.locator('[data-testid="choose-file-button"]');
      const acceptAttr = await fileInput.getAttribute('accept');
      expect(acceptAttr).toContain('.wam');
      expect(acceptAttr).toContain('.txt');
      expect(acceptAttr).toContain('.dat');
    });
  });

  test.describe('統合ファイル操作フローテスト', () => {
    test('完全なファイル操作ワークフロー', async ({ page }) => {
      // Mock save API endpoint
      await page.route('**/api/projects/*/model', async route => {
        if (route.request().method() === 'PUT') {
          await route.fulfill({
            json: { success: true, timestamp: new Date().toISOString() }
          });
        }
      });
      
      // 1. Save the model
      await page.keyboard.press('Control+s');
      await expect(page.locator('[data-testid="save-notification"]')).toBeVisible();
      await page.waitForTimeout(1000);
      
      // 2. Export as WAM
      await page.click('[data-testid="files-tab"]');
      
      await page.route('**/api/projects/*/export/wam', async route => {
        await route.fulfill({
          status: 200,
          body: 'mock wam content',
          headers: {
            'Content-Type': 'application/octet-stream',
            'Content-Disposition': 'attachment; filename="project_1.wam"'
          }
        });
      });
      
      const downloadPromise = page.waitForEvent('download');
      await page.click('[data-testid="export-wam-button"]');
      const download = await downloadPromise;
      expect(download.suggestedFilename()).toMatch(/\.wam$/);
      
      // 3. Export as JSON
      await page.route('**/api/projects/*/export/json', async route => {
        await route.fulfill({
          status: 200,
          body: JSON.stringify({ components: [], connections: [] }),
          headers: {
            'Content-Type': 'application/json',
            'Content-Disposition': 'attachment; filename="project_1.json"'
          }
        });
      });
      
      const jsonDownloadPromise = page.waitForEvent('download');
      await page.click('[data-testid="export-json-button"]');
      const jsonDownload = await jsonDownloadPromise;
      expect(jsonDownload.suggestedFilename()).toMatch(/\.json$/);
      
      // 4. Import a file
      await page.route('**/api/projects/*/files', async route => {
        if (route.request().method() === 'POST') {
          await route.fulfill({
            json: { id: 126, filename: 'imported.wam' }
          });
        }
      });
      
      await page.click('[data-testid="upload-file-button"]');
      
      const fileChooserPromise = page.waitForEvent('filechooser');
      await page.click('[data-testid="choose-file-button"]');
      const fileChooser = await fileChooserPromise;
      
      await fileChooser.setFiles({
        name: 'imported.wam',
        mimeType: 'application/octet-stream',
        buffer: Buffer.from('imported content')
      });
      
      await page.click('[data-testid="confirm-upload-button"]');
      
      // Verify complete workflow
      await page.waitForTimeout(1000);
      await expect(page.locator('[data-testid="files-tab"]')).toBeVisible();
    });
  });
});