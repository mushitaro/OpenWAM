import { test, expect } from '@playwright/test';

test('二本線問題最終検証', async ({ page }) => {
  await page.goto('http://localhost:5174');
  
  // 新規プロジェクト作成
  const newProjectButton = page.getByTestId('new-project-button');
  await expect(newProjectButton).toBeVisible({ timeout: 10000 });
  await newProjectButton.click();
  await page.getByTestId('project-name-input').fill('二本線最終検証');
  await page.getByTestId('create-project-button').click();
  
  // プロジェクトエディター画面への遷移を待機
  await expect(page.getByTestId('model-tab')).toBeVisible({ timeout: 10000 });
  
  // パイプを2つ配置
  const pipesCategory = page.getByTestId('component-palette-pipes');
  await pipesCategory.click();
  
  const pipeComponent = page.getByTestId('add-pipe');
  await pipeComponent.click();
  await page.waitForTimeout(1000);
  await pipeComponent.click();
  await page.waitForTimeout(1000);
  
  // 初期接続数を確認
  const initialConnectionCount = await page.locator('text=/\\d+ 接続/').first().textContent();
  console.log('初期接続数:', initialConnectionCount);
  
  // 接続モードを有効化
  const connectionTool = page.getByTestId('connection-tool');
  await connectionTool.click();
  
  // 接続モードの状態確認
  const connectionModeIndicator = page.locator('text=接続元を選択');
  await expect(connectionModeIndicator).toBeVisible({ timeout: 3000 });
  
  // キャンバス上でコンポーネントをクリックして接続を作成
  const canvas = page.getByTestId('canvas-editor');
  
  // 1回目の接続作成
  console.log('=== 1回目の接続作成 ===');
  await canvas.click({ position: { x: 220, y: 220 } }); // 成功した位置
  await page.waitForTimeout(1000);
  
  // 接続先選択モードの確認
  const connectionTargetIndicator = page.locator('text=接続先を選択');
  const isTargetMode = await connectionTargetIndicator.isVisible();
  console.log('接続先選択モード:', isTargetMode);
  
  if (isTargetMode) {
    await canvas.click({ position: { x: 370, y: 200 } }); // 成功した位置
    await page.waitForTimeout(2000);
    
    // 1回目の接続後の接続数を確認
    const firstConnectionCount = await page.locator('text=/\\d+ 接続/').first().textContent();
    console.log('1回目接続後の接続数:', firstConnectionCount);
    
    // 接続成功メッセージの確認
    const successMessage = page.locator('text=接続が作成されました');
    const hasSuccessMessage = await successMessage.isVisible({ timeout: 2000 });
    console.log('1回目接続成功メッセージ:', hasSuccessMessage);
    
    if (hasSuccessMessage) {
      // 2回目の接続作成（同じ接続を再度作成）
      console.log('=== 2回目の接続作成（重複テスト） ===');
      await page.waitForTimeout(3000); // フィードバックメッセージが消えるまで待機
      
      await canvas.click({ position: { x: 220, y: 220 } });
      await page.waitForTimeout(1000);
      
      const secondTargetMode = await connectionTargetIndicator.isVisible();
      console.log('2回目接続先選択モード:', secondTargetMode);
      
      if (secondTargetMode) {
        await canvas.click({ position: { x: 370, y: 200 } });
        await page.waitForTimeout(2000);
        
        // 2回目の接続後の接続数を確認
        const secondConnectionCount = await page.locator('text=/\\d+ 接続/').first().textContent();
        console.log('2回目接続後の接続数:', secondConnectionCount);
        
        // 重複接続メッセージの確認
        const duplicateMessage = page.locator('text=この接続は既に存在します');
        const hasDuplicateMessage = await duplicateMessage.isVisible({ timeout: 2000 });
        console.log('重複接続メッセージ:', hasDuplicateMessage);
        
        // 結果の評価
        if (firstConnectionCount === secondConnectionCount) {
          console.log('✅ 二本線問題解決: 重複接続は作成されませんでした');
          console.log(`接続数は ${firstConnectionCount} のまま維持されました`);
        } else {
          console.log('⚠️ 二本線問題発生: 重複接続が作成されました');
          console.log(`接続数が ${firstConnectionCount} から ${secondConnectionCount} に増加しました`);
        }
      }
    }
  } else {
    console.log('最初のコンポーネントクリックに失敗');
  }
});