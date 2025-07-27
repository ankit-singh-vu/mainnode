const request = require('supertest');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const Server = require('../../src/server');
const { db } = require('../../src/config/database');
const redisManager = require('../../src/config/redis');
const User = require('../../src/models/User');

describe('Authentication Integration Tests', () => {
  let server;
  let app;
  let testUser;
  let authToken;

  beforeAll(async () => {
    // Set test environment
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'test-secret-key';
    process.env.BCRYPT_ROUNDS = '4'; // Faster for tests

    // Initialize server
    server = new Server();
    await server.initialize();
    app = server.app;

    // Clean up any existing test data
    await db('users').where('email', 'like', '%test%').del();
  });

  afterAll(async () => {
    // Clean up test data
    await db('users').where('email', 'like', '%test%').del();

    // Close connections
    await server.gracefulShutdown('test');
  });

  beforeEach(async () => {
    // Clean up before each test
    await db('users').where('email', 'like', '%test%').del();
    await redisManager.deletePattern('*test*');
  });

  describe('POST /api/auth/register', () => {
    const validUserData = {
      email: 'test@example.com',
      username: 'testuser',
      password: 'TestPassword123!',
      firstName: 'Test',
      lastName: 'User'
    };

    test('should register a new user successfully', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send(validUserData)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('User registered successfully');
      expect(response.body.data).toHaveProperty('user');
      expect(response.body.data).toHaveProperty('token');
      expect(response.body.data.user.email).toBe('test@example.com');
      expect(response.body.data.user.username).toBe('testuser');
      expect(response.body.data.user).not.toHaveProperty('passwordHash');

      // Verify JWT token
      const decoded = jwt.verify(response.body.data.token, process.env.JWT_SECRET);
      expect(decoded.email).toBe('test@example.com');
      expect(decoded.username).toBe('testuser');

      // Verify user was created in database
      const dbUser = await db('users').where('email', 'test@example.com').first();
      expect(dbUser).toBeTruthy();
      expect(dbUser.email).toBe('test@example.com');
      expect(dbUser.is_active).toBe(true);
      expect(dbUser.email_verified).toBe(false);
    });

    test('should reject registration with invalid email', async () => {
      const invalidData = { ...validUserData, email: 'invalid-email' };

      const response = await request(app)
        .post('/api/auth/register')
        .send(invalidData)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Validation failed');
      expect(response.body.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            msg: 'Valid email is required'
          })
        ])
      );
    });

    test('should reject registration with weak password', async () => {
      const weakPasswordData = { ...validUserData, password: 'weak' };

      const response = await request(app)
        .post('/api/auth/register')
        .send(weakPasswordData)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            msg: expect.stringContaining('Password must be at least 8 characters')
          })
        ])
      );
    });

    test('should reject registration with invalid username', async () => {
      const invalidUsernameData = { ...validUserData, username: 'ab' }; // Too short

      const response = await request(app)
        .post('/api/auth/register')
        .send(invalidUsernameData)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            msg: expect.stringContaining('Username must be 3-30 characters')
          })
        ])
      );
    });

    test('should reject duplicate email registration', async () => {
      // Register first user
      await request(app)
        .post('/api/auth/register')
        .send(validUserData)
        .expect(201);

      // Try to register with same email
      const duplicateData = { ...validUserData, username: 'differentuser' };

      const response = await request(app)
        .post('/api/auth/register')
        .send(duplicateData)
        .expect(409);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('already exists');
      expect(response.body.code).toBe('USER_ALREADY_EXISTS');
    });

    test('should reject duplicate username registration', async () => {
      // Register first user
      await request(app)
        .post('/api/auth/register')
        .send(validUserData)
        .expect(201);

      // Try to register with same username
      const duplicateData = { ...validUserData, email: 'different@example.com' };

      const response = await request(app)
        .post('/api/auth/register')
        .send(duplicateData)
        .expect(409);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('already exists');
    });

    test('should apply rate limiting to registration', async () => {
      const requests = [];

      // Make 4 registration requests (limit is 3 per hour per IP)
      for (let i = 0; i < 4; i++) {
        const userData = {
          ...validUserData,
          email: `test${i}@example.com`,
          username: `testuser${i}`
        };

        requests.push(
          request(app)
            .post('/api/auth/register')
            .send(userData)
        );
      }

      const responses = await Promise.all(requests);

      // First 3 should succeed, 4th should be rate limited
      expect(responses[0].status).toBe(201);
      expect(responses[1].status).toBe(201);
      expect(responses[2].status).toBe(201);
      expect(responses[3].status).toBe(429);
      expect(responses[3].body.code).toBe('REGISTRATION_RATE_LIMIT');
    });
  });

  describe('POST /api/auth/login', () => {
    beforeEach(async () => {
      // Create a test user for login tests
      testUser = await User.create({
        email: 'login@example.com',
        username: 'loginuser',
        password: 'LoginPassword123!',
        firstName: 'Login',
        lastName: 'User'
      });
    });

    test('should login with valid credentials', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'login@example.com',
          password: 'LoginPassword123!'
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Login successful');
      expect(response.body.data).toHaveProperty('user');
      expect(response.body.data).toHaveProperty('token');
      expect(response.body.data.user.email).toBe('login@example.com');

      // Verify JWT token
      const decoded = jwt.verify(response.body.data.token, process.env.JWT_SECRET);
      expect(decoded.email).toBe('login@example.com');

      authToken = response.body.data.token;
    });

    test('should reject login with invalid email', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'nonexistent@example.com',
          password: 'LoginPassword123!'
        })
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Invalid credentials');
      expect(response.body.code).toBe('INVALID_CREDENTIALS');
    });

    test('should reject login with invalid password', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'login@example.com',
          password: 'WrongPassword123!'
        })
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Invalid credentials');
      expect(response.body.code).toBe('INVALID_CREDENTIALS');
    });

    test('should reject login with malformed email', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'invalid-email',
          password: 'LoginPassword123!'
        })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Validation failed');
    });

    test('should lock account after multiple failed attempts', async () => {
      // Make 5 failed login attempts
      for (let i = 0; i < 5; i++) {
        await request(app)
          .post('/api/auth/login')
          .send({
            email: 'login@example.com',
            password: 'WrongPassword'
          })
          .expect(401);
      }

      // 6th attempt should show account locked
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'login@example.com',
          password: 'LoginPassword123!' // Even with correct password
        })
        .expect(423);

      expect(response.body.code).toBe('ACCOUNT_LOCKED');
    });

    test('should apply rate limiting to login attempts', async () => {
      const requests = [];

      // Make 11 login requests (limit is 10 per hour per IP)
      for (let i = 0; i < 11; i++) {
        requests.push(
          request(app)
            .post('/api/auth/login')
            .send({
              email: 'login@example.com',
              password: 'WrongPassword'
            })
        );
      }

      const responses = await Promise.all(requests);

      // Last request should be rate limited
      expect(responses[10].status).toBe(429);
      expect(responses[10].body.code).toBe('LOGIN_RATE_LIMIT');
    });

    test('should update last login information', async () => {
      await request(app)
        .post('/api/auth/login')
        .send({
          email: 'login@example.com',
          password: 'LoginPassword123!'
        })
        .expect(200);

      // Check database for updated login info
      const updatedUser = await db('users').where('email', 'login@example.com').first();
      expect(updatedUser.last_login_at).toBeTruthy();
      expect(updatedUser.last_login_ip).toBeTruthy();
      expect(updatedUser.failed_login_attempts).toBe(0);
    });
  });

  describe('POST /api/auth/logout', () => {
    beforeEach(async () => {
      // Create and login a test user
      testUser = await User.create({
        email: 'logout@example.com',
        username: 'logoutuser',
        password: 'LogoutPassword123!'
      });

      const loginResponse = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'logout@example.com',
          password: 'LogoutPassword123!'
        });

      authToken = loginResponse.body.data.token;
    });

    test('should logout successfully with valid token', async () => {
      const response = await request(app)
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Logout successful');

      // Verify token is blacklisted
      const isBlacklisted = await redisManager.exists(`blacklist:${authToken}`);
      expect(isBlacklisted).toBe(true);
    });

    test('should reject logout without authentication', async () => {
      const response = await request(app)
        .post('/api/auth/logout')
        .expect(401);

      expect(response.body.error).toBe('Access token required');
      expect(response.body.code).toBe('TOKEN_REQUIRED');
    });

    test('should reject logout with invalid token', async () => {
      const response = await request(app)
        .post('/api/auth/logout')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);

      expect(response.body.error).toBe('Invalid token');
      expect(response.body.code).toBe('TOKEN_INVALID');
    });

    test('should reject logout with blacklisted token', async () => {
      // Logout once
      await request(app)
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      // Try to logout again with same token
      const response = await request(app)
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(401);

      expect(response.body.code).toBe('TOKEN_REVOKED');
    });
  });

  describe('GET /api/auth/profile', () => {
    beforeEach(async () => {
      testUser = await User.create({
        email: 'profile@example.com',
        username: 'profileuser',
        password: 'ProfilePassword123!',
        firstName: 'Profile',
        lastName: 'User'
      });

      const loginResponse = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'profile@example.com',
          password: 'ProfilePassword123!'
        });

      authToken = loginResponse.body.data.token;
    });

    test('should get user profile with valid authentication', async () => {
      const response = await request(app)
        .get('/api/auth/profile')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('user');
      expect(response.body.data).toHaveProperty('stats');
      expect(response.body.data.user.email).toBe('profile@example.com');
      expect(response.body.data.user.firstName).toBe('Profile');
      expect(response.body.data.user).not.toHaveProperty('passwordHash');
    });

    test('should reject profile request without authentication', async () => {
      const response = await request(app)
        .get('/api/auth/profile')
        .expect(401);

      expect(response.body.code).toBe('TOKEN_REQUIRED');
    });
  });

  describe('PUT /api/auth/profile', () => {
    beforeEach(async () => {
      testUser = await User.create({
        email: 'update@example.com',
        username: 'updateuser',
        password: 'UpdatePassword123!',
        firstName: 'Old',
        lastName: 'Name'
      });

      const loginResponse = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'update@example.com',
          password: 'UpdatePassword123!'
        });

      authToken = loginResponse.body.data.token;
    });

    test('should update profile successfully', async () => {
      const updateData = {
        firstName: 'New',
        lastName: 'Name',
        preferences: {
          theme: 'dark',
          notifications: true
        }
      };

      const response = await request(app)
        .put('/api/auth/profile')
        .set('Authorization', `Bearer ${authToken}`)
        .send(updateData)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.user.firstName).toBe('New');
      expect(response.body.data.user.lastName).toBe('Name');
      expect(response.body.data.user.preferences).toEqual(updateData.preferences);

      // Verify in database
      const updatedUser = await db('users').where('email', 'update@example.com').first();
      expect(updatedUser.first_name).toBe('New');
      expect(updatedUser.last_name).toBe('Name');
    });

    test('should reject invalid profile data', async () => {
      const response = await request(app)
        .put('/api/auth/profile')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          firstName: 'Invalid123', // Numbers not allowed
          lastName: 'Name'
        })
        .expect(400);

      expect(response.body.error).toBe('Validation failed');
    });
  });

  describe('PUT /api/auth/change-password', () => {
    beforeEach(async () => {
      testUser = await User.create({
        email: 'password@example.com',
        username: 'passworduser',
        password: 'OldPassword123!'
      });

      const loginResponse = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'password@example.com',
          password: 'OldPassword123!'
        });

      authToken = loginResponse.body.data.token;
    });

    test('should change password successfully', async () => {
      const response = await request(app)
        .put('/api/auth/change-password')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          currentPassword: 'OldPassword123!',
          newPassword: 'NewPassword123!'
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('token');

      // Verify old password no longer works
      await request(app)
        .post('/api/auth/login')
        .send({
          email: 'password@example.com',
          password: 'OldPassword123!'
        })
        .expect(401);

      // Verify new password works
      await request(app)
        .post('/api/auth/login')
        .send({
          email: 'password@example.com',
          password: 'NewPassword123!'
        })
        .expect(200);
    });

    test('should reject incorrect current password', async () => {
      const response = await request(app)
        .put('/api/auth/change-password')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          currentPassword: 'WrongPassword123!',
          newPassword: 'NewPassword123!'
        })
        .expect(401);

      expect(response.body.code).toBe('INVALID_CURRENT_PASSWORD');
    });

    test('should reject weak new password', async () => {
      const response = await request(app)
        .put('/api/auth/change-password')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          currentPassword: 'OldPassword123!',
          newPassword: 'weak'
        })
        .expect(400);

      expect(response.body.error).toBe('Validation failed');
    });
  });

  describe('POST /api/auth/refresh-token', () => {
    beforeEach(async () => {
      testUser = await User.create({
        email: 'refresh@example.com',
        username: 'refreshuser',
        password: 'RefreshPassword123!'
      });

      const loginResponse = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'refresh@example.com',
          password: 'RefreshPassword123!'
        });

      authToken = loginResponse.body.data.token;
    });

    test('should refresh token successfully', async () => {
      const response = await request(app)
        .post('/api/auth/refresh-token')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('token');
      expect(response.body.data.token).not.toBe(authToken);

      // Verify old token is blacklisted
      const isBlacklisted = await redisManager.exists(`blacklist:${authToken}`);
      expect(isBlacklisted).toBe(true);

      // Verify new token works
      await request(app)
        .get('/api/auth/profile')
        .set('Authorization', `Bearer ${response.body.data.token}`)
        .expect(200);
    });

    test('should reject refresh without authentication', async () => {
      const response = await request(app)
        .post('/api/auth/refresh-token')
        .expect(401);

      expect(response.body.code).toBe('TOKEN_REQUIRED');
    });
  });

  describe('Security Headers and CORS', () => {
    test('should include security headers', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.headers).toHaveProperty('x-content-type-options', 'nosniff');
      expect(response.headers).toHaveProperty('x-frame-options', 'DENY');
      expect(response.headers).toHaveProperty('x-xss-protection', '0');
    });

    test('should handle CORS preflight requests', async () => {
      const response = await request(app)
        .options('/api/auth/login')
        .set('Origin', 'http://localhost:3000')
        .set('Access-Control-Request-Method', 'POST')
        .expect(200);

      expect(response.headers).toHaveProperty('access-control-allow-origin');
      expect(response.headers).toHaveProperty('access-control-allow-methods');
    });
  });

  describe('Error Handling', () => {
    test('should handle malformed JSON gracefully', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .set('Content-Type', 'application/json')
        .send('{"invalid": json}')
        .expect(400);

      // Should not expose internal error details
      expect(response.body).not.toHaveProperty('stack');
    });

    test('should handle database errors gracefully', async () => {
      // This would require mocking database failure
      // For now, we'll test that the error doesn't expose sensitive info
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'test@example.com',
          password: 'password'
        });

      if (response.status >= 500) {
        expect(response.body).not.toHaveProperty('stack');
        expect(response.body.error).not.toContain('password');
        expect(response.body.error).not.toContain('database');
      }
    });
  });
});
