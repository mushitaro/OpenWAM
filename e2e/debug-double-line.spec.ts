import { test, expect } from '@playwright/test';

test('二本線問題デバッグ', async ({ page }) => {
  // コンソールログを監視
  const consoleMessages: string[] = [];
  page.on('console', msg => {
    const message = `${msg.type()}: ${msg.text()}`;
    consoleMessages.push(message);
    console.log('ブラウザコンソール:', message);
  });

  await page.goto('http://localhost:5174');
  
  // 新規プロジェクト作成
  const newProjectButton = page.getByTestId('new-project-button');
  await expect(newProjectButton).toBeVisible({ timeout: 10000 });
  await newProjectButton.click();
  await page.getByTestId('project-name-input').fill('二本線デバッグ');
  await page.getByTestId('create-project-button').click();
  
  // プロジェクトエディター画面への遷移を待機
  await expect(page.getByTestId('model-tab')).toBeVisible({ timeout: 10000 });
  
  // パイプを2つ配置
  console.log('=== パイプ配置開始 ===');
  const pipesCategory = page.getByTestId('component-palette-pipes');
  await pipesCategory.click();
  
  const pipeComponent = page.getByTestId('add-pipe');
  await pipeComponent.click();
  console.log('1つ目のパイプ配置');
  await page.waitForTimeout(1000);
  
  await pipeComponent.click();
  console.log('2つ目のパイプ配置');
  await page.waitForTimeout(1000);
  
  // 接続モードを有効化
  console.log('=== 接続モード有効化 ===');
  const connectionTool = page.getByTestId('connection-tool');
  await connectionTool.click();
  console.log('接続ツールクリック完了');
  
  // 接続モードの状態確認
  await page.waitForTimeout(1000);
  const connectionModeIndicator = page.locator('text=接続元を選択');
  const isModeActive = await connectionModeIndicator.isVisible();
  console.log('接続モード状態:', isModeActive);
  
  // キャンバス上でコンポーネントをクリックして接続を作成
  console.log('=== 接続作成試行 ===');
  const canvas = page.getByTestId('canvas-editor');
  
  // より広い範囲でコンポーネントを探す
  const positions = [
    { x: 200, y: 200 }, // 予測位置
    { x: 220, y: 220 }, // 前回成功した位置
    { x: 180, y: 180 },
    { x: 200, y: 180 },
    { x: 200, y: 220 },
    { x: 180, y: 200 },
    { x: 220, y: 200 },
    { x: 250, y: 200 },
    { x: 150, y: 200 }
  ];
  
  let firstClickSuccess = false;
  for (const pos of positions) {
    console.log(`位置 (${pos.x}, ${pos.y}) をクリック試行`);
    await canvas.click({ position: pos });
    await page.waitForTimeout(500);
    
    // 接続先選択モードになったかチェック
    const connectionTargetIndicator = page.locator('text=接続先を選択');
    const isTargetMode = await connectionTargetIndicator.isVisible({ timeout: 1000 });
    console.log(`位置 (${pos.x}, ${pos.y}) - 接続先選択モード:`, isTargetMode);
    
    if (isTargetMode) {
      firstClickSuccess = true;
      console.log('最初のコンポーネントクリック成功');
      break;
    }
  }
  
  if (firstClickSuccess) {
    // 2番目のコンポーネントを探す
    const secondPositions = [
      { x: 350, y: 200 }, // 予測位置
      { x: 370, y: 220 }, // 前回成功した位置
      { x: 330, y: 180 },
      { x: 370, y: 200 },
      { x: 350, y: 180 },
      { x: 350, y: 220 },
      { x: 330, y: 200 },
      { x: 400, y: 200 },
      { x: 300, y: 200 }
    ];
    
    let secondClickSuccess = false;
    for (const pos of secondPositions) {
      console.log(`2番目の位置 (${pos.x}, ${pos.y}) をクリック試行`);
      await canvas.click({ position: pos });
      await page.waitForTimeout(1000);
      
      // 接続成功メッセージの確認
      const successMessage = page.locator('text=接続が作成されました');
      const hasSuccessMessage = await successMessage.isVisible({ timeout: 2000 });
      console.log(`位置 (${pos.x}, ${pos.y}) - 接続成功メッセージ:`, hasSuccessMessage);
      
      if (hasSuccessMessage) {
        secondClickSuccess = true;
        console.log('2番目のコンポーネントクリック成功');
        break;
      }
    }
    
    if (secondClickSuccess) {
    
      // 接続線の数を確認
      const connectionLines = page.locator('[data-testid="canvas-connection"]');
      const connectionCount = await connectionLines.count();
      console.log('接続線数:', connectionCount);
      
      // モデルの接続数も確認
      const modelConnectionCount = await page.locator('text=/\\d+ 接続/').first().textContent();
      console.log('モデル接続数:', modelConnectionCount);
      
      // もう一度同じ接続を作成してみる（二本線問題のテスト）
      console.log('=== 重複接続作成試行 ===');
      
      // 最初のコンポーネントを再度クリック
      await canvas.click({ position: { x: 200, y: 200 } }); // 成功した位置を使用
      await page.waitForTimeout(1000);
      
      // 2番目のコンポーネントを再度クリック
      await canvas.click({ position: { x: 350, y: 200 } }); // 成功した位置を使用
      await page.waitForTimeout(2000);
      
      // 接続線の数を再確認
      const finalConnectionCount = await connectionLines.count();
      console.log('最終接続線数:', finalConnectionCount);
      
      if (finalConnectionCount > connectionCount) {
        console.log('⚠️ 二本線問題発生: 重複した接続線が作成されました');
      } else {
        console.log('✅ 二本線問題なし: 重複接続は防止されました');
      }
    } else {
      console.log('2番目のコンポーネントクリックに失敗');
    }
  } else {
    console.log('最初のコンポーネントクリックに失敗');
  }
  
  // 最終的なコンソールログの出力
  console.log('=== 全コンソールメッセージ ===');
  consoleMessages.forEach((msg, index) => {
    console.log(`${index + 1}: ${msg}`);
  });
});