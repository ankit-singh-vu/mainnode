const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { db, withTransaction } = require('../config/database');
const logger = require('../config/logger');
const redisManager = require('../config/redis');

class User {
  constructor(data) {
    this.id = data.id;
    this.email = data.email;
    this.username = data.username;
    this.passwordHash = data.password_hash;
    this.firstName = data.first_name;
    this.lastName = data.last_name;
    this.isActive = data.is_active;
    this.emailVerified = data.email_verified;
    this.emailVerificationToken = data.email_verification_token;
    this.emailVerifiedAt = data.email_verified_at;
    this.passwordResetToken = data.password_reset_token;
    this.passwordResetExpires = data.password_reset_expires;
    this.lastLoginAt = data.last_login_at;
    this.lastLoginIp = data.last_login_ip;
    this.failedLoginAttempts = data.failed_login_attempts;
    this.lockedUntil = data.locked_until;
    this.preferences = data.preferences || {};
    this.createdAt = data.created_at;
    this.updatedAt = data.updated_at;
  }

  // Static methods for user operations
  static async create(userData) {
    try {
      const {
        email,
        username,
        password,
        firstName,
        lastName,
        preferences = {}
      } = userData;

      // Check if user already exists
      const existingUser = await User.findByEmailOrUsername(email, username);
      if (existingUser) {
        const field = existingUser.email === email ? 'email' : 'username';
        throw new Error(`User with this ${field} already exists`);
      }

      // Hash password
      const passwordHash = await User.hashPassword(password);

      // Generate email verification token
      const emailVerificationToken = uuidv4();

      // Create user in database
      const [user] = await db('users')
        .insert({
          email: email.toLowerCase(),
          username,
          password_hash: passwordHash,
          first_name: firstName,
          last_name: lastName,
          email_verification_token: emailVerificationToken,
          preferences: JSON.stringify(preferences)
        })
        .returning('*');

      logger.business.userRegistered(user.id, user.email);

      return new User(user);
    } catch (error) {
      logger.error('Error creating user:', error);
      throw error;
    }
  }

  static async findById(id) {
    try {
      // Try cache first
      const cacheKey = `user:${id}`;
      let userData = await redisManager.get(cacheKey);

      if (!userData) {
        userData = await db('users')
          .where('id', id)
          .first();

        if (userData) {
          // Cache for 30 minutes
          await redisManager.set(cacheKey, userData, 1800);
        }
      }

      return userData ? new User(userData) : null;
    } catch (error) {
      logger.error('Error finding user by ID:', error);
      throw error;
    }
  }

  static async findByEmail(email) {
    try {
      const userData = await db('users')
        .where('email', email.toLowerCase())
        .first();

      return userData ? new User(userData) : null;
    } catch (error) {
      logger.error('Error finding user by email:', error);
      throw error;
    }
  }

  static async findByUsername(username) {
    try {
      const userData = await db('users')
        .where('username', username)
        .first();

      return userData ? new User(userData) : null;
    } catch (error) {
      logger.error('Error finding user by username:', error);
      throw error;
    }
  }

  static async findByEmailOrUsername(email, username) {
    try {
      const userData = await db('users')
        .where('email', email.toLowerCase())
        .orWhere('username', username)
        .first();

      return userData ? new User(userData) : null;
    } catch (error) {
      logger.error('Error finding user by email or username:', error);
      throw error;
    }
  }

  static async findByEmailVerificationToken(token) {
    try {
      const userData = await db('users')
        .where('email_verification_token', token)
        .first();

      return userData ? new User(userData) : null;
    } catch (error) {
      logger.error('Error finding user by verification token:', error);
      throw error;
    }
  }

  static async findByPasswordResetToken(token) {
    try {
      const userData = await db('users')
        .where('password_reset_token', token)
        .where('password_reset_expires', '>', new Date())
        .first();

      return userData ? new User(userData) : null;
    } catch (error) {
      logger.error('Error finding user by reset token:', error);
      throw error;
    }
  }

