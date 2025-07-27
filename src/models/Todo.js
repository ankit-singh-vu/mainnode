const { v4: uuidv4 } = require('uuid');
const { db, withTransaction } = require('../config/database');
const logger = require('../config/logger');
const redisManager = require('../config/redis');

class Todo {
  constructor(data) {
    this.id = data.id;
    this.userId = data.user_id;
    this.title = data.title;
    this.description = data.description;
    this.completed = data.completed;
    this.priority = data.priority;
    this.category = data.category;
    this.dueDate = data.due_date;
    this.completedAt = data.completed_at;
    this.tags = Array.isArray(data.tags) ? data.tags : JSON.parse(data.tags || '[]');
    this.metadata = typeof data.metadata === 'object' ? data.metadata : JSON.parse(data.metadata || '{}');
    this.position = data.position;
    this.createdAt = data.created_at;
    this.updatedAt = data.updated_at;
  }

  // Static methods for todo operations
  static async create(todoData, userId) {
    try {
      const {
        title,
        description,
        priority = 1,
        category,
        dueDate,
        tags = [],
        metadata = {},
        position
      } = todoData;

      // If position not specified, get the next position
      let finalPosition = position;
      if (finalPosition === undefined) {
        const [lastTodo] = await db('todos')
          .where('user_id', userId)
          .orderBy('position', 'desc')
          .limit(1);

        finalPosition = lastTodo ? lastTodo.position + 1 : 0;
      }

      const [todo] = await db('todos')
        .insert({
          user_id: userId,
          title,
          description,
          priority,
          category,
          due_date: dueDate,
          tags: JSON.stringify(tags),
          metadata: JSON.stringify(metadata),
          position: finalPosition
        })
        .returning('*');

      // Invalidate user's todo cache
      await this.invalidateUserCache(userId);

      logger.business.todoCreated(userId, todo.id);

      return new Todo(todo);
    } catch (error) {
      logger.error('Error creating todo:', error);
      throw error;
    }
  }

  static async findById(id, userId = null) {
    try {
      let query = db('todos').where('id', id);

      if (userId) {
        query = query.where('user_id', userId);
      }

      const todoData = await query.first();

      return todoData ? new Todo(todoData) : null;
    } catch (error) {
      logger.error('Error finding todo by ID:', error);
      throw error;
    }
  }

  static async findByUser(userId, options = {}) {
    try {
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
      } = options;

      // Create cache key based on query parameters
      const cacheKey = `todos:${userId}:${JSON.stringify(options)}`;

      // Try cache first
      let result = await redisManager.get(cacheKey);

      if (!result) {
        let query = db('todos')
          .where('user_id', userId);

        // Apply filters
        if (completed !== undefined) {
          query = query.where('completed', completed);
        }

        if (priority !== undefined) {
          query = query.where('priority', priority);
        }

        if (category) {
          query = query.where('category', category);
        }

        if (search) {
          query = query.where(function() {
            this.whereILike('title', `%${search}%`)
                .orWhereILike('description', `%${search}%`);
          });
        }

        if (dueBefore) {
          query = query.where('due_date', '<', dueBefore);
        }

        if (dueAfter) {
          query = query.where('due_date', '>', dueAfter);
        }

        if (tags && tags.length > 0) {
          // PostgreSQL JSON array contains query
          for (const tag of tags) {
            query = query.whereRaw('tags::jsonb ? ?', [tag]);
          }
        }

        // Get total count for pagination
        const totalQuery = query.clone();
        const [{ count }] = await totalQuery.count('* as count');
        const total = parseInt(count);

        // Apply sorting
        const validSortFields = ['created_at', 'updated_at', 'title', 'priority', 'due_date', 'position'];
        const sortField = validSortFields.includes(sortBy) ? sortBy : 'created_at';
        const sortDirection = sortOrder.toLowerCase() === 'asc' ? 'asc' : 'desc';

        query = query.orderBy(sortField, sortDirection);

        // Apply pagination
        const offset = (page - 1) * limit;
        query = query.limit(limit).offset(offset);

        const todos = await query;

        result = {
          todos: todos.map(todo => new Todo(todo)),
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            pages: Math.ceil(total / limit),
            hasNext: page < Math.ceil(total / limit),
            hasPrev: page > 1
          }
        };

        // Cache for 2 minutes
        await redisManager.set(cacheKey, result, 120);
      } else {
        // Convert plain objects back to Todo instances
        result.todos = result.todos.map(todo => new Todo(todo));
      }

