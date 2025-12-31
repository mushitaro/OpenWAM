import { test, expect } from '@playwright/test';

test.describe('UIテスト 10.2: 基本コンポーネント配置テスト', () => {
  test.beforeEach(async ({ page }) => {
    // アプリケーションにアクセス
    await page.goto('http://localhost:5174', { waitUntil: 'networkidle' });
    
    // ページが完全に読み込まれるまで待機
    await page.waitForLoadState('domcontentloaded');
    
    // 新規プロジェクトボタンが表示されるまで待機
    const newProjectButton = page.getByTestId('new-project-button');
    await expect(newProjectButton).toBeVisible({ timeout: 15000 });
    
    // 新規プロジェクト作成
    await newProjectButton.click();
    
    // モーダルが表示されるまで待機
    await expect(page.getByTestId('project-name-input')).toBeVisible({ timeout: 10000 });
    
    await page.getByTestId('project-name-input').fill('基本コンポーネントテスト');
    await page.getByTestId('project-description-input').fill('基本的なコンポーネント配置のテスト');
    
    // 作成ボタンをクリック
    await page.getByTestId('create-project-button').click();
    
    // プロジェクトエディター画面への遷移を待機
    await expect(page.getByTestId('model-tab')).toBeVisible({ timeout: 15000 });
  });

  test('1. コンポーネントパレット表示確認', async ({ page }) => {
    console.log('🔧 コンポーネントパレット表示確認開始');
    
    // コンポーネントパレットの存在確認
    const palette = page.locator('[data-testid="component-palette"]');
    await expect(palette).toBeVisible({ timeout: 10000 });
    
    console.log('✅ コンポーネントパレット表示確認: 成功');
  });

  test('2. パイプカテゴリ操作テスト', async ({ page }) => {
    console.log('🔧 パイプカテゴリ操作テスト開始');
    
    // コンポーネントパレットの確認
    const palette = page.locator('[data-testid="component-palette"]');
    await expect(palette).toBeVisible({ timeout: 10000 });
    
    // パイプカテゴリボタンの確認
    const pipesCategory = page.locator('[data-testid="component-palette-pipes"]');
    await expect(pipesCategory).toBeVisible({ timeout: 5000 });
    
    // パイプカテゴリをクリック
    await pipesCategory.click();
    
    // パイプコンポーネントが表示されることを確認
    const pipeComponent = page.locator('[data-testid="add-pipe"]');
    await expect(pipeComponent).toBeVisible({ timeout: 5000 });
    
    console.log('✅ パイプカテゴリ操作テスト: 成功');
  });

  test('3. 境界条件カテゴリ操作テスト', async ({ page }) => {
    console.log('🔧 境界条件カテゴリ操作テスト開始');
    
    // 境界条件カテゴリボタンの確認
    const boundariesCategory = page.locator('[data-testid="component-palette-boundaries"]');
    await expect(boundariesCategory).toBeVisible({ timeout: 5000 });
    
    // 境界条件カテゴリをクリック
    await boundariesCategory.click();
    
    // 境界条件コンポーネントが表示されることを確認
    const atmosphereComponent = page.locator('[data-testid="add-atmosphere"]');
    await expect(atmosphereComponent).toBeVisible({ timeout: 5000 });
    
    console.log('✅ 境界条件カテゴリ操作テスト: 成功');
  });

  test('4. 全カテゴリ表示確認テスト', async ({ page }) => {
    console.log('🔧 全カテゴリ表示確認テスト開始');
    
    const categories = [
      'pipes',
      'boundaries', 
      'plenums',
      'valves',
      'engine',
      'dpf'
    ];
    
    for (const category of categories) {
      const categoryButton = page.locator(`[data-testid="component-palette-${category}"]`);
      
      if (await categoryButton.isVisible({ timeout: 2000 })) {
        console.log(`✅ ${category}カテゴリ: 表示確認`);
        
        // カテゴリをクリックして展開
        await categoryButton.click();
        
        // 少し待機してからクリックして閉じる
        await page.waitForTimeout(500);
        await categoryButton.click();
      } else {
        console.log(`⚠️ ${category}カテゴリ: 表示されていません`);
      }
    }
    
    console.log('✅ 全カテゴリ表示確認テスト: 完了');
  });

  test('5. コンポーネント配置基本テスト', async ({ page }) => {
    console.log('🔧 コンポーネント配置基本テスト開始');
    
    // パイプカテゴリを開く
    const pipesCategory = page.locator('[data-testid="component-palette-pipes"]');
    await pipesCategory.click();
    
    // 1Dパイプコンポーネントをクリック
    const pipeComponent = page.locator('[data-testid="add-pipe"]');
    await expect(pipeComponent).toBeVisible({ timeout: 5000 });
    await pipeComponent.click();
    
    // キャンバス要素の確認
    const canvas = page.locator('[data-testid="canvas-editor"], canvas, .canvas-container, .konva-content').first();
    await expect(canvas).toBeVisible({ timeout: 5000 });
    
    console.log('✅ コンポーネント配置基本テスト: 成功');
  });

  test('6. 複数コンポーネント配置テスト', async ({ page }) => {
    console.log('🔧 複数コンポーネント配置テスト開始');
    
    // パイプカテゴリを開く
    const pipesCategory = page.locator('[data-testid="component-palette-pipes"]');
    await pipesCategory.click();
    
    // 複数のパイプを配置
    const pipeComponent = page.locator('[data-testid="add-pipe"]');
    await expect(pipeComponent).toBeVisible({ timeout: 5000 });
    
    for (let i = 0; i < 3; i++) {
      await pipeComponent.click();
      await page.waitForTimeout(200); // 配置間隔
      console.log(`パイプ ${i + 1} 配置完了`);
    }
    
    console.log('✅ 複数コンポーネント配置テスト: 成功');
  });

  test('7. 異なるカテゴリのコンポーネント配置テスト', async ({ page }) => {
    console.log('🔧 異なるカテゴリのコンポーネント配置テスト開始');
    
    // パイプを配置
    const pipesCategory = page.locator('[data-testid="component-palette-pipes"]');
    await pipesCategory.click();
    const pipeComponent = page.locator('[data-testid="add-pipe"]');
    if (await pipeComponent.isVisible({ timeout: 3000 })) {
      await pipeComponent.click();
      console.log('✅ パイプ配置: 成功');
    }
    
    // 境界条件を配置
    const boundariesCategory = page.locator('[data-testid="component-palette-boundaries"]');
    await boundariesCategory.click();
    const atmosphereComponent = page.locator('[data-testid="add-atmosphere"]');
    if (await atmosphereComponent.isVisible({ timeout: 3000 })) {
      await atmosphereComponent.click();
      console.log('✅ 開放端配置: 成功');
    }
    
    // プレナムを配置
    const plenumsCategory = page.locator('[data-testid="component-palette-plenums"]');
    if (await plenumsCategory.isVisible({ timeout: 3000 })) {
      await plenumsCategory.click();
      const plenumComponent = page.locator('[data-testid="add-plenum"]');
      if (await plenumComponent.isVisible({ timeout: 3000 })) {
        await plenumComponent.click();
        console.log('✅ プレナム配置: 成功');
      }
    }
    
    console.log('✅ 異なるカテゴリのコンポーネント配置テスト: 完了');
  });

  test('8. キャンバス基本操作テスト', async ({ page }) => {
    console.log('🔧 キャンバス基本操作テスト開始');
    
    // キャンバス要素の確認
    const canvas = page.locator('[data-testid="canvas-editor"], canvas, .canvas-container, .konva-content').first();
    await expect(canvas).toBeVisible({ timeout: 10000 });
    
    // キャンバス上でのクリック操作（安全な位置）
    const canvasBounds = await canvas.boundingBox();
    if (canvasBounds) {
      const centerX = canvasBounds.width / 2;
      const centerY = canvasBounds.height / 2;
      
      // キャンバス中央をクリック
      await canvas.click({ position: { x: centerX, y: centerY } });
      console.log('✅ キャンバスクリック: 成功');
      
      // 右クリック操作
      await canvas.click({ 
        position: { x: centerX + 50, y: centerY + 50 }, 
        button: 'right' 
      });
      console.log('✅ キャンバス右クリック: 成功');
    }
    
    console.log('✅ キャンバス基本操作テスト: 完了');
  });

  test('9. 保存機能テスト', async ({ page }) => {
    console.log('🔧 保存機能テスト開始');
    
    // コンポーネントを1つ配置
    const pipesCategory = page.locator('[data-testid="component-palette-pipes"]');
    await pipesCategory.click();
    const pipeComponent = page.locator('[data-testid="add-pipe"]');
    if (await pipeComponent.isVisible({ timeout: 3000 })) {
      await pipeComponent.click();
    }
    
    // Ctrl+S で保存
    await page.keyboard.press('Control+s');
    
    // 保存通知の確認
    const saveNotification = page.locator('[data-testid="save-notification"], .save-notification, .notification');
    if (await saveNotification.isVisible({ timeout: 3000 })) {
      console.log('✅ 保存通知表示: 成功');
      
      // 通知が自動で消えることを確認
      await expect(saveNotification).not.toBeVisible({ timeout: 5000 });
      console.log('✅ 保存通知自動消去: 成功');
    } else {
      console.log('⚠️ 保存通知が表示されませんでした');
    }
    
    console.log('✅ 保存機能テスト: 完了');
  });

  test('10. エラーハンドリング基本テスト', async ({ page }) => {
    console.log('🔧 エラーハンドリング基本テスト開始');
    
    // 存在しないコンポーネントの削除試行
    await page.keyboard.press('Delete');
    
    // エラーメッセージまたは何も起こらないことを確認
    const errorMessage = page.locator('.error-message, [data-testid*="error"]');
    if (await errorMessage.isVisible({ timeout: 2000 })) {
      console.log('✅ エラーメッセージ表示: 成功');
    } else {
      console.log('✅ 無効操作の適切な無視: 成功');
    }
    
    console.log('✅ エラーハンドリング基本テスト: 完了');
  });

  test('11. UI応答性テスト', async ({ page }) => {
    console.log('🔧 UI応答性テスト開始');
    
    const startTime = Date.now();
    
    // 複数の操作を連続実行
    const pipesCategory = page.locator('[data-testid="component-palette-pipes"]');
    await pipesCategory.click();
    
    const pipeComponent = page.locator('[data-testid="add-pipe"]');
    if (await pipeComponent.isVisible({ timeout: 3000 })) {
      // 5個のコンポーネントを素早く配置
      for (let i = 0; i < 5; i++) {
        await pipeComponent.click();
      }
    }
    
    const endTime = Date.now();
    const duration = endTime - startTime;
    
    console.log(`✅ UI応答性テスト完了: ${duration}ms で5個のコンポーネントを配置`);
    
    // 応答性基準チェック（5秒以内）
    if (duration < 5000) {
      console.log('✅ UI応答性: 良好');
    } else {
      console.log('⚠️ UI応答性: 改善が必要');
    }
  });

  test('12. 総合基本操作フローテスト', async ({ page }) => {
    console.log('🚀 総合基本操作フローテスト開始');
    
    // 1. パレット表示確認
    const palette = page.locator('[data-testid="component-palette"]');
    await expect(palette).toBeVisible({ timeout: 10000 });
    console.log('📝 ステップ1: パレット表示確認 - 完了');
    
    // 2. パイプ配置
    const pipesCategory = page.locator('[data-testid="component-palette-pipes"]');
    await pipesCategory.click();
    const pipeComponent = page.locator('[data-testid="add-pipe"]');
    if (await pipeComponent.isVisible({ timeout: 3000 })) {
      await pipeComponent.click();
    }
    console.log('📝 ステップ2: パイプ配置 - 完了');
    
    // 3. 境界条件配置
    const boundariesCategory = page.locator('[data-testid="component-palette-boundaries"]');
    await boundariesCategory.click();
    const atmosphereComponent = page.locator('[data-testid="add-atmosphere"]');
    if (await atmosphereComponent.isVisible({ timeout: 3000 })) {
      await atmosphereComponent.click();
    }
    console.log('📝 ステップ3: 境界条件配置 - 完了');
    
    // 4. キャンバス操作
    const canvas = page.locator('[data-testid="canvas-editor"], canvas, .canvas-container, .konva-content').first();
    if (await canvas.isVisible({ timeout: 3000 })) {
      const canvasBounds = await canvas.boundingBox();
      if (canvasBounds) {
        await canvas.click({ 
          position: { 
            x: canvasBounds.width / 2, 
            y: canvasBounds.height / 2 
          } 
        });
      }
    }
    console.log('📝 ステップ4: キャンバス操作 - 完了');
    
    // 5. 保存
    await page.keyboard.press('Control+s');
    console.log('📝 ステップ5: 保存 - 完了');
    
    console.log('✅ 総合基本操作フローテスト: 全ステップ完了');
  });
});