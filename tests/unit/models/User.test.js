const User = require('../../../src/models/User');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { db } = require('../../../src/config/database');
const redisManager = require('../../../src/config/redis');

// Mock dependencies
jest.mock('../../../src/config/database');
jest.mock('../../../src/config/redis');
jest.mock('../../../src/config/logger');
jest.mock('bcryptjs');
jest.mock('jsonwebtoken');

describe('User Model', () => {
  let mockDb;
  let mockRedis;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Setup database mock
    mockDb = {
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      orWhere: jest.fn().mockReturnThis(),
      first: jest.fn(),
      insert: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      returning: jest.fn(),
      del: jest.fn()
    };

    db.mockImplementation(() => mockDb);

    // Setup Redis mock
    mockRedis = {
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
      exists: jest.fn(),
      deletePattern: jest.fn()
    };

    Object.assign(redisManager, mockRedis);
  });

  describe('User Creation', () => {
    test('should create a new user successfully', async () => {
      // Mock bcrypt.hash
      bcrypt.hash.mockResolvedValue('hashedPassword123');

      // Mock database insert
      const mockUserData = {
        id: 'user-123',
        email: 'test@example.com',
        username: 'testuser',
        password_hash: 'hashedPassword123',
        first_name: 'Test',
        last_name: 'User',
        is_active: true,
        email_verified: false,
        created_at: new Date(),
        updated_at: new Date()
      };

      mockDb.first.mockResolvedValue(null); // No existing user
      mockDb.returning.mockResolvedValue([mockUserData]);

      const userData = {
        email: 'test@example.com',
        username: 'testuser',
        password: 'Password123!',
        firstName: 'Test',
        lastName: 'User'
      };

      const user = await User.create(userData);

      expect(user).toBeInstanceOf(User);
      expect(user.email).toBe('test@example.com');
      expect(user.username).toBe('testuser');
      expect(bcrypt.hash).toHaveBeenCalledWith('Password123!', 12);
    });

    test('should throw error if user already exists', async () => {
      // Mock existing user
      const existingUser = {
        id: 'existing-123',
        email: 'test@example.com',
        username: 'testuser'
      };

      mockDb.first.mockResolvedValue(existingUser);

      const userData = {
        email: 'test@example.com',
        username: 'testuser',
        password: 'Password123!'
      };

      await expect(User.create(userData)).rejects.toThrow('User with this email already exists');
    });

    test('should hash password with correct salt rounds', async () => {
      process.env.BCRYPT_ROUNDS = '14';
      bcrypt.hash.mockResolvedValue('hashedPassword');

      mockDb.first.mockResolvedValue(null);
      mockDb.returning.mockResolvedValue([{
        id: 'user-123',
        email: 'test@example.com',
        password_hash: 'hashedPassword'
      }]);

      await User.create({
        email: 'test@example.com',
        username: 'testuser',
        password: 'Password123!'
      });

      expect(bcrypt.hash).toHaveBeenCalledWith('Password123!', 14);
    });
  });

  describe('User Authentication', () => {
    test('should validate correct password', async () => {
      bcrypt.compare.mockResolvedValue(true);

      const user = new User({
        id: 'user-123',
        password_hash: 'hashedPassword'
      });

      const isValid = await user.validatePassword('correctPassword');

      expect(isValid).toBe(true);
      expect(bcrypt.compare).toHaveBeenCalledWith('correctPassword', 'hashedPassword');
    });

    test('should reject incorrect password', async () => {
      bcrypt.compare.mockResolvedValue(false);

      const user = new User({
        id: 'user-123',
        password_hash: 'hashedPassword'
      });

      const isValid = await user.validatePassword('wrongPassword');

      expect(isValid).toBe(false);
    });

    test('should generate JWT token correctly', () => {
      jwt.sign.mockReturnValue('jwt-token-123');

      const user = new User({
        id: 'user-123',
        email: 'test@example.com',
        username: 'testuser',
        is_active: true,
        email_verified: true
      });

      const token = user.generateJWT();

      expect(token).toBe('jwt-token-123');
      expect(jwt.sign).toHaveBeenCalledWith(
        {
          id: 'user-123',
          email: 'test@example.com',
          username: 'testuser',
          isActive: true,
          emailVerified: true
        },
        process.env.JWT_SECRET,
        {
          expiresIn: process.env.JWT_EXPIRES_IN || '7d',
          issuer: 'todo-app',
          audience: 'todo-app-users'
        }
      );
    });
  });

  describe('User Queries', () => {
    test('should find user by ID with caching', async () => {
      const mockUserData = {
        id: 'user-123',
        email: 'test@example.com',
        username: 'testuser'
      };

      // Mock cache miss, then database hit
      redisManager.get.mockResolvedValue(null);
      mockDb.first.mockResolvedValue(mockUserData);
      redisManager.set.mockResolvedValue(true);

      const user = await User.findById('user-123');

      expect(user).toBeInstanceOf(User);
      expect(user.id).toBe('user-123');
      expect(redisManager.get).toHaveBeenCalledWith('user:user-123');
      expect(redisManager.set).toHaveBeenCalledWith('user:user-123', mockUserData, 1800);
    });

    test('should return cached user data', async () => {
      const cachedUserData = {
        id: 'user-123',
        email: 'test@example.com',
        username: 'testuser'
      };

      redisManager.get.mockResolvedValue(cachedUserData);

      const user = await User.findById('user-123');

      expect(user).toBeInstanceOf(User);
      expect(user.id).toBe('user-123');
      expect(mockDb.first).not.toHaveBeenCalled(); // Should not hit database
    });

    test('should find user by email', async () => {
      const mockUserData = {
        id: 'user-123',
        email: 'test@example.com'
      };

      mockDb.first.mockResolvedValue(mockUserData);

      const user = await User.findByEmail('test@example.com');

      expect(user).toBeInstanceOf(User);
      expect(mockDb.where).toHaveBeenCalledWith('email', 'test@example.com');
    });

    test('should return null for non-existent user', async () => {
      mockDb.first.mockResolvedValue(null);

      const user = await User.findById('non-existent');

      expect(user).toBeNull();
    });
  });

  describe('User Updates', () => {
    test('should update user profile successfully', async () => {
      const user = new User({
        id: 'user-123',
        email: 'test@example.com',
        first_name: 'Old',
        last_name: 'Name'
      });

      const updatedData = {
        id: 'user-123',
        first_name: 'New',
        last_name: 'Name',
        updated_at: new Date()
      };

      mockDb.returning.mockResolvedValue([updatedData]);
      redisManager.del.mockResolvedValue(true);

      await user.update({
        first_name: 'New',
        last_name: 'Name'
      });

      expect(user.firstName).toBe('New');
      expect(mockDb.update).toHaveBeenCalled();
      expect(redisManager.del).toHaveBeenCalledWith('user:user-123');
    });

    test('should update password and clear reset tokens', async () => {
      bcrypt.hash.mockResolvedValue('newHashedPassword');

      const user = new User({
        id: 'user-123',
        password_hash: 'oldHash',
        password_reset_token: 'reset-token',
        password_reset_expires: new Date()
      });

      mockDb.update.mockResolvedValue(1);
      redisManager.del.mockResolvedValue(true);

      await user.updatePassword('newPassword123!');

      expect(bcrypt.hash).toHaveBeenCalledWith('newPassword123!', 12);
      expect(user.passwordHash).toBe('newHashedPassword');
      expect(user.passwordResetToken).toBeNull();
      expect(user.passwordResetExpires).toBeNull();
    });

    test('should record successful login attempt', async () => {
      const user = new User({
        id: 'user-123',
        failed_login_attempts: 2,
        locked_until: new Date()
      });

      mockDb.update.mockResolvedValue(1);
      redisManager.del.mockResolvedValue(true);

      await user.recordLoginAttempt(true, '192.168.1.1');

      expect(mockDb.update).toHaveBeenCalledWith({
        last_login_ip: '192.168.1.1',
        last_login_at: expect.any(Date),
        failed_login_attempts: 0,
        locked_until: null,
        updated_at: expect.any(Date)
      });
    });

    test('should lock account after 5 failed attempts', async () => {
      const user = new User({
        id: 'user-123',
        failed_login_attempts: 4 // Will become 5 after this attempt
      });

      mockDb.update.mockResolvedValue(1);
      redisManager.del.mockResolvedValue(true);

      await user.recordLoginAttempt(false, '192.168.1.1');

      expect(mockDb.update).toHaveBeenCalledWith(
        expect.objectContaining({
          failed_login_attempts: 5,
          locked_until: expect.any(Date)
        })
      );
    });
  });

  describe('User Email Verification', () => {
    test('should verify email successfully', async () => {
      const user = new User({
        id: 'user-123',
        email_verified: false,
        email_verification_token: 'verify-token'
      });

      mockDb.update.mockResolvedValue(1);
      redisManager.del.mockResolvedValue(true);

      await user.verifyEmail();

      expect(user.emailVerified).toBe(true);
      expect(user.emailVerificationToken).toBeNull();
      expect(mockDb.update).toHaveBeenCalledWith({
        email_verified: true,
        email_verified_at: expect.any(Date),
        email_verification_token: null,
        updated_at: expect.any(Date)
      });
    });

    test('should generate password reset token', async () => {
      const user = new User({
        id: 'user-123'
      });

      mockDb.update.mockResolvedValue(1);
      redisManager.del.mockResolvedValue(true);

      const token = await user.generatePasswordResetToken();

      expect(typeof token).toBe('string');
      expect(token).toHaveLength(36); // UUID length
      expect(user.passwordResetToken).toBe(token);
      expect(user.passwordResetExpires).toBeInstanceOf(Date);
    });
  });

  describe('User Account Status', () => {
    test('should detect locked account', () => {
      const futureDate = new Date(Date.now() + 60000); // 1 minute in future
      const user = new User({
        locked_until: futureDate
      });

      expect(user.isLocked()).toBe(true);
    });

    test('should detect unlocked account', () => {
      const pastDate = new Date(Date.now() - 60000); // 1 minute ago
      const user = new User({
        locked_until: pastDate
      });

      expect(user.isLocked()).toBe(false);
    });

    test('should unlock account', async () => {
      const user = new User({
        id: 'user-123',
        failed_login_attempts: 5,
        locked_until: new Date()
      });

      mockDb.update.mockResolvedValue(1);
      redisManager.del.mockResolvedValue(true);

      await user.unlockAccount();

      expect(user.failedLoginAttempts).toBe(0);
      expect(user.lockedUntil).toBeNull();
    });
  });

  describe('User Statistics', () => {
    test('should get user stats with caching', async () => {
      const user = new User({ id: 'user-123' });

      // Mock cache miss
      redisManager.get.mockResolvedValue(null);

      // Mock database query result
      const mockStats = {
        total_todos: '10',
        completed_todos: '6',
        pending_todos: '4',
        high_priority_todos: '2',
        overdue_todos: '1'
      };

      mockDb.select.mockResolvedValue([mockStats]);
      redisManager.set.mockResolvedValue(true);

      const stats = await user.getStats();

      expect(stats).toEqual({
        totalTodos: 10,
        completedTodos: 6,
        pendingTodos: 4,
        highPriorityTodos: 2,
        overdueTodos: 1,
        completionRate: 60
      });

      expect(redisManager.set).toHaveBeenCalledWith('user_stats:user-123', expect.any(Object), 300);
    });

    test('should return cached stats', async () => {
      const user = new User({ id: 'user-123' });

      const cachedStats = {
        totalTodos: 5,
        completedTodos: 3,
        completionRate: 60
      };

      redisManager.get.mockResolvedValue(cachedStats);

      const stats = await user.getStats();

      expect(stats).toEqual(cachedStats);
      expect(mockDb.select).not.toHaveBeenCalled();
    });
  });

  describe('User Serialization', () => {
    test('should convert to safe object without sensitive data', () => {
      const user = new User({
        id: 'user-123',
        email: 'test@example.com',
        username: 'testuser',
        password_hash: 'secretHash',
        first_name: 'Test',
        last_name: 'User',
        is_active: true,
        email_verified: true,
        created_at: new Date(),
        updated_at: new Date()
      });

      const safeObject = user.toSafeObject();

      expect(safeObject).not.toHaveProperty('passwordHash');
      expect(safeObject).not.toHaveProperty('password_hash');
      expect(safeObject).toHaveProperty('id');
      expect(safeObject).toHaveProperty('email');
      expect(safeObject).toHaveProperty('username');
      expect(safeObject).toHaveProperty('firstName');
      expect(safeObject).toHaveProperty('lastName');
    });

    test('should convert to JSON without sensitive data', () => {
      const user = new User({
        id: 'user-123',
        email: 'test@example.com',
        password_hash: 'secretHash'
      });

      const json = JSON.stringify(user);
      const parsed = JSON.parse(json);

      expect(parsed).not.toHaveProperty('passwordHash');
      expect(parsed).not.toHaveProperty('password_hash');
      expect(parsed).toHaveProperty('id');
      expect(parsed).toHaveProperty('email');
    });
  });

  describe('Error Handling', () => {
    test('should handle database errors gracefully', async () => {
      mockDb.first.mockRejectedValue(new Error('Database connection failed'));

      await expect(User.findById('user-123')).rejects.toThrow('Database connection failed');
    });

    test('should handle Redis errors gracefully', async () => {
      redisManager.get.mockRejectedValue(new Error('Redis connection failed'));
      mockDb.first.mockResolvedValue({ id: 'user-123' });

      // Should still work when Redis fails
      const user = await User.findById('user-123');
      expect(user).toBeInstanceOf(User);
    });

    test('should handle password hashing errors', async () => {
      bcrypt.hash.mockRejectedValue(new Error('Hashing failed'));

      await expect(User.create({
        email: 'test@example.com',
        username: 'testuser',
        password: 'password'
      })).rejects.toThrow('Hashing failed');
    });
  });

  describe('Input Validation', () => {
    test('should lowercase email addresses', async () => {
      mockDb.first.mockResolvedValue(null);
      mockDb.returning.mockResolvedValue([{
        id: 'user-123',
        email: 'test@example.com'
      }]);
      bcrypt.hash.mockResolvedValue('hash');

      await User.create({
        email: 'TEST@EXAMPLE.COM',
        username: 'testuser',
        password: 'Password123!'
      });

      expect(mockDb.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'test@example.com'
        })
      );
    });

    test('should handle JSON preferences correctly', async () => {
      const user = new User({
        id: 'user-123',
        preferences: '{"theme": "dark", "notifications": true}'
      });

      expect(user.preferences).toEqual({
        theme: 'dark',
        notifications: true
      });
    });
  });
});
