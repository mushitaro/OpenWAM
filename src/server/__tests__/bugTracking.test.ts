import { DatabaseManager } from '../database/DatabaseManager';
import { BugTrackingService } from '../services/BugTrackingService';
import { BugPriorityCalculator } from '../../shared/services/bugPriorityCalculator';
import { BugSeverity, BugCategory, BugType, CreateBugRequest, BugReport } from '../../shared/types/bugTracking';
import { BUG_TEMPLATES } from '../../shared/templates/bugTemplates';

describe('Bug Tracking System', () => {
  let dbManager: DatabaseManager;
  let bugTrackingService: BugTrackingService;

  beforeAll(async () => {
    // Use in-memory database for testing
    dbManager = new DatabaseManager();
    await dbManager.initialize();
    bugTrackingService = new BugTrackingService(dbManager);
  });

  afterAll(async () => {
    await dbManager.close();
  });

  beforeEach(async () => {
    // Clean up database before each test
    const db = (dbManager as any).db;
    await db.exec('DELETE FROM bug_reports');
    await db.exec('DELETE FROM bug_comments');
    await db.exec('DELETE FROM bug_attachments');
  });

  describe('Bug Templates', () => {
    test('should have all required bug templates', () => {
      expect(BUG_TEMPLATES).toBeDefined();
      expect(BUG_TEMPLATES.length).toBeGreaterThan(0);

      // Check for essential templates
      const templateIds = BUG_TEMPLATES.map(t => t.id);
      expect(templateIds).toContain('ui_component_not_rendering');
      expect(templateIds).toContain('component_connection_failure');
      expect(templateIds).toContain('file_upload_failure');
      expect(templateIds).toContain('simulation_execution_error');
      expect(templateIds).toContain('performance_slow_rendering');
      expect(templateIds).toContain('browser_compatibility_issue');
      expect(templateIds).toContain('validation_error_incorrect');
      expect(templateIds).toContain('data_loss_issue');
    });

    test('should have valid template structure', () => {
      BUG_TEMPLATES.forEach(template => {
        expect(template.id).toBeDefined();
        expect(template.name).toBeDefined();
        expect(template.description).toBeDefined();
        expect(template.category).toBeDefined();
        expect(template.type).toBeDefined();
        expect(template.defaultSeverity).toBeDefined();
        expect(template.requiredFields).toBeDefined();
        expect(template.template).toBeDefined();
        expect(template.template.title).toBeDefined();
        expect(template.template.description).toBeDefined();
        expect(template.template.reproductionSteps).toBeDefined();
        expect(template.template.expectedBehavior).toBeDefined();
        expect(template.template.tags).toBeDefined();
      });
    });
  });

  describe('Priority Calculator', () => {
    test('should calculate priority correctly for critical bugs', () => {
      const criticalBug: BugReport = {
        id: 1,
        title: 'System Crash',
        description: 'Application crashes on startup',
        severity: BugSeverity.CRITICAL,
        status: 'open',
        category: BugCategory.DATA_INTEGRITY,
        type: BugType.BUG,
        reportedBy: 'test-user',
        reportedAt: new Date().toISOString(),
        environment: {} as any,
        reproductionSteps: [],
        expectedBehavior: 'App should start normally',
        actualBehavior: 'App crashes',
        attachments: [],
        relatedBugs: [],
        tags: ['critical', 'data-loss'],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        priorityScore: 0,
        priorityFactors: {} as any
      };

      const priority = BugPriorityCalculator.calculatePriority(criticalBug);
      
      expect(priority.severityScore).toBe(10);
      expect(priority.totalScore).toBeGreaterThan(80);
    });

    test('should calculate priority correctly for low severity bugs', () => {
      const lowBug: BugReport = {
        id: 2,
        title: 'Minor UI Issue',
        description: 'Button text is slightly misaligned',
        severity: BugSeverity.LOW,
        status: 'open',
        category: BugCategory.UI_UX,
        type: BugType.BUG,
        reportedBy: 'test-user',
        reportedAt: new Date().toISOString(),
        environment: {} as any,
        reproductionSteps: [],
        expectedBehavior: 'Button should be aligned',
        actualBehavior: 'Button is misaligned',
        attachments: [],
        relatedBugs: [],
        tags: ['ui', 'minor'],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        priorityScore: 0,
        priorityFactors: {} as any
      };

      const priority = BugPriorityCalculator.calculatePriority(lowBug);
      
      expect(priority.severityScore).toBe(2);
      expect(priority.totalScore).toBeLessThan(50);
    });

    test('should provide recommended actions based on priority', () => {
      const criticalAction = BugPriorityCalculator.getRecommendedAction(95);
      expect(criticalAction.action).toBe('緊急対応');
      expect(criticalAction.timeframe).toBe('即座（1時間以内）');

      const lowAction = BugPriorityCalculator.getRecommendedAction(20);
      expect(lowAction.action).toBe('将来対応');
      expect(lowAction.timeframe).toBe('次期バージョン');
    });

    test('should sort bugs by priority correctly', () => {
      const bugs: BugReport[] = [
        {
          id: 1,
          priorityScore: 50,
          severity: BugSeverity.MEDIUM,
          createdAt: '2023-01-01T00:00:00Z'
        } as BugReport,
        {
          id: 2,
          priorityScore: 90,
          severity: BugSeverity.CRITICAL,
          createdAt: '2023-01-02T00:00:00Z'
        } as BugReport,
        {
          id: 3,
          priorityScore: 50,
          severity: BugSeverity.HIGH,
          createdAt: '2023-01-03T00:00:00Z'
        } as BugReport
      ];

      const sorted = BugPriorityCalculator.sortBugsByPriority(bugs);
      
      expect(sorted[0].id).toBe(2); // Highest priority score
      expect(sorted[1].id).toBe(3); // Same priority score but higher severity
      expect(sorted[2].id).toBe(1); // Lowest priority
    });
  });

  describe('Bug Tracking Service', () => {
    test('should create bug report successfully', async () => {
      const bugData: CreateBugRequest = {
        title: 'Test Bug',
        description: 'This is a test bug',
        severity: BugSeverity.MEDIUM,
        category: BugCategory.FUNCTIONALITY,
        type: BugType.BUG,
        environment: {
          browser: 'Chrome',
          browserVersion: '91.0',
          os: 'Windows',
          osVersion: '10',
          screenResolution: '1920x1080',
          deviceType: 'desktop',
          userAgent: 'test-agent',
          timestamp: new Date().toISOString()
        },
        reproductionSteps: [
          {
            stepNumber: 1,
            action: 'Open application',
            expectedResult: 'App opens',
            actualResult: 'Error occurs'
          }
        ],
        expectedBehavior: 'Application should work',
        actualBehavior: 'Application fails',
        tags: ['test']
      };

      const bugReport = await bugTrackingService.createBugReport(bugData, 'test-user');
      
      expect(bugReport.id).toBeDefined();
      expect(bugReport.title).toBe(bugData.title);
      expect(bugReport.description).toBe(bugData.description);
      expect(bugReport.severity).toBe(bugData.severity);
      expect(bugReport.priorityScore).toBeGreaterThan(0);
      expect(bugReport.priorityFactors).toBeDefined();
    });

    test('should retrieve bug report by id', async () => {
      const bugData: CreateBugRequest = {
        title: 'Test Bug for Retrieval',
        description: 'This bug is for testing retrieval',
        severity: BugSeverity.HIGH,
        category: BugCategory.PERFORMANCE,
        type: BugType.PERFORMANCE_ISSUE,
        environment: {} as any,
        reproductionSteps: [],
        expectedBehavior: 'Fast performance',
        actualBehavior: 'Slow performance'
      };

      const createdBug = await bugTrackingService.createBugReport(bugData, 'test-user');
      const retrievedBug = await bugTrackingService.getBugReport(createdBug.id);
      
      expect(retrievedBug.id).toBe(createdBug.id);
      expect(retrievedBug.title).toBe(bugData.title);
      expect(retrievedBug.description).toBe(bugData.description);
    });

    test('should update bug report successfully', async () => {
      const bugData: CreateBugRequest = {
        title: 'Bug to Update',
        description: 'This bug will be updated',
        severity: BugSeverity.LOW,
        category: BugCategory.UI_UX,
        type: BugType.BUG,
        environment: {} as any,
        reproductionSteps: [],
        expectedBehavior: 'UI works',
        actualBehavior: 'UI broken'
      };

      const createdBug = await bugTrackingService.createBugReport(bugData, 'test-user');
      
      const updates = {
        status: 'resolved' as const,
        resolution: 'Fixed in version 1.1',
        assignedTo: 'developer-1'
      };

      const updatedBug = await bugTrackingService.updateBugReport(createdBug.id, updates);
      
      expect(updatedBug.status).toBe('resolved');
      expect(updatedBug.resolution).toBe('Fixed in version 1.1');
      expect(updatedBug.assignedTo).toBe('developer-1');
      expect(updatedBug.resolvedAt).toBeDefined();
    });

    test('should get bug reports with filters', async () => {
      // Create multiple bugs
      const bugs = [
        {
          title: 'Critical Bug',
          severity: BugSeverity.CRITICAL,
          category: BugCategory.DATA_INTEGRITY
        },
        {
          title: 'UI Bug',
          severity: BugSeverity.MEDIUM,
          category: BugCategory.UI_UX
        },
        {
          title: 'Performance Bug',
          severity: BugSeverity.HIGH,
          category: BugCategory.PERFORMANCE
        }
      ];

      for (const bugData of bugs) {
        await bugTrackingService.createBugReport({
          ...bugData,
          description: 'Test bug',
          type: BugType.BUG,
          environment: {} as any,
          reproductionSteps: [],
          expectedBehavior: 'Works',
          actualBehavior: 'Broken'
        }, 'test-user');
      }

      // Test filtering by severity
      const criticalBugs = await bugTrackingService.getBugReports({
        severity: [BugSeverity.CRITICAL]
      });
      expect(criticalBugs.bugs.length).toBe(1);
      expect(criticalBugs.bugs[0].title).toBe('Critical Bug');

      // Test filtering by category
      const uiBugs = await bugTrackingService.getBugReports({
        category: [BugCategory.UI_UX]
      });
      expect(uiBugs.bugs.length).toBe(1);
      expect(uiBugs.bugs[0].title).toBe('UI Bug');
    });

    test('should add comments to bug reports', async () => {
      const bugData: CreateBugRequest = {
        title: 'Bug with Comments',
        description: 'This bug will have comments',
        severity: BugSeverity.MEDIUM,
        category: BugCategory.FUNCTIONALITY,
        type: BugType.BUG,
        environment: {} as any,
        reproductionSteps: [],
        expectedBehavior: 'Works',
        actualBehavior: 'Broken'
      };

      const bug = await bugTrackingService.createBugReport(bugData, 'test-user');
      
      const comment = await bugTrackingService.addComment(
        bug.id,
        'developer-1',
        'I can reproduce this issue'
      );
      
      expect(comment.bugId).toBe(bug.id);
      expect(comment.author).toBe('developer-1');
      expect(comment.content).toBe('I can reproduce this issue');

      const comments = await bugTrackingService.getComments(bug.id);
      expect(comments.length).toBe(1);
      expect(comments[0].id).toBe(comment.id);
    });

    test('should generate bug statistics', async () => {
      // Create bugs with different properties
      const bugTypes = [
        { severity: BugSeverity.CRITICAL, category: BugCategory.DATA_INTEGRITY, status: 'open' },
        { severity: BugSeverity.HIGH, category: BugCategory.FUNCTIONALITY, status: 'in_progress' },
        { severity: BugSeverity.MEDIUM, category: BugCategory.UI_UX, status: 'resolved' },
        { severity: BugSeverity.LOW, category: BugCategory.PERFORMANCE, status: 'closed' }
      ];

      for (const [index, bugType] of bugTypes.entries()) {
        const bug = await bugTrackingService.createBugReport({
          title: `Bug ${index + 1}`,
          description: 'Test bug',
          severity: bugType.severity,
          category: bugType.category,
          type: BugType.BUG,
          environment: {} as any,
          reproductionSteps: [],
          expectedBehavior: 'Works',
          actualBehavior: 'Broken'
        }, 'test-user');

        if (bugType.status !== 'open') {
          await bugTrackingService.updateBugReport(bug.id, {
            status: bugType.status as any
          });
        }
      }

      const statistics = await bugTrackingService.getBugStatistics();
      
      expect(statistics.total).toBe(4);
      expect(statistics.bySeverity.critical).toBe(1);
      expect(statistics.bySeverity.high).toBe(1);
      expect(statistics.bySeverity.medium).toBe(1);
      expect(statistics.bySeverity.low).toBe(1);
      expect(statistics.byCategory.data_integrity).toBe(1);
      expect(statistics.byCategory.functionality).toBe(1);
      expect(statistics.byCategory.ui_ux).toBe(1);
      expect(statistics.byCategory.performance).toBe(1);
      expect(statistics.criticalBugsOpen).toBe(1);
    });

    test('should find duplicate bugs', async () => {
      // Create original bug
      const originalBug = await bugTrackingService.createBugReport({
        title: 'Component Connection Error',
        description: 'Cannot connect pipe to plenum',
        severity: BugSeverity.HIGH,
        category: BugCategory.FUNCTIONALITY,
        type: BugType.BUG,
        environment: {} as any,
        reproductionSteps: [],
        expectedBehavior: 'Connection works',
        actualBehavior: 'Connection fails',
        errorMessage: 'Invalid connection type',
        componentIds: ['pipe_1', 'plenum_1'],
        tags: ['connection', 'validation']
      }, 'user1');

      // Create similar bug
      const similarBug = await bugTrackingService.createBugReport({
        title: 'Pipe Connection Issue',
        description: 'Pipe cannot be connected to plenum component',
        severity: BugSeverity.MEDIUM,
        category: BugCategory.FUNCTIONALITY,
        type: BugType.BUG,
        environment: {} as any,
        reproductionSteps: [],
        expectedBehavior: 'Connection should work',
        actualBehavior: 'Connection does not work',
        errorMessage: 'Invalid connection type',
        componentIds: ['pipe_2', 'plenum_1'],
        tags: ['connection']
      }, 'user2');

      const duplicates = await bugTrackingService.findDuplicateBugs(similarBug);
      
      expect(duplicates.length).toBeGreaterThan(0);
      expect(duplicates[0].id).toBe(originalBug.id);
    });
  });

  describe('Environment Collection', () => {
    test('should collect environment information correctly', () => {
      const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36';
      
      const environment = BugTrackingService.collectEnvironmentInfo(userAgent, {
        screenResolution: '1920x1080',
        deviceType: 'desktop'
      });

      expect(environment.browser).toBe('Chrome');
      expect(environment.browserVersion).toBe('91.0.4472.124');
      expect(environment.os).toBe('Windows');
      expect(environment.osVersion).toBe('10.0');
      expect(environment.screenResolution).toBe('1920x1080');
      expect(environment.deviceType).toBe('desktop');
      expect(environment.userAgent).toBe(userAgent);
      expect(environment.timestamp).toBeDefined();
    });
  });
});