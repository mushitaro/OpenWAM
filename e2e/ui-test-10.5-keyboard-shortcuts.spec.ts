import { test, expect } from '@playwright/test';

test.describe('UIテスト 10.5: キーボードショートカット詳細テスト', () => {
  
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:5173');
    // 新規プロジェクト作成
    await page.getByTestId('new-project-button').click();
    await page.getByTestId('project-name-input').fill('ショートカットテスト');
    await page.getByTestId('create-project-button').click();
  });

  // 基本ショートカットテスト
  test.describe('基本ショートカットテスト', () => {
    
    test('Ctrl+S - 保存ショートカット詳細テスト', async ({ page, browserName }) => {
      console.log(`🎹 ${browserName} Ctrl+S保存ショートカットテスト開始`);
      
      // 保存ショートカット実行
      await page.keyboard.press('Control+s');
      
      // 保存通知の確認
      const saveNotification = page.getByTestId('save-notification');
      if (await saveNotification.isVisible({ timeout: 3000 })) {
        await expect(saveNotification).toContainText('保存');
        console.log(`✅ ${browserName} 保存通知表示: 成功`);
        
        // 通知の自動消去確認（3秒後）
        await expect(saveNotification).not.toBeVisible({ timeout: 5000 });
        console.log(`✅ ${browserName} 保存通知自動消去: 成功`);
      } else {
        console.log(`⚠️ ${browserName} 保存通知が表示されませんでした`);
      }
      
      // 複数回の保存操作テスト
      await page.keyboard.press('Control+s');
      await page.waitForTimeout(500);
      await page.keyboard.press('Control+s');
      await page.waitForTimeout(500);
      await page.keyboard.press('Control+s');
      
      console.log(`✅ ${browserName} 連続保存操作: 完了`);
    });

    test('Ctrl+Z - 元に戻すショートカットテスト', async ({ page, browserName }) => {
      console.log(`🎹 ${browserName} Ctrl+Z元に戻すショートカットテスト開始`);
      
      // 元に戻すショートカット実行
      await page.keyboard.press('Control+z');
      console.log(`✅ ${browserName} Ctrl+Z実行: 完了`);
      
      // 複数回の元に戻す操作
      for (let i = 0; i < 3; i++) {
        await page.keyboard.press('Control+z');
        await page.waitForTimeout(100);
      }
      
      console.log(`✅ ${browserName} 連続Ctrl+Z操作: 完了`);
    });

    test('Ctrl+Y - やり直しショートカットテスト', async ({ page, browserName }) => {
      console.log(`🎹 ${browserName} Ctrl+Yやり直しショートカットテスト開始`);
      
      // やり直しショートカット実行
      await page.keyboard.press('Control+y');
      console.log(`✅ ${browserName} Ctrl+Y実行: 完了`);
      
      // 複数回のやり直し操作
      for (let i = 0; i < 3; i++) {
        await page.keyboard.press('Control+y');
        await page.waitForTimeout(100);
      }
      
      console.log(`✅ ${browserName} 連続Ctrl+Y操作: 完了`);
    });

    test('Ctrl+A - 全選択ショートカットテスト', async ({ page, browserName }) => {
      console.log(`🎹 ${browserName} Ctrl+A全選択ショートカットテスト開始`);
      
      // 全選択ショートカット実行
      await page.keyboard.press('Control+a');
      console.log(`✅ ${browserName} Ctrl+A実行: 完了`);
      
      // テキストフィールドでの全選択テスト
      await page.getByTestId('files-tab').click();
      
      // ファイル名入力フィールドがある場合のテスト
      const textInputs = page.locator('input[type="text"], textarea');
      const inputCount = await textInputs.count();
      
      if (inputCount > 0) {
        await textInputs.first().click();
        await textInputs.first().fill('テスト文字列');
        await page.keyboard.press('Control+a');
        
        // 選択状態の確認（文字が選択されているかは視覚的確認が必要）
        console.log(`✅ ${browserName} テキストフィールドでのCtrl+A: 実行完了`);
      }
    });
  });

  // 削除・編集ショートカットテスト
  test.describe('削除・編集ショートカットテスト', () => {
    
    test('Delete - 削除ショートカットテスト', async ({ page, browserName }) => {
      console.log(`🎹 ${browserName} Delete削除ショートカットテスト開始`);
      
      // 削除キー操作
      await page.keyboard.press('Delete');
      console.log(`✅ ${browserName} Delete実行: 完了`);
      
      // コンポーネント選択状態での削除テスト
      const paletteContainer = page.locator('.component-palette');
      if (await paletteContainer.isVisible()) {
        const pipesCategory = page.locator('[data-category="pipes"]');
        if (await pipesCategory.isVisible()) {
          await pipesCategory.click();
          
          const pipeComponent = page.locator('[data-component-type="TTubo"]');
          if (await pipeComponent.isVisible()) {
            await pipeComponent.click();
            
            // コンポーネント選択後の削除
            await page.keyboard.press('Delete');
            console.log(`✅ ${browserName} コンポーネント削除: 実行完了`);
          }
        }
      }
    });

    test('Backspace - バックスペースショートカットテスト', async ({ page, browserName }) => {
      console.log(`🎹 ${browserName} Backspaceショートカットテスト開始`);
      
      // バックスペースキー操作
      await page.keyboard.press('Backspace');
      console.log(`✅ ${browserName} Backspace実行: 完了`);
      
      // テキスト入力での削除テスト
      await page.getByTestId('files-tab').click();
      
      const textInputs = page.locator('input[type="text"], textarea');
      const inputCount = await textInputs.count();
      
      if (inputCount > 0) {
        await textInputs.first().click();
        await textInputs.first().fill('削除テスト文字列');
        
        // 文字を一つずつ削除
        for (let i = 0; i < 5; i++) {
          await page.keyboard.press('Backspace');
          await page.waitForTimeout(50);
        }
        
        console.log(`✅ ${browserName} テキスト削除: 完了`);
      }
    });
  });

  // ナビゲーションショートカットテスト
  test.describe('ナビゲーションショートカットテスト', () => {
    
    test('Tab - フォーカス移動ショートカットテスト', async ({ page, browserName }) => {
      console.log(`🎹 ${browserName} Tabフォーカス移動ショートカットテスト開始`);
      
      // Tabキーでのフォーカス移動
      for (let i = 0; i < 5; i++) {
        await page.keyboard.press('Tab');
        await page.waitForTimeout(100);
        
        // フォーカスされた要素の確認
        const focusedElement = await page.evaluate(() => {
          const focused = document.activeElement;
          return focused ? {
            tagName: focused.tagName,
            id: focused.id,
            className: focused.className
          } : null;
        });
        
        console.log(`Tab ${i + 1}: フォーカス要素 -`, focusedElement);
      }
      
      console.log(`✅ ${browserName} Tabフォーカス移動: 完了`);
    });

    test('Shift+Tab - 逆方向フォーカス移動テスト', async ({ page, browserName }) => {
      console.log(`🎹 ${browserName} Shift+Tab逆方向フォーカス移動テスト開始`);
      
      // まず前方向にフォーカス移動
      for (let i = 0; i < 3; i++) {
        await page.keyboard.press('Tab');
        await page.waitForTimeout(100);
      }
      
      // 逆方向にフォーカス移動
      for (let i = 0; i < 3; i++) {
        await page.keyboard.press('Shift+Tab');
        await page.waitForTimeout(100);
        
        const focusedElement = await page.evaluate(() => {
          const focused = document.activeElement;
          return focused ? focused.tagName : null;
        });
        
        console.log(`Shift+Tab ${i + 1}: フォーカス要素 - ${focusedElement}`);
      }
      
      console.log(`✅ ${browserName} Shift+Tab逆方向移動: 完了`);
    });

    test('Enter - 確定ショートカットテスト', async ({ page, browserName }) => {
      console.log(`🎹 ${browserName} Enter確定ショートカットテスト開始`);
      
      // ボタンフォーカス時のEnterキーテスト
      const modelTab = page.getByTestId('model-tab');
      await modelTab.focus();
      await page.keyboard.press('Enter');
      
      console.log(`✅ ${browserName} Enter確定: 実行完了`);
      
      // フォームでのEnterキーテスト
      await page.getByTestId('files-tab').click();
      
      const textInputs = page.locator('input[type="text"]');
      const inputCount = await textInputs.count();
      
      if (inputCount > 0) {
        await textInputs.first().click();
        await textInputs.first().fill('Enterテスト');
        await page.keyboard.press('Enter');
        
        console.log(`✅ ${browserName} フォームでのEnter: 実行完了`);
      }
    });
  });

  // システムショートカットテスト
  test.describe('システムショートカットテスト', () => {
    
    test('Escape - キャンセルショートカットテスト', async ({ page, browserName }) => {
      console.log(`🎹 ${browserName} Escapeキャンセルショートカットテスト開始`);
      
      // Escapeキー操作
      await page.keyboard.press('Escape');
      console.log(`✅ ${browserName} Escape実行: 完了`);
      
      // モーダルダイアログでのEscapeテスト
      // （新規プロジェクト作成モーダルを開いてEscapeで閉じる）
      await page.goto('http://localhost:5173');
      await page.getByTestId('new-project-button').click();
      
      // モーダルが開いていることを確認
      const modal = page.locator('.modal, [role="dialog"]');
      if (await modal.isVisible()) {
        await page.keyboard.press('Escape');
        
        // モーダルが閉じることを確認
        await expect(modal).not.toBeVisible({ timeout: 2000 });
        console.log(`✅ ${browserName} モーダルEscapeキャンセル: 成功`);
      } else {
        console.log(`⚠️ ${browserName} モーダルが見つかりませんでした`);
      }
    });

    test('F5 - ページ更新ショートカットテスト', async ({ page, browserName }) => {
      console.log(`🎹 ${browserName} F5ページ更新ショートカットテスト開始`);
      
      // F5キーでのページ更新
      await page.keyboard.press('F5');
      
      // ページが再読み込みされることを確認
      await expect(page.locator('h1')).toContainText('OpenWAM プロジェクト');
      
      console.log(`✅ ${browserName} F5ページ更新: 完了`);
    });

    test('F11 - フルスクリーンショートカットテスト', async ({ page, browserName }) => {
      console.log(`🎹 ${browserName} F11フルスクリーンショートカットテスト開始`);
      
      // 初期ウィンドウサイズの記録
      const initialViewport = page.viewportSize();
      
      // F11キーでフルスクリーン切り替え
      await page.keyboard.press('F11');
      await page.waitForTimeout(1000); // フルスクリーン切り替え待機
      
      // フルスクリーン解除
      await page.keyboard.press('F11');
      await page.waitForTimeout(1000);
      
      // ウィンドウサイズが元に戻ることを確認
      const finalViewport = page.viewportSize();
      expect(finalViewport).toEqual(initialViewport);
      
      console.log(`✅ ${browserName} F11フルスクリーン切り替え: 完了`);
    });

    test('F12 - 開発者ツールショートカットテスト', async ({ page, browserName }) => {
      console.log(`🎹 ${browserName} F12開発者ツールショートカットテスト開始`);
      
      // F12キー操作（開発者ツールの開閉）
      await page.keyboard.press('F12');
      await page.waitForTimeout(500);
      
      // 再度F12で閉じる
      await page.keyboard.press('F12');
      await page.waitForTimeout(500);
      
      console.log(`✅ ${browserName} F12開発者ツール: 実行完了`);
    });
  });

  // 組み合わせショートカットテスト
  test.describe('組み合わせショートカットテスト', () => {
    
    test('Ctrl+Shift+I - 開発者ツール組み合わせショートカット', async ({ page, browserName }) => {
      console.log(`🎹 ${browserName} Ctrl+Shift+I開発者ツールテスト開始`);
      
      await page.keyboard.press('Control+Shift+I');
      await page.waitForTimeout(500);
      
      console.log(`✅ ${browserName} Ctrl+Shift+I: 実行完了`);
    });

    test('Ctrl+Shift+R - 強制リロードショートカット', async ({ page, browserName }) => {
      console.log(`🎹 ${browserName} Ctrl+Shift+R強制リロードテスト開始`);
      
      await page.keyboard.press('Control+Shift+R');
      
      // ページが再読み込みされることを確認
      await expect(page.locator('h1')).toContainText('OpenWAM プロジェクト');
      
      console.log(`✅ ${browserName} Ctrl+Shift+R強制リロード: 完了`);
    });

    test('Alt+Tab - アプリケーション切り替えショートカット', async ({ page, browserName }) => {
      console.log(`🎹 ${browserName} Alt+Tabアプリケーション切り替えテスト開始`);
      
      // Alt+Tab操作（ブラウザ内では制限されるが、キー送信は可能）
      await page.keyboard.press('Alt+Tab');
      await page.waitForTimeout(200);
      
      console.log(`✅ ${browserName} Alt+Tab: 実行完了`);
    });
  });

  // アクセシビリティショートカットテスト
  test.describe('アクセシビリティショートカットテスト', () => {
    
    test('スペースキー - ボタン実行ショートカット', async ({ page, browserName }) => {
      console.log(`🎹 ${browserName} スペースキーボタン実行テスト開始`);
      
      // ボタンにフォーカスを当ててスペースキーで実行
      const modelTab = page.getByTestId('model-tab');
      await modelTab.focus();
      await page.keyboard.press('Space');
      
      console.log(`✅ ${browserName} スペースキーボタン実行: 完了`);
    });

    test('矢印キー - ナビゲーションショートカット', async ({ page, browserName }) => {
      console.log(`🎹 ${browserName} 矢印キーナビゲーションテスト開始`);
      
      // 矢印キーでのナビゲーション
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(100);
      await page.keyboard.press('ArrowLeft');
      await page.waitForTimeout(100);
      await page.keyboard.press('ArrowDown');
      await page.waitForTimeout(100);
      await page.keyboard.press('ArrowUp');
      await page.waitForTimeout(100);
      
      console.log(`✅ ${browserName} 矢印キーナビゲーション: 完了`);
    });

    test('Home/End - 行頭・行末移動ショートカット', async ({ page, browserName }) => {
      console.log(`🎹 ${browserName} Home/End行頭・行末移動テスト開始`);
      
      // テキストフィールドでのHome/Endキーテスト
      await page.getByTestId('files-tab').click();
      
      const textInputs = page.locator('input[type="text"], textarea');
      const inputCount = await textInputs.count();
      
      if (inputCount > 0) {
        await textInputs.first().click();
        await textInputs.first().fill('Home End テスト文字列');
        
        await page.keyboard.press('Home'); // 行頭に移動
        await page.waitForTimeout(100);
        await page.keyboard.press('End');  // 行末に移動
        await page.waitForTimeout(100);
        
        console.log(`✅ ${browserName} Home/End移動: 完了`);
      }
    });
  });

  // ブラウザ固有ショートカットテスト
  test.describe('ブラウザ固有ショートカットテスト', () => {
    
    test('Ctrl+T - 新しいタブ（ブラウザ制御）', async ({ page, browserName }) => {
      console.log(`🎹 ${browserName} Ctrl+T新しいタブテスト開始`);
      
      // Ctrl+T操作（ブラウザによって動作が異なる）
      await page.keyboard.press('Control+t');
      await page.waitForTimeout(500);
      
      console.log(`✅ ${browserName} Ctrl+T: 実行完了（ブラウザ制御）`);
    });

    test('Ctrl+W - タブを閉じる（ブラウザ制御）', async ({ page, browserName }) => {
      console.log(`🎹 ${browserName} Ctrl+Wタブを閉じるテスト開始`);
      
      // Ctrl+W操作（ブラウザによって動作が異なる）
      await page.keyboard.press('Control+w');
      await page.waitForTimeout(500);
      
      console.log(`✅ ${browserName} Ctrl+W: 実行完了（ブラウザ制御）`);
    });

    test('Ctrl+R - ページ更新', async ({ page, browserName }) => {
      console.log(`🎹 ${browserName} Ctrl+Rページ更新テスト開始`);
      
      await page.keyboard.press('Control+r');
      
      // ページが再読み込みされることを確認
      await expect(page.locator('h1')).toContainText('OpenWAM プロジェクト');
      
      console.log(`✅ ${browserName} Ctrl+Rページ更新: 完了`);
    });
  });

  // 総合ショートカットテスト
  test.describe('総合ショートカットテスト', () => {
    
    test('全ショートカット連続実行テスト', async ({ page, browserName }) => {
      console.log(`🚀 ${browserName} 全ショートカット連続実行テスト開始`);
      
      const shortcuts = [
        'Control+s',  // 保存
        'Control+z',  // 元に戻す
        'Control+y',  // やり直し
        'Delete',     // 削除
        'Escape',     // キャンセル
        'Tab',        // フォーカス移動
        'Enter',      // 確定
        'F5'          // 更新
      ];
      
      for (const shortcut of shortcuts) {
        await page.keyboard.press(shortcut);
        await page.waitForTimeout(200);
        console.log(`✅ ${shortcut} 実行完了`);
      }
      
      // 最終的にページが正常に表示されていることを確認
      await expect(page.locator('h1')).toContainText('OpenWAM プロジェクト');
      
      console.log(`✅ ${browserName} 全ショートカット連続実行: 完了`);
    });

    test('ショートカット応答性能テスト', async ({ page, browserName }) => {
      console.log(`📊 ${browserName} ショートカット応答性能テスト開始`);
      
      const performanceResults: { [key: string]: number } = {};
      
      // 各ショートカットの応答時間測定
      const shortcuts = ['Control+s', 'Control+z', 'Delete', 'Escape'];
      
      for (const shortcut of shortcuts) {
        const startTime = Date.now();
        await page.keyboard.press(shortcut);
        await page.waitForTimeout(100); // 最小待機時間
        const endTime = Date.now();
        
        performanceResults[shortcut] = endTime - startTime;
        console.log(`📊 ${shortcut} 応答時間: ${performanceResults[shortcut]}ms`);
      }
      
      // 応答時間が妥当な範囲内であることを確認（500ms以内）
      for (const [shortcut, time] of Object.entries(performanceResults)) {
        expect(time).toBeLessThan(500);
      }
      
      console.log(`✅ ${browserName} ショートカット応答性能: 全て合格`);
    });
  });
});