  static async hashPassword(password) {
    try {
      const saltRounds = parseInt(process.env.BCRYPT_ROUNDS) || 12;
      return await bcrypt.hash(password, saltRounds);
    } catch (error) {
      logger.error('Error hashing password:', error);
      throw error;
    }
  }

  static async validatePassword(password, hash) {
    try {
      return await bcrypt.compare(password, hash);
    } catch (error) {
      logger.error('Error validating password:', error);
      throw error;
    }
  }

  static generateJWT(user) {
    const payload = {
      id: user.id,
      email: user.email,
      username: user.username,
      isActive: user.isActive,
      emailVerified: user.emailVerified
    };

    const options = {
      expiresIn: process.env.JWT_EXPIRES_IN || '7d',
      issuer: 'todo-app',
      audience: 'todo-app-users'
    };

    return jwt.sign(payload, process.env.JWT_SECRET, options);
  }

  // Instance methods
  async update(updateData) {
    try {
      const allowedFields = [
        'first_name',
        'last_name',
        'preferences',
        'is_active',
        'email_verified',
        'email_verified_at',
        'last_login_at',
        'last_login_ip',
        'failed_login_attempts',
        'locked_until'
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
      if (filteredData.preferences) {
        filteredData.preferences = JSON.stringify(filteredData.preferences);
      }

      filteredData.updated_at = new Date();

      const [updatedUser] = await db('users')
        .where('id', this.id)
        .update(filteredData)
        .returning('*');

      // Update instance properties
      Object.assign(this, new User(updatedUser));

      // Invalidate cache
      await redisManager.del(`user:${this.id}`);

      logger.info('User updated:', { userId: this.id, fields: Object.keys(filteredData) });

      return this;
    } catch (error) {
      logger.error('Error updating user:', error);
      throw error;
    }
  }

  async updatePassword(newPassword) {
    try {
      const passwordHash = await User.hashPassword(newPassword);

      await db('users')
        .where('id', this.id)
        .update({
          password_hash: passwordHash,
          password_reset_token: null,
          password_reset_expires: null,
          updated_at: new Date()
        });

      this.passwordHash = passwordHash;
      this.passwordResetToken = null;
      this.passwordResetExpires = null;

      // Invalidate cache
      await redisManager.del(`user:${this.id}`);

      logger.info('Password updated for user:', { userId: this.id });

      return this;
    } catch (error) {
      logger.error('Error updating password:', error);
      throw error;
    }
  }

  async validatePassword(password) {
    return await User.validatePassword(password, this.passwordHash);
  }

  async generatePasswordResetToken() {
    try {
      const token = uuidv4();
      const expires = new Date(Date.now() + 3600000); // 1 hour

      await db('users')
        .where('id', this.id)
        .update({
          password_reset_token: token,
          password_reset_expires: expires,
          updated_at: new Date()
        });

      this.passwordResetToken = token;
      this.passwordResetExpires = expires;

      // Invalidate cache
      await redisManager.del(`user:${this.id}`);

      logger.info('Password reset token generated:', { userId: this.id });

      return token;
    } catch (error) {
      logger.error('Error generating password reset token:', error);
      throw error;
    }
  }

  async verifyEmail() {
    try {
      await db('users')
        .where('id', this.id)
        .update({
          email_verified: true,
          email_verified_at: new Date(),
          email_verification_token: null,
          updated_at: new Date()
        });

      this.emailVerified = true;
      this.emailVerifiedAt = new Date();
      this.emailVerificationToken = null;

      // Invalidate cache
      await redisManager.del(`user:${this.id}`);

      logger.info('Email verified for user:', { userId: this.id });

      return this;
    } catch (error) {
      logger.error('Error verifying email:', error);
      throw error;
    }
  }

  async recordLoginAttempt(success, ip) {
    try {
      const updateData = {
        last_login_ip: ip,
        updated_at: new Date()
      };

      if (success) {
        updateData.last_login_at = new Date();
        updateData.failed_login_attempts = 0;
        updateData.locked_until = null;
      } else {
        updateData.failed_login_attempts = (this.failedLoginAttempts || 0) + 1;

        // Lock account after 5 failed attempts
        if (updateData.failed_login_attempts >= 5) {
          updateData.locked_until = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes
          logger.security.suspiciousActivity('Account locked due to failed login attempts', {
            userId: this.id,
            email: this.email,
            attempts: updateData.failed_login_attempts,
            ip
          });
        }
      }

      await db('users')
        .where('id', this.id)
        .update(updateData);

      // Update instance properties
      Object.assign(this, updateData);

      // Invalidate cache
      await redisManager.del(`user:${this.id}`);

      logger.security.loginAttempt(this.email, success, ip);

      return this;
    } catch (error) {
      logger.error('Error recording login attempt:', error);
      throw error;
    }
  }

  isLocked() {
    return this.lockedUntil && new Date() < new Date(this.lockedUntil);
  }

  async unlockAccount() {
    try {
      await db('users')
        .where('id', this.id)
        .update({
          failed_login_attempts: 0,
          locked_until: null,
          updated_at: new Date()
        });

      this.failedLoginAttempts = 0;
      this.lockedUntil = null;

      // Invalidate cache
      await redisManager.del(`user:${this.id}`);

      logger.info('Account unlocked:', { userId: this.id });

      return this;
    } catch (error) {
      logger.error('Error unlocking account:', error);
      throw error;
    }
  }

  generateJWT() {
    return User.generateJWT(this);
  }

  async delete() {
    try {
      await withTransaction(async (trx) => {
        // Soft delete - mark as inactive instead of actually deleting
        await trx('users')
          .where('id', this.id)
          .update({
            is_active: false,
            email: `deleted_${Date.now()}_${this.email}`,
            username: `deleted_${Date.now()}_${this.username}`,
            updated_at: new Date()
          });

        // Note: Todos will be cascade deleted due to foreign key constraint
        // if you want to keep them, remove the CASCADE option from migration
      });

      // Invalidate cache
      await redisManager.del(`user:${this.id}`);

      logger.info('User deleted:', { userId: this.id });

      return true;
    } catch (error) {
      logger.error('Error deleting user:', error);
      throw error;
    }
  }

  // Get user statistics
  async getStats() {
    try {
      const cacheKey = `user_stats:${this.id}`;
      let stats = await redisManager.get(cacheKey);

      if (!stats) {
        const [result] = await db('todos')
          .where('user_id', this.id)
          .select(
            db.raw('COUNT(*) as total_todos'),
            db.raw('COUNT(CASE WHEN completed = true THEN 1 END) as completed_todos'),
            db.raw('COUNT(CASE WHEN completed = false THEN 1 END) as pending_todos'),
            db.raw('COUNT(CASE WHEN priority = 3 THEN 1 END) as high_priority_todos'),
            db.raw('COUNT(CASE WHEN due_date < NOW() AND completed = false THEN 1 END) as overdue_todos')
          );

        stats = {
          totalTodos: parseInt(result.total_todos) || 0,
          completedTodos: parseInt(result.completed_todos) || 0,
          pendingTodos: parseInt(result.pending_todos) || 0,
          highPriorityTodos: parseInt(result.high_priority_todos) || 0,
          overdueTodos: parseInt(result.overdue_todos) || 0,
          completionRate: parseInt(result.total_todos) > 0
            ? Math.round((parseInt(result.completed_todos) / parseInt(result.total_todos)) * 100)
            : 0
        };

        // Cache for 5 minutes
        await redisManager.set(cacheKey, stats, 300);
      }

      return stats;
    } catch (error) {
      logger.error('Error getting user stats:', error);
      throw error;
    }
  }

  // Convert to safe object (without sensitive data)
  toSafeObject() {
    return {
      id: this.id,
      email: this.email,
      username: this.username,
      firstName: this.firstName,
      lastName: this.lastName,
      isActive: this.isActive,
      emailVerified: this.emailVerified,
      emailVerifiedAt: this.emailVerifiedAt,
      lastLoginAt: this.lastLoginAt,
      preferences: this.preferences,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt
    };
  }

  // Convert to JSON
  toJSON() {
    return this.toSafeObject();
  }
}

module.exports = User;