      return result;
    } catch (error) {
      logger.error('Error finding todos by user:', error);
      throw error;
    }
  }

  static async getUserCategories(userId) {
    try {
      const cacheKey = `user_categories:${userId}`;
      let categories = await redisManager.get(cacheKey);

      if (!categories) {
        const result = await db('todos')
          .where('user_id', userId)
          .whereNotNull('category')
          .distinct('category')
          .orderBy('category');

        categories = result.map(row => row.category);

        // Cache for 10 minutes
        await redisManager.set(cacheKey, categories, 600);
      }

      return categories;
    } catch (error) {
      logger.error('Error getting user categories:', error);
      throw error;
    }
  }

  static async getUserTags(userId) {
    try {
      const cacheKey = `user_tags:${userId}`;
      let tags = await redisManager.get(cacheKey);

      if (!tags) {
        const result = await db('todos')
          .where('user_id', userId)
          .whereRaw("jsonb_array_length(tags) > 0");

        const tagSet = new Set();
        result.forEach(todo => {
          const todoTags = JSON.parse(todo.tags || '[]');
          todoTags.forEach(tag => tagSet.add(tag));
        });

        tags = Array.from(tagSet).sort();

        // Cache for 10 minutes
        await redisManager.set(cacheKey, tags, 600);
      }

      return tags;
    } catch (error) {
      logger.error('Error getting user tags:', error);
      throw error;
    }
  }

  static async getOverdueTodos(userId) {
    try {
      const cacheKey = `overdue_todos:${userId}`;
      let overdueTodos = await redisManager.get(cacheKey);

      if (!overdueTodos) {
        const todos = await db('todos')
          .where('user_id', userId)
          .where('completed', false)
          .where('due_date', '<', new Date())
          .orderBy('due_date', 'asc');

        overdueTodos = todos.map(todo => new Todo(todo));

        // Cache for 5 minutes
        await redisManager.set(cacheKey, overdueTodos, 300);
      } else {
        overdueTodos = overdueTodos.map(todo => new Todo(todo));
      }

      return overdueTodos;
    } catch (error) {
      logger.error('Error getting overdue todos:', error);
      throw error;
    }
  }

  static async getUpcomingTodos(userId, days = 7) {
    try {
      const cacheKey = `upcoming_todos:${userId}:${days}`;
      let upcomingTodos = await redisManager.get(cacheKey);

      if (!upcomingTodos) {
        const endDate = new Date();
        endDate.setDate(endDate.getDate() + days);

        const todos = await db('todos')
          .where('user_id', userId)
          .where('completed', false)
          .whereBetween('due_date', [new Date(), endDate])
          .orderBy('due_date', 'asc');

        upcomingTodos = todos.map(todo => new Todo(todo));

        // Cache for 30 minutes
        await redisManager.set(cacheKey, upcomingTodos, 1800);
      } else {
        upcomingTodos = upcomingTodos.map(todo => new Todo(todo));
      }

      return upcomingTodos;
    } catch (error) {
      logger.error('Error getting upcoming todos:', error);
      throw error;
    }
  }

  static async bulkUpdate(todoIds, userId, updateData) {
    try {
      return await withTransaction(async (trx) => {
        // Verify all todos belong to the user
        const todos = await trx('todos')
          .whereIn('id', todoIds)
          .where('user_id', userId);

        if (todos.length !== todoIds.length) {
          throw new Error('Some todos not found or not owned by user');
        }

        // Prepare update data
        const allowedFields = ['completed', 'priority', 'category', 'due_date'];
        const filteredData = {};

        for (const field of allowedFields) {
          if (updateData[field] !== undefined) {
            filteredData[field] = updateData[field];
          }
        }

        if (Object.keys(filteredData).length === 0) {
          throw new Error('No valid fields to update');
        }

        filteredData.updated_at = new Date();

        // Handle completion timestamp
        if (filteredData.completed === true) {
          filteredData.completed_at = new Date();
        } else if (filteredData.completed === false) {
          filteredData.completed_at = null;
        }

        // Perform bulk update
        await trx('todos')
          .whereIn('id', todoIds)
          .where('user_id', userId)
          .update(filteredData);

        // Get updated todos
        const updatedTodos = await trx('todos')
          .whereIn('id', todoIds)
          .where('user_id', userId);

        // Invalidate cache
        await this.invalidateUserCache(userId);

        logger.info('Bulk todo update:', {
          userId,
          todoIds,
          updateData: filteredData
        });

        return updatedTodos.map(todo => new Todo(todo));
      });
    } catch (error) {
      logger.error('Error bulk updating todos:', error);
      throw error;
    }
  }

  static async bulkDelete(todoIds, userId) {
    try {
      return await withTransaction(async (trx) => {
        // Verify todos belong to user and get them for logging
        const todos = await trx('todos')
          .whereIn('id', todoIds)
          .where('user_id', userId);

        if (todos.length === 0) {
          throw new Error('No todos found to delete');
        }

        const actualIds = todos.map(todo => todo.id);

        // Delete todos
        const deletedCount = await trx('todos')
          .whereIn('id', actualIds)
          .where('user_id', userId)
          .del();

        // Invalidate cache
        await this.invalidateUserCache(userId);

        logger.info('Bulk todo deletion:', {
          userId,
          deletedCount,
          todoIds: actualIds
        });

        return { deletedCount, deletedIds: actualIds };
      });
    } catch (error) {
      logger.error('Error bulk deleting todos:', error);
      throw error;
    }
  }

  static async reorderTodos(userId, todoIds) {
    try {
      return await withTransaction(async (trx) => {
        // Verify all todos belong to the user
        const todos = await trx('todos')
          .whereIn('id', todoIds)
          .where('user_id', userId);

        if (todos.length !== todoIds.length) {
          throw new Error('Some todos not found or not owned by user');
        }

        // Update positions
        const updates = todoIds.map((todoId, index) => ({
          id: todoId,
          position: index
        }));

        for (const update of updates) {
          await trx('todos')
            .where('id', update.id)
            .where('user_id', userId)
            .update({ position: update.position, updated_at: new Date() });
        }

        // Invalidate cache
        await this.invalidateUserCache(userId);

        logger.info('Todos reordered:', { userId, todoIds });

        return true;
      });
    } catch (error) {
      logger.error('Error reordering todos:', error);
      throw error;
    }
  }

  static async invalidateUserCache(userId) {
    try {
      // Delete all cache keys related to this user
      await redisManager.deletePattern(`todos:${userId}:*`);
      await redisManager.deletePattern(`user_categories:${userId}`);
      await redisManager.deletePattern(`user_tags:${userId}`);
      await redisManager.deletePattern(`overdue_todos:${userId}`);
      await redisManager.deletePattern(`upcoming_todos:${userId}:*`);
      await redisManager.deletePattern(`user_stats:${userId}`);
    } catch (error) {
      logger.error('Error invalidating user cache:', error);
      // Don't throw - cache invalidation failure shouldn't break the operation
    }
  }

  // Instance methods
  async update(updateData) {
    try {
      const allowedFields = [
        'title',
        'description',
        'completed',
        'priority',
        'category',
        'due_date',
        'tags',
        'metadata',
        'position'
      ];

      const filteredData = {};
      for (const field of allowedFields) {
        if (updateData[field] !== undefined) {
          filteredData[field] = updateData[field];
        }
      }

      if (Object.keys(filteredData).length === 0) {
        throw new Error('No valid fields to update');
      }

      // Handle JSON fields
      if (filteredData.tags) {
        filteredData.tags = JSON.stringify(filteredData.tags);
      }
      if (filteredData.metadata) {
        filteredData.metadata = JSON.stringify(filteredData.metadata);
      }

      // Handle completion
      const wasCompleted = this.completed;
      if (filteredData.completed !== undefined) {
        if (filteredData.completed && !wasCompleted) {
          filteredData.completed_at = new Date();
          logger.business.todoCompleted(this.userId, this.id);
        } else if (!filteredData.completed && wasCompleted) {
          filteredData.completed_at = null;
        }
      }

      filteredData.updated_at = new Date();

      const [updatedTodo] = await db('todos')
        .where('id', this.id)
        .update(filteredData)
        .returning('*');

      // Update instance properties
      Object.assign(this, new Todo(updatedTodo));

      // Invalidate cache
      await Todo.invalidateUserCache(this.userId);

      logger.info('Todo updated:', {
        todoId: this.id,
        userId: this.userId,
        fields: Object.keys(filteredData)
      });

      return this;
    } catch (error) {
      logger.error('Error updating todo:', error);
      throw error;
    }
  }

  async delete() {
    try {
      const deletedCount = await db('todos')
        .where('id', this.id)
        .del();

      if (deletedCount === 0) {
        throw new Error('Todo not found');
      }

      // Invalidate cache
      await Todo.invalidateUserCache(this.userId);

      logger.info('Todo deleted:', {
        todoId: this.id,
        userId: this.userId
      });

      return true;
    } catch (error) {
      logger.error('Error deleting todo:', error);
      throw error;
    }
  }

  async toggleComplete() {
    return await this.update({ completed: !this.completed });
  }

  async addTag(tag) {
    const currentTags = this.tags || [];
    if (!currentTags.includes(tag)) {
      const newTags = [...currentTags, tag];
      return await this.update({ tags: newTags });
    }
    return this;
  }

  async removeTag(tag) {
    const currentTags = this.tags || [];
    const newTags = currentTags.filter(t => t !== tag);
    return await this.update({ tags: newTags });
  }

  async duplicate() {
    try {
      const duplicateData = {
        title: `${this.title} (Copy)`,
        description: this.description,
        priority: this.priority,
        category: this.category,
        tags: this.tags,
        metadata: this.metadata
        // Note: not copying due_date, completed status, or position
      };

      return await Todo.create(duplicateData, this.userId);
    } catch (error) {
      logger.error('Error duplicating todo:', error);
      throw error;
    }
  }

  // Computed properties
  get isOverdue() {
    return this.dueDate && !this.completed && new Date(this.dueDate) < new Date();
  }

  get isDueSoon() {
    if (!this.dueDate || this.completed) return false;

    const now = new Date();
    const due = new Date(this.dueDate);
    const diffHours = (due - now) / (1000 * 60 * 60);

    return diffHours > 0 && diffHours <= 24; // Due within 24 hours
  }

  get priorityText() {
    const priorityMap = {
      1: 'Low',
      2: 'Medium',
      3: 'High'
    };
    return priorityMap[this.priority] || 'Unknown';
  }

  get timeUntilDue() {
    if (!this.dueDate) return null;

    const now = new Date();
    const due = new Date(this.dueDate);
    const diff = due - now;

    if (diff < 0) return 'Overdue';

    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

    if (days > 0) return `${days} day${days > 1 ? 's' : ''}`;
    if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''}`;
    if (minutes > 0) return `${minutes} minute${minutes > 1 ? 's' : ''}`;

    return 'Due now';
  }

  // Convert to JSON with computed properties
  toJSON() {
    return {
      id: this.id,
      userId: this.userId,
      title: this.title,
      description: this.description,
      completed: this.completed,
      priority: this.priority,
      priorityText: this.priorityText,
      category: this.category,
      dueDate: this.dueDate,
      completedAt: this.completedAt,
      tags: this.tags,
      metadata: this.metadata,
      position: this.position,
      isOverdue: this.isOverdue,
      isDueSoon: this.isDueSoon,
      timeUntilDue: this.timeUntilDue,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt
    };
  }
}

module.exports = Todo;
