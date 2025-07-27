const express = require("express");
const TodoController = require("../controllers/todoController");
const {
  rateLimits,
  authenticateToken,
  validationRules,
  handleValidationErrors,
  xssProtection,
  sqlInjectionProtection,
} = require("../middleware/security");
const redisManager = require("../config/redis");

const router = express.Router();

// Apply security middleware to all todo routes
router.use(xssProtection);
router.use(sqlInjectionProtection);

// All todo routes require authentication
router.use(authenticateToken);

// Apply general rate limiting to all routes
router.use(rateLimits.api);

/**
 * @swagger
 * components:
 *   schemas:
 *     Todo:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *           description: Unique todo identifier
 *         userId:
 *           type: integer
 *           description: ID of the user who owns this todo
 *         title:
 *           type: string
 *           description: Todo title
 *         description:
 *           type: string
 *           description: Todo description
 *         completed:
 *           type: boolean
 *           description: Whether the todo is completed
 *         priority:
 *           type: integer
 *           enum: [1, 2, 3]
 *           description: Priority level (1=Low, 2=Medium, 3=High)
 *         category:
 *           type: string
 *           description: Todo category
 *         dueDate:
 *           type: string
 *           format: date-time
 *           description: Due date for the todo
 *         tags:
 *           type: array
 *           items:
 *             type: string
 *           description: Array of tags
 *         metadata:
 *           type: object
 *           description: Additional metadata
 *         position:
 *           type: integer
 *           description: Position for ordering
 *         createdAt:
 *           type: string
 *           format: date-time
 *         updatedAt:
 *           type: string
 *           format: date-time
 *     CreateTodoRequest:
 *       type: object
 *       required:
 *         - title
 *       properties:
 *         title:
 *           type: string
 *           minLength: 1
 *           maxLength: 255
 *           description: Todo title
 *         description:
 *           type: string
 *           maxLength: 1000
 *           description: Todo description
 *         priority:
 *           type: integer
 *           enum: [1, 2, 3]
 *           default: 1
 *           description: Priority level
 *         category:
 *           type: string
 *           maxLength: 50
 *           description: Todo category
 *         dueDate:
 *           type: string
 *           format: date-time
 *           description: Due date
 *         tags:
 *           type: array
 *           items:
 *             type: string
 *           description: Array of tags
 *         metadata:
 *           type: object
 *           description: Additional metadata
 *     UpdateTodoRequest:
 *       type: object
 *       properties:
 *         title:
 *           type: string
 *           minLength: 1
 *           maxLength: 255
 *         description:
 *           type: string
 *           maxLength: 1000
 *         completed:
 *           type: boolean
 *         priority:
 *           type: integer
 *           enum: [1, 2, 3]
 *         category:
 *           type: string
 *           maxLength: 50
 *         dueDate:
 *           type: string
 *           format: date-time
 *         tags:
 *           type: array
 *           items:
 *             type: string
 *         metadata:
 *           type: object
 *     TodoResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *         message:
 *           type: string
 *         data:
 *           $ref: '#/components/schemas/Todo'
 *     TodoListResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *         message:
 *           type: string
 *         data:
 *           type: object
 *           properties:
 *             todos:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Todo'
 *             pagination:
 *               type: object
 *               properties:
 *                 page:
 *                   type: integer
 *                 limit:
 *                   type: integer
 *                 total:
 *                   type: integer
 *                 pages:
 *                   type: integer
 */

// Main CRUD operations

