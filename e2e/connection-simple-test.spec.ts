import { test, expect } from '@playwright/test';

test('シンプル接続テスト', async ({ page }) => {
  await page.goto('http://localhost:5174');
  
  // 新規プロジェクト作成
  const newProjectButton = page.getByTestId('new-project-button');
  await expect(newProjectButton).toBeVisible({ timeout: 10000 });
  await newProjectButton.click();
  await page.getByTestId('project-name-input').fill('シンプル接続テスト');
  await page.getByTestId('create-project-button').click();
  
  // プロジェクトエディター画面への遷移を待機
  await expect(page.getByTestId('model-tab')).toBeVisible({ timeout: 10000 });
  
  // パイプを2つ配置
  const pipesCategory = page.getByTestId('component-palette-pipes');
  await pipesCategory.click();
  
  const pipeComponent = page.getByTestId('add-pipe');
  await pipeComponent.click();
  await page.waitForTimeout(1000);
  
  // 最初のコンポーネント配置後の確認
  let componentCount = await page.locator('text=/\\d+ コンポーネント/').first().textContent();
  console.log('1つ目配置後のコンポーネント数:', componentCount);
  
  await pipeComponent.click();
  await page.waitForTimeout(1000);
  
  // 2つ目のコンポーネント配置後の確認
  componentCount = await page.locator('text=/\\d+ コンポーネント/').first().textContent();
  console.log('2つ目配置後のコンポーネント数:', componentCount);
  
  // 接続モードを有効化
  const connectionTool = page.getByTestId('connection-tool');
  await connectionTool.click();
  
  // 接続モードの状態確認
  const connectionModeIndicator = page.locator('text=接続元を選択');
  await expect(connectionModeIndicator).toBeVisible({ timeout: 3000 });
  
  // キャンバス上でコンポーネントを直接クリック
  const canvas = page.getByTestId('canvas-editor');
  
  // キャンバスの境界を取得
  const canvasBounds = await canvas.boundingBox();
  console.log('キャンバス境界:', canvasBounds);
  
  // より広い範囲でクリックを試行
  const positions = [
    { x: 200, y: 200 },
    { x: 300, y: 200 },
    { x: 400, y: 200 },
    { x: 500, y: 200 },
    { x: 200, y: 300 },
    { x: 300, y: 300 },
    { x: 400, y: 300 },
    { x: 500, y: 300 }
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
      
      // 2番目のコンポーネントをクリック（予測される位置: 350, 200）
      const secondPositions = [
        { x: 350, y: 200 }, // 2番目のコンポーネントの予測位置
        { x: 200, y: 200 }, // 1番目のコンポーネントの位置
        { x: 500, y: 200 }  // 3番目のコンポーネントの位置（存在しないが念のため）
      ];
      
      for (const pos2 of secondPositions) {
        if (pos2.x !== pos.x || pos2.y !== pos.y) { // 同じ位置を避ける
          console.log(`2番目の位置 (${pos2.x}, ${pos2.y}) をクリック試行`);
          await canvas.click({ position: pos2 });
          await page.waitForTimeout(1000);
          
          // 接続が作成されたか確認
          const connectionCount = await page.locator('text=/\\d+ 接続/').first().textContent();
          console.log('接続数:', connectionCount);
          
          // 接続成功メッセージの確認
          const successMessage = page.locator('text=接続が作成されました');
          const hasSuccessMessage = await successMessage.isVisible({ timeout: 2000 });
          console.log('接続成功メッセージ:', hasSuccessMessage);
          
          if (hasSuccessMessage) {
            console.log('接続作成成功！');
            return;
          }
        }
      }
      break;
    }
  }
  
  if (!firstClickSuccess) {
    console.log('最初のコンポーネントクリックに失敗');
  }
});