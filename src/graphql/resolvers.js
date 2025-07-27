const { AuthenticationError, ForbiddenError, UserInputError } = require('apollo-server-express');
const { GraphQLScalarType } = require('graphql');
const { Kind } = require('graphql/language');
const User = require('../models/User');
const Todo = require('../models/Todo');
const logger = require('../config/logger');
const redisManager = require('../config/redis');

// Custom DateTime scalar
const DateTimeScalar = new GraphQLScalarType({
  name: 'DateTime',
  description: 'Date custom scalar type',
  serialize(value) {
    return value instanceof Date ? value.toISOString() : value;
  },
  parseValue(value) {
    return new Date(value);
  },
  parseLiteral(ast) {
    if (ast.kind === Kind.STRING) {
      return new Date(ast.value);
    }
    return null;
  },
});

// Custom JSON scalar
const JSONScalar = new GraphQLScalarType({
  name: 'JSON',
  description: 'JSON custom scalar type',
  serialize(value) {
    return value;
  },
  parseValue(value) {
    return value;
  },
  parseLiteral(ast) {
    switch (ast.kind) {
      case Kind.STRING:
      case Kind.BOOLEAN:
        return ast.value;
      case Kind.INT:
      case Kind.FLOAT:
        return parseFloat(ast.value);
      case Kind.OBJECT: {
        const value = Object.create(null);
        ast.fields.forEach((field) => {
          value[field.name.value] = parseLiteral(field.value);
        });
        return value;
      }
      case Kind.LIST:
        return ast.values.map(parseLiteral);
      default:
        return null;
    }
  },
});

// Helper function to map priority values
const mapPriorityToNumber = (priority) => {
  const priorityMap = { LOW: 1, MEDIUM: 2, HIGH: 3 };
  return priorityMap[priority] || 1;
};

const mapNumberToPriority = (number) => {
  const priorityMap = { 1: 'LOW', 2: 'MEDIUM', 3: 'HIGH' };
  return priorityMap[number] || 'LOW';
};

// Helper function to validate authentication
const requireAuth = (user) => {
  if (!user) {
    throw new AuthenticationError('Authentication required');
  }
  return user;
};

// Helper function for error handling
const handleError = (error, operation, context = {}) => {
  logger.error(`GraphQL ${operation} error:`, {
    error: error.message,
    stack: error.stack,
    ...context
  });

  if (error instanceof AuthenticationError || error instanceof ForbiddenError) {
    throw error;
  }

  if (error.message.includes('not found')) {
    throw new UserInputError(error.message);
  }

  if (error.message.includes('already exists')) {
    throw new UserInputError(error.message);
  }

  throw new Error(`Failed to ${operation}`);
};