/**
 * @swagger
 * /api/todos:
 *   post:
 *     summary: Create a new todo
 *     description: Create a new todo item for the authenticated user
 *     tags: [Todos]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateTodoRequest'
 *           example:
 *             title: "Complete project documentation"
 *             description: "Write comprehensive API documentation"
 *             priority: 2
 *             category: "work"
 *             dueDate: "2024-12-31T23:59:59Z"
 *             tags: ["documentation", "api"]
 *     responses:
 *       201:
 *         description: Todo created successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/TodoResponse'
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post(
  "/",
  validationRules.createTodo,
  handleValidationErrors,
  TodoController.createTodo,
);

/**
 * @swagger
 * /api/todos:
 *   get:
 *     summary: Get all todos
 *     description: Retrieve todos with filtering, pagination, and sorting
 *     tags: [Todos]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           minimum: 1
 *           default: 1
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 20
 *         description: Items per page
 *       - in: query
 *         name: completed
 *         schema:
 *           type: boolean
 *         description: Filter by completion status
 *       - in: query
 *         name: priority
 *         schema:
 *           type: integer
 *           enum: [1, 2, 3]
 *         description: Filter by priority
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *         description: Filter by category
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search in title and description
 *       - in: query
 *         name: sortBy
 *         schema:
 *           type: string
 *           enum: [createdAt, updatedAt, title, priority, dueDate]
 *           default: createdAt
 *         description: Sort field
 *       - in: query
 *         name: sortOrder
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *           default: desc
 *         description: Sort order
 *     responses:
 *       200:
 *         description: Todos retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/TodoListResponse'
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get(
  "/",
  redisManager.cacheMiddleware(120), // Cache for 2 minutes
  validationRules.getTodos,
  handleValidationErrors,
  TodoController.getTodos,
);

/**
 * @swagger
 * /api/todos/stats:
 *   get:
 *     summary: Get todo statistics
 *     description: Get comprehensive statistics about user's todos
 *     tags: [Todos]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Statistics retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     total:
 *                       type: integer
 *                     completed:
 *                       type: integer
 *                     pending:
 *                       type: integer
 *                     overdue:
 *                       type: integer
 *                     highPriority:
 *                       type: integer
 *                     completionRate:
 *                       type: number
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get(
  "/stats",
  redisManager.cacheMiddleware(300), // Cache for 5 minutes
  TodoController.getTodoStats,
);

/**
 * @swagger
 * /api/todos/categories:
 *   get:
 *     summary: Get user's categories
 *     description: Get all categories used by the user
 *     tags: [Todos]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Categories retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     type: string
 *       401:
 *         description: Unauthorized
 */
router.get(
  "/categories",
  redisManager.cacheMiddleware(600), // Cache for 10 minutes
  TodoController.getCategories,
);

/**
 * @swagger
 * /api/todos/tags:
 *   get:
 *     summary: Get user's tags
 *     description: Get all tags used by the user
 *     tags: [Todos]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Tags retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     type: string
 *       401:
 *         description: Unauthorized
 */
router.get(
  "/tags",
  redisManager.cacheMiddleware(600), // Cache for 10 minutes
  TodoController.getTags,
);

// Get overdue todos
router.get(
  "/overdue",
  redisManager.cacheMiddleware(300), // Cache for 5 minutes
  TodoController.getOverdueTodos,
);

// Get upcoming todos
router.get(
  "/upcoming",
  redisManager.cacheMiddleware(1800), // Cache for 30 minutes
  [
    require("express-validator")
      .query("days")
      .optional()
      .isInt({ min: 1, max: 365 })
      .withMessage("Days must be between 1 and 365"),
  ],
  handleValidationErrors,
  TodoController.getUpcomingTodos,
);

// Bulk operations

// Bulk update todos
router.put(
  "/bulk",
  [
    require("express-validator")
      .body("todoIds")
      .isArray({ min: 1 })
      .withMessage("todoIds must be a non-empty array"),
    require("express-validator")
      .body("todoIds.*")
      .isUUID()
      .withMessage("Each todoId must be a valid UUID"),
    require("express-validator")
      .body("updateData")
      .isObject()
      .withMessage("updateData must be an object"),
    require("express-validator")
      .body("updateData.completed")
      .optional()
      .isBoolean()
      .withMessage("completed must be a boolean"),
    require("express-validator")
      .body("updateData.priority")
      .optional()
      .isInt({ min: 1, max: 3 })
      .withMessage("priority must be 1, 2, or 3"),
    require("express-validator")
      .body("updateData.category")
      .optional()
      .isLength({ max: 50 })
      .matches(/^[a-zA-Z0-9\s_-]+$/)
      .withMessage(
        "category must be alphanumeric with spaces, underscores, or hyphens",
      ),
    require("express-validator")
      .body("updateData.dueDate")
      .optional()
      .isISO8601()
      .withMessage("dueDate must be a valid ISO 8601 date"),
  ],
  handleValidationErrors,
  TodoController.bulkUpdateTodos,
);

