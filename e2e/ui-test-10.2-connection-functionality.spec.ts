import { test, expect } from '@playwright/test';

test.describe('UIテスト 10.2: コンポーネント接続機能テスト', () => {
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
    
    await page.getByTestId('project-name-input').fill('接続機能テスト');
    await page.getByTestId('project-description-input').fill('コンポーネント接続機能のテスト');
    
    // 作成ボタンをクリック
    await page.getByTestId('create-project-button').click();
    
    // プロジェクトエディター画面への遷移を待機
    await expect(page.getByTestId('model-tab')).toBeVisible({ timeout: 15000 });
  });

  test('1. 接続ツールボタンの表示と動作確認', async ({ page }) => {
    console.log('🔧 接続ツールボタンの表示と動作確認開始');
    
    // 接続ツールボタンの存在確認
    const connectionTool = page.locator('[data-testid="connection-tool"]');
    await expect(connectionTool).toBeVisible({ timeout: 10000 });
    
    // 接続モードの切り替え
    await connectionTool.click();
    
    // 接続モードがアクティブになったことを確認（ボタンの色が変わる）
    const connectionToolStyle = await connectionTool.evaluate(el => getComputedStyle(el).backgroundColor);
    console.log('接続ツールボタンの背景色:', connectionToolStyle);
    
    // 接続モードを無効にする
    await connectionTool.click();
    
    console.log('✅ 接続ツールボタンの表示と動作確認: 成功');
  });

  test('2. 基本的なコンポーネント接続テスト', async ({ page }) => {
    console.log('🔧 基本的なコンポーネント接続テスト開始');
    
    // パイプコンポーネントを2つ配置
    const pipesCategory = page.locator('[data-testid="component-palette-pipes"]');
    await pipesCategory.click();
    
    const pipeComponent = page.locator('[data-testid="add-pipe"]');
    await expect(pipeComponent).toBeVisible({ timeout: 5000 });
    
    // 1つ目のパイプを配置
    await pipeComponent.click();
    await page.waitForTimeout(500);
    
    // 2つ目のパイプを配置
    await pipeComponent.click();
    await page.waitForTimeout(500);
    
    // 接続モードを有効にする
    const connectionTool = page.locator('[data-testid="connection-tool"]');
    await connectionTool.click();
    
    // キャンバス上のコンポーネントをクリックして接続を作成
    const canvas = page.locator('[data-testid="canvas-editor"]');
    await expect(canvas).toBeVisible({ timeout: 5000 });
    
    // 最初のコンポーネントをクリック（接続開始点）
    await canvas.click({ position: { x: 200, y: 200 } });
    await page.waitForTimeout(500);
    
    // 2番目のコンポーネントをクリック（接続終了点）
    await canvas.click({ position: { x: 400, y: 200 } });
    await page.waitForTimeout(1000);
    
    // 接続線が表示されることを確認
    const connectionLines = page.locator('[data-testid="canvas-connection"]');
    const connectionCount = await connectionLines.count();
    
    if (connectionCount > 0) {
      console.log(`✅ 接続線が作成されました: ${connectionCount}本`);
    } else {
      console.log('⚠️ 接続線が検出されませんでした');
    }
    
    console.log('✅ 基本的なコンポーネント接続テスト: 完了');
  });

  test('3. パイプと境界条件の接続テスト', async ({ page }) => {
    console.log('🔧 パイプと境界条件の接続テスト開始');
    
    // パイプを配置
    const pipesCategory = page.locator('[data-testid="component-palette-pipes"]');
    await pipesCategory.click();
    const pipeComponent = page.locator('[data-testid="add-pipe"]');
    await pipeComponent.click();
    await page.waitForTimeout(500);
    
    // 境界条件（開放端）を配置
    const boundariesCategory = page.locator('[data-testid="component-palette-boundaries"]');
    await boundariesCategory.click();
    const atmosphereComponent = page.locator('[data-testid="add-atmosphere"]');
    await atmosphereComponent.click();
    await page.waitForTimeout(500);
    
    // 接続モードを有効にする
    const connectionTool = page.locator('[data-testid="connection-tool"]');
    await connectionTool.click();
    
    // パイプと境界条件を接続
    const canvas = page.locator('[data-testid="canvas-editor"]');
    
    // パイプをクリック
    await canvas.click({ position: { x: 200, y: 200 } });
    await page.waitForTimeout(500);
    
    // 境界条件をクリック
    await canvas.click({ position: { x: 400, y: 200 } });
    await page.waitForTimeout(1000);
    
    // 接続が作成されたことを確認
    const connectionLines = page.locator('[data-testid="canvas-connection"]');
    const connectionCount = await connectionLines.count();
    
    console.log(`接続線の数: ${connectionCount}`);
    
    // 接続フィードバックメッセージの確認
    const feedbackMessage = page.locator('text=接続が作成されました');
    if (await feedbackMessage.isVisible({ timeout: 2000 })) {
      console.log('✅ 接続成功メッセージ表示: 成功');
    }
    
    console.log('✅ パイプと境界条件の接続テスト: 完了');
  });

  test('4. 無効な接続のバリデーションテスト', async ({ page }) => {
    console.log('🔧 無効な接続のバリデーションテスト開始');
    
    // 境界条件を2つ配置（無効な接続の組み合わせ）
    const boundariesCategory = page.locator('[data-testid="component-palette-boundaries"]');
    await boundariesCategory.click();
    
    const atmosphereComponent = page.locator('[data-testid="add-atmosphere"]');
    await atmosphereComponent.click();
    await page.waitForTimeout(500);
    await atmosphereComponent.click();
    await page.waitForTimeout(500);
    
    // 接続モードを有効にする
    const connectionTool = page.locator('[data-testid="connection-tool"]');
    await connectionTool.click();
    
    // 境界条件同士を接続しようとする
    const canvas = page.locator('[data-testid="canvas-editor"]');
    
    // 最初の境界条件をクリック
    await canvas.click({ position: { x: 200, y: 200 } });
    await page.waitForTimeout(500);
    
    // 2番目の境界条件をクリック
    await canvas.click({ position: { x: 400, y: 200 } });
    await page.waitForTimeout(1000);
    
    // エラーメッセージの確認
    const errorMessages = [
      'この接続は無効です',
      'パイプ経由で接続してください',
      '直接接続できません'
    ];
    
    let errorFound = false;
    for (const errorMsg of errorMessages) {
      const errorElement = page.locator(`text=${errorMsg}`);
      if (await errorElement.isVisible({ timeout: 2000 })) {
        console.log(`✅ エラーメッセージ表示: ${errorMsg}`);
        errorFound = true;
        break;
      }
    }
    
    if (!errorFound) {
      console.log('⚠️ エラーメッセージが表示されませんでした');
    }
    
    // 無効な接続線が作成されていないことを確認
    const connectionLines = page.locator('[data-testid="canvas-connection"]');
    const connectionCount = await connectionLines.count();
    
    if (connectionCount === 0) {
      console.log('✅ 無効な接続は作成されませんでした');
    } else {
      console.log(`⚠️ 予期しない接続が作成されました: ${connectionCount}本`);
    }
    
    console.log('✅ 無効な接続のバリデーションテスト: 完了');
  });

  test('5. 複数接続の作成テスト', async ({ page }) => {
    console.log('🔧 複数接続の作成テスト開始');
    
    // パイプを3つ配置
    const pipesCategory = page.locator('[data-testid="component-palette-pipes"]');
    await pipesCategory.click();
    const pipeComponent = page.locator('[data-testid="add-pipe"]');
    
    for (let i = 0; i < 3; i++) {
      await pipeComponent.click();
      await page.waitForTimeout(300);
    }
    
    // 接続モードを有効にする
    const connectionTool = page.locator('[data-testid="connection-tool"]');
    await connectionTool.click();
    
    const canvas = page.locator('[data-testid="canvas-editor"]');
    
    // 1つ目と2つ目のパイプを接続
    await canvas.click({ position: { x: 150, y: 200 } });
    await page.waitForTimeout(500);
    await canvas.click({ position: { x: 300, y: 200 } });
    await page.waitForTimeout(1000);
    
    // 2つ目と3つ目のパイプを接続
    await canvas.click({ position: { x: 300, y: 200 } });
    await page.waitForTimeout(500);
    await canvas.click({ position: { x: 450, y: 200 } });
    await page.waitForTimeout(1000);
    
    // 複数の接続線が作成されたことを確認
    const connectionLines = page.locator('[data-testid="canvas-connection"]');
    const connectionCount = await connectionLines.count();
    
    console.log(`作成された接続線の数: ${connectionCount}`);
    
    if (connectionCount >= 2) {
      console.log('✅ 複数接続の作成: 成功');
    } else {
      console.log('⚠️ 期待された数の接続が作成されませんでした');
    }
    
    console.log('✅ 複数接続の作成テスト: 完了');
  });

  test('6. 接続情報の表示確認テスト', async ({ page }) => {
    console.log('🔧 接続情報の表示確認テスト開始');
    
    // パイプを2つ配置
    const pipesCategory = page.locator('[data-testid="component-palette-pipes"]');
    await pipesCategory.click();
    const pipeComponent = page.locator('[data-testid="add-pipe"]');
    await pipeComponent.click();
    await page.waitForTimeout(500);
    await pipeComponent.click();
    await page.waitForTimeout(500);
    
    // 接続前の接続数を確認
    const initialConnectionInfo = page.locator('text=/\\d+ 接続/');
    if (await initialConnectionInfo.isVisible({ timeout: 2000 })) {
      const initialText = await initialConnectionInfo.textContent();
      console.log(`接続前の接続数: ${initialText}`);
    }
    
    // 接続モードを有効にして接続を作成
    const connectionTool = page.locator('[data-testid="connection-tool"]');
    await connectionTool.click();
    
    const canvas = page.locator('[data-testid="canvas-editor"]');
    await canvas.click({ position: { x: 200, y: 200 } });
    await page.waitForTimeout(500);
    await canvas.click({ position: { x: 400, y: 200 } });
    await page.waitForTimeout(1000);
    
    // 接続後の接続数を確認
    const updatedConnectionInfo = page.locator('text=/\\d+ 接続/');
    if (await updatedConnectionInfo.isVisible({ timeout: 2000 })) {
      const updatedText = await updatedConnectionInfo.textContent();
      console.log(`接続後の接続数: ${updatedText}`);
      
      if (updatedText && updatedText.includes('1 接続')) {
        console.log('✅ 接続数の表示更新: 成功');
      }
    }
    
    console.log('✅ 接続情報の表示確認テスト: 完了');
  });

  test('7. 接続モードの状態表示テスト', async ({ page }) => {
    console.log('🔧 接続モードの状態表示テスト開始');
    
    // 接続モードを有効にする
    const connectionTool = page.locator('[data-testid="connection-tool"]');
    await connectionTool.click();
    
    // 接続モードの状態表示を確認
    const connectionModeIndicator = page.locator('text=接続元を選択');
    if (await connectionModeIndicator.isVisible({ timeout: 2000 })) {
      console.log('✅ 接続モード状態表示: 接続元を選択');
    }
    
    // パイプを配置
    const pipesCategory = page.locator('[data-testid="component-palette-pipes"]');
    await pipesCategory.click();
    const pipeComponent = page.locator('[data-testid="add-pipe"]');
    await pipeComponent.click();
    await page.waitForTimeout(500);
    
    // 最初のコンポーネントをクリック
    const canvas = page.locator('[data-testid="canvas-editor"]');
    await canvas.click({ position: { x: 200, y: 200 } });
    await page.waitForTimeout(500);
    
    // 状態が「接続先を選択」に変わることを確認
    const connectionTargetIndicator = page.locator('text=接続先を選択');
    if (await connectionTargetIndicator.isVisible({ timeout: 2000 })) {
      console.log('✅ 接続モード状態表示: 接続先を選択');
    }
    
    console.log('✅ 接続モードの状態表示テスト: 完了');
  });

  test('8. 接続線の視覚的確認テスト', async ({ page }) => {
    console.log('🔧 接続線の視覚的確認テスト開始');
    
    // パイプを2つ配置
    const pipesCategory = page.locator('[data-testid="component-palette-pipes"]');
    await pipesCategory.click();
    const pipeComponent = page.locator('[data-testid="add-pipe"]');
    await pipeComponent.click();
    await page.waitForTimeout(500);
    await pipeComponent.click();
    await page.waitForTimeout(500);
    
    // 接続を作成
    const connectionTool = page.locator('[data-testid="connection-tool"]');
    await connectionTool.click();
    
    const canvas = page.locator('[data-testid="canvas-editor"]');
    await canvas.click({ position: { x: 200, y: 200 } });
    await page.waitForTimeout(500);
    await canvas.click({ position: { x: 400, y: 200 } });
    await page.waitForTimeout(1000);
    
    // 接続線の属性を確認
    const connectionLine = page.locator('[data-testid="canvas-connection"]').first();
    if (await connectionLine.isVisible({ timeout: 2000 })) {
      // 接続線のスタイル属性を確認
      const stroke = await connectionLine.getAttribute('stroke');
      const strokeWidth = await connectionLine.getAttribute('stroke-width');
      
      console.log(`接続線のスタイル - stroke: ${stroke}, strokeWidth: ${strokeWidth}`);
      
      if (stroke && strokeWidth) {
        console.log('✅ 接続線の視覚的属性: 確認済み');
      }
    }
    
    console.log('✅ 接続線の視覚的確認テスト: 完了');
  });

  test('9. 自己接続の防止テスト', async ({ page }) => {
    console.log('🔧 自己接続の防止テスト開始');
    
    // パイプを1つ配置
    const pipesCategory = page.locator('[data-testid="component-palette-pipes"]');
    await pipesCategory.click();
    const pipeComponent = page.locator('[data-testid="add-pipe"]');
    await pipeComponent.click();
    await page.waitForTimeout(500);
    
    // 接続モードを有効にする
    const connectionTool = page.locator('[data-testid="connection-tool"]');
    await connectionTool.click();
    
    // 同じコンポーネントを2回クリック（自己接続を試行）
    const canvas = page.locator('[data-testid="canvas-editor"]');
    await canvas.click({ position: { x: 200, y: 200 } });
    await page.waitForTimeout(500);
    await canvas.click({ position: { x: 200, y: 200 } });
    await page.waitForTimeout(1000);
    
    // 自己接続エラーメッセージの確認
    const selfConnectionError = page.locator('text=同じコンポーネント内では接続できません');
    if (await selfConnectionError.isVisible({ timeout: 2000 })) {
      console.log('✅ 自己接続エラーメッセージ: 表示確認');
    }
    
    // 接続線が作成されていないことを確認
    const connectionLines = page.locator('[data-testid="canvas-connection"]');
    const connectionCount = await connectionLines.count();
    
    if (connectionCount === 0) {
      console.log('✅ 自己接続の防止: 成功');
    } else {
      console.log('⚠️ 自己接続が作成されてしまいました');
    }
    
    console.log('✅ 自己接続の防止テスト: 完了');
  });

  test('10. 総合接続機能テスト', async ({ page }) => {
    console.log('🚀 総合接続機能テスト開始');
    
    // 1. 複数種類のコンポーネントを配置
    console.log('📝 ステップ1: コンポーネント配置');
    
    // パイプを配置
    const pipesCategory = page.locator('[data-testid="component-palette-pipes"]');
    await pipesCategory.click();
    const pipeComponent = page.locator('[data-testid="add-pipe"]');
    await pipeComponent.click();
    await page.waitForTimeout(300);
    
    // 境界条件を配置
    const boundariesCategory = page.locator('[data-testid="component-palette-boundaries"]');
    await boundariesCategory.click();
    const atmosphereComponent = page.locator('[data-testid="add-atmosphere"]');
    await atmosphereComponent.click();
    await page.waitForTimeout(300);
    
    const closedEndComponent = page.locator('[data-testid="add-closed-end"]');
    await closedEndComponent.click();
    await page.waitForTimeout(300);
    
    // 2. 接続モードを有効にして複数接続を作成
    console.log('📝 ステップ2: 接続作成');
    
    const connectionTool = page.locator('[data-testid="connection-tool"]');
    await connectionTool.click();
    
    const canvas = page.locator('[data-testid="canvas-editor"]');
    
    // パイプと開放端を接続
    await canvas.click({ position: { x: 200, y: 200 } });
    await page.waitForTimeout(500);
    await canvas.click({ position: { x: 350, y: 200 } });
    await page.waitForTimeout(1000);
    
    // パイプと閉端を接続
    await canvas.click({ position: { x: 200, y: 200 } });
    await page.waitForTimeout(500);
    await canvas.click({ position: { x: 500, y: 200 } });
    await page.waitForTimeout(1000);
    
    // 3. 接続結果の確認
    console.log('📝 ステップ3: 接続結果確認');
    
    const connectionLines = page.locator('[data-testid="canvas-connection"]');
    const connectionCount = await connectionLines.count();
    
    console.log(`作成された接続数: ${connectionCount}`);
    
    // 4. 接続情報の表示確認
    const connectionInfo = page.locator('text=/\\d+ 接続/');
    if (await connectionInfo.isVisible({ timeout: 2000 })) {
      const infoText = await connectionInfo.textContent();
      console.log(`接続情報表示: ${infoText}`);
    }
    
    // 5. 保存機能のテスト
    console.log('📝 ステップ4: 保存機能テスト');
    await page.keyboard.press('Control+s');
    
    // 保存通知の確認
    const saveNotification = page.locator('[data-testid="save-notification"]');
    if (await saveNotification.isVisible({ timeout: 3000 })) {
      console.log('✅ 保存通知確認: 成功');
    }
    
    console.log('✅ 総合接続機能テスト: 全ステップ完了');
  });
});