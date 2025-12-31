import { test, expect } from '@playwright/test';

test.describe('UIテスト 10.5: Microsoft Edge 互換性テスト', () => {
  
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:5173');
  });

  test('Edge - 基本機能互換性テスト', async ({ page, browserName }) => {
    // Edge専用テスト（他のブラウザではスキップ）
    test.skip(browserName !== 'Microsoft Edge', 'Microsoft Edge専用テスト');
    
    console.log('🚀 Microsoft Edge 基本機能テスト開始');
    
    // 基本UI要素の表示確認
    await expect(page.locator('h1')).toContainText('OpenWAM プロジェクト');
    await expect(page.getByTestId('new-project-button')).toBeVisible();
    
    // 新規プロジェクト作成フロー
    await page.getByTestId('new-project-button').click();
    await page.getByTestId('project-name-input').fill('Edge互換性テスト');
    await page.getByTestId('project-description-input').fill('Microsoft Edgeでの互換性確認');
    await page.getByTestId('create-project-button').click();
    
    // プロジェクトエディター画面の表示確認
    await expect(page.getByTestId('model-tab')).toBeVisible();
    await expect(page.getByTestId('files-tab')).toBeVisible();
    await expect(page.getByTestId('simulation-tab')).toBeVisible();
    
    console.log('✅ Edge基本機能テスト: 成功');
  });

  test('Edge - ドラッグ&ドロップ互換性テスト', async ({ page, browserName }) => {
    test.skip(browserName !== 'Microsoft Edge', 'Microsoft Edge専用テスト');
    
    // 新規プロジェクト作成
    await page.getByTestId('new-project-button').click();
    await page.getByTestId('project-name-input').fill('Edge D&Dテスト');
    await page.getByTestId('create-project-button').click();
    
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
            
            // Edge特有のドラッグ&ドロップ操作
            const sourceBox = await pipeComponent.boundingBox();
            const targetBox = await canvas.first().boundingBox();
            
            if (sourceBox && targetBox) {
              // Edgeでのドラッグ&ドロップ（より慎重な操作）
              await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
              await page.waitForTimeout(100); // Edge用の待機時間
              await page.mouse.down();
              await page.waitForTimeout(100);
              await page.mouse.move(targetBox.x + 200, targetBox.y + 200, { steps: 10 });
              await page.waitForTimeout(100);
              await page.mouse.up();
              
              console.log('✅ Edge ドラッグ&ドロップ: 実行完了');
            }
          }
        }
      }
    }
  });

  test('Edge - キーボードショートカット互換性テスト', async ({ page, browserName }) => {
    test.skip(browserName !== 'Microsoft Edge', 'Microsoft Edge専用テスト');
    
    // 新規プロジェクト作成
    await page.getByTestId('new-project-button').click();
    await page.getByTestId('project-name-input').fill('Edgeショートカットテスト');
    await page.getByTestId('create-project-button').click();
    
    // Ctrl+S 保存ショートカット
    await page.keyboard.press('Control+s');
    
    // 保存通知の確認
    const saveNotification = page.getByTestId('save-notification');
    if (await saveNotification.isVisible({ timeout: 2000 })) {
      await expect(saveNotification).toContainText('保存');
      console.log('✅ Edge Ctrl+S保存ショートカット: 成功');
    }
    
    // その他のショートカットテスト
    await page.keyboard.press('Control+z'); // 元に戻す
    await page.keyboard.press('Control+y'); // やり直し
    await page.keyboard.press('Delete');    // 削除
    await page.keyboard.press('Escape');    // キャンセル
    
    console.log('✅ Edge キーボードショートカット: 全て実行完了');
  });

  test('Edge - CSS互換性テスト', async ({ page, browserName }) => {
    test.skip(browserName !== 'Microsoft Edge', 'Microsoft Edge専用テスト');
    
    // 新規プロジェクト作成
    await page.getByTestId('new-project-button').click();
    await page.getByTestId('project-name-input').fill('EdgeCSSテスト');
    await page.getByTestId('create-project-button').click();
    
    // CSS Grid/Flexbox レイアウトの確認
    const modelTab = page.getByTestId('model-tab');
    if (await modelTab.isVisible()) {
      const tabStyles = await modelTab.evaluate((el) => {
        const styles = window.getComputedStyle(el);
        return {
          display: styles.display,
          position: styles.position,
          flexDirection: styles.flexDirection
        };
      });
      
      console.log('Edge CSS スタイル確認:', tabStyles);
    }
    
    // コンポーネントパレットのスタイル確認
    const paletteContainer = page.locator('.component-palette');
    if (await paletteContainer.isVisible()) {
      const paletteStyles = await paletteContainer.evaluate((el) => {
        const styles = window.getComputedStyle(el);
        return {
          display: styles.display,
          overflow: styles.overflow,
          height: styles.height
        };
      });
      
      console.log('Edge パレットスタイル確認:', paletteStyles);
    }
    
    console.log('✅ Edge CSS互換性テスト: 完了');
  });

  test('Edge - JavaScript ES6+ 機能互換性テスト', async ({ page, browserName }) => {
    test.skip(browserName !== 'Microsoft Edge', 'Microsoft Edge専用テスト');
    
    // JavaScript機能の動作確認
    const jsFeatures = await page.evaluate(() => {
      const features = {
        arrow_functions: typeof (() => {}) === 'function',
        template_literals: `test` === 'test',
        destructuring: (() => {
          try {
            const [a, b] = [1, 2];
            return a === 1 && b === 2;
          } catch {
            return false;
          }
        })(),
        async_await: typeof (async () => {}) === 'function',
        promises: typeof Promise !== 'undefined',
        fetch_api: typeof fetch !== 'undefined',
        local_storage: typeof localStorage !== 'undefined',
        session_storage: typeof sessionStorage !== 'undefined'
      };
      
      return features;
    });
    
    console.log('Edge JavaScript機能サポート:', jsFeatures);
    
    // 重要な機能がサポートされていることを確認
    expect(jsFeatures.arrow_functions).toBe(true);
    expect(jsFeatures.promises).toBe(true);
    expect(jsFeatures.fetch_api).toBe(true);
    expect(jsFeatures.local_storage).toBe(true);
    
    console.log('✅ Edge JavaScript ES6+ 互換性: 合格');
  });

  test('Edge - WebSocket互換性テスト', async ({ page, browserName }) => {
    test.skip(browserName !== 'Microsoft Edge', 'Microsoft Edge専用テスト');
    
    // WebSocket APIの確認
    const webSocketSupport = await page.evaluate(() => {
      return {
        websocket_available: typeof WebSocket !== 'undefined',
        websocket_constructor: typeof WebSocket === 'function'
      };
    });
    
    console.log('Edge WebSocketサポート:', webSocketSupport);
    
    expect(webSocketSupport.websocket_available).toBe(true);
    expect(webSocketSupport.websocket_constructor).toBe(true);
    
    console.log('✅ Edge WebSocket互換性: 合格');
  });

  test('Edge - ファイルAPI互換性テスト', async ({ page, browserName }) => {
    test.skip(browserName !== 'Microsoft Edge', 'Microsoft Edge専用テスト');
    
    // 新規プロジェクト作成
    await page.getByTestId('new-project-button').click();
    await page.getByTestId('project-name-input').fill('EdgeファイルAPIテスト');
    await page.getByTestId('create-project-button').click();
    
    // ファイルタブに切り替え
    await page.getByTestId('files-tab').click();
    
    // File API の確認
    const fileApiSupport = await page.evaluate(() => {
      return {
        file_api: typeof File !== 'undefined',
        file_reader: typeof FileReader !== 'undefined',
        blob_api: typeof Blob !== 'undefined',
        form_data: typeof FormData !== 'undefined'
      };
    });
    
    console.log('Edge ファイルAPIサポート:', fileApiSupport);
    
    expect(fileApiSupport.file_api).toBe(true);
    expect(fileApiSupport.file_reader).toBe(true);
    expect(fileApiSupport.blob_api).toBe(true);
    expect(fileApiSupport.form_data).toBe(true);
    
    console.log('✅ Edge ファイルAPI互換性: 合格');
  });

  test('Edge - Canvas API互換性テスト', async ({ page, browserName }) => {
    test.skip(browserName !== 'Microsoft Edge', 'Microsoft Edge専用テスト');
    
    // 新規プロジェクト作成
    await page.getByTestId('new-project-button').click();
    await page.getByTestId('project-name-input').fill('EdgeCanvasテスト');
    await page.getByTestId('create-project-button').click();
    
    // Canvas API の確認
    const canvasApiSupport = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      const ctx2d = canvas.getContext('2d');
      
      return {
        canvas_element: typeof HTMLCanvasElement !== 'undefined',
        canvas_2d_context: ctx2d !== null,
        canvas_methods: ctx2d ? {
          drawImage: typeof ctx2d.drawImage === 'function',
          fillRect: typeof ctx2d.fillRect === 'function',
          strokeRect: typeof ctx2d.strokeRect === 'function',
          arc: typeof ctx2d.arc === 'function'
        } : {}
      };
    });
    
    console.log('Edge Canvas APIサポート:', canvasApiSupport);
    
    expect(canvasApiSupport.canvas_element).toBe(true);
    expect(canvasApiSupport.canvas_2d_context).toBe(true);
    
    console.log('✅ Edge Canvas API互換性: 合格');
  });

  test('Edge - 総合互換性テスト', async ({ page, browserName }) => {
    test.skip(browserName !== 'Microsoft Edge', 'Microsoft Edge専用テスト');
    
    console.log('🚀 Microsoft Edge 総合互換性テスト開始');
    
    // 1. 基本機能テスト
    await expect(page.locator('h1')).toContainText('OpenWAM プロジェクト');
    await page.getByTestId('new-project-button').click();
    await page.getByTestId('project-name-input').fill('Edge総合テスト');
    await page.getByTestId('create-project-button').click();
    
    // 2. UI操作テスト
    await expect(page.getByTestId('model-tab')).toBeVisible();
    await page.getByTestId('files-tab').click();
    await page.getByTestId('simulation-tab').click();
    await page.getByTestId('model-tab').click();
    
    // 3. キーボードショートカットテスト
    await page.keyboard.press('Control+s');
    
    // 4. 解像度変更テスト
    await page.setViewportSize({ width: 1366, height: 768 });
    await expect(page.getByTestId('model-tab')).toBeVisible();
    
    await page.setViewportSize({ width: 1024, height: 768 });
    await expect(page.getByTestId('model-tab')).toBeVisible();
    
    // 5. パフォーマンステスト
    const startTime = Date.now();
    await page.reload();
    await expect(page.locator('h1')).toBeVisible();
    const loadTime = Date.now() - startTime;
    
    console.log(`📊 Edge ページ再読み込み時間: ${loadTime}ms`);
    expect(loadTime).toBeLessThan(5000);
    
    console.log('✅ Microsoft Edge 総合互換性テスト: 全ステップ完了');
  });
});