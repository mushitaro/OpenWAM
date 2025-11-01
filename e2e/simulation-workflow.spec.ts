import { test, expect } from '@playwright/test';

test.describe('Simulation Workflow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:5173/');
    
    // Create a project with a simple valid model
    await page.click('[data-testid="new-project-button"]');
    await page.fill('[data-testid="project-name-input"]', 'Simulation Test');
    await page.click('[data-testid="create-project-button"]');
    
    // Create a simple pipe with boundary conditions
    await page.click('[data-testid="component-palette-boundaries"]');
    await page.click('[data-testid="component-atmosphere"]');
    await page.click('[data-testid="canvas-editor"]', { position: { x: 100, y: 200 } });
    
    await page.click('[data-testid="component-palette-pipes"]');
    await page.click('[data-testid="component-pipe"]');
    await page.click('[data-testid="canvas-editor"]', { position: { x: 200, y: 200 } });
    
    await page.click('[data-testid="component-palette-boundaries"]');
    await page.click('[data-testid="component-atmosphere"]');
    await page.click('[data-testid="canvas-editor"]', { position: { x: 300, y: 200 } });
    
    // Connect components
    await page.click('[data-testid="connection-tool"]');
    
    // Wait for connection points to be available and click them
    await page.waitForSelector('.component-connection-point');
    const connectionPoints = await page.locator('.component-connection-point').all();
    
    // Click first 4 connection points to create connections
    for (let i = 0; i < Math.min(4, connectionPoints.length); i++) {
      await connectionPoints[i].click({ force: true });
    }
  });

  test('should start simulation', async ({ page }) => {
    // Navigate to simulation tab
    await page.click('[data-testid="simulation-tab"]');
    
    // Click run simulation button
    await page.click('[data-testid="run-simulation-button"]');
    
    // Should show simulation dialog
    await expect(page.locator('[data-testid="simulation-dialog"]')).toBeVisible();
    
    // Configure simulation settings
    await page.fill('[data-testid="simulation-duration"]', '1.0');
    await page.fill('[data-testid="angle-increment"]', '0.1');
    
    // Start simulation
    await page.click('[data-testid="start-simulation-button"]');
    
    // Wait a moment for simulation to start
    await page.waitForTimeout(500);
    
    // Check if there's an error or if progress is shown
    const errorVisible = await page.locator('[data-testid="simulation-error"]').isVisible();
    if (errorVisible) {
      const errorMessage = await page.locator('[data-testid="error-message"]').textContent();
      console.log('Simulation error:', errorMessage);
    }
    
    // Should show progress indicator
    await expect(page.locator('[data-testid="simulation-progress"]')).toBeVisible();
    await expect(page.locator('[data-testid="progress-bar"]')).toBeVisible();
  });

  test('should show simulation progress', async ({ page }) => {
    // Navigate to simulation tab
    await page.click('[data-testid="simulation-tab"]');
    
    // Start simulation
    await page.click('[data-testid="run-simulation-button"]');
    await page.click('[data-testid="start-simulation-button"]');
    
    // Should show progress updates
    await expect(page.locator('[data-testid="progress-percentage"]')).toBeVisible();
    await expect(page.locator('[data-testid="simulation-status"]')).toContainText('実行中');
    
    // Should show estimated time remaining
    await expect(page.locator('[data-testid="time-remaining"]')).toBeVisible();
  });

  test('should cancel running simulation', async ({ page }) => {
    // Navigate to simulation tab
    await page.click('[data-testid="simulation-tab"]');
    
    // Start simulation
    await page.click('[data-testid="run-simulation-button"]');
    await page.click('[data-testid="start-simulation-button"]');
    
    // Cancel simulation
    await page.click('[data-testid="cancel-simulation-button"]');
    
    // Should show cancellation confirmation
    await page.click('[data-testid="confirm-cancel-button"]');
    
    // Status should change to cancelled
    await expect(page.locator('[data-testid="simulation-status"]')).toContainText('キャンセル');
  });

  test('should display simulation results', async ({ page }) => {
    // Navigate to simulation tab first
    await page.click('[data-testid="simulation-tab"]');
    
    // Mock successful simulation completion
    await page.route('**/api/simulations/*', async route => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          json: {
            id: 1,
            status: 'completed',
            progress: 100,
            results: {
              timeData: [0, 0.1, 0.2, 0.3, 0.4, 0.5],
              pressureData: {
                'Node 1': [101325, 102000, 101800, 102200, 101900, 102100]
              }
            }
          }
        });
      }
    });
    
    // Start simulation
    await page.click('[data-testid="run-simulation-button"]');
    await page.click('[data-testid="start-simulation-button"]');
    
    // Wait for completion with longer timeout
    await expect(page.locator('[data-testid="simulation-status"]')).toContainText('完了', { timeout: 15000 });
    
    // Should show results viewer
    await expect(page.locator('[data-testid="results-viewer"]')).toBeVisible();
    await expect(page.locator('[data-testid="pressure-chart"]')).toBeVisible();
  });

  test('should export simulation results', async ({ page }) => {
    // Navigate to simulation tab
    await page.click('[data-testid="simulation-tab"]');
    
    // Mock completed simulation
    await page.route('**/api/simulations/*', async route => {
      await route.fulfill({
        json: {
          id: 1,
          status: 'completed',
          progress: 100,
          results: { /* mock data */ }
        }
      });
    });
    
    // Navigate to results
    await page.click('[data-testid="run-simulation-button"]');
    await page.click('[data-testid="start-simulation-button"]');
    
    // Export results
    await page.click('[data-testid="export-results-button"]');
    
    // Should trigger download when clicking CSV option
    const downloadPromise = page.waitForEvent('download');
    await page.click('[data-testid="export-csv-option"]');
    const download = await downloadPromise;
    
    expect(download.suggestedFilename()).toContain('.csv');
  });

  test('should compare simulation results', async ({ page }) => {
    // Navigate to simulation tab first
    await page.click('[data-testid="simulation-tab"]');
    
    // Mock multiple completed simulations
    await page.route('**/api/projects/*/simulations', async route => {
      await route.fulfill({
        json: [
          { id: 1, status: 'completed', startedAt: '2024-01-01T10:00:00Z' },
          { id: 2, status: 'completed', startedAt: '2024-01-01T11:00:00Z' }
        ]
      });
    });
    
    // Navigate to history
    await page.click('[data-testid="simulation-history-button"]');
    
    // Wait for history dialog to appear
    await expect(page.locator('[data-testid="simulation-checkbox-1"]')).toBeVisible();
    
    // Select simulations to compare
    await page.check('[data-testid="simulation-checkbox-1"]');
    await page.check('[data-testid="simulation-checkbox-2"]');
    
    // Start comparison
    await page.click('[data-testid="compare-simulations-button"]');
    
    // Should show comparison view
    await expect(page.locator('[data-testid="comparison-viewer"]')).toBeVisible();
    await expect(page.locator('[data-testid="comparison-chart"]')).toBeVisible();
  });

  test('should handle simulation errors', async ({ page }) => {
    // Navigate to simulation tab first
    await page.click('[data-testid="simulation-tab"]');
    
    // Mock simulation error - need to intercept both POST and GET requests
    await page.route('**/api/projects/*/simulations', async route => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          json: {
            id: 1,
            status: 'running',
            progress: 0
          }
        });
      }
    });
    
    await page.route('**/api/simulations/*', async route => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          json: {
            id: 1,
            status: 'failed',
            progress: 45,
            errorMessage: 'Convergence failed at time step 0.25'
          }
        });
      }
    });
    
    // Start simulation
    await page.click('[data-testid="run-simulation-button"]');
    await page.click('[data-testid="start-simulation-button"]');
    
    // Wait for error status with longer timeout
    await expect(page.locator('[data-testid="simulation-status"]')).toContainText('失敗', { timeout: 10000 });
    await expect(page.locator('[data-testid="error-message"]')).toContainText('Convergence failed');
  });
});