const resolvers = {
  DateTime: DateTimeScalar,
  JSON: JSONScalar,

  // Priority enum resolver
  Priority: {
    LOW: 1,
    MEDIUM: 2,
    HIGH: 3,
  },

  // User resolvers
  User: {
    async stats(parent, args, context) {
      try {
        const user = await User.findById(parent.id);
        if (!user) return null;
        return await user.getStats();
      } catch (error) {
        handleError(error, 'get user stats', { userId: parent.id });
      }
    }
  },

  // Todo resolvers
  Todo: {
    priority(parent) {
      return mapNumberToPriority(parent.priority);
    },
    async user(parent, args, context) {
      try {
        return await User.findById(parent.userId);
      } catch (error) {
        handleError(error, 'get todo user', { todoId: parent.id });
      }
    }
  },

  // Query resolvers
  Query: {
    // User queries
    async me(parent, args, context) {
      const user = requireAuth(context.user);
      try {
        return await User.findById(user.id);
      } catch (error) {
        handleError(error, 'get current user', { userId: user.id });
      }
    },

    async profile(parent, args, context) {
      const user = requireAuth(context.user);
      try {
        return await User.findById(user.id);
      } catch (error) {
        handleError(error, 'get user profile', { userId: user.id });
      }
    },

    async sessions(parent, args, context) {
      const user = requireAuth(context.user);
      try {
        const sessionData = await redisManager.get(`user_session:${user.id}`);
        return sessionData;
      } catch (error) {
        handleError(error, 'get user sessions', { userId: user.id });
      }
    },

    // Todo queries
    async todos(parent, args, context) {
      const user = requireAuth(context.user);
      try {
        const { page = 1, limit = 20, filter = {}, sort = {} } = args;

        const options = {
          page,
          limit,
          completed: filter.completed,
          priority: filter.priority ? mapPriorityToNumber(filter.priority) : undefined,
          category: filter.category,
          search: filter.search,
          dueBefore: filter.dueBefore,
          dueAfter: filter.dueAfter,
          tags: filter.tags,
          sortBy: sort.sortBy?.toLowerCase() || 'created_at',
          sortOrder: sort.sortOrder?.toLowerCase() || 'desc'
        };

        return await Todo.findByUser(user.id, options);
      } catch (error) {
        handleError(error, 'get todos', { userId: user.id, args });
      }
    },

    async todo(parent, args, context) {
      const user = requireAuth(context.user);
      try {
        const todo = await Todo.findById(args.id, user.id);
        if (!todo) {
          throw new UserInputError('Todo not found');
        }
        return todo;
      } catch (error) {
        handleError(error, 'get todo', { userId: user.id, todoId: args.id });
      }
    },

    async categories(parent, args, context) {
      const user = requireAuth(context.user);
      try {
        return await Todo.getUserCategories(user.id);
      } catch (error) {
        handleError(error, 'get categories', { userId: user.id });
      }
    },

    async tags(parent, args, context) {
      const user = requireAuth(context.user);
      try {
        return await Todo.getUserTags(user.id);
      } catch (error) {
        handleError(error, 'get tags', { userId: user.id });
      }
    },

    async overdueTodos(parent, args, context) {
      const user = requireAuth(context.user);
      try {
        return await Todo.getOverdueTodos(user.id);
      } catch (error) {
        handleError(error, 'get overdue todos', { userId: user.id });
      }
    },

    async upcomingTodos(parent, args, context) {
      const user = requireAuth(context.user);
      try {
        const { days = 7 } = args;
        return await Todo.getUpcomingTodos(user.id, days);
      } catch (error) {
        handleError(error, 'get upcoming todos', { userId: user.id, days: args.days });
      }
    },

    async todoStats(parent, args, context) {
      const user = requireAuth(context.user);
      try {
        const userInstance = await User.findById(user.id);
        if (!userInstance) {
          throw new UserInputError('User not found');
        }
        return await userInstance.getStats();
      } catch (error) {
        handleError(error, 'get todo stats', { userId: user.id });
      }
    },

    health() {
      return 'GraphQL service is healthy';
    }
  },

  // Mutation resolvers
  Mutation: {
    // Authentication mutations
    async register(parent, args, context) {
      try {
        const { email, username, password, firstName, lastName } = args.input;

        const user = await User.create({
          email,
          username,
          password,
          firstName,
          lastName
        });

        const token = user.generateJWT();
        await redisManager.set(`session:${user.id}`, token, 7 * 24 * 60 * 60);

        logger.info('User registered via GraphQL', {
          userId: user.id,
          email: user.email,
          ip: context.req?.ip
        });

        return {
          user,
          token,
          expiresIn: '7d'
        };
      } catch (error) {
        handleError(error, 'register user', { input: args.input });
      }
    },

    async login(parent, args, context) {
      try {
        const { email, password } = args.input;
        const ip = context.req?.ip;

        const user = await User.findByEmail(email);
        if (!user) {
          logger.security.loginAttempt(email, false, ip);
          throw new AuthenticationError('Invalid credentials');
        }

        if (user.isLocked()) {
          logger.security.suspiciousActivity('Login attempt on locked account', {
            userId: user.id,
            email: user.email,
            ip
          });
          throw new ForbiddenError('Account is temporarily locked');
        }

        if (!user.isActive) {
          logger.security.suspiciousActivity('Login attempt on inactive account', {
            userId: user.id,
            email: user.email,
            ip
          });
          throw new ForbiddenError('Account is deactivated');
        }

        const isValidPassword = await user.validatePassword(password);
        if (!isValidPassword) {
          await user.recordLoginAttempt(false, ip);
          throw new AuthenticationError('Invalid credentials');
        }

        await user.recordLoginAttempt(true, ip);

        const token = user.generateJWT();
        await redisManager.set(`session:${user.id}`, token, 7 * 24 * 60 * 60);

        logger.info('User logged in via GraphQL', {
          userId: user.id,
          email: user.email,
          ip
        });

        return {
          user,
          token,
          expiresIn: '7d'
        };
      } catch (error) {
        handleError(error, 'login user', { email: args.input.email });
      }
    },

    async logout(parent, args, context) {
      const user = requireAuth(context.user);
      try {
        const token = context.token;

        if (token) {
          const jwt = require('jsonwebtoken');
          const decoded = jwt.decode(token);
          const expiresIn = decoded.exp - Math.floor(Date.now() / 1000);

          if (expiresIn > 0) {
            await redisManager.set(`blacklist:${token}`, true, expiresIn);
          }
        }

        await redisManager.del(`session:${user.id}`);
        await redisManager.del(`user_session:${user.id}`);

        logger.info('User logged out via GraphQL', {
          userId: user.id,
          ip: context.req?.ip
        });

        return true;
      } catch (error) {
        handleError(error, 'logout user', { userId: user.id });
      }
    },

    async refreshToken(parent, args, context) {
      const user = requireAuth(context.user);
      try {
        const userInstance = await User.findById(user.id);
        if (!userInstance || !userInstance.isActive) {
          throw new AuthenticationError('User not found or inactive');
        }

        const token = userInstance.generateJWT();
        await redisManager.set(`session:${user.id}`, token, 7 * 24 * 60 * 60);

        if (context.token) {
          const jwt = require('jsonwebtoken');
          const decoded = jwt.decode(context.token);
          const expiresIn = decoded.exp - Math.floor(Date.now() / 1000);

          if (expiresIn > 0) {
            await redisManager.set(`blacklist:${context.token}`, true, expiresIn);
          }
        }

        return {
          user: userInstance,
          token,
          expiresIn: '7d'
        };
      } catch (error) {
        handleError(error, 'refresh token', { userId: user.id });
      }
    },

    async updateProfile(parent, args, context) {
      const user = requireAuth(context.user);
      try {
        const { firstName, lastName, preferences } = args.input;

        const userInstance = await User.findById(user.id);
        if (!userInstance) {
          throw new UserInputError('User not found');
        }

        await userInstance.update({
          first_name: firstName,
          last_name: lastName,
          preferences
        });

        logger.info('User profile updated via GraphQL', {
          userId: user.id,
          fields: args.input
        });

        return userInstance;
      } catch (error) {
        handleError(error, 'update profile', { userId: user.id, input: args.input });
      }
    },

    async changePassword(parent, args, context) {
      const user = requireAuth(context.user);
      try {
        const { currentPassword, newPassword } = args.input;

        const userInstance = await User.findById(user.id);
        if (!userInstance) {
          throw new UserInputError('User not found');
        }

        const isValidPassword = await userInstance.validatePassword(currentPassword);
        if (!isValidPassword) {
          throw new AuthenticationError('Current password is incorrect');
        }

        await userInstance.updatePassword(newPassword);

        await redisManager.deletePattern(`session:${user.id}`);
        await redisManager.deletePattern(`user_session:${user.id}`);

        const token = userInstance.generateJWT();
        await redisManager.set(`session:${user.id}`, token, 7 * 24 * 60 * 60);

        logger.info('Password changed via GraphQL', {
          userId: user.id,
          ip: context.req?.ip
        });

        return {
          user: userInstance,
          token,
          expiresIn: '7d'
        };
      } catch (error) {
        handleError(error, 'change password', { userId: user.id });
      }
    },

    async requestPasswordReset(parent, args, context) {
      try {
        const { email } = args;
        const user = await User.findByEmail(email);

        if (user && user.isActive) {
          await user.generatePasswordResetToken();
          logger.info('Password reset requested via GraphQL', {
            userId: user.id,
            email: user.email,
            ip: context.req?.ip
          });
        }

        return true;
      } catch (error) {
        handleError(error, 'request password reset', { email: args.email });
      }
    },

    async resetPassword(parent, args, context) {
      try {
        const { token, newPassword } = args;

        const user = await User.findByPasswordResetToken(token);
        if (!user) {
          throw new UserInputError('Invalid or expired reset token');
        }

        await user.updatePassword(newPassword);
        await redisManager.deletePattern(`session:${user.id}`);
        await redisManager.deletePattern(`user_session:${user.id}`);

        logger.info('Password reset completed via GraphQL', {
          userId: user.id,
          ip: context.req?.ip
        });

        return true;
      } catch (error) {
        handleError(error, 'reset password', { token: args.token });
      }
    },

    async verifyEmail(parent, args, context) {
      try {
        const { token } = args;

        const user = await User.findByEmailVerificationToken(token);
        if (!user) {
          throw new UserInputError('Invalid verification token');
        }

        await user.verifyEmail();

        logger.info('Email verified via GraphQL', {
          userId: user.id,
          email: user.email
        });

        return true;
      } catch (error) {
        handleError(error, 'verify email', { token: args.token });
      }
    },

    // Todo mutations
    async createTodo(parent, args, context) {
      const user = requireAuth(context.user);
      try {
        const {
          title,
          description,
          priority = 'LOW',
          category,
          dueDate,
          tags = [],
          metadata = {},
          position
        } = args.input;

        const todo = await Todo.create({
          title,
          description,
          priority: mapPriorityToNumber(priority),
          category,
          dueDate,
          tags,
          metadata,
          position
        }, user.id);

        logger.info('Todo created via GraphQL', {
          todoId: todo.id,
          userId: user.id,
          title: todo.title
        });

        return todo;
      } catch (error) {
        handleError(error, 'create todo', { userId: user.id, input: args.input });
      }
    },

    async updateTodo(parent, args, context) {
      const user = requireAuth(context.user);
      try {
        const { id, input } = args;

        const todo = await Todo.findById(id, user.id);
        if (!todo) {
          throw new UserInputError('Todo not found');
        }

        const updateData = { ...input };
        if (updateData.priority) {
          updateData.priority = mapPriorityToNumber(updateData.priority);
        }

        await todo.update(updateData);

        logger.info('Todo updated via GraphQL', {
          todoId: todo.id,
          userId: user.id,
          updateData: input
        });

        return todo;
      } catch (error) {
        handleError(error, 'update todo', { userId: user.id, todoId: args.id, input: args.input });
      }
    },

    async deleteTodo(parent, args, context) {
      const user = requireAuth(context.user);
      try {
        const { id } = args;

        const todo = await Todo.findById(id, user.id);
        if (!todo) {
          throw new UserInputError('Todo not found');
        }

        await todo.delete();

        logger.info('Todo deleted via GraphQL', {
          todoId: id,
          userId: user.id
        });

        return true;
      } catch (error) {
        handleError(error, 'delete todo', { userId: user.id, todoId: args.id });
      }
    },

    async toggleTodo(parent, args, context) {
      const user = requireAuth(context.user);
      try {
        const { id } = args;

        const todo = await Todo.findById(id, user.id);
        if (!todo) {
          throw new UserInputError('Todo not found');
        }

        await todo.toggleComplete();

        logger.info('Todo toggled via GraphQL', {
          todoId: todo.id,
          userId: user.id,
          completed: todo.completed
        });

        return todo;
      } catch (error) {
        handleError(error, 'toggle todo', { userId: user.id, todoId: args.id });
      }
    },

    async duplicateTodo(parent, args, context) {
      const user = requireAuth(context.user);
      try {
        const { id } = args;

        const todo = await Todo.findById(id, user.id);
        if (!todo) {
          throw new UserInputError('Todo not found');
        }

        const duplicatedTodo = await todo.duplicate();

        logger.info('Todo duplicated via GraphQL', {
          originalTodoId: todo.id,
          duplicatedTodoId: duplicatedTodo.id,
          userId: user.id
        });

        return duplicatedTodo;
      } catch (error) {
        handleError(error, 'duplicate todo', { userId: user.id, todoId: args.id });
      }
    },

    async bulkUpdateTodos(parent, args, context) {
      const user = requireAuth(context.user);
      try {
        const { todoIds, updateData } = args.input;

        const processedUpdateData = { ...updateData };
        if (processedUpdateData.priority) {
          processedUpdateData.priority = mapPriorityToNumber(processedUpdateData.priority);
        }

        const updatedTodos = await Todo.bulkUpdate(todoIds, user.id, processedUpdateData);

        logger.info('Bulk todo update via GraphQL', {
          userId: user.id,
          todoCount: updatedTodos.length,
          updateData: processedUpdateData
        });

        return {
          updatedCount: updatedTodos.length,
          todos: updatedTodos
        };
      } catch (error) {
        handleError(error, 'bulk update todos', { userId: user.id, input: args.input });
      }
    },

    async bulkDeleteTodos(parent, args, context) {
      const user = requireAuth(context.user);
      try {
        const { todoIds } = args.input;

        const result = await Todo.bulkDelete(todoIds, user.id);

        logger.info('Bulk todo deletion via GraphQL', {
          userId: user.id,
          deletedCount: result.deletedCount,
          deletedIds: result.deletedIds
        });

        return result;
      } catch (error) {
        handleError(error, 'bulk delete todos', { userId: user.id, input: args.input });
      }
    },

    async reorderTodos(parent, args, context) {
      const user = requireAuth(context.user);
      try {
        const { todoIds } = args.input;

        await Todo.reorderTodos(user.id, todoIds);

        logger.info('Todos reordered via GraphQL', {
          userId: user.id,
          todoIds
        });

        return true;
      } catch (error) {
        handleError(error, 'reorder todos', { userId: user.id, input: args.input });
      }
    },

    async addTagToTodo(parent, args, context) {
      const user = requireAuth(context.user);
      try {
        const { id, tag } = args;

        const todo = await Todo.findById(id, user.id);
        if (!todo) {
          throw new UserInputError('Todo not found');
        }

        await todo.addTag(tag);

        logger.info('Tag added to todo via GraphQL', {
          todoId: todo.id,
          userId: user.id,
          tag
        });

        return todo;
      } catch (error) {
        handleError(error, 'add tag to todo', { userId: user.id, todoId: args.id, tag: args.tag });
      }
    },

    async removeTagFromTodo(parent, args, context) {
      const user = requireAuth(context.user);
      try {
        const { id, tag } = args;

        const todo = await Todo.findById(id, user.id);
        if (!todo) {
          throw new UserInputError('Todo not found');
        }

        await todo.removeTag(tag);

        logger.info('Tag removed from todo via GraphQL', {
          todoId: todo.id,
          userId: user.id,
          tag
        });

        return todo;
      } catch (error) {
        handleError(error, 'remove tag from todo', { userId: user.id, todoId: args.id, tag: args.tag });
      }
    }
  },

  // Subscription resolvers (for real-time updates)
  Subscription: {
    todoCreated: {
      // This would require setting up subscription infrastructure
      // For now, we'll leave it as a placeholder
      subscribe: () => {
        // Implementation would go here with PubSub
      }
    },

    todoUpdated: {
      subscribe: () => {
        // Implementation would go here with PubSub
      }
    },

    todoDeleted: {
      subscribe: () => {
        // Implementation would go here with PubSub
      }
    },

    todosReordered: {
      subscribe: () => {
        // Implementation would go here with PubSub
      }
    }
  }
};

module.exports = resolvers;
