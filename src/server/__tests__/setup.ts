import { DatabaseManager } from '../database/DatabaseManager';
import fs from 'fs/promises';
import path from 'path';

// Test database setup
export const setupTestDatabase = async (): Promise<DatabaseManager> => {
  const testDbPath = path.join(__dirname, '../../../test_data/test.db');
  
  // Ensure test directory exists
  await fs.mkdir(path.dirname(testDbPath), { recursive: true });
  
  // Remove existing test database
  try {
    await fs.unlink(testDbPath);
  } catch (error) {
    // File doesn't exist, which is fine
  }
  
  const dbManager = new DatabaseManager();
  // Override the database path for testing
  (dbManager as any).dbPath = testDbPath;
  
  await dbManager.initialize();
  return dbManager;
};

export const cleanupTestDatabase = async (dbManager: DatabaseManager): Promise<void> => {
  await dbManager.close();
  
  // Clean up test files
  const testDataDir = path.join(__dirname, '../../../test_data');
  try {
    await fs.rm(testDataDir, { recursive: true, force: true });
  } catch (error) {
    // Directory doesn't exist, which is fine
  }
};

// Global test setup
beforeAll(async () => {
  // Set test environment
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'error';
});

afterAll(async () => {
  // Clean up any remaining test files
  const testDataDir = path.join(__dirname, '../../../test_data');
  try {
    await fs.rm(testDataDir, { recursive: true, force: true });
  } catch (error) {
    // Directory doesn't exist, which is fine
  }
});