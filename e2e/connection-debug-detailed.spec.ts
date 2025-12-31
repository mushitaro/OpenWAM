import { test, expect } from '@playwright/test';

test('接続作成詳細デバッグテスト', async ({ page }) => {
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
  await page.getByTestId('project-name-input').fill('接続デバッグテスト');
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
  
  // キャンバス上のコンポーネントを詳細に調査
  console.log('=== コンポーネント調査 ===');
  const canvas = page.locator('[data-testid="canvas-editor"]');
  await expect(canvas).toBeVisible();
  
  // Konvaキャンバス内のコンポーネントを探す
  const konvaCanvas = page.locator('canvas').first();
  await expect(konvaCanvas).toBeVisible();
  
  // キャンバスの境界を取得
  const canvasBounds = await canvas.boundingBox();
  console.log('キャンバス境界:', canvasBounds);
  
  // コンポーネントの存在確認（SVGまたはKonva要素）
  const components = page.locator('[data-testid*="component-"]');
  const componentCount = await components.count();
  console.log('検出されたコンポーネント数:', componentCount);
  
  // 各コンポーネントの詳細情報を取得
  for (let i = 0; i < Math.min(componentCount, 5); i++) {
    const component = components.nth(i);
    const testId = await component.getAttribute('data-testid');
    const isVisible = await component.isVisible();
    console.log(`コンポーネント ${i}: testId=${testId}, visible=${isVisible}`);
  }
  
  // キャンバス上でマウスを動かしてコンポーネントを探す
  console.log('キャンバス上でコンポーネントを探索中...');
  for (let x = 100; x <= 500; x += 50) {
    for (let y = 100; y <= 300; y += 50) {
      await canvas.hover({ position: { x, y } });
      await page.waitForTimeout(100);
      
      // コンソールログでComponentShapeのhoverイベントを確認
      // この時点でログが出力されればコンポーネントが存在する
    }
  }
  
  // 接続を試行
  console.log('=== 接続試行開始 ===');
  
  // より広い範囲でコンポーネントを探してクリック
  console.log('最初のコンポーネントクリック試行');
  
  // 複数の位置を試行 - 前回成功した位置を含める
  const positions = [
    { x: 223, y: 167 }, // 前回成功した位置
    { x: 220, y: 170 },
    { x: 225, y: 165 },
    { x: 150, y: 200 },
    { x: 200, y: 200 },
    { x: 250, y: 200 },
    { x: 150, y: 150 },
    { x: 200, y: 150 }
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

  if (!firstClickSuccess) {
    console.log('最初のコンポーネントクリックに失敗');
    // それでも2番目のクリックを試行
  }

  // 2番目のクリック - 最初のコンポーネント（component_1762013723267）を探す
  console.log('2番目のコンポーネントクリック試行 - 最初のコンポーネントを探す');
  const secondPositions = [
    // より広範囲で最初のコンポーネントを探す
    { x: 50, y: 120 },
    { x: 100, y: 120 },
    { x: 50, y: 150 },
    { x: 100, y: 150 },
    { x: 50, y: 180 },
    { x: 100, y: 180 },
    { x: 50, y: 200 },
    { x: 100, y: 200 },
    { x: 250, y: 120 },
    { x: 300, y: 120 },
    { x: 250, y: 150 },
    { x: 300, y: 150 }
  ];
  
  for (const pos of secondPositions) {
    console.log(`2番目の位置 (${pos.x}, ${pos.y}) をクリック試行`);
    await canvas.click({ position: pos });
    await page.waitForTimeout(1000);
    
    // 接続が作成されたかチェック
    const connectionLines = page.locator('[data-testid="canvas-connection"]');
    const connectionCount = await connectionLines.count();
    console.log(`位置 (${pos.x}, ${pos.y}) 後の接続数:`, connectionCount);
    
    if (connectionCount > 0) {
      console.log('接続作成成功');
      break;
    }
  }
  
  // 接続結果を確認
  console.log('=== 接続結果確認 ===');
  const connectionLines = page.locator('[data-testid="canvas-connection"]');
  const connectionCount = await connectionLines.count();
  console.log('接続線数:', connectionCount);
  
  // 接続情報パネルの確認
  const connectionInfo = page.locator('text=/\\d+ 接続/');
  if (await connectionInfo.isVisible()) {
    const infoText = await connectionInfo.textContent();
    console.log('接続情報表示:', infoText);
  }
  
  // フィードバックメッセージの確認
  const feedbackMessages = [
    '接続が作成されました',
    'この接続は無効です',
    '同じコンポーネント内では接続できません',
    'パイプ経由で接続してください'
  ];
  
  for (const message of feedbackMessages) {
    const element = page.locator(`text=${message}`);
    if (await element.isVisible({ timeout: 1000 })) {
      console.log('フィードバックメッセージ:', message);
    }
  }
  
  // 最終的なコンソールログの出力
  console.log('=== 全コンソールメッセージ ===');
  consoleMessages.forEach((msg, index) => {
    console.log(`${index + 1}: ${msg}`);
  });
  
  // 少し待機してから終了
  await page.waitForTimeout(3000);
});