const Todo = require('../models/Todo');
const User = require('../models/User');
const logger = require('../config/logger');
const redisManager = require('../config/redis');
const { validationResult } = require('express-validator');

class TodoController {
  // Create a new todo
  static async createTodo(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: errors.array()
        });
      }

      const {
        title,
        description,
        priority,
        category,
        dueDate,
        tags,
        metadata,
        position
      } = req.body;

      const todo = await Todo.create({
        title,
        description,
        priority,
        category,
        dueDate,
        tags,
        metadata,
        position
      }, req.user.id);

      logger.info('Todo created successfully', {
        todoId: todo.id,
        userId: req.user.id,
        title: todo.title
      });

      res.status(201).json({
        success: true,
        message: 'Todo created successfully',
        data: { todo }
      });

    } catch (error) {
      logger.error('Create todo error:', {
        error: error.message,
        userId: req.user?.id,
        body: req.body
      });

      res.status(500).json({
        success: false,
        error: 'Failed to create todo',
        code: 'CREATE_TODO_ERROR'
      });
    }
  }

  // Get all todos for the current user
  static async getTodos(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: errors.array()
        });
      }

      const {
        page = 1,
        limit = 20,
        completed,
        priority,
        category,
        search,
        sortBy = 'created_at',
        sortOrder = 'desc',
        dueBefore,
        dueAfter,
        tags
      } = req.query;

      // Parse tags if provided
      let parsedTags;
      if (tags) {
        try {
          parsedTags = Array.isArray(tags) ? tags : tags.split(',');
        } catch (e) {
          parsedTags = undefined;
        }
      }

      const options = {
        page: parseInt(page),
        limit: parseInt(limit),
        completed: completed !== undefined ? completed === 'true' : undefined,
        priority: priority ? parseInt(priority) : undefined,
        category,
        search,
        sortBy,
        sortOrder,
        dueBefore: dueBefore ? new Date(dueBefore) : undefined,
        dueAfter: dueAfter ? new Date(dueAfter) : undefined,
        tags: parsedTags
      };

      const result = await Todo.findByUser(req.user.id, options);

      res.json({
        success: true,
        data: result
      });

    } catch (error) {
      logger.error('Get todos error:', {
        error: error.message,
        userId: req.user?.id,
        query: req.query
      });

      res.status(500).json({
        success: false,
        error: 'Failed to get todos',
        code: 'GET_TODOS_ERROR'
      });
    }
  }

  // Get a specific todo by ID
  static async getTodoById(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: errors.array()
        });
      }

      const { id } = req.params;

      const todo = await Todo.findById(id, req.user.id);

      if (!todo) {
        return res.status(404).json({
          success: false,
          error: 'Todo not found',
          code: 'TODO_NOT_FOUND'
        });
      }

      res.json({
        success: true,
        data: { todo }
      });

    } catch (error) {
      logger.error('Get todo by ID error:', {
        error: error.message,
        todoId: req.params?.id,
        userId: req.user?.id
      });

      res.status(500).json({
        success: false,
        error: 'Failed to get todo',
        code: 'GET_TODO_ERROR'
      });
    }
  }

  // Update a todo
  static async updateTodo(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: errors.array()
        });
      }

      const { id } = req.params;
      const updateData = req.body;

      const todo = await Todo.findById(id, req.user.id);

      if (!todo) {
        return res.status(404).json({
          success: false,
          error: 'Todo not found',
          code: 'TODO_NOT_FOUND'
        });
      }

      await todo.update(updateData);

      logger.info('Todo updated successfully', {
        todoId: todo.id,
        userId: req.user.id,
        updateData
      });

      res.json({
        success: true,
        message: 'Todo updated successfully',
        data: { todo }
      });

    } catch (error) {
      logger.error('Update todo error:', {
        error: error.message,
        todoId: req.params?.id,
        userId: req.user?.id,
        updateData: req.body
      });

      res.status(500).json({
        success: false,
        error: 'Failed to update todo',
        code: 'UPDATE_TODO_ERROR'
      });
    }
  }

  // Delete a todo
  static async deleteTodo(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: errors.array()
        });
      }

      const { id } = req.params;

      const todo = await Todo.findById(id, req.user.id);

      if (!todo) {
        return res.status(404).json({
          success: false,
          error: 'Todo not found',
          code: 'TODO_NOT_FOUND'
        });
      }

      await todo.delete();

      logger.info('Todo deleted successfully', {
        todoId: id,
        userId: req.user.id
      });

      res.json({
        success: true,
        message: 'Todo deleted successfully'
      });

    } catch (error) {
      logger.error('Delete todo error:', {
        error: error.message,
        todoId: req.params?.id,
        userId: req.user?.id
      });

      res.status(500).json({
        success: false,
        error: 'Failed to delete todo',
        code: 'DELETE_TODO_ERROR'
      });
    }
  }

  // Toggle todo completion status
  static async toggleTodo(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: errors.array()
        });
      }

      const { id } = req.params;

      const todo = await Todo.findById(id, req.user.id);

      if (!todo) {
        return res.status(404).json({
          success: false,
          error: 'Todo not found',
          code: 'TODO_NOT_FOUND'
        });
      }

      await todo.toggleComplete();

      logger.info('Todo toggled successfully', {
        todoId: todo.id,
        userId: req.user.id,
        completed: todo.completed
      });

      res.json({
        success: true,
        message: `Todo marked as ${todo.completed ? 'completed' : 'incomplete'}`,
        data: { todo }
      });

    } catch (error) {
      logger.error('Toggle todo error:', {
        error: error.message,
        todoId: req.params?.id,
        userId: req.user?.id
      });

      res.status(500).json({
        success: false,
        error: 'Failed to toggle todo',
        code: 'TOGGLE_TODO_ERROR'
      });
    }
  }

  // Duplicate a todo
  static async duplicateTodo(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: errors.array()
        });
      }

      const { id } = req.params;

      const todo = await Todo.findById(id, req.user.id);

      if (!todo) {
        return res.status(404).json({
          success: false,
          error: 'Todo not found',
          code: 'TODO_NOT_FOUND'
        });
      }

      const duplicatedTodo = await todo.duplicate();

      logger.info('Todo duplicated successfully', {
        originalTodoId: todo.id,
        duplicatedTodoId: duplicatedTodo.id,
        userId: req.user.id
      });

      res.status(201).json({
        success: true,
        message: 'Todo duplicated successfully',
        data: { todo: duplicatedTodo }
      });

    } catch (error) {
      logger.error('Duplicate todo error:', {
        error: error.message,
        todoId: req.params?.id,
        userId: req.user?.id
      });

      res.status(500).json({
        success: false,
        error: 'Failed to duplicate todo',
        code: 'DUPLICATE_TODO_ERROR'
      });
    }
  }

  // Bulk update todos
  static async bulkUpdateTodos(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: errors.array()
        });
      }

      const { todoIds, updateData } = req.body;

      if (!Array.isArray(todoIds) || todoIds.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'todoIds must be a non-empty array',
          code: 'INVALID_TODO_IDS'
        });
      }

      if (!updateData || Object.keys(updateData).length === 0) {
        return res.status(400).json({
          success: false,
          error: 'updateData is required',
          code: 'INVALID_UPDATE_DATA'
        });
      }

      const updatedTodos = await Todo.bulkUpdate(todoIds, req.user.id, updateData);

      logger.info('Bulk todo update completed', {
        userId: req.user.id,
        todoCount: updatedTodos.length,
        updateData
      });

      res.json({
        success: true,
        message: `${updatedTodos.length} todos updated successfully`,
        data: { todos: updatedTodos }
      });

    } catch (error) {
      logger.error('Bulk update todos error:', {
        error: error.message,
        userId: req.user?.id,
        body: req.body
      });

      res.status(500).json({
        success: false,
        error: 'Failed to bulk update todos',
        code: 'BULK_UPDATE_ERROR'
      });
    }
  }

  // Bulk delete todos
  static async bulkDeleteTodos(req, res) {
    try {
      const { todoIds } = req.body;

      if (!Array.isArray(todoIds) || todoIds.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'todoIds must be a non-empty array',
          code: 'INVALID_TODO_IDS'
        });
      }

      const result = await Todo.bulkDelete(todoIds, req.user.id);

      logger.info('Bulk todo deletion completed', {
        userId: req.user.id,
        deletedCount: result.deletedCount,
        deletedIds: result.deletedIds
      });

      res.json({
        success: true,
        message: `${result.deletedCount} todos deleted successfully`,
        data: { deletedCount: result.deletedCount }
      });

    } catch (error) {
      logger.error('Bulk delete todos error:', {
        error: error.message,
        userId: req.user?.id,
        body: req.body
      });

      res.status(500).json({
        success: false,
        error: 'Failed to bulk delete todos',
        code: 'BULK_DELETE_ERROR'
      });
    }
  }

  // Reorder todos
  static async reorderTodos(req, res) {
    try {
      const { todoIds } = req.body;

      if (!Array.isArray(todoIds) || todoIds.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'todoIds must be a non-empty array',
          code: 'INVALID_TODO_IDS'
        });
      }

      await Todo.reorderTodos(req.user.id, todoIds);

      logger.info('Todos reordered successfully', {
        userId: req.user.id,
        todoIds
      });

      res.json({
        success: true,
        message: 'Todos reordered successfully'
      });

    } catch (error) {
      logger.error('Reorder todos error:', {
        error: error.message,
        userId: req.user?.id,
        body: req.body
      });

      res.status(500).json({
        success: false,
        error: 'Failed to reorder todos',
        code: 'REORDER_ERROR'
      });
    }
  }

  // Get user's categories
  static async getCategories(req, res) {
    try {
      const categories = await Todo.getUserCategories(req.user.id);

      res.json({
        success: true,
        data: { categories }
      });

    } catch (error) {
      logger.error('Get categories error:', {
        error: error.message,
        userId: req.user?.id
      });

      res.status(500).json({
        success: false,
        error: 'Failed to get categories',
        code: 'GET_CATEGORIES_ERROR'
      });
    }
  }

  // Get user's tags
  static async getTags(req, res) {
    try {
      const tags = await Todo.getUserTags(req.user.id);

      res.json({
        success: true,
        data: { tags }
      });

    } catch (error) {
      logger.error('Get tags error:', {
        error: error.message,
        userId: req.user?.id
      });

      res.status(500).json({
        success: false,
        error: 'Failed to get tags',
        code: 'GET_TAGS_ERROR'
      });
    }
  }

  // Get overdue todos
  static async getOverdueTodos(req, res) {
    try {
      const overdueTodos = await Todo.getOverdueTodos(req.user.id);

      res.json({
        success: true,
        data: {
          todos: overdueTodos,
          count: overdueTodos.length
        }
      });

    } catch (error) {
      logger.error('Get overdue todos error:', {
        error: error.message,
        userId: req.user?.id
      });

      res.status(500).json({
        success: false,
        error: 'Failed to get overdue todos',
        code: 'GET_OVERDUE_ERROR'
      });
    }
  }

  // Get upcoming todos
  static async getUpcomingTodos(req, res) {
    try {
      const { days = 7 } = req.query;
      const upcomingTodos = await Todo.getUpcomingTodos(req.user.id, parseInt(days));

      res.json({
        success: true,
        data: {
          todos: upcomingTodos,
          count: upcomingTodos.length,
          days: parseInt(days)
        }
      });

    } catch (error) {
      logger.error('Get upcoming todos error:', {
        error: error.message,
        userId: req.user?.id
      });

      res.status(500).json({
        success: false,
        error: 'Failed to get upcoming todos',
        code: 'GET_UPCOMING_ERROR'
      });
    }
  }

  // Get todo statistics
  static async getTodoStats(req, res) {
    try {
      const user = await User.findById(req.user.id);
      if (!user) {
        return res.status(404).json({
          success: false,
          error: 'User not found',
          code: 'USER_NOT_FOUND'
        });
      }

      const stats = await user.getStats();

      // Get additional stats
      const [overdueTodos, upcomingTodos] = await Promise.all([
        Todo.getOverdueTodos(req.user.id),
        Todo.getUpcomingTodos(req.user.id, 7)
      ]);

      const extendedStats = {
        ...stats,
        overdueCount: overdueTodos.length,
        upcomingCount: upcomingTodos.length
      };

      res.json({
        success: true,
        data: { stats: extendedStats }
      });

    } catch (error) {
      logger.error('Get todo stats error:', {
        error: error.message,
        userId: req.user?.id
      });

      res.status(500).json({
        success: false,
        error: 'Failed to get todo statistics',
        code: 'GET_STATS_ERROR'
      });
    }
  }

  // Add tag to todo
  static async addTagToTodo(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: errors.array()
        });
      }

      const { id } = req.params;
      const { tag } = req.body;

      if (!tag || typeof tag !== 'string') {
        return res.status(400).json({
          success: false,
          error: 'Tag is required and must be a string',
          code: 'INVALID_TAG'
        });
      }

      const todo = await Todo.findById(id, req.user.id);

      if (!todo) {
        return res.status(404).json({
          success: false,
          error: 'Todo not found',
          code: 'TODO_NOT_FOUND'
        });
      }

      await todo.addTag(tag);

      logger.info('Tag added to todo', {
        todoId: todo.id,
        userId: req.user.id,
        tag
      });

      res.json({
        success: true,
        message: 'Tag added successfully',
        data: { todo }
      });

    } catch (error) {
      logger.error('Add tag to todo error:', {
        error: error.message,
        todoId: req.params?.id,
        userId: req.user?.id
      });

      res.status(500).json({
        success: false,
        error: 'Failed to add tag',
        code: 'ADD_TAG_ERROR'
      });
    }
  }

  // Remove tag from todo
  static async removeTagFromTodo(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: errors.array()
        });
      }

      const { id } = req.params;
      const { tag } = req.body;

      if (!tag || typeof tag !== 'string') {
        return res.status(400).json({
          success: false,
          error: 'Tag is required and must be a string',
          code: 'INVALID_TAG'
        });
      }

      const todo = await Todo.findById(id, req.user.id);

      if (!todo) {
        return res.status(404).json({
          success: false,
          error: 'Todo not found',
          code: 'TODO_NOT_FOUND'
        });
      }

      await todo.removeTag(tag);

      logger.info('Tag removed from todo', {
        todoId: todo.id,
        userId: req.user.id,
        tag
      });

      res.json({
        success: true,
        message: 'Tag removed successfully',
        data: { todo }
      });

    } catch (error) {
      logger.error('Remove tag from todo error:', {
        error: error.message,
        todoId: req.params?.id,
        userId: req.user?.id
      });

      res.status(500).json({
        success: false,
        error: 'Failed to remove tag',
        code: 'REMOVE_TAG_ERROR'
      });
    }
  }
}

module.exports = TodoController;
