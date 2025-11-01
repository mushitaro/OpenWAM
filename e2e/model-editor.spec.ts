import { test, expect } from '@playwright/test';

test.describe('Model Editor', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:5173/');
    
    // Create a new project for testing
    await page.click('[data-testid="new-project-button"]');
    await page.fill('[data-testid="project-name-input"]', 'Model Editor Test');
    await page.click('[data-testid="create-project-button"]');
  });

  test('should add components to canvas', async ({ page }) => {
    // Add a pipe component
    await page.click('[data-testid="component-pipe"]');
    await page.click('[data-testid="canvas-editor"]', { position: { x: 200, y: 200 } });
    
    // Should see component on canvas
    await expect(page.locator('[data-testid="canvas-component"]')).toBeVisible();
    
    // Add an atmosphere boundary condition
    await page.click('[data-testid="component-atmosphere"]');
    await page.click('[data-testid="canvas-editor"]', { position: { x: 100, y: 200 } });
    
    // Should have two components
    await expect(page.locator('[data-testid="canvas-component"]')).toHaveCount(2);
  });

  test('should select and edit component properties', async ({ page }) => {
    // Add a pipe component
    await page.click('[data-testid="component-pipe"]');
    await page.click('[data-testid="canvas-editor"]', { position: { x: 200, y: 200 } });
    
    // Select the component
    await page.click('[data-testid="canvas-component"]');
    
    // Properties panel should open
    await expect(page.locator('[data-testid="properties-panel"]')).toBeVisible();
    await expect(page.locator('[data-testid="property-numeroTubo"]')).toBeVisible();
    
    // Edit a property
    await page.fill('[data-testid="property-numeroTubo"]', '5');
    await page.locator('[data-testid="property-numeroTubo"]').blur();
    
    // Property should be updated
    await expect(page.locator('[data-testid="property-numeroTubo"]')).toHaveValue('5');
  });

  test('should create connections between components', async ({ page }) => {
    // Add pipe and atmosphere components
    await page.click('[data-testid="component-pipe"]');
    await page.click('[data-testid="canvas-editor"]', { position: { x: 200, y: 200 } });
    
    await page.click('[data-testid="component-atmosphere"]');
    await page.click('[data-testid="canvas-editor"]', { position: { x: 100, y: 200 } });
    
    // Enable connection mode
    await page.click('[data-testid="connection-tool"]');
    
    // Create connection by clicking on connection points
    await page.waitForSelector('.component-connection-point');
    const connectionPoints = await page.locator('.component-connection-point').all();
    
    if (connectionPoints.length >= 2) {
      await connectionPoints[0].click({ force: true });
      await connectionPoints[1].click({ force: true });
    }
    
    // Should see connection line
    await expect(page.locator('[data-testid="canvas-connection"]')).toBeVisible();
  });

  test('should validate model and show errors', async ({ page }) => {
    // Add a pipe without boundary conditions
    await page.click('[data-testid="component-pipe"]');
    await page.click('[data-testid="canvas-editor"]', { position: { x: 200, y: 200 } });
    
    // Validate model
    await page.click('[data-testid="validate-model-button"]');
    
    // Should show validation errors
    await expect(page.locator('[data-testid="validation-errors"]')).toBeVisible();
    await expect(page.locator('[data-testid="validation-error"]')).toContainText('境界条件');
  });

  test('should delete components', async ({ page }) => {
    // Add a component
    await page.click('[data-testid="component-pipe"]');
    await page.click('[data-testid="canvas-editor"]', { position: { x: 200, y: 200 } });
    
    // Select and delete
    await page.click('[data-testid="canvas-component"]');
    await page.keyboard.press('Delete');
    
    // Component should be removed
    await expect(page.locator('[data-testid="canvas-component"]')).not.toBeVisible();
  });

  test('should use zoom and pan controls', async ({ page }) => {
    // Test zoom in
    await page.click('[data-testid="zoom-in-button"]');
    
    // Test zoom out
    await page.click('[data-testid="zoom-out-button"]');
    
    // Test zoom reset
    await page.click('[data-testid="zoom-reset-button"]');
    
    // Test pan by dragging canvas
    await page.mouse.move(300, 300);
    await page.mouse.down();
    await page.mouse.move(350, 350);
    await page.mouse.up();
  });

  test('should toggle grid display', async ({ page }) => {
    // Toggle grid on
    await page.click('[data-testid="toggle-grid-button"]');
    await expect(page.locator('[data-testid="canvas-grid"]')).toBeVisible();
    
    // Toggle grid off
    await page.click('[data-testid="toggle-grid-button"]');
    await expect(page.locator('[data-testid="canvas-grid"]')).not.toBeVisible();
  });
});