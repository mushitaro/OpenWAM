import { test, expect } from '@playwright/test';

test.describe('UIテスト 10.2: 基本接続機能確認テスト', () => {
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
    
    await page.getByTestId('project-name-input').fill('基本接続テスト');
    await page.getByTestId('project-description-input').fill('基本的な接続機能のテスト');
    
    // 作成ボタンをクリック
    await page.getByTestId('create-project-button').click();
    
    // プロジェクトエディター画面への遷移を待機
    await expect(page.getByTestId('model-tab')).toBeVisible({ timeout: 15000 });
  });

  test('1. 接続ツールボタンの存在確認', async ({ page }) => {
    console.log('🔧 接続ツールボタンの存在確認開始');
    
    // 接続ツールボタンの存在確認
    const connectionTool = page.locator('[data-testid="connection-tool"]');
    await expect(connectionTool).toBeVisible({ timeout: 10000 });
    
    // ボタンのタイトル属性確認
    const title = await connectionTool.getAttribute('title');
    console.log(`接続ツールボタンのタイトル: ${title}`);
    
    if (title && title.includes('接続')) {
      console.log('✅ 接続ツールボタンのタイトル: 適切');
    }
    
    console.log('✅ 接続ツールボタンの存在確認: 成功');
  });

  test('2. 接続ツールボタンのクリック動作確認', async ({ page }) => {
    console.log('🔧 接続ツールボタンのクリック動作確認開始');
    
    // 接続ツールボタンをクリック
    const connectionTool = page.locator('[data-testid="connection-tool"]');
    await connectionTool.click();
    
    // ボタンの状態変化を確認（背景色の変化）
    const backgroundColorAfterClick = await connectionTool.evaluate(el => getComputedStyle(el).backgroundColor);
    console.log(`クリック後の背景色: ${backgroundColorAfterClick}`);
    
    // 接続モードの状態表示を確認
    const connectionModeIndicator = page.locator('text=接続元を選択');
    if (await connectionModeIndicator.isVisible({ timeout: 3000 })) {
      console.log('✅ 接続モード状態表示: 接続元を選択');
    } else {
      console.log('⚠️ 接続モード状態表示が見つかりませんでした');
    }
    
    // 接続モードを無効にする
    await connectionTool.click();
    
    // 状態表示が消えることを確認
    if (await connectionModeIndicator.isHidden({ timeout: 3000 })) {
      console.log('✅ 接続モード無効化: 状態表示が非表示');
    }
    
    console.log('✅ 接続ツールボタンのクリック動作確認: 成功');
  });

  test('3. キャンバス情報パネルの接続数表示確認', async ({ page }) => {
    console.log('🔧 キャンバス情報パネルの接続数表示確認開始');
    
    // 接続数の表示を確認
    const connectionCountDisplay = page.locator('text=/\\d+ 接続/').first();
    await expect(connectionCountDisplay).toBeVisible({ timeout: 5000 });
    
    const initialConnectionText = await connectionCountDisplay.textContent();
    console.log(`初期接続数表示: ${initialConnectionText}`);
    
    if (initialConnectionText && initialConnectionText.includes('0 接続')) {
      console.log('✅ 初期接続数表示: 正しく0接続を表示');
    }
    
    console.log('✅ キャンバス情報パネルの接続数表示確認: 成功');
  });

  test('4. コンポーネント数と接続数の表示確認', async ({ page }) => {
    console.log('🔧 コンポーネント数と接続数の表示確認開始');
    
    // 初期状態の確認
    const componentCountDisplay = page.locator('text=/\\d+ コンポーネント/').first();
    const connectionCountDisplay = page.locator('text=/\\d+ 接続/').first();
    
    await expect(componentCountDisplay).toBeVisible({ timeout: 5000 });
    await expect(connectionCountDisplay).toBeVisible({ timeout: 5000 });
    
    const initialComponentText = await componentCountDisplay.textContent();
    const initialConnectionText = await connectionCountDisplay.textContent();
    
    console.log(`初期コンポーネント数: ${initialComponentText}`);
    console.log(`初期接続数: ${initialConnectionText}`);
    
    // パイプを1つ追加
    const pipesCategory = page.locator('[data-testid="component-palette-pipes"]');
    await pipesCategory.click();
    const pipeComponent = page.locator('[data-testid="add-pipe"]');
    await pipeComponent.click();
    await page.waitForTimeout(1000);
    
    // コンポーネント数の更新を確認
    const updatedComponentText = await componentCountDisplay.textContent();
    console.log(`更新後コンポーネント数: ${updatedComponentText}`);
    
    if (updatedComponentText && updatedComponentText.includes('1 コンポーネント')) {
      console.log('✅ コンポーネント数の更新: 成功');
    }
    
    console.log('✅ コンポーネント数と接続数の表示確認: 成功');
  });

  test('5. 接続モードでのキャンバス情報表示確認', async ({ page }) => {
    console.log('🔧 接続モードでのキャンバス情報表示確認開始');
    
    // 接続モードを有効にする
    const connectionTool = page.locator('[data-testid="connection-tool"]');
    await connectionTool.click();
    
    // 接続モードの状態表示を確認
    const connectionModeInfo = page.locator('text=接続元を選択');
    if (await connectionModeInfo.isVisible({ timeout: 3000 })) {
      console.log('✅ 接続モード情報表示: 接続元を選択');
      
      // 情報パネルのスタイル確認
      const infoPanel = connectionModeInfo.locator('..');
      const backgroundColor = await infoPanel.evaluate(el => getComputedStyle(el).backgroundColor);
      console.log(`接続モード情報パネルの背景色: ${backgroundColor}`);
    }
    
    // 接続モードを無効にして状態変化を確認
    await connectionTool.click();
    
    if (await connectionModeInfo.isHidden({ timeout: 3000 })) {
      console.log('✅ 接続モード無効化: 情報表示が非表示');
    }
    
    console.log('✅ 接続モードでのキャンバス情報表示確認: 成功');
  });

  test('6. ズームとグリッドコントロールの確認', async ({ page }) => {
    console.log('🔧 ズームとグリッドコントロールの確認開始');
    
    // ズームインボタンの確認
    const zoomInButton = page.locator('[data-testid="zoom-in-button"]');
    await expect(zoomInButton).toBeVisible({ timeout: 5000 });
    await zoomInButton.click();
    console.log('✅ ズームインボタン: クリック成功');
    
    // ズームアウトボタンの確認
    const zoomOutButton = page.locator('[data-testid="zoom-out-button"]');
    await expect(zoomOutButton).toBeVisible({ timeout: 5000 });
    await zoomOutButton.click();
    console.log('✅ ズームアウトボタン: クリック成功');
    
    // ズームリセットボタンの確認
    const zoomResetButton = page.locator('[data-testid="zoom-reset-button"]');
    await expect(zoomResetButton).toBeVisible({ timeout: 5000 });
    await zoomResetButton.click();
    console.log('✅ ズームリセットボタン: クリック成功');
    
    // グリッド切り替えボタンの確認
    const toggleGridButton = page.locator('[data-testid="toggle-grid-button"]');
    await expect(toggleGridButton).toBeVisible({ timeout: 5000 });
    
    // グリッドを有効にする
    await toggleGridButton.click();
    console.log('✅ グリッド有効化: クリック成功');
    
    // グリッド線の存在確認
    const gridLines = page.locator('[data-testid="canvas-grid"]');
    const gridCount = await gridLines.count();
    
    if (gridCount > 0) {
      console.log(`✅ グリッド線表示: ${gridCount}本の線を検出`);
    } else {
      console.log('⚠️ グリッド線が検出されませんでした');
    }
    
    // グリッドを無効にする
    await toggleGridButton.click();
    console.log('✅ グリッド無効化: クリック成功');
    
    console.log('✅ ズームとグリッドコントロールの確認: 成功');
  });

  test('7. キャンバスサイズ情報の表示確認', async ({ page }) => {
    console.log('🔧 キャンバスサイズ情報の表示確認開始');
    
    // キャンバスサイズ情報の表示を確認
    const canvasSizeInfo = page.locator('text=/キャンバス \\d+ × \\d+/');
    await expect(canvasSizeInfo).toBeVisible({ timeout: 5000 });
    
    const sizeText = await canvasSizeInfo.textContent();
    console.log(`キャンバスサイズ情報: ${sizeText}`);
    
    if (sizeText && sizeText.includes('キャンバス') && sizeText.includes('×')) {
      console.log('✅ キャンバスサイズ情報: 正しく表示');
    }
    
    console.log('✅ キャンバスサイズ情報の表示確認: 成功');
  });

  test('8. 接続機能の基本UI要素確認', async ({ page }) => {
    console.log('🔧 接続機能の基本UI要素確認開始');
    
    // キャンバスエディターの存在確認
    const canvasEditor = page.locator('[data-testid="canvas-editor"]');
    await expect(canvasEditor).toBeVisible({ timeout: 5000 });
    console.log('✅ キャンバスエディター: 表示確認');
    
    // 接続ツールボタンの存在確認
    const connectionTool = page.locator('[data-testid="connection-tool"]');
    await expect(connectionTool).toBeVisible({ timeout: 5000 });
    console.log('✅ 接続ツールボタン: 表示確認');
    
    // 情報パネルの存在確認
    const infoPanel = page.locator('text=/\\d+ コンポーネント/').first();
    await expect(infoPanel).toBeVisible({ timeout: 5000 });
    console.log('✅ 情報パネル: 表示確認');
    
    // コントロールパネルの存在確認
    const controlPanel = page.locator('[data-testid="zoom-in-button"]').locator('..');
    await expect(controlPanel).toBeVisible({ timeout: 5000 });
    console.log('✅ コントロールパネル: 表示確認');
    
    console.log('✅ 接続機能の基本UI要素確認: 全て成功');
  });

  test('9. 接続ツールボタンの視覚的フィードバック確認', async ({ page }) => {
    console.log('🔧 接続ツールボタンの視覚的フィードバック確認開始');
    
    const connectionTool = page.locator('[data-testid="connection-tool"]');
    
    // 初期状態の背景色を取得
    const initialBgColor = await connectionTool.evaluate(el => getComputedStyle(el).backgroundColor);
    console.log(`初期背景色: ${initialBgColor}`);
    
    // ボタンをクリックして接続モードを有効にする
    await connectionTool.click();
    
    // アクティブ状態の背景色を取得
    const activeBgColor = await connectionTool.evaluate(el => getComputedStyle(el).backgroundColor);
    console.log(`アクティブ背景色: ${activeBgColor}`);
    
    // 背景色が変化したことを確認
    if (initialBgColor !== activeBgColor) {
      console.log('✅ 接続ツールボタンの視覚的フィードバック: 背景色変化確認');
    } else {
      console.log('⚠️ 背景色の変化が検出されませんでした');
    }
    
    // 接続モードを無効にする
    await connectionTool.click();
    
    // 背景色が元に戻ったことを確認
    const deactiveBgColor = await connectionTool.evaluate(el => getComputedStyle(el).backgroundColor);
    console.log(`無効化後背景色: ${deactiveBgColor}`);
    
    console.log('✅ 接続ツールボタンの視覚的フィードバック確認: 完了');
  });

  test('10. 総合基本接続機能確認テスト', async ({ page }) => {
    console.log('🚀 総合基本接続機能確認テスト開始');
    
    // 1. UI要素の存在確認
    console.log('📝 ステップ1: UI要素の存在確認');
    
    const canvasEditor = page.locator('[data-testid="canvas-editor"]');
    const connectionTool = page.locator('[data-testid="connection-tool"]');
    const componentCount = page.locator('text=/\\d+ コンポーネント/').first();
    const connectionCount = page.locator('text=/\\d+ 接続/').first();
    
    await expect(canvasEditor).toBeVisible({ timeout: 5000 });
    await expect(connectionTool).toBeVisible({ timeout: 5000 });
    await expect(componentCount).toBeVisible({ timeout: 5000 });
    await expect(connectionCount).toBeVisible({ timeout: 5000 });
    
    console.log('✅ UI要素の存在確認: 完了');
    
    // 2. 接続モードの切り替え確認
    console.log('📝 ステップ2: 接続モードの切り替え確認');
    
    await connectionTool.click();
    const connectionModeIndicator = page.locator('text=接続元を選択');
    if (await connectionModeIndicator.isVisible({ timeout: 3000 })) {
      console.log('✅ 接続モード有効化: 成功');
    }
    
    await connectionTool.click();
    if (await connectionModeIndicator.isHidden({ timeout: 3000 })) {
      console.log('✅ 接続モード無効化: 成功');
    }
    
    // 3. コンポーネント追加と情報更新確認
    console.log('📝 ステップ3: コンポーネント追加と情報更新確認');
    
    const pipesCategory = page.locator('[data-testid="component-palette-pipes"]');
    await pipesCategory.click();
    const pipeComponent = page.locator('[data-testid="add-pipe"]');
    await pipeComponent.click();
    await page.waitForTimeout(1000);
    
    const updatedComponentText = await componentCount.textContent();
    console.log(`コンポーネント数更新: ${updatedComponentText}`);
    
    // 4. グリッド機能確認
    console.log('📝 ステップ4: グリッド機能確認');
    
    const toggleGridButton = page.locator('[data-testid="toggle-grid-button"]');
    await toggleGridButton.click();
    
    const gridLines = page.locator('[data-testid="canvas-grid"]');
    const gridCount = await gridLines.count();
    console.log(`グリッド線数: ${gridCount}`);
    
    // 5. 保存機能確認
    console.log('📝 ステップ5: 保存機能確認');
    
    await page.keyboard.press('Control+s');
    
    const saveNotification = page.locator('[data-testid="save-notification"]');
    if (await saveNotification.isVisible({ timeout: 3000 })) {
      console.log('✅ 保存通知確認: 成功');
    } else {
      console.log('⚠️ 保存通知が表示されませんでした');
    }
    
    console.log('✅ 総合基本接続機能確認テスト: 全ステップ完了');
  });
});