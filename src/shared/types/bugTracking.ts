// Bug tracking system types

export enum BugSeverity {
  CRITICAL = 'critical',
  HIGH = 'high',
  MEDIUM = 'medium',
  LOW = 'low'
}

export enum BugStatus {
  OPEN = 'open',
  IN_PROGRESS = 'in_progress',
  RESOLVED = 'resolved',
  CLOSED = 'closed',
  DUPLICATE = 'duplicate',
  WONT_FIX = 'wont_fix'
}

export enum BugCategory {
  UI_UX = 'ui_ux',
  FUNCTIONALITY = 'functionality',
  PERFORMANCE = 'performance',
  BROWSER_COMPATIBILITY = 'browser_compatibility',
  FILE_OPERATIONS = 'file_operations',
  SIMULATION = 'simulation',
  VALIDATION = 'validation',
  CONNECTIVITY = 'connectivity',
  DATA_INTEGRITY = 'data_integrity',
  SECURITY = 'security'
}

export enum BugType {
  BUG = 'bug',
  ENHANCEMENT = 'enhancement',
  FEATURE_REQUEST = 'feature_request',
  PERFORMANCE_ISSUE = 'performance_issue',
  COMPATIBILITY_ISSUE = 'compatibility_issue'
}

export interface BugEnvironment {
  browser: string;
  browserVersion: string;
  os: string;
  osVersion: string;
  screenResolution: string;
  deviceType: 'desktop' | 'tablet' | 'mobile';
  userAgent: string;
  timestamp: string;
}

export interface BugReproductionStep {
  stepNumber: number;
  action: string;
  expectedResult?: string;
  actualResult?: string;
  screenshot?: string;
  notes?: string;
}

export interface BugAttachment {
  id: string;
  bugId: number;
  filename: string;
  filePath: string;
  fileType: 'screenshot' | 'video' | 'log' | 'model' | 'other';
  fileSize: number;
  uploadedAt: string;
  description?: string;
}

export interface PerformanceMetrics {
  loadTime?: number;
  renderTime?: number;
  memoryUsage?: number;
  cpuUsage?: number;
  networkRequests?: number;
  errorCount?: number;
  componentCount?: number;
  connectionCount?: number;
}

export interface BugReport {
  id: number;
  title: string;
  description: string;
  severity: BugSeverity;
  status: BugStatus;
  category: BugCategory;
  type: BugType;
  
  // Reporter information
  reportedBy: string;
  reportedAt: string;
  
  // Environment details
  environment: BugEnvironment;
  
  // Reproduction information
  reproductionSteps: BugReproductionStep[];
  expectedBehavior: string;
  actualBehavior: string;
  
  // Technical details
  errorMessage?: string;
  stackTrace?: string;
  consoleErrors?: string[];
  networkErrors?: string[];
  
  // Performance data (for performance issues)
  performanceMetrics?: PerformanceMetrics;
  
  // Attachments
  attachments: BugAttachment[];
  
  // Project context
  projectId?: number;
  modelData?: string;
  componentIds?: string[];
  
  // Resolution information
  assignedTo?: string;
  resolvedBy?: string;
  resolvedAt?: string;
  resolution?: string;
  resolutionNotes?: string;
  
  // Tracking
  duplicateOf?: number;
  relatedBugs?: number[];
  tags: string[];
  
  // Timestamps
  createdAt: string;
  updatedAt: string;
  
  // Priority calculation
  priorityScore: number;
  priorityFactors: PriorityFactors;
}

export interface PriorityFactors {
  severityWeight: number;
  userImpactWeight: number;
  frequencyWeight: number;
  businessImpactWeight: number;
  technicalComplexityWeight: number;
  
  // Calculated scores (0-10)
  severityScore: number;
  userImpactScore: number;
  frequencyScore: number;
  businessImpactScore: number;
  technicalComplexityScore: number;
  
  // Final priority score (0-100)
  totalScore: number;
}

export interface BugTemplate {
  id: string;
  name: string;
  description: string;
  category: BugCategory;
  type: BugType;
  defaultSeverity: BugSeverity;
  requiredFields: string[];
  template: {
    title: string;
    description: string;
    reproductionSteps: BugReproductionStep[];
    expectedBehavior: string;
    tags: string[];
  };
}

export interface BugStatistics {
  total: number;
  byStatus: Record<BugStatus, number>;
  bySeverity: Record<BugSeverity, number>;
  byCategory: Record<BugCategory, number>;
  byType: Record<BugType, number>;
  
  // Time-based statistics
  openedThisWeek: number;
  resolvedThisWeek: number;
  averageResolutionTime: number; // in hours
  
  // Performance metrics
  criticalBugsOpen: number;
  highPriorityBugsOpen: number;
  oldestOpenBug?: BugReport;
  
  // Browser compatibility
  browserIssues: Record<string, number>;
  performanceIssues: number;
}

export interface BugSearchFilters {
  status?: BugStatus[];
  severity?: BugSeverity[];
  category?: BugCategory[];
  type?: BugType[];
  reportedBy?: string;
  assignedTo?: string;
  projectId?: number;
  tags?: string[];
  dateRange?: {
    start: string;
    end: string;
  };
  textSearch?: string;
}

export interface BugComment {
  id: number;
  bugId: number;
  author: string;
  content: string;
  attachments?: BugAttachment[];
  createdAt: string;
  updatedAt: string;
}

// API request/response types
export interface CreateBugRequest {
  title: string;
  description: string;
  severity: BugSeverity;
  category: BugCategory;
  type: BugType;
  environment: BugEnvironment;
  reproductionSteps: BugReproductionStep[];
  expectedBehavior: string;
  actualBehavior: string;
  errorMessage?: string;
  stackTrace?: string;
  consoleErrors?: string[];
  performanceMetrics?: PerformanceMetrics;
  projectId?: number;
  modelData?: string;
  componentIds?: string[];
  tags?: string[];
}

export interface UpdateBugRequest {
  title?: string;
  description?: string;
  severity?: BugSeverity;
  status?: BugStatus;
  category?: BugCategory;
  type?: BugType;
  assignedTo?: string;
  resolution?: string;
  resolutionNotes?: string;
  tags?: string[];
}

export interface BugListResponse {
  bugs: BugReport[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}