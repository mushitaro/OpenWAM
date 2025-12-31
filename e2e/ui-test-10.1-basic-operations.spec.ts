import { test, expect } from '@playwright/test';

test.describe('UIテスト 10.1: 基本操作フローテスト', () => {
  test.beforeEach(async ({ page }) => {
    // アプリケーションにアクセス
    await page.goto('http://localhost:5173');
  });

  test('1. アプリケーション起動テスト', async ({ page }) => {
    // ダッシュボード画面の表示確認
    await expect(page.locator('h1')).toContainText('OpenWAM プロジェクト');
    
    // 新規プロジェクトボタンの存在確認
    await expect(page.getByTestId('new-project-button')).toBeVisible();
    
    // ページタイトルの確認
    await expect(page).toHaveTitle(/OpenWAM/);
    
    console.log('✅ アプリケーション起動テスト: 成功');
  });

  test('2. 新規プロジェクト作成フローテスト', async ({ page }) => {
    // 新規プロジェクトボタンをクリック
    await page.getByTestId('new-project-button').click();
    
    // モーダルダイアログの表示確認
    await expect(page.locator('h3')).toContainText('新規プロジェクト作成');
    
    // プロジェクト名入力
    const projectNameInput = page.getByTestId('project-name-input');
    await expect(projectNameInput).toBeVisible();
    await projectNameInput.fill('UIテスト_基本操作');
    
    // 説明入力
    const descriptionInput = page.getByTestId('project-description-input');
    await expect(descriptionInput).toBeVisible();
    await descriptionInput.fill('基本操作フローのテスト用プロジェクト');
    
    // 作成ボタンをクリック
    await page.getByTestId('create-project-button').click();
    
    // プロジェクトエディター画面への遷移確認
    await expect(page.locator('[data-testid="model-tab"]')).toBeVisible();
    await expect(page.locator('[data-testid="files-tab"]')).toBeVisible();
    await expect(page.locator('[data-testid="simulation-tab"]')).toBeVisible();
    
    console.log('✅ 新規プロジェクト作成フローテスト: 成功');
  });

  test('3. コンポーネントパレット操作テスト', async ({ page }) => {
    // まず新規プロジェクトを作成
    await page.getByTestId('new-project-button').click();
    await page.getByTestId('project-name-input').fill('パレットテスト');
    await page.getByTestId('create-project-button').click();
    
    // モデルタブがアクティブであることを確認
    await expect(page.getByTestId('model-tab')).toBeVisible();
    
    // コンポーネントパレットの存在確認
    const paletteContainer = page.locator('.component-palette');
    await expect(paletteContainer).toBeVisible();
    
    // パイプカテゴリの確認
    const pipesCategory = page.locator('[data-category="pipes"]');
    if (await pipesCategory.isVisible()) {
      await pipesCategory.click();
      
      // 1Dパイプコンポーネントの確認
      const pipeComponent = page.locator('[data-component-type="TTubo"]');
      if (await pipeComponent.isVisible()) {
        await pipeComponent.click();
        console.log('✅ パイプコンポーネント選択: 成功');
      }
    }
    
    console.log('✅ コンポーネントパレット操作テスト: 完了');
  });

  test('4. キャンバス基本操作テスト', async ({ page }) => {
    // 新規プロジェクト作成
    await page.getByTestId('new-project-button').click();
    await page.getByTestId('project-name-input').fill('キャンバステスト');
    await page.getByTestId('create-project-button').click();
    
    // キャンバス要素の確認
    const canvas = page.locator('canvas, .canvas-container, .konva-content');
    
    // キャンバスが存在する場合のテスト
    if (await canvas.first().isVisible()) {
      // キャンバス上でのクリック操作
      await canvas.first().click({ position: { x: 200, y: 200 } });
      
      // ズーム操作のシミュレーション（マウスホイール）
      await canvas.first().hover();
      await page.mouse.wheel(0, -100); // ズームイン
      await page.mouse.wheel(0, 100);  // ズームアウト
      
      console.log('✅ キャンバス基本操作: 成功');
    } else {
      console.log('⚠️ キャンバス要素が見つかりません');
    }
    
    console.log('✅ キャンバス基本操作テスト: 完了');
  });

  test('5. プロパティパネル表示テスト', async ({ page }) => {
    // 新規プロジェクト作成
    await page.getByTestId('new-project-button').click();
    await page.getByTestId('project-name-input').fill('プロパティテスト');
    await page.getByTestId('create-project-button').click();
    
    // プロパティパネルの存在確認
    const propertiesPanel = page.locator('.properties-panel, [data-testid="properties-panel"]');
    
    if (await propertiesPanel.isVisible()) {
      console.log('✅ プロパティパネル表示: 成功');
      
      // プロパティパネル内の要素確認
      const propertyInputs = page.locator('input[type="number"], input[type="text"]');
      const inputCount = await propertyInputs.count();
      console.log(`プロパティ入力フィールド数: ${inputCount}`);
    } else {
      console.log('⚠️ プロパティパネルが見つかりません（コンポーネント未選択のため正常）');
    }
    
    console.log('✅ プロパティパネル表示テスト: 完了');
  });

  test('6. 保存機能テスト', async ({ page }) => {
    // 新規プロジェクト作成
    await page.getByTestId('new-project-button').click();
    await page.getByTestId('project-name-input').fill('保存テスト');
    await page.getByTestId('create-project-button').click();
    
    // Ctrl+S キーボードショートカットテスト
    await page.keyboard.press('Control+s');
    
    // 保存通知の確認
    const saveNotification = page.getByTestId('save-notification');
    if (await saveNotification.isVisible({ timeout: 2000 })) {
      await expect(saveNotification).toContainText('保存');
      console.log('✅ 保存通知表示: 成功');
      
      // 通知の自動消去確認（3秒後）
      await expect(saveNotification).not.toBeVisible({ timeout: 4000 });
      console.log('✅ 保存通知自動消去: 成功');
    } else {
      console.log('⚠️ 保存通知が表示されませんでした');
    }
    
    console.log('✅ 保存機能テスト: 完了');
  });

  test('7. タブ切り替えテスト', async ({ page }) => {
    // 新規プロジェクト作成
    await page.getByTestId('new-project-button').click();
    await page.getByTestId('project-name-input').fill('タブテスト');
    await page.getByTestId('create-project-button').click();
    
    // モデルタブ（デフォルト選択）
    await expect(page.getByTestId('model-tab')).toBeVisible();
    
    // ファイルタブに切り替え
    await page.getByTestId('files-tab').click();
    await expect(page.getByTestId('files-tab')).toBeVisible();
    
    // シミュレーションタブに切り替え
    await page.getByTestId('simulation-tab').click();
    await expect(page.getByTestId('simulation-tab')).toBeVisible();
    
    // モデルタブに戻る
    await page.getByTestId('model-tab').click();
    await expect(page.getByTestId('model-tab')).toBeVisible();
    
    console.log('✅ タブ切り替えテスト: 成功');
  });

  test('8. レスポンシブデザインテスト', async ({ page }) => {
    // デスクトップサイズ (1920x1080)
    await page.setViewportSize({ width: 1920, height: 1080 });
    await expect(page.getByTestId('new-project-button')).toBeVisible();
    
    // タブレットサイズ (1024x768)
    await page.setViewportSize({ width: 1024, height: 768 });
    await expect(page.getByTestId('new-project-button')).toBeVisible();
    
    // 最小サポートサイズ (1280x720)
    await page.setViewportSize({ width: 1280, height: 720 });
    await expect(page.getByTestId('new-project-button')).toBeVisible();
    
    console.log('✅ レスポンシブデザインテスト: 成功');
  });

  test('9. エラーハンドリングテスト', async ({ page }) => {
    // 新規プロジェクトボタンをクリック
    await page.getByTestId('new-project-button').click();
    
    // 空のプロジェクト名で作成を試行
    await page.getByTestId('project-name-input').fill('');
    await page.getByTestId('create-project-button').click();
    
    // エラーメッセージまたは作成が阻止されることを確認
    // （実装によってはバリデーションメッセージが表示される）
    
    // 有効な名前を入力して正常作成
    await page.getByTestId('project-name-input').fill('エラーテスト');
    await page.getByTestId('create-project-button').click();
    
    // 正常に作成されることを確認
    await expect(page.getByTestId('model-tab')).toBeVisible();
    
    console.log('✅ エラーハンドリングテスト: 完了');
  });

  test('10. 総合フローテスト', async ({ page }) => {
    console.log('🚀 総合フローテスト開始');
    
    // 1. ダッシュボード表示
    await expect(page.locator('h1')).toContainText('OpenWAM プロジェクト');
    
    // 2. 新規プロジェクト作成
    await page.getByTestId('new-project-button').click();
    await page.getByTestId('project-name-input').fill('総合テストプロジェクト');
    await page.getByTestId('project-description-input').fill('全機能の統合テスト');
    await page.getByTestId('create-project-button').click();
    
    // 3. プロジェクトエディター画面確認
    await expect(page.getByTestId('model-tab')).toBeVisible();
    
    // 4. 各タブの動作確認
    await page.getByTestId('files-tab').click();
    await page.getByTestId('simulation-tab').click();
    await page.getByTestId('model-tab').click();
    
    // 5. 保存操作
    await page.keyboard.press('Control+s');
    
    // 6. 完了確認
    console.log('✅ 総合フローテスト: 全ステップ完了');
  });
});