import { test, expect } from '@playwright/test';

test('コンポーネント位置特定', async ({ page }) => {
  await page.goto('http://localhost:5174');
  
  // 新規プロジェクト作成
  const newProjectButton = page.getByTestId('new-project-button');
  await expect(newProjectButton).toBeVisible({ timeout: 10000 });
  await newProjectButton.click();
  await page.getByTestId('project-name-input').fill('位置特定テスト');
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
  
  // 接続モードを有効化
  const connectionTool = page.getByTestId('connection-tool');
  await connectionTool.click();
  
  // キャンバス全体をスキャンしてコンポーネントを探す
  const canvas = page.getByTestId('canvas-editor');
  const canvasBounds = await canvas.boundingBox();
  
  console.log('キャンバス境界:', canvasBounds);
  console.log('コンポーネント探索開始...');
  
  let foundComponents = 0;
  const foundPositions: {x: number, y: number}[] = [];
  
  // より細かいグリッドでスキャン
  for (let x = 50; x <= 800; x += 25) {
    for (let y = 50; y <= 400; y += 25) {
      await canvas.click({ position: { x, y } });
      await page.waitForTimeout(100);
      
      // 接続先選択モードになったかチェック
      const connectionTargetIndicator = page.locator('text=接続先を選択');
      const isTargetMode = await connectionTargetIndicator.isVisible({ timeout: 200 });
      
      if (isTargetMode) {
        foundComponents++;
        foundPositions.push({ x, y });
        console.log(`✅ コンポーネント発見: (${x}, ${y})`);
        
        if (foundComponents >= 2) {
          console.log('2つのコンポーネントを発見、探索終了');
          break;
        }
        
        // 接続モードをリセット
        await connectionTool.click();
        await page.waitForTimeout(500);
        await connectionTool.click();
        await page.waitForTimeout(500);
      }
    }
    if (foundComponents >= 2) break;
  }
  
  console.log(`発見されたコンポーネント数: ${foundComponents}`);
  console.log('発見された位置:', foundPositions);
  
  if (foundPositions.length >= 2) {
    console.log('=== 実際の接続作成テスト ===');
    
    // 1回目の接続作成
    await canvas.click({ position: foundPositions[0] });
    await page.waitForTimeout(1000);
    await canvas.click({ position: foundPositions[1] });
    await page.waitForTimeout(2000);
    
    const firstConnectionCount = await page.locator('text=/\\d+ 接続/').first().textContent();
    console.log('1回目接続後:', firstConnectionCount);
    
    // 2回目の接続作成（重複テスト）
    await page.waitForTimeout(3000); // フィードバックメッセージが消えるまで待機
    
    await canvas.click({ position: foundPositions[0] });
    await page.waitForTimeout(1000);
    await canvas.click({ position: foundPositions[1] });
    await page.waitForTimeout(2000);
    
    const secondConnectionCount = await page.locator('text=/\\d+ 接続/').first().textContent();
    console.log('2回目接続後:', secondConnectionCount);
    
    // 結果の評価
    if (firstConnectionCount === secondConnectionCount) {
      console.log('✅ 二本線問題解決: 重複接続は防止されました');
    } else {
      console.log('⚠️ 二本線問題発生: 重複接続が作成されました');
    }
  }
});