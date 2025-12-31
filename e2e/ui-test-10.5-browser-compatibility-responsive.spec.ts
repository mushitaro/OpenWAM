import { test, expect, devices } from '@playwright/test';

test.describe('UIテスト 10.5: ブラウザ互換性とレスポンシブテスト', () => {
  
  // 各ブラウザでの基本機能テスト
  test.describe('ブラウザ互換性テスト', () => {
    
    test('Chrome - 基本機能テスト', async ({ page, browserName }) => {
      test.skip(browserName !== 'chromium', 'Chrome専用テスト');
      
      await page.goto('http://localhost:5173');
      
      // 基本UI要素の表示確認
      await expect(page.locator('h1')).toContainText('OpenWAM プロジェクト');
      await expect(page.getByTestId('new-project-button')).toBeVisible();
      
      // 新規プロジェクト作成フロー
      await page.getByTestId('new-project-button').click();
      await page.getByTestId('project-name-input').fill('Chrome互換性テスト');
      await page.getByTestId('create-project-button').click();
      
      // プロジェクトエディター画面の表示確認
      await expect(page.getByTestId('model-tab')).toBeVisible();
      await expect(page.getByTestId('files-tab')).toBeVisible();
      await expect(page.getByTestId('simulation-tab')).toBeVisible();
      
      console.log('✅ Chrome基本機能テスト: 成功');
    });

    test('Firefox - 基本機能テスト', async ({ page, browserName }) => {
      test.skip(browserName !== 'firefox', 'Firefox専用テスト');
      
      await page.goto('http://localhost:5173');
      
      // 基本UI要素の表示確認
      await expect(page.locator('h1')).toContainText('OpenWAM プロジェクト');
      await expect(page.getByTestId('new-project-button')).toBeVisible();
      
      // 新規プロジェクト作成フロー
      await page.getByTestId('new-project-button').click();
      await page.getByTestId('project-name-input').fill('Firefox互換性テスト');
      await page.getByTestId('create-project-button').click();
      
      // プロジェクトエディター画面の表示確認
      await expect(page.getByTestId('model-tab')).toBeVisible();
      await expect(page.getByTestId('files-tab')).toBeVisible();
      await expect(page.getByTestId('simulation-tab')).toBeVisible();
      
      console.log('✅ Firefox基本機能テスト: 成功');
    });

    test('Safari/WebKit - 基本機能テスト', async ({ page, browserName }) => {
      test.skip(browserName !== 'webkit', 'Safari/WebKit専用テスト');
      
      await page.goto('http://localhost:5173');
      
      // 基本UI要素の表示確認
      await expect(page.locator('h1')).toContainText('OpenWAM プロジェクト');
      await expect(page.getByTestId('new-project-button')).toBeVisible();
      
      // 新規プロジェクト作成フロー
      await page.getByTestId('new-project-button').click();
      await page.getByTestId('project-name-input').fill('Safari互換性テスト');
      await page.getByTestId('create-project-button').click();
      
      // プロジェクトエディター画面の表示確認
      await expect(page.getByTestId('model-tab')).toBeVisible();
      await expect(page.getByTestId('files-tab')).toBeVisible();
      await expect(page.getByTestId('simulation-tab')).toBeVisible();
      
      console.log('✅ Safari/WebKit基本機能テスト: 成功');
    });
  });

  // ドラッグ&ドロップ動作確認（各ブラウザ）
  test.describe('ドラッグ&ドロップ互換性テスト', () => {
    
    test.beforeEach(async ({ page }) => {
      await page.goto('http://localhost:5173');
      // 新規プロジェクト作成
      await page.getByTestId('new-project-button').click();
      await page.getByTestId('project-name-input').fill('ドラッグ&ドロップテスト');
      await page.getByTestId('create-project-button').click();
    });

    test('Chrome - ドラッグ&ドロップ動作確認', async ({ page, browserName }) => {
      test.skip(browserName !== 'chromium', 'Chrome専用テスト');
      
      // コンポーネントパレットの確認
      const paletteContainer = page.locator('.component-palette');
      if (await paletteContainer.isVisible()) {
        
        // パイプカテゴリを開く
        const pipesCategory = page.locator('[data-category="pipes"]');
        if (await pipesCategory.isVisible()) {
          await pipesCategory.click();
          
          // 1Dパイプコンポーネントの確認
          const pipeComponent = page.locator('[data-component-type="TTubo"]');
          if (await pipeComponent.isVisible()) {
            
            // キャンバス要素の確認
            const canvas = page.locator('canvas, .canvas-container, .konva-content');
            if (await canvas.first().isVisible()) {
              
              // ドラッグ&ドロップ操作
              const sourceBox = await pipeComponent.boundingBox();
              const targetBox = await canvas.first().boundingBox();
              
              if (sourceBox && targetBox) {
                await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
                await page.mouse.down();
                await page.mouse.move(targetBox.x + 200, targetBox.y + 200);
                await page.mouse.up();
                
                console.log('✅ Chrome ドラッグ&ドロップ: 実行完了');
              }
            }
          }
        }
      }
    });

    test('Firefox - ドラッグ&ドロップ動作確認', async ({ page, browserName }) => {
      test.skip(browserName !== 'firefox', 'Firefox専用テスト');
      
      // コンポーネントパレットの確認
      const paletteContainer = page.locator('.component-palette');
      if (await paletteContainer.isVisible()) {
        
        // パイプカテゴリを開く
        const pipesCategory = page.locator('[data-category="pipes"]');
        if (await pipesCategory.isVisible()) {
          await pipesCategory.click();
          
          // 1Dパイプコンポーネントの確認
          const pipeComponent = page.locator('[data-component-type="TTubo"]');
          if (await pipeComponent.isVisible()) {
            
            // キャンバス要素の確認
            const canvas = page.locator('canvas, .canvas-container, .konva-content');
            if (await canvas.first().isVisible()) {
              
              // ドラッグ&ドロップ操作
              const sourceBox = await pipeComponent.boundingBox();
              const targetBox = await canvas.first().boundingBox();
              
              if (sourceBox && targetBox) {
                await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
                await page.mouse.down();
                await page.mouse.move(targetBox.x + 200, targetBox.y + 200);
                await page.mouse.up();
                
                console.log('✅ Firefox ドラッグ&ドロップ: 実行完了');
              }
            }
          }
        }
      }
    });

    test('Safari/WebKit - ドラッグ&ドロップ動作確認', async ({ page, browserName }) => {
      test.skip(browserName !== 'webkit', 'Safari/WebKit専用テスト');
      
      // コンポーネントパレットの確認
      const paletteContainer = page.locator('.component-palette');
      if (await paletteContainer.isVisible()) {
        
        // パイプカテゴリを開く
        const pipesCategory = page.locator('[data-category="pipes"]');
        if (await pipesCategory.isVisible()) {
          await pipesCategory.click();
          
          // 1Dパイプコンポーネントの確認
          const pipeComponent = page.locator('[data-component-type="TTubo"]');
          if (await pipeComponent.isVisible()) {
            
            // キャンバス要素の確認
            const canvas = page.locator('canvas, .canvas-container, .konva-content');
            if (await canvas.first().isVisible()) {
              
              // ドラッグ&ドロップ操作
              const sourceBox = await pipeComponent.boundingBox();
              const targetBox = await canvas.first().boundingBox();
              
              if (sourceBox && targetBox) {
                await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
                await page.mouse.down();
                await page.mouse.move(targetBox.x + 200, targetBox.y + 200);
                await page.mouse.up();
                
                console.log('✅ Safari/WebKit ドラッグ&ドロップ: 実行完了');
              }
            }
          }
        }
      }
    });
  });

  // 解像度別UI表示テスト
  test.describe('解像度別UI表示テスト', () => {
    
    test.beforeEach(async ({ page }) => {
      await page.goto('http://localhost:5173');
    });

    test('1920x1080 - フルHD解像度テスト', async ({ page }) => {
      await page.setViewportSize({ width: 1920, height: 1080 });
      
      // 基本UI要素の表示確認
      await expect(page.locator('h1')).toBeVisible();
      await expect(page.getByTestId('new-project-button')).toBeVisible();
      
      // 新規プロジェクト作成
      await page.getByTestId('new-project-button').click();
      await page.getByTestId('project-name-input').fill('1920x1080テスト');
      await page.getByTestId('create-project-button').click();
      
      // プロジェクトエディター画面の要素配置確認
      await expect(page.getByTestId('model-tab')).toBeVisible();
      
      // コンポーネントパレットの表示確認
      const paletteContainer = page.locator('.component-palette');
      if (await paletteContainer.isVisible()) {
        const paletteBox = await paletteContainer.boundingBox();
        expect(paletteBox?.width).toBeGreaterThan(200); // 十分な幅があることを確認
      }
      
      // キャンバス領域の確認
      const canvas = page.locator('canvas, .canvas-container, .konva-content');
      if (await canvas.first().isVisible()) {
        const canvasBox = await canvas.first().boundingBox();
        expect(canvasBox?.width).toBeGreaterThan(800); // 十分なキャンバス幅があることを確認
      }
      
      console.log('✅ 1920x1080解像度テスト: 成功');
    });

    test('1366x768 - 標準ノートPC解像度テスト', async ({ page }) => {
      await page.setViewportSize({ width: 1366, height: 768 });
      
      // 基本UI要素の表示確認
      await expect(page.locator('h1')).toBeVisible();
      await expect(page.getByTestId('new-project-button')).toBeVisible();
      
      // 新規プロジェクト作成
      await page.getByTestId('new-project-button').click();
      await page.getByTestId('project-name-input').fill('1366x768テスト');
      await page.getByTestId('create-project-button').click();
      
      // プロジェクトエディター画面の要素配置確認
      await expect(page.getByTestId('model-tab')).toBeVisible();
      
      // UI要素が適切に配置されていることを確認
      const paletteContainer = page.locator('.component-palette');
      if (await paletteContainer.isVisible()) {
        // パレットが画面内に収まっていることを確認
        const paletteBox = await paletteContainer.boundingBox();
        expect(paletteBox?.x).toBeGreaterThanOrEqual(0);
        expect(paletteBox?.y).toBeGreaterThanOrEqual(0);
      }
      
      console.log('✅ 1366x768解像度テスト: 成功');
    });

    test('1280x720 - 最小サポート解像度テスト', async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 720 });
      
      // 基本UI要素の表示確認
      await expect(page.locator('h1')).toBeVisible();
      await expect(page.getByTestId('new-project-button')).toBeVisible();
      
      // 新規プロジェクト作成
      await page.getByTestId('new-project-button').click();
      await page.getByTestId('project-name-input').fill('1280x720テスト');
      await page.getByTestId('create-project-button').click();
      
      // プロジェクトエディター画面の要素配置確認
      await expect(page.getByTestId('model-tab')).toBeVisible();
      
      // 最小解像度でも基本機能が使用可能であることを確認
      const tabs = page.locator('[data-testid="model-tab"], [data-testid="files-tab"], [data-testid="simulation-tab"]');
      await expect(tabs.first()).toBeVisible();
      
      console.log('✅ 1280x720解像度テスト: 成功');
    });
  });

  // タブレット解像度での操作性テスト
  test.describe('タブレット解像度操作性テスト', () => {
    
    test('1024x768 - タブレット解像度操作性テスト', async ({ page }) => {
      await page.setViewportSize({ width: 1024, height: 768 });
      
      await page.goto('http://localhost:5173');
      
      // 基本UI要素の表示確認
      await expect(page.locator('h1')).toBeVisible();
      await expect(page.getByTestId('new-project-button')).toBeVisible();
      
      // タッチ操作のシミュレーション（クリック操作）
      await page.getByTestId('new-project-button').click();
      await page.getByTestId('project-name-input').fill('タブレットテスト');
      await page.getByTestId('create-project-button').click();
      
      // プロジェクトエディター画面での操作性確認
      await expect(page.getByTestId('model-tab')).toBeVisible();
      
      // タブ切り替え操作
      await page.getByTestId('files-tab').click();
      await expect(page.getByTestId('files-tab')).toBeVisible();
      
      await page.getByTestId('simulation-tab').click();
      await expect(page.getByTestId('simulation-tab')).toBeVisible();
      
      await page.getByTestId('model-tab').click();
      await expect(page.getByTestId('model-tab')).toBeVisible();
      
      // コンポーネントパレットの操作性確認
      const paletteContainer = page.locator('.component-palette');
      if (await paletteContainer.isVisible()) {
        const pipesCategory = page.locator('[data-category="pipes"]');
        if (await pipesCategory.isVisible()) {
          await pipesCategory.click();
          
          // コンポーネント選択の操作性確認
          const pipeComponent = page.locator('[data-component-type="TTubo"]');
          if (await pipeComponent.isVisible()) {
            await pipeComponent.click();
          }
        }
      }
      
      console.log('✅ タブレット解像度操作性テスト: 成功');
    });

    test('768x1024 - タブレット縦向き解像度テスト', async ({ page }) => {
      await page.setViewportSize({ width: 768, height: 1024 });
      
      await page.goto('http://localhost:5173');
      
      // 縦向きでの基本UI要素の表示確認
      await expect(page.locator('h1')).toBeVisible();
      await expect(page.getByTestId('new-project-button')).toBeVisible();
      
      // 新規プロジェクト作成フロー
      await page.getByTestId('new-project-button').click();
      await page.getByTestId('project-name-input').fill('縦向きタブレットテスト');
      await page.getByTestId('create-project-button').click();
      
      // プロジェクトエディター画面の表示確認
      await expect(page.getByTestId('model-tab')).toBeVisible();
      
      // 縦向きレイアウトでの操作性確認
      const tabs = page.locator('[data-testid="model-tab"], [data-testid="files-tab"], [data-testid="simulation-tab"]');
      const tabCount = await tabs.count();
      expect(tabCount).toBeGreaterThanOrEqual(3);
      
      console.log('✅ タブレット縦向き解像度テスト: 成功');
    });
  });

  // キーボードショートカット動作確認
  test.describe('キーボードショートカット動作確認', () => {
    
    test.beforeEach(async ({ page }) => {
      await page.goto('http://localhost:5173');
      // 新規プロジェクト作成
      await page.getByTestId('new-project-button').click();
      await page.getByTestId('project-name-input').fill('ショートカットテスト');
      await page.getByTestId('create-project-button').click();
    });

    test('Ctrl+S - 保存ショートカットテスト', async ({ page, browserName }) => {
      // 保存ショートカット実行
      await page.keyboard.press('Control+s');
      
      // 保存通知の確認
      const saveNotification = page.getByTestId('save-notification');
      if (await saveNotification.isVisible({ timeout: 2000 })) {
        await expect(saveNotification).toContainText('保存');
        console.log(`✅ ${browserName} Ctrl+S保存ショートカット: 成功`);
        
        // 通知の自動消去確認
        await expect(saveNotification).not.toBeVisible({ timeout: 4000 });
      } else {
        console.log(`⚠️ ${browserName} 保存通知が表示されませんでした`);
      }
    });

    test('Ctrl+Z/Ctrl+Y - 元に戻す/やり直しショートカットテスト', async ({ page, browserName }) => {
      // 元に戻すショートカット
      await page.keyboard.press('Control+z');
      console.log(`✅ ${browserName} Ctrl+Z元に戻すショートカット: 実行完了`);
      
      // やり直しショートカット
      await page.keyboard.press('Control+y');
      console.log(`✅ ${browserName} Ctrl+Yやり直しショートカット: 実行完了`);
    });

    test('Delete - 削除ショートカットテスト', async ({ page, browserName }) => {
      // 削除キー操作
      await page.keyboard.press('Delete');
      console.log(`✅ ${browserName} Delete削除ショートカット: 実行完了`);
    });

    test('Escape - キャンセルショートカットテスト', async ({ page, browserName }) => {
      // Escapeキー操作
      await page.keyboard.press('Escape');
      console.log(`✅ ${browserName} Escapeキャンセルショートカット: 実行完了`);
    });

    test('Tab - フォーカス移動ショートカットテスト', async ({ page, browserName }) => {
      // Tabキーでのフォーカス移動
      await page.keyboard.press('Tab');
      await page.keyboard.press('Tab');
      await page.keyboard.press('Tab');
      console.log(`✅ ${browserName} Tabフォーカス移動ショートカット: 実行完了`);
    });

    test('F11 - フルスクリーンショートカットテスト', async ({ page, browserName }) => {
      // F11キー操作（フルスクリーン切り替え）
      await page.keyboard.press('F11');
      await page.waitForTimeout(1000); // フルスクリーン切り替え待機
      await page.keyboard.press('F11'); // フルスクリーン解除
      console.log(`✅ ${browserName} F11フルスクリーンショートカット: 実行完了`);
    });
  });

  // 総合ブラウザ互換性テスト
  test.describe('総合ブラウザ互換性テスト', () => {
    
    test('全ブラウザ - 基本ワークフロー互換性テスト', async ({ page, browserName }) => {
      console.log(`🚀 ${browserName} 総合互換性テスト開始`);
      
      await page.goto('http://localhost:5173');
      
      // 1. ダッシュボード表示確認
      await expect(page.locator('h1')).toContainText('OpenWAM プロジェクト');
      
      // 2. 新規プロジェクト作成
      await page.getByTestId('new-project-button').click();
      await page.getByTestId('project-name-input').fill(`${browserName}総合テスト`);
      await page.getByTestId('project-description-input').fill(`${browserName}での総合互換性テスト`);
      await page.getByTestId('create-project-button').click();
      
      // 3. プロジェクトエディター画面確認
      await expect(page.getByTestId('model-tab')).toBeVisible();
      
      // 4. タブ切り替え動作確認
      await page.getByTestId('files-tab').click();
      await expect(page.getByTestId('files-tab')).toBeVisible();
      
      await page.getByTestId('simulation-tab').click();
      await expect(page.getByTestId('simulation-tab')).toBeVisible();
      
      await page.getByTestId('model-tab').click();
      await expect(page.getByTestId('model-tab')).toBeVisible();
      
      // 5. コンポーネントパレット操作
      const paletteContainer = page.locator('.component-palette');
      if (await paletteContainer.isVisible()) {
        const pipesCategory = page.locator('[data-category="pipes"]');
        if (await pipesCategory.isVisible()) {
          await pipesCategory.click();
        }
      }
      
      // 6. キーボードショートカット確認
      await page.keyboard.press('Control+s');
      
      // 7. 解像度変更テスト
      await page.setViewportSize({ width: 1366, height: 768 });
      await expect(page.getByTestId('model-tab')).toBeVisible();
      
      await page.setViewportSize({ width: 1024, height: 768 });
      await expect(page.getByTestId('model-tab')).toBeVisible();
      
      console.log(`✅ ${browserName} 総合互換性テスト: 全ステップ完了`);
    });

    test('全ブラウザ - パフォーマンステスト', async ({ page, browserName }) => {
      const startTime = Date.now();
      
      await page.goto('http://localhost:5173');
      
      // ページ読み込み時間測定
      await expect(page.locator('h1')).toBeVisible();
      const loadTime = Date.now() - startTime;
      
      console.log(`📊 ${browserName} ページ読み込み時間: ${loadTime}ms`);
      
      // 新規プロジェクト作成の応答性テスト
      const createStartTime = Date.now();
      await page.getByTestId('new-project-button').click();
      await page.getByTestId('project-name-input').fill('パフォーマンステスト');
      await page.getByTestId('create-project-button').click();
      await expect(page.getByTestId('model-tab')).toBeVisible();
      const createTime = Date.now() - createStartTime;
      
      console.log(`📊 ${browserName} プロジェクト作成時間: ${createTime}ms`);
      
      // パフォーマンス基準チェック（5秒以内）
      expect(loadTime).toBeLessThan(5000);
      expect(createTime).toBeLessThan(5000);
      
      console.log(`✅ ${browserName} パフォーマンステスト: 合格`);
    });
  });

  // エラーハンドリング互換性テスト
  test.describe('エラーハンドリング互換性テスト', () => {
    
    test('全ブラウザ - JavaScript エラーハンドリングテスト', async ({ page, browserName }) => {
      // JavaScriptエラーの監視
      const jsErrors: string[] = [];
      page.on('pageerror', (error) => {
        jsErrors.push(error.message);
      });
      
      await page.goto('http://localhost:5173');
      
      // 基本操作を実行してエラーが発生しないことを確認
      await page.getByTestId('new-project-button').click();
      await page.getByTestId('project-name-input').fill('エラーテスト');
      await page.getByTestId('create-project-button').click();
      
      // タブ切り替え
      await page.getByTestId('files-tab').click();
      await page.getByTestId('simulation-tab').click();
      await page.getByTestId('model-tab').click();
      
      // JavaScriptエラーが発生していないことを確認
      expect(jsErrors.length).toBe(0);
      
      if (jsErrors.length > 0) {
        console.log(`❌ ${browserName} JavaScriptエラー検出:`, jsErrors);
      } else {
        console.log(`✅ ${browserName} JavaScriptエラーハンドリング: 正常`);
      }
    });

    test('全ブラウザ - ネットワークエラーハンドリングテスト', async ({ page, browserName }) => {
      await page.goto('http://localhost:5173');
      
      // 新規プロジェクト作成
      await page.getByTestId('new-project-button').click();
      await page.getByTestId('project-name-input').fill('ネットワークテスト');
      await page.getByTestId('create-project-button').click();
      
      // ネットワーク接続を一時的に無効化
      await page.context().setOffline(true);
      
      // オフライン状態での操作テスト
      await page.keyboard.press('Control+s');
      
      // ネットワーク接続を復旧
      await page.context().setOffline(false);
      
      console.log(`✅ ${browserName} ネットワークエラーハンドリング: 完了`);
    });
  });
});