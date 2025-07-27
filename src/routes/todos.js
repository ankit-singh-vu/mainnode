const express = require('express');
const TodoController = require('../controllers/todoController');
const {
  rateLimits,
  authenticateToken,
  validationRules,
  handleValidationErrors,
  xssProtection,
  sqlInjectionProtection
} = require('../middleware/security');
const redisManager = require('../config/redis');

const router = express.Router();

// Apply security middleware to all todo routes
router.use(xssProtection);
router.use(sqlInjectionProtection);

// All todo routes require authentication
router.use(authenticateToken);

// Apply general rate limiting to all routes
router.use(rateLimits.api);

// Main CRUD operations

// Create a new todo
router.post('/',
  validationRules.createTodo,
  handleValidationErrors,
  TodoController.createTodo
);

// Get all todos with filtering, pagination, and sorting
router.get('/',
  redisManager.cacheMiddleware(120), // Cache for 2 minutes
  validationRules.getTodos,
  handleValidationErrors,
  TodoController.getTodos
);

// Get todo statistics
router.get('/stats',
  redisManager.cacheMiddleware(300), // Cache for 5 minutes
  TodoController.getTodoStats
);

// Get user's categories
router.get('/categories',
  redisManager.cacheMiddleware(600), // Cache for 10 minutes
  TodoController.getCategories
);

// Get user's tags
router.get('/tags',
  redisManager.cacheMiddleware(600), // Cache for 10 minutes
  TodoController.getTags
);

// Get overdue todos
router.get('/overdue',
  redisManager.cacheMiddleware(300), // Cache for 5 minutes
  TodoController.getOverdueTodos
);

// Get upcoming todos
router.get('/upcoming',
  redisManager.cacheMiddleware(1800), // Cache for 30 minutes
  [
    require('express-validator').query('days')
      .optional()
      .isInt({ min: 1, max: 365 })
      .withMessage('Days must be between 1 and 365')
  ],
  handleValidationErrors,
  TodoController.getUpcomingTodos
);

// Bulk operations

// Bulk update todos
router.put('/bulk',
  [
    require('express-validator').body('todoIds')
      .isArray({ min: 1 })
      .withMessage('todoIds must be a non-empty array'),
    require('express-validator').body('todoIds.*')
      .isUUID()
      .withMessage('Each todoId must be a valid UUID'),
    require('express-validator').body('updateData')
      .isObject()
      .withMessage('updateData must be an object'),
    require('express-validator').body('updateData.completed')
      .optional()
      .isBoolean()
      .withMessage('completed must be a boolean'),
    require('express-validator').body('updateData.priority')
      .optional()
      .isInt({ min: 1, max: 3 })
      .withMessage('priority must be 1, 2, or 3'),
    require('express-validator').body('updateData.category')
      .optional()
      .isLength({ max: 50 })
      .matches(/^[a-zA-Z0-9\s_-]+$/)
      .withMessage('category must be alphanumeric with spaces, underscores, or hyphens'),
    require('express-validator').body('updateData.dueDate')
      .optional()
      .isISO8601()
      .withMessage('dueDate must be a valid ISO 8601 date')
  ],
  handleValidationErrors,
  TodoController.bulkUpdateTodos
);

// Bulk delete todos
router.delete('/bulk',
  [
    require('express-validator').body('todoIds')
      .isArray({ min: 1 })
      .withMessage('todoIds must be a non-empty array'),
    require('express-validator').body('todoIds.*')
      .isUUID()
      .withMessage('Each todoId must be a valid UUID')
  ],
  handleValidationErrors,
  TodoController.bulkDeleteTodos
);

// Reorder todos
router.put('/reorder',
  [
    require('express-validator').body('todoIds')
      .isArray({ min: 1 })
      .withMessage('todoIds must be a non-empty array'),
    require('express-validator').body('todoIds.*')
      .isUUID()
      .withMessage('Each todoId must be a valid UUID')
  ],
  handleValidationErrors,
  TodoController.reorderTodos
);

// Individual todo operations

// Get a specific todo by ID
router.get('/:id',
  validationRules.uuidParam,
  handleValidationErrors,
  TodoController.getTodoById
);

// Update a specific todo
router.put('/:id',
  validationRules.updateTodo,
  handleValidationErrors,
  TodoController.updateTodo
);

// Delete a specific todo
router.delete('/:id',
  validationRules.uuidParam,
  handleValidationErrors,
  TodoController.deleteTodo
);

// Toggle todo completion status
router.patch('/:id/toggle',
  validationRules.uuidParam,
  handleValidationErrors,
  TodoController.toggleTodo
);

// Duplicate a todo
router.post('/:id/duplicate',
  validationRules.uuidParam,
  handleValidationErrors,
  TodoController.duplicateTodo
);

// Tag management

// Add tag to todo
router.post('/:id/tags',
  validationRules.uuidParam,
  [
    require('express-validator').body('tag')
      .notEmpty()
      .isLength({ max: 30 })
      .matches(/^[a-zA-Z0-9_-]+$/)
      .withMessage('Tag must be alphanumeric with underscores or hyphens and max 30 characters')
  ],
  handleValidationErrors,
  TodoController.addTagToTodo
);

// Remove tag from todo
router.delete('/:id/tags',
  validationRules.uuidParam,
  [
    require('express-validator').body('tag')
      .notEmpty()
      .isLength({ max: 30 })
      .matches(/^[a-zA-Z0-9_-]+$/)
      .withMessage('Tag must be alphanumeric with underscores or hyphens and max 30 characters')
  ],
  handleValidationErrors,
  TodoController.removeTagFromTodo
);

// Health check endpoint for todos service
router.get('/health',
  (req, res) => {
    res.json({
      success: true,
      message: 'Todos service is healthy',
      userId: req.user.id,
      timestamp: new Date().toISOString()
    });
  }
);

// Error handling middleware for this router
router.use((error, req, res, next) => {
  const logger = require('../config/logger');

  logger.error('Todo route error:', {
    error: error.message,
    stack: error.stack,
    url: req.originalUrl,
    method: req.method,
    userId: req.user?.id,
    body: req.body,
    params: req.params,
    query: req.query
  });

  // Don't expose internal errors in production
  const isDevelopment = process.env.NODE_ENV === 'development';

  res.status(error.status || 500).json({
    success: false,
    error: isDevelopment ? error.message : 'Internal server error',
    code: error.code || 'INTERNAL_ERROR',
    ...(isDevelopment && { stack: error.stack })
  });
});

module.exports = router;