// Bulk delete todos
router.delete(
  "/bulk",
  [
    require("express-validator")
      .body("todoIds")
      .isArray({ min: 1 })
      .withMessage("todoIds must be a non-empty array"),
    require("express-validator")
      .body("todoIds.*")
      .isUUID()
      .withMessage("Each todoId must be a valid UUID"),
  ],
  handleValidationErrors,
  TodoController.bulkDeleteTodos,
);

// Reorder todos
router.put(
  "/reorder",
  [
    require("express-validator")
      .body("todoIds")
      .isArray({ min: 1 })
      .withMessage("todoIds must be a non-empty array"),
    require("express-validator")
      .body("todoIds.*")
      .isUUID()
      .withMessage("Each todoId must be a valid UUID"),
  ],
  handleValidationErrors,
  TodoController.reorderTodos,
);

// Individual todo operations

// Get a specific todo by ID
router.get(
  "/:id",
  validationRules.uuidParam,
  handleValidationErrors,
  TodoController.getTodoById,
);

// Update a specific todo
/**
 * @swagger
 * /api/todos/{id}:
 *   put:
 *     summary: Update a todo
 *     description: Update an existing todo
 *     tags: [Todos]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Todo ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateTodoRequest'
 *     responses:
 *       200:
 *         description: Todo updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/TodoResponse'
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Todo not found
 */
router.put(
  "/:id",
  validationRules.updateTodo,
  handleValidationErrors,
  TodoController.updateTodo,
);

// Delete a specific todo
router.delete(
  "/:id",
  validationRules.uuidParam,
  handleValidationErrors,
  TodoController.deleteTodo,
);

// Toggle todo completion status
router.patch(
  "/:id/toggle",
  validationRules.uuidParam,
  handleValidationErrors,
  TodoController.toggleTodo,
);

/**
 * @swagger
 * /api/todos/{id}/duplicate:
 *   post:
 *     summary: Duplicate a todo
 *     description: Create a duplicate of an existing todo
 *     tags: [Todos]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Todo ID to duplicate
 *     responses:
 *       201:
 *         description: Todo duplicated successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/TodoResponse'
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Todo not found
 */
router.post(
  "/:id/duplicate",
  validationRules.uuidParam,
  handleValidationErrors,
  TodoController.duplicateTodo,
);

// Tag management

// Add tag to todo
router.post(
  "/:id/tags",
  validationRules.uuidParam,
  [
    require("express-validator")
      .body("tag")
      .notEmpty()
      .isLength({ max: 30 })
      .matches(/^[a-zA-Z0-9_-]+$/)
      .withMessage(
        "Tag must be alphanumeric with underscores or hyphens and max 30 characters",
      ),
  ],
  handleValidationErrors,
  TodoController.addTagToTodo,
);

// Remove tag from todo
router.delete(
  "/:id/tags",
  validationRules.uuidParam,
  [
    require("express-validator")
      .body("tag")
      .notEmpty()
      .isLength({ max: 30 })
      .matches(/^[a-zA-Z0-9_-]+$/)
      .withMessage(
        "Tag must be alphanumeric with underscores or hyphens and max 30 characters",
      ),
  ],
  handleValidationErrors,
  TodoController.removeTagFromTodo,
);

/**
 * @swagger
 * /api/todos/health:
 *   get:
 *     summary: Health check
 *     description: Check if the todos service is healthy
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: Service is healthy
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Todos service is healthy"
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 */
router.get("/health", rateLimits.general, (req, res) => {
  res.json({
    success: true,
    message: "Todos service is healthy",
    timestamp: new Date().toISOString(),
  });
});

// Error handling middleware for this router
router.use((error, req, res, next) => {
  const logger = require("../config/logger");

  logger.error("Todo route error:", {
    error: error.message,
    stack: error.stack,
    url: req.originalUrl,
    method: req.method,
    userId: req.user?.id,
    body: req.body,
    params: req.params,
    query: req.query,
  });

  // Don't expose internal errors in production
  const isDevelopment = process.env.NODE_ENV === "development";

  res.status(error.status || 500).json({
    success: false,
    error: isDevelopment ? error.message : "Internal server error",
    code: error.code || "INTERNAL_ERROR",
    ...(isDevelopment && { stack: error.stack }),
  });
});

module.exports = router;
