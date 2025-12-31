import { test, expect } from '@playwright/test';

test.describe('プロジェクト作成デバッグテスト', () => {
  test('プロジェクト作成フローの詳細確認', async ({ page }) => {
    // アプリケーションにアクセス
    await page.goto('http://localhost:5174', { waitUntil: 'networkidle' });
    
    // ページが完全に読み込まれるまで待機
    await page.waitForLoadState('domcontentloaded');
    
    console.log('ページタイトル:', await page.title());
    console.log('現在のURL:', page.url());
    
    // 新規プロジェクトボタンが表示されるまで待機
    const newProjectButton = page.getByTestId('new-project-button');
    await expect(newProjectButton).toBeVisible({ timeout: 10000 });
    console.log('新規プロジェクトボタンが見つかりました');
    
    // 新規プロジェクト作成
    await newProjectButton.click();
    console.log('新規プロジェクトボタンをクリックしました');
    
    // モーダルが表示されるまで待機
    await expect(page.getByTestId('project-name-input')).toBeVisible({ timeout: 5000 });
    console.log('プロジェクト名入力フィールドが表示されました');
    
    await page.getByTestId('project-name-input').fill('デバッグテスト');
    await page.getByTestId('project-description-input').fill('プロジェクト作成のデバッグテスト');
    console.log('プロジェクト情報を入力しました');
    
    // 作成ボタンをクリック
    await page.getByTestId('create-project-button').click();
    console.log('作成ボタンをクリックしました');
    
    // 少し待機してページの状態を確認
    await page.waitForTimeout(3000);
    
    console.log('作成後のURL:', page.url());
    
    // ページ上の全ての要素を確認
    const allElements = await page.locator('[data-testid]').all();
    console.log('ページ上のテストID要素:');
    for (const element of allElements) {
      const testId = await element.getAttribute('data-testid');
      const isVisible = await element.isVisible();
      console.log(`  - ${testId}: ${isVisible ? '表示' : '非表示'}`);
    }
    
    // model-tabが存在するか確認
    const modelTab = page.getByTestId('model-tab');
    const modelTabExists = await modelTab.count() > 0;
    console.log('model-tab要素の存在:', modelTabExists);
    
    if (modelTabExists) {
      const isVisible = await modelTab.isVisible();
      console.log('model-tab要素の表示状態:', isVisible);
    }
    
    // ページのHTMLを出力（デバッグ用）
    const bodyHTML = await page.locator('body').innerHTML();
    console.log('ページのHTML（最初の1000文字）:', bodyHTML.substring(0, 1000));
    
    // コンソールエラーを確認
    const consoleMessages: string[] = [];
    page.on('console', msg => {
      const message = `${msg.type()}: ${msg.text()}`;
      consoleMessages.push(message);
      console.log('ブラウザコンソール:', message);
    });
    
    // ページエラーを確認
    const pageErrors: string[] = [];
    page.on('pageerror', error => {
      pageErrors.push(error.message);
    });
    
    // 少し待機してエラーを収集
    await page.waitForTimeout(2000);
    
    console.log('コンソールメッセージ:', consoleMessages);
    console.log('ページエラー:', pageErrors);
    
    // 直接URLにアクセスしてみる
    await page.goto('http://localhost:5174/projects/1', { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    
    console.log('直接アクセス後のURL:', page.url());
    const directHTML = await page.locator('body').innerHTML();
    console.log('直接アクセス後のHTML（最初の1000文字）:', directHTML.substring(0, 1000));
  });
});