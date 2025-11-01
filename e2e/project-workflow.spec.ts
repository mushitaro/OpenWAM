import { test, expect } from '@playwright/test';

test.describe('Project Workflow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('http://localhost:5173/');
  });

  test('should create a new project', async ({ page }) => {
    // Click new project button
    await page.click('[data-testid="new-project-button"]');
    
    // Fill project form
    await page.fill('[data-testid="project-name-input"]', 'Test Engine Project');
    await page.fill('[data-testid="project-description-input"]', 'A test project for engine simulation');
    
    // Submit form
    await page.click('[data-testid="create-project-button"]');
    
    // Should navigate to project editor
    await expect(page).toHaveURL(/\/projects\/\d+/);
    await expect(page.locator('[data-testid="project-title"]')).toContainText('Test Engine Project');
  });

  test('should load existing project', async ({ page }) => {
    // Assuming there's at least one project in the list
    await page.click('[data-testid="project-list-item"]:first-child');
    
    // Should navigate to project editor
    await expect(page).toHaveURL(/\/projects\/\d+/);
    await expect(page.locator('[data-testid="canvas-editor"]')).toBeVisible();
  });

  test('should save project changes', async ({ page }) => {
    // Create or open a project
    await page.click('[data-testid="new-project-button"]');
    await page.fill('[data-testid="project-name-input"]', 'Save Test Project');
    await page.click('[data-testid="create-project-button"]');
    
    // Make some changes (add a component)
    await page.click('[data-testid="component-pipe"]');
    
    // Click on canvas to add component
    await page.click('[data-testid="canvas-editor"]', { position: { x: 200, y: 200 } });
    
    // Save project
    await page.keyboard.press('Control+S');
    
    // Should show save confirmation
    await expect(page.locator('[data-testid="save-notification"]')).toBeVisible();
  });

  test('should delete project', async ({ page }) => {
    let projectsData: any[] = [];
    
    // Mock projects GET
    await page.route('**/api/projects', async route => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          json: projectsData
        });
      } else if (route.request().method() === 'POST') {
        const body = await route.request().postDataJSON();
        const newProject = {
          id: Date.now(),
          name: body.name,
          description: body.description,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };
        projectsData.push(newProject);
        await route.fulfill({
          json: newProject
        });
      }
    });
    
    // Mock project DELETE
    await page.route('**/api/projects/*', async route => {
      if (route.request().method() === 'DELETE') {
        const projectId = parseInt(route.request().url().split('/').pop() || '0');
        projectsData = projectsData.filter(p => p.id !== projectId);
        await route.fulfill({
          status: 200,
          json: { success: true }
        });
      }
    });
    
    // Create a project first
    await page.click('[data-testid="new-project-button"]');
    const uniqueName = `Project to Delete ${Date.now()}`;
    await page.fill('[data-testid="project-name-input"]', uniqueName);
    await page.click('[data-testid="create-project-button"]');
    
    // Go back to project list
    await page.click('[data-testid="back-to-projects"]');
    
    // Wait for project to appear in list
    await expect(page.locator(`[data-testid="project-list-item"]:has-text("${uniqueName}")`)).toBeVisible();
    
    // Delete the project
    await page.click('[data-testid="delete-project-button"]:first-child');
    
    // Confirm deletion
    await page.click('[data-testid="confirm-delete-button"]');
    
    // Wait for deletion to complete and project to be removed from list
    await page.waitForTimeout(1000); // Give time for API call to complete
    await expect(page.locator(`[data-testid="project-list-item"]:has-text("${uniqueName}")`)).not.toBeVisible();
  });
});