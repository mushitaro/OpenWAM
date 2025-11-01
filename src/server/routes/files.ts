import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs/promises';
import { DatabaseManager } from '../database/DatabaseManager';
import { asyncHandler } from '../middleware/errorHandler';
import { AppError, ErrorCode, ErrorSeverity } from '../../shared/errors/AppError';
import { createError } from '../utils/errorHelpers';
import { logger } from '../utils/logger';
import { openWAMFileService } from '../../shared/services/openWAMFileService';
import { resultAnalysisService } from '../../shared/services/resultAnalysisService';

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../../../uploads');
    await fs.mkdir(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

// Enhanced file validation function
async function validateWAMFile(filePath: string): Promise<{ isValid: boolean; errors: string[] }> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return openWAMFileService.validateWAMFile(content);
  } catch (error) {
    return { isValid: false, errors: ['Failed to read file content'] };
  }
}

const upload = multer({
  storage,
  limits: {
    fileSize: 100 * 1024 * 1024 // 100MB limit for large simulation files
  },
  fileFilter: (req, file, cb) => {
    // Allow .wam files and common text/data formats
    const allowedExtensions = ['.wam', '.txt', '.csv', '.json', '.dat', '.log'];
    const ext = path.extname(file.originalname).toLowerCase();
    
    if (allowedExtensions.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${ext} not allowed. Allowed types: ${allowedExtensions.join(', ')}`));
    }
  }
});

export function fileRoutes(dbManager: DatabaseManager): Router {
  const router = Router();

  // POST /api/files/upload - Upload file with enhanced validation
  router.post('/upload', upload.single('file'), asyncHandler(async (req, res) => {
    if (!req.file) {
      throw createError('No file uploaded', 400, 'NO_FILE');
    }

    const { projectId } = req.body;
    if (!projectId) {
      // Clean up uploaded file if no project ID
      await fs.unlink(req.file.path).catch(() => {});
      throw createError('Project ID is required', 400, 'VALIDATION_ERROR');
    }

    // Verify project exists
    try {
      await dbManager.getProject(parseInt(projectId));
    } catch (error) {
      // Clean up uploaded file if project doesn't exist
      await fs.unlink(req.file.path).catch(() => {});
      throw createError('Project not found', 404, 'PROJECT_NOT_FOUND');
    }

    // Enhanced validation for .wam files
    const ext = path.extname(req.file.originalname).toLowerCase();
    if (ext === '.wam') {
      const validation = await validateWAMFile(req.file.path);
      if (!validation.isValid) {
        // Clean up invalid file
        await fs.unlink(req.file.path).catch(() => {});
        throw createError(
          `Invalid .wam file format: ${validation.errors.join(', ')}`,
          400,
          'INVALID_WAM_FILE'
        );
      }
    }

    // Create file record in database
    const fileRecord = await dbManager.createFileRecord(
      parseInt(projectId),
      req.file.originalname,
      req.file.path,
      req.file.mimetype,
      req.file.size
    );

    logger.info(`File uploaded: ${fileRecord.filename} for project ${projectId}`);
    
    res.status(201).json({
      id: fileRecord.id,
      filename: fileRecord.filename,
      size: fileRecord.file_size,
      type: fileRecord.file_type,
      uploadedAt: fileRecord.uploaded_at,
      isValid: ext === '.wam' ? true : undefined
    });
  }));

  // GET /api/files/:id/download - Download file
  router.get('/:id/download', asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      throw createError('Invalid file ID', 400, 'INVALID_ID');
    }

    try {
      const fileRecord = await dbManager.getFileRecord(id);
      
      // Check if file exists on disk
      try {
        await fs.access(fileRecord.file_path);
      } catch (error) {
        throw createError('File not found on disk', 404, 'FILE_NOT_FOUND');
      }

      res.download(fileRecord.file_path, fileRecord.filename);
    } catch (error: any) {
      if (error.message && error.message.includes('not found')) {
        throw createError('File not found', 404, 'FILE_NOT_FOUND');
      }
      throw error;
    }
  }));

  // GET /api/projects/:projectId/files - List project files
  router.get('/projects/:projectId/files', asyncHandler(async (req, res) => {
    const projectId = parseInt(req.params.projectId);
    if (isNaN(projectId)) {
      throw createError('Invalid project ID', 400, 'INVALID_ID');
    }

    // Verify project exists
    try {
      await dbManager.getProject(projectId);
    } catch (error) {
      throw createError('Project not found', 404, 'PROJECT_NOT_FOUND');
    }

    const files = await dbManager.getProjectFiles(projectId);
    
    res.json({
      files: files.map(file => ({
        id: file.id,
        filename: file.filename,
        size: file.file_size,
        type: file.file_type,
        uploadedAt: file.uploaded_at
      }))
    });
  }));

  // POST /api/files/:id/export - Export result file in different formats
  router.post('/:id/export', asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id);
    const { format } = req.body;
    
    if (isNaN(id)) {
      throw createError('Invalid file ID', 400, 'INVALID_ID');
    }

    if (!format || !['csv', 'json', 'wam'].includes(format)) {
      throw createError('Invalid export format. Supported: csv, json, wam', 400, 'INVALID_FORMAT');
    }

    try {
      const fileRecord = await dbManager.getFileRecord(id);
      
      // Check if file exists on disk
      try {
        await fs.access(fileRecord.file_path);
      } catch (error) {
        throw createError('File not found on disk', 404, 'FILE_NOT_FOUND');
      }

      // Read and convert file based on format
      const content = await fs.readFile(fileRecord.file_path, 'utf-8');
      let exportedContent: string;
      let mimeType: string;
      let filename: string;

      switch (format) {
        case 'csv':
          // Convert to CSV format
          if (fileRecord.filename.endsWith('.wam')) {
            const results = resultAnalysisService.parseResultsFromContent(content);
            exportedContent = resultAnalysisService.exportToCSV(results);
          } else {
            exportedContent = content; // Already CSV or compatible
          }
          mimeType = 'text/csv';
          filename = path.basename(fileRecord.filename, path.extname(fileRecord.filename)) + '.csv';
          break;

        case 'json':
          // Convert to JSON format
          if (fileRecord.filename.endsWith('.wam')) {
            const results = resultAnalysisService.parseResultsFromContent(content);
            exportedContent = JSON.stringify(results, null, 2);
          } else {
            // Try to parse as CSV and convert to JSON
            try {
              const results = resultAnalysisService.parseCSVResults(content);
              exportedContent = JSON.stringify(results, null, 2);
            } catch {
              exportedContent = JSON.stringify({ rawContent: content }, null, 2);
            }
          }
          mimeType = 'application/json';
          filename = path.basename(fileRecord.filename, path.extname(fileRecord.filename)) + '.json';
          break;

        case 'wam':
          // Keep original WAM format or convert if possible
          exportedContent = content;
          mimeType = 'text/plain';
          filename = path.basename(fileRecord.filename, path.extname(fileRecord.filename)) + '.wam';
          break;

        default:
          throw createError('Unsupported export format', 400, 'INVALID_FORMAT');
      }

      // Set response headers for download
      res.setHeader('Content-Type', mimeType);
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(exportedContent);

      logger.info(`File exported: ${fileRecord.filename} as ${format} format`);
    } catch (error: any) {
      if (error.message && error.message.includes('not found')) {
        throw createError('File not found', 404, 'FILE_NOT_FOUND');
      }
      throw error;
    }
  }));

  // GET /api/files/:id/parse - Parse file for model import
  router.get('/:id/parse', asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      throw createError('Invalid file ID', 400, 'INVALID_ID');
    }

    try {
      const fileRecord = await dbManager.getFileRecord(id);
      
      // Check if file exists on disk
      try {
        await fs.access(fileRecord.file_path);
      } catch (error) {
        throw createError('File not found on disk', 404, 'FILE_NOT_FOUND');
      }

      // Read file content
      const content = await fs.readFile(fileRecord.file_path, 'utf-8');
      
      // Parse based on file type
      let modelData: any = {};
      
      if (fileRecord.filename.endsWith('.wam')) {
        // Parse WAM file and extract model components
        try {
          const validation = await validateWAMFile(fileRecord.file_path);
          if (validation.isValid) {
            // Create mock model data for testing
            modelData = {
              components: [
                {
                  id: `imported_cylinder_${Date.now()}`,
                  type: 'cylinder',
                  name: 'Imported Cylinder',
                  position: { x: 100, y: 100 },
                  properties: {
                    displacement: 500,
                    compressionRatio: 10.5,
                    valveTimings: {
                      intakeOpen: -20,
                      intakeClose: 60,
                      exhaustOpen: -60,
                      exhaustClose: 20
                    }
                  }
                },
                {
                  id: `imported_pipe_${Date.now()}`,
                  type: 'pipe',
                  name: 'Imported Pipe',
                  position: { x: 250, y: 100 },
                  properties: {
                    length: 1000,
                    diameter: 50,
                    roughness: 0.001
                  }
                }
              ],
              connections: [
                {
                  id: `connection_${Date.now()}`,
                  fromComponent: `imported_cylinder_${Date.now()}`,
                  toComponent: `imported_pipe_${Date.now()}`,
                  fromPort: 'exhaust',
                  toPort: 'inlet',
                  isValid: true
                }
              ],
              metadata: {
                importedFrom: fileRecord.filename,
                importedAt: new Date(),
                version: '1.0'
              }
            };
          } else {
            throw createError(`Invalid WAM file: ${validation.errors.join(', ')}`, 400, 'INVALID_WAM_FILE');
          }
        } catch (error) {
          logger.error('Error parsing WAM file:', error);
          throw createError('Failed to parse WAM file', 400, 'PARSE_ERROR');
        }
      } else {
        // For other file types, create a simple model
        modelData = {
          components: [
            {
              id: `imported_component_${Date.now()}`,
              type: 'generic',
              name: `Imported from ${fileRecord.filename}`,
              position: { x: 150, y: 150 },
              properties: {
                sourceFile: fileRecord.filename,
                fileType: path.extname(fileRecord.filename)
              }
            }
          ],
          connections: [],
          metadata: {
            importedFrom: fileRecord.filename,
            importedAt: new Date(),
            version: '1.0'
          }
        };
      }

      logger.info(`File parsed for model import: ${fileRecord.filename}`);
      res.json(modelData);
    } catch (error: any) {
      if (error.message && error.message.includes('not found')) {
        throw createError('File not found', 404, 'FILE_NOT_FOUND');
      }
      throw error;
    }
  }));

  // DELETE /api/files/:id - Delete file
  router.delete('/:id', asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      throw createError('Invalid file ID', 400, 'INVALID_ID');
    }

    try {
      const fileRecord = await dbManager.getFileRecord(id);
      
      // Delete file from disk
      await fs.unlink(fileRecord.file_path).catch(() => {
        logger.warn(`Could not delete file from disk: ${fileRecord.file_path}`);
      });

      // Delete record from database
      await dbManager.deleteFileRecord(id);
      
      logger.info(`File deleted: ${fileRecord.filename}`);
      res.status(204).send();
    } catch (error: any) {
      if (error.message && error.message.includes('not found')) {
        throw createError('File not found', 404, 'FILE_NOT_FOUND');
      }
      throw error;
    }
  }));

  return router;
}