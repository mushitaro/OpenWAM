import { test, expect } from '@playwright/test';

test('簡単なページ確認', async ({ page }) => {
  await page.goto('http://localhost:5174');
  
  console.log('ページタイトル:', await page.title());
  console.log('現在のURL:', page.url());
  
  // ページのHTMLを確認
  const bodyHTML = await page.locator('body').innerHTML();
  console.log('ページのHTML（最初の500文字）:', bodyHTML.substring(0, 500));
  
  // 全てのテストID要素を確認
  const allElements = await page.locator('[data-testid]').all();
  console.log('ページ上のテストID要素:');
  for (const element of allElements) {
    const testId = await element.getAttribute('data-testid');
    const isVisible = await element.isVisible();
    console.log(`  - ${testId}: ${isVisible ? '表示' : '非表示'}`);
  }
});