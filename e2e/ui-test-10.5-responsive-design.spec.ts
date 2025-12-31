import { test, expect } from '@playwright/test';

test.describe('UIテスト 10.5: レスポンシブデザイン詳細テスト', () => {
  
  // デスクトップ解像度テスト
  test.describe('デスクトップ解像度テスト', () => {
    
    test('4K解像度 (3840x2160) - 超高解像度テスト', async ({ page }) => {
      await page.setViewportSize({ width: 3840, height: 2160 });
      await page.goto('http://localhost:5173');
      
      // 基本UI要素の表示確認
      await expect(page.locator('h1')).toBeVisible();
      await expect(page.getByTestId('new-project-button')).toBeVisible();
      
      // 新規プロジェクト作成
      await page.getByTestId('new-project-button').click();
      await page.getByTestId('project-name-input').fill('4K解像度テスト');
      await page.getByTestId('create-project-button').click();
      
      // 4K解像度での要素配置確認
      const paletteContainer = page.locator('.component-palette');
      if (await paletteContainer.isVisible()) {
        const paletteBox = await paletteContainer.boundingBox();
        expect(paletteBox?.width).toBeGreaterThan(250); // 4Kでは十分な幅
      }
      
      // キャンバス領域の確認
      const canvas = page.locator('canvas, .canvas-container, .konva-content');
      if (await canvas.first().isVisible()) {
        const canvasBox = await canvas.first().boundingBox();
        expect(canvasBox?.width).toBeGreaterThan(2000); // 4Kでは非常に広いキャンバス
      }
      
      console.log('✅ 4K解像度テスト: 成功');
    });

    test('WQHD解像度 (2560x1440) - 高解像度テスト', async ({ page }) => {
      await page.setViewportSize({ width: 2560, height: 1440 });
      await page.goto('http://localhost:5173');
      
      // 基本UI要素の表示確認
      await expect(page.locator('h1')).toBeVisible();
      await expect(page.getByTestId('new-project-button')).toBeVisible();
      
      // 新規プロジェクト作成
      await page.getByTestId('new-project-button').click();
      await page.getByTestId('project-name-input').fill('WQHD解像度テスト');
      await page.getByTestId('create-project-button').click();
      
      // WQHD解像度での要素配置確認
      await expect(page.getByTestId('model-tab')).toBeVisible();
      
      // タブ切り替えの動作確認
      await page.getByTestId('files-tab').click();
      await page.getByTestId('simulation-tab').click();
      await page.getByTestId('model-tab').click();
      
      console.log('✅ WQHD解像度テスト: 成功');
    });

    test('フルHD解像度 (1920x1080) - 標準高解像度テスト', async ({ page }) => {
      await page.setViewportSize({ width: 1920, height: 1080 });
      await page.goto('http://localhost:5173');
      
      // 基本UI要素の表示確認
      await expect(page.locator('h1')).toBeVisible();
      await expect(page.getByTestId('new-project-button')).toBeVisible();
      
      // 新規プロジェクト作成
      await page.getByTestId('new-project-button').click();
      await page.getByTestId('project-name-input').fill('フルHD解像度テスト');
      await page.getByTestId('create-project-button').click();
      
      // フルHD解像度での最適な表示確認
      const paletteContainer = page.locator('.component-palette');
      if (await paletteContainer.isVisible()) {
        const paletteBox = await paletteContainer.boundingBox();
        expect(paletteBox?.width).toBeGreaterThan(200);
        expect(paletteBox?.width).toBeLessThan(400); // 適切な幅
      }
      
      // プロパティパネルの表示確認
      const propertiesPanel = page.locator('.properties-panel, [data-testid="properties-panel"]');
      if (await propertiesPanel.isVisible()) {
        const propertiesBox = await propertiesPanel.boundingBox();
        expect(propertiesBox?.width).toBeGreaterThan(200);
      }
      
      console.log('✅ フルHD解像度テスト: 成功');
    });
  });

  // ノートPC解像度テスト
  test.describe('ノートPC解像度テスト', () => {
    
    test('1366x768 - 標準ノートPC解像度テスト', async ({ page }) => {
      await page.setViewportSize({ width: 1366, height: 768 });
      await page.goto('http://localhost:5173');
      
      // 基本UI要素の表示確認
      await expect(page.locator('h1')).toBeVisible();
      await expect(page.getByTestId('new-project-button')).toBeVisible();
      
      // 新規プロジェクト作成
      await page.getByTestId('new-project-button').click();
      await page.getByTestId('project-name-input').fill('1366x768解像度テスト');
      await page.getByTestId('create-project-button').click();
      
      // 標準ノートPC解像度での要素配置確認
      await expect(page.getByTestId('model-tab')).toBeVisible();
      
      // UI要素が画面内に収まっていることを確認
      const tabs = page.locator('[data-testid="model-tab"], [data-testid="files-tab"], [data-testid="simulation-tab"]');
      const tabCount = await tabs.count();
      expect(tabCount).toBeGreaterThanOrEqual(3);
      
      // 各タブが見える位置にあることを確認
      for (let i = 0; i < tabCount; i++) {
        const tab = tabs.nth(i);
        const tabBox = await tab.boundingBox();
        if (tabBox) {
          expect(tabBox.x).toBeGreaterThanOrEqual(0);
          expect(tabBox.x + tabBox.width).toBeLessThanOrEqual(1366);
        }
      }
      
      console.log('✅ 1366x768解像度テスト: 成功');
    });

    test('1440x900 - MacBook Air解像度テスト', async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto('http://localhost:5173');
      
      // 基本UI要素の表示確認
      await expect(page.locator('h1')).toBeVisible();
      await expect(page.getByTestId('new-project-button')).toBeVisible();
      
      // 新規プロジェクト作成
      await page.getByTestId('new-project-button').click();
      await page.getByTestId('project-name-input').fill('MacBook Air解像度テスト');
      await page.getByTestId('create-project-button').click();
      
      // MacBook Air解像度での表示確認
      await expect(page.getByTestId('model-tab')).toBeVisible();
      
      // コンポーネントパレットの操作性確認
      const paletteContainer = page.locator('.component-palette');
      if (await paletteContainer.isVisible()) {
        const pipesCategory = page.locator('[data-category="pipes"]');
        if (await pipesCategory.isVisible()) {
          await pipesCategory.click();
          
          const pipeComponent = page.locator('[data-component-type="TTubo"]');
          if (await pipeComponent.isVisible()) {
            await pipeComponent.click();
          }
        }
      }
      
      console.log('✅ MacBook Air解像度テスト: 成功');
    });
  });

  // 最小サポート解像度テスト
  test.describe('最小サポート解像度テスト', () => {
    
    test('1280x720 - 最小サポート解像度テスト', async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 720 });
      await page.goto('http://localhost:5173');
      
      // 基本UI要素の表示確認
      await expect(page.locator('h1')).toBeVisible();
      await expect(page.getByTestId('new-project-button')).toBeVisible();
      
      // 新規プロジェクト作成
      await page.getByTestId('new-project-button').click();
      await page.getByTestId('project-name-input').fill('最小解像度テスト');
      await page.getByTestId('create-project-button').click();
      
      // 最小解像度でも基本機能が使用可能であることを確認
      await expect(page.getByTestId('model-tab')).toBeVisible();
      
      // UI要素が重複していないことを確認
      const modelTab = page.getByTestId('model-tab');
      const filesTab = page.getByTestId('files-tab');
      const simulationTab = page.getByTestId('simulation-tab');
      
      const modelBox = await modelTab.boundingBox();
      const filesBox = await filesTab.boundingBox();
      const simulationBox = await simulationTab.boundingBox();
      
      if (modelBox && filesBox && simulationBox) {
        // タブが重複していないことを確認
        expect(modelBox.x + modelBox.width).toBeLessThanOrEqual(filesBox.x + 5); // 5pxの余裕
        expect(filesBox.x + filesBox.width).toBeLessThanOrEqual(simulationBox.x + 5);
      }
      
      console.log('✅ 最小解像度テスト: 成功');
    });

    test('1280x800 - 小型ノートPC解像度テスト', async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto('http://localhost:5173');
      
      // 基本UI要素の表示確認
      await expect(page.locator('h1')).toBeVisible();
      await expect(page.getByTestId('new-project-button')).toBeVisible();
      
      // 新規プロジェクト作成
      await page.getByTestId('new-project-button').click();
      await page.getByTestId('project-name-input').fill('小型ノートPC解像度テスト');
      await page.getByTestId('create-project-button').click();
      
      // 小型ノートPC解像度での操作性確認
      await expect(page.getByTestId('model-tab')).toBeVisible();
      
      // 縦方向のスペースが十分であることを確認
      const pageHeight = await page.evaluate(() => document.body.scrollHeight);
      expect(pageHeight).toBeLessThanOrEqual(800 * 1.2); // 20%のスクロール余裕
      
      console.log('✅ 小型ノートPC解像度テスト: 成功');
    });
  });

  // タブレット解像度テスト
  test.describe('タブレット解像度テスト', () => {
    
    test('1024x768 - 標準タブレット横向きテスト', async ({ page }) => {
      await page.setViewportSize({ width: 1024, height: 768 });
      await page.goto('http://localhost:5173');
      
      // 基本UI要素の表示確認
      await expect(page.locator('h1')).toBeVisible();
      await expect(page.getByTestId('new-project-button')).toBeVisible();
      
      // タッチ操作のシミュレーション
      await page.getByTestId('new-project-button').click();
      await page.getByTestId('project-name-input').fill('タブレット横向きテスト');
      await page.getByTestId('create-project-button').click();
      
      // タブレット解像度での操作性確認
      await expect(page.getByTestId('model-tab')).toBeVisible();
      
      // タブ切り替えの操作性確認（タッチ操作想定）
      await page.getByTestId('files-tab').click();
      await page.waitForTimeout(100); // タッチ操作の遅延を考慮
      await expect(page.getByTestId('files-tab')).toBeVisible();
      
      await page.getByTestId('simulation-tab').click();
      await page.waitForTimeout(100);
      await expect(page.getByTestId('simulation-tab')).toBeVisible();
      
      await page.getByTestId('model-tab').click();
      await page.waitForTimeout(100);
      await expect(page.getByTestId('model-tab')).toBeVisible();
      
      console.log('✅ タブレット横向きテスト: 成功');
    });

    test('768x1024 - タブレット縦向きテスト', async ({ page }) => {
      await page.setViewportSize({ width: 768, height: 1024 });
      await page.goto('http://localhost:5173');
      
      // 縦向きでの基本UI要素の表示確認
      await expect(page.locator('h1')).toBeVisible();
      await expect(page.getByTestId('new-project-button')).toBeVisible();
      
      // 新規プロジェクト作成
      await page.getByTestId('new-project-button').click();
      await page.getByTestId('project-name-input').fill('タブレット縦向きテスト');
      await page.getByTestId('create-project-button').click();
      
      // 縦向きレイアウトでの表示確認
      await expect(page.getByTestId('model-tab')).toBeVisible();
      
      // 縦向きでのUI要素配置確認
      const paletteContainer = page.locator('.component-palette');
      if (await paletteContainer.isVisible()) {
        const paletteBox = await paletteContainer.boundingBox();
        if (paletteBox) {
          // 縦向きでは幅が制限されるため、適切に調整されていることを確認
          expect(paletteBox.width).toBeLessThan(300);
          expect(paletteBox.x + paletteBox.width).toBeLessThanOrEqual(768);
        }
      }
      
      console.log('✅ タブレット縦向きテスト: 成功');
    });

    test('1280x800 - 大型タブレット解像度テスト', async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto('http://localhost:5173');
      
      // 基本UI要素の表示確認
      await expect(page.locator('h1')).toBeVisible();
      await expect(page.getByTestId('new-project-button')).toBeVisible();
      
      // 新規プロジェクト作成
      await page.getByTestId('new-project-button').click();
      await page.getByTestId('project-name-input').fill('大型タブレットテスト');
      await page.getByTestId('create-project-button').click();
      
      // 大型タブレットでの操作性確認
      await expect(page.getByTestId('model-tab')).toBeVisible();
      
      // コンポーネントパレットの操作確認
      const paletteContainer = page.locator('.component-palette');
      if (await paletteContainer.isVisible()) {
        const pipesCategory = page.locator('[data-category="pipes"]');
        if (await pipesCategory.isVisible()) {
          await pipesCategory.click();
          
          // コンポーネント選択の操作性確認
          const pipeComponent = page.locator('[data-component-type="TTubo"]');
          if (await pipeComponent.isVisible()) {
            await pipeComponent.click();
            
            // キャンバス操作の確認
            const canvas = page.locator('canvas, .canvas-container, .konva-content');
            if (await canvas.first().isVisible()) {
              await canvas.first().click({ position: { x: 200, y: 200 } });
            }
          }
        }
      }
      
      console.log('✅ 大型タブレットテスト: 成功');
    });
  });

  // 動的解像度変更テスト
  test.describe('動的解像度変更テスト', () => {
    
    test('解像度動的変更テスト - デスクトップからタブレット', async ({ page }) => {
      // デスクトップ解像度で開始
      await page.setViewportSize({ width: 1920, height: 1080 });
      await page.goto('http://localhost:5173');
      
      // 新規プロジェクト作成
      await page.getByTestId('new-project-button').click();
      await page.getByTestId('project-name-input').fill('動的解像度変更テスト');
      await page.getByTestId('create-project-button').click();
      
      // デスクトップでの表示確認
      await expect(page.getByTestId('model-tab')).toBeVisible();
      
      // タブレット解像度に変更
      await page.setViewportSize({ width: 1024, height: 768 });
      await page.waitForTimeout(500); // レイアウト調整の待機
      
      // タブレット解像度でも正常に表示されることを確認
      await expect(page.getByTestId('model-tab')).toBeVisible();
      await expect(page.getByTestId('files-tab')).toBeVisible();
      await expect(page.getByTestId('simulation-tab')).toBeVisible();
      
      // 最小解像度に変更
      await page.setViewportSize({ width: 1280, height: 720 });
      await page.waitForTimeout(500);
      
      // 最小解像度でも正常に表示されることを確認
      await expect(page.getByTestId('model-tab')).toBeVisible();
      
      console.log('✅ 動的解像度変更テスト: 成功');
    });

    test('ウィンドウリサイズシミュレーションテスト', async ({ page }) => {
      await page.setViewportSize({ width: 1366, height: 768 });
      await page.goto('http://localhost:5173');
      
      // 新規プロジェクト作成
      await page.getByTestId('new-project-button').click();
      await page.getByTestId('project-name-input').fill('リサイズテスト');
      await page.getByTestId('create-project-button').click();
      
      // 段階的にウィンドウサイズを変更
      const sizes = [
        { width: 1366, height: 768 },
        { width: 1200, height: 700 },
        { width: 1024, height: 600 },
        { width: 1280, height: 720 },
        { width: 1600, height: 900 },
        { width: 1920, height: 1080 }
      ];
      
      for (const size of sizes) {
        await page.setViewportSize(size);
        await page.waitForTimeout(200); // レイアウト調整の待機
        
        // 各サイズで基本要素が表示されることを確認
        await expect(page.getByTestId('model-tab')).toBeVisible();
        
        console.log(`✅ ${size.width}x${size.height} 表示確認: 成功`);
      }
      
      console.log('✅ ウィンドウリサイズシミュレーション: 全サイズ成功');
    });
  });

  // レスポンシブ要素テスト
  test.describe('レスポンシブ要素詳細テスト', () => {
    
    test('ナビゲーション要素レスポンシブテスト', async ({ page }) => {
      const sizes = [
        { width: 1920, height: 1080, name: 'デスクトップ' },
        { width: 1366, height: 768, name: 'ノートPC' },
        { width: 1024, height: 768, name: 'タブレット' },
        { width: 1280, height: 720, name: '最小サポート' }
      ];
      
      for (const size of sizes) {
        await page.setViewportSize(size);
        await page.goto('http://localhost:5173');
        
        // 新規プロジェクト作成
        await page.getByTestId('new-project-button').click();
        await page.getByTestId('project-name-input').fill(`${size.name}ナビテスト`);
        await page.getByTestId('create-project-button').click();
        
        // ナビゲーション要素の表示確認
        const tabs = page.locator('[data-testid="model-tab"], [data-testid="files-tab"], [data-testid="simulation-tab"]');
        const tabCount = await tabs.count();
        
        expect(tabCount).toBeGreaterThanOrEqual(3);
        
        // 各タブが適切に配置されていることを確認
        for (let i = 0; i < tabCount; i++) {
          const tab = tabs.nth(i);
          await expect(tab).toBeVisible();
          
          const tabBox = await tab.boundingBox();
          if (tabBox) {
            expect(tabBox.x).toBeGreaterThanOrEqual(0);
            expect(tabBox.x + tabBox.width).toBeLessThanOrEqual(size.width);
          }
        }
        
        console.log(`✅ ${size.name} (${size.width}x${size.height}) ナビゲーション: 成功`);
      }
    });

    test('コンテンツ領域レスポンシブテスト', async ({ page }) => {
      const sizes = [
        { width: 1920, height: 1080 },
        { width: 1366, height: 768 },
        { width: 1024, height: 768 },
        { width: 1280, height: 720 }
      ];
      
      for (const size of sizes) {
        await page.setViewportSize(size);
        await page.goto('http://localhost:5173');
        
        // 新規プロジェクト作成
        await page.getByTestId('new-project-button').click();
        await page.getByTestId('project-name-input').fill('コンテンツ領域テスト');
        await page.getByTestId('create-project-button').click();
        
        // コンテンツ領域の確認
        const paletteContainer = page.locator('.component-palette');
        const canvas = page.locator('canvas, .canvas-container, .konva-content');
        
        if (await paletteContainer.isVisible()) {
          const paletteBox = await paletteContainer.boundingBox();
          if (paletteBox) {
            expect(paletteBox.x).toBeGreaterThanOrEqual(0);
            expect(paletteBox.x + paletteBox.width).toBeLessThanOrEqual(size.width);
          }
        }
        
        if (await canvas.first().isVisible()) {
          const canvasBox = await canvas.first().boundingBox();
          if (canvasBox) {
            expect(canvasBox.x).toBeGreaterThanOrEqual(0);
            expect(canvasBox.x + canvasBox.width).toBeLessThanOrEqual(size.width);
          }
        }
        
        console.log(`✅ ${size.width}x${size.height} コンテンツ領域: 成功`);
      }
    });
  });
});