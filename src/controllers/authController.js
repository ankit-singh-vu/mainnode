const User = require('../models/User');
const logger = require('../config/logger');
const redisManager = require('../config/redis');
const { validationResult } = require('express-validator');

class AuthController {
  // Register a new user
  static async register(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: errors.array()
        });
      }

      const { email, username, password, firstName, lastName } = req.body;

      // Check rate limiting for registration
      const registrationKey = `registration:${req.ip}`;
      const registrationCount = await redisManager.get(registrationKey) || 0;

      if (registrationCount >= 3) { // Max 3 registrations per hour per IP
        logger.security.suspiciousActivity('Too many registration attempts', {
          ip: req.ip,
          count: registrationCount
        });

        return res.status(429).json({
          success: false,
          error: 'Too many registration attempts. Please try again later.',
          code: 'REGISTRATION_RATE_LIMIT'
        });
      }

      // Create user
      const user = await User.create({
        email,
        username,
        password,
        firstName,
        lastName
      });

      // Increment registration counter
      await redisManager.set(registrationKey, registrationCount + 1, 3600);

      // Generate JWT token
      const token = user.generateJWT();

      // Store token in Redis for session management
      await redisManager.set(`session:${user.id}`, token, 7 * 24 * 60 * 60); // 7 days

      logger.info('User registered successfully', {
        userId: user.id,
        email: user.email,
        ip: req.ip
      });

      res.status(201).json({
        success: true,
        message: 'User registered successfully',
        data: {
          user: user.toSafeObject(),
          token,
          expiresIn: '7d'
        }
      });

    } catch (error) {
      logger.error('Registration error:', {
        error: error.message,
        email: req.body?.email,
        ip: req.ip
      });

      if (error.message.includes('already exists')) {
        return res.status(409).json({
          success: false,
          error: error.message,
          code: 'USER_ALREADY_EXISTS'
        });
      }

      res.status(500).json({
        success: false,
        error: 'Registration failed',
        code: 'REGISTRATION_ERROR'
      });
    }
  }

  // Login user
  static async login(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: errors.array()
        });
      }

      const { email, password } = req.body;
      const ip = req.ip;

      // Check rate limiting for login attempts
      const loginKey = `login_attempts:${ip}`;
      const loginAttempts = await redisManager.get(loginKey) || 0;

      if (loginAttempts >= 10) { // Max 10 attempts per hour per IP
        logger.security.rateLimitExceeded(ip, '/auth/login');

        return res.status(429).json({
          success: false,
          error: 'Too many login attempts. Please try again later.',
          code: 'LOGIN_RATE_LIMIT'
        });
      }

      // Find user by email
      const user = await User.findByEmail(email);
      if (!user) {
        // Increment failed attempts
        await redisManager.set(loginKey, loginAttempts + 1, 3600);

        logger.security.loginAttempt(email, false, ip);

        return res.status(401).json({
          success: false,
          error: 'Invalid credentials',
          code: 'INVALID_CREDENTIALS'
        });
      }

      // Check if account is locked
      if (user.isLocked()) {
        logger.security.suspiciousActivity('Login attempt on locked account', {
          userId: user.id,
          email: user.email,
          ip
        });

        return res.status(423).json({
          success: false,
          error: 'Account is temporarily locked due to multiple failed login attempts',
          code: 'ACCOUNT_LOCKED'
        });
      }

      // Check if account is active
      if (!user.isActive) {
        logger.security.suspiciousActivity('Login attempt on inactive account', {
          userId: user.id,
          email: user.email,
          ip
        });

        return res.status(403).json({
          success: false,
          error: 'Account is deactivated',
          code: 'ACCOUNT_INACTIVE'
        });
      }

      // Validate password
      const isValidPassword = await user.validatePassword(password);
      if (!isValidPassword) {
        // Record failed login attempt
        await user.recordLoginAttempt(false, ip);

        // Increment IP-based rate limiting
        await redisManager.set(loginKey, loginAttempts + 1, 3600);

        return res.status(401).json({
          success: false,
          error: 'Invalid credentials',
          code: 'INVALID_CREDENTIALS'
        });
      }

      // Success - record login attempt
      await user.recordLoginAttempt(true, ip);

      // Reset IP-based rate limiting on successful login
      await redisManager.del(loginKey);

      // Generate JWT token
      const token = user.generateJWT();

      // Store token in Redis for session management
      await redisManager.set(`session:${user.id}`, token, 7 * 24 * 60 * 60); // 7 days

      // Store user session info
      await redisManager.set(`user_session:${user.id}`, {
        ip,
        userAgent: req.get('User-Agent'),
        loginAt: new Date().toISOString()
      }, 7 * 24 * 60 * 60);

      logger.info('User logged in successfully', {
        userId: user.id,
        email: user.email,
        ip
      });

      res.json({
        success: true,
        message: 'Login successful',
        data: {
          user: user.toSafeObject(),
          token,
          expiresIn: '7d'
        }
      });

    } catch (error) {
      logger.error('Login error:', {
        error: error.message,
        email: req.body?.email,
        ip: req.ip
      });

      res.status(500).json({
        success: false,
        error: 'Login failed',
        code: 'LOGIN_ERROR'
      });
    }
  }

  // Logout user
  static async logout(req, res) {
    try {
      const { user, token } = req;

      // Add token to blacklist
      if (token) {
        // Get token expiration time
        const jwt = require('jsonwebtoken');
        const decoded = jwt.decode(token);
        const expiresIn = decoded.exp - Math.floor(Date.now() / 1000);

        if (expiresIn > 0) {
          await redisManager.set(`blacklist:${token}`, true, expiresIn);
        }
      }

      // Remove session data
      await redisManager.del(`session:${user.id}`);
      await redisManager.del(`user_session:${user.id}`);

      logger.info('User logged out', {
        userId: user.id,
        email: user.email,
        ip: req.ip
      });

      res.json({
        success: true,
        message: 'Logout successful'
      });

    } catch (error) {
      logger.error('Logout error:', {
        error: error.message,
        userId: req.user?.id,
        ip: req.ip
      });

      res.status(500).json({
        success: false,
        error: 'Logout failed',
        code: 'LOGOUT_ERROR'
      });
    }
  }

  // Get current user profile
  static async getProfile(req, res) {
    try {
      const user = await User.findById(req.user.id);

      if (!user) {
        return res.status(404).json({
          success: false,
          error: 'User not found',
          code: 'USER_NOT_FOUND'
        });
      }

      // Get user statistics
      const stats = await user.getStats();

      res.json({
        success: true,
        data: {
          user: user.toSafeObject(),
          stats
        }
      });

    } catch (error) {
      logger.error('Get profile error:', {
        error: error.message,
        userId: req.user?.id
      });

      res.status(500).json({
        success: false,
        error: 'Failed to get profile',
        code: 'PROFILE_ERROR'
      });
    }
  }

  // Update user profile
  static async updateProfile(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: errors.array()
        });
      }

      const { firstName, lastName, preferences } = req.body;
      const user = await User.findById(req.user.id);

      if (!user) {
        return res.status(404).json({
          success: false,
          error: 'User not found',
          code: 'USER_NOT_FOUND'
        });
      }

      // Update user
      await user.update({
        first_name: firstName,
        last_name: lastName,
        preferences
      });

      logger.info('User profile updated', {
        userId: user.id,
        fields: { firstName, lastName, preferences }
      });

      res.json({
        success: true,
        message: 'Profile updated successfully',
        data: {
          user: user.toSafeObject()
        }
      });

    } catch (error) {
      logger.error('Update profile error:', {
        error: error.message,
        userId: req.user?.id
      });

      res.status(500).json({
        success: false,
        error: 'Failed to update profile',
        code: 'UPDATE_PROFILE_ERROR'
      });
    }
  }

  // Change password
  static async changePassword(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: errors.array()
        });
      }

      const { currentPassword, newPassword } = req.body;
      const user = await User.findById(req.user.id);

      if (!user) {
        return res.status(404).json({
          success: false,
          error: 'User not found',
          code: 'USER_NOT_FOUND'
        });
      }

      // Validate current password
      const isValidPassword = await user.validatePassword(currentPassword);
      if (!isValidPassword) {
        logger.security.suspiciousActivity('Invalid current password in change password attempt', {
          userId: user.id,
          ip: req.ip
        });

        return res.status(401).json({
          success: false,
          error: 'Current password is incorrect',
          code: 'INVALID_CURRENT_PASSWORD'
        });
      }

      // Update password
      await user.updatePassword(newPassword);

      // Invalidate all sessions for this user
      await redisManager.deletePattern(`session:${user.id}`);
      await redisManager.deletePattern(`user_session:${user.id}`);

      // Generate new token
      const token = user.generateJWT();
      await redisManager.set(`session:${user.id}`, token, 7 * 24 * 60 * 60);

      logger.info('Password changed successfully', {
        userId: user.id,
        ip: req.ip
      });

      res.json({
        success: true,
        message: 'Password changed successfully',
        data: {
          token,
          expiresIn: '7d'
        }
      });

    } catch (error) {
      logger.error('Change password error:', {
        error: error.message,
        userId: req.user?.id
      });

      res.status(500).json({
        success: false,
        error: 'Failed to change password',
        code: 'CHANGE_PASSWORD_ERROR'
      });
    }
  }

  // Request password reset
  static async requestPasswordReset(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: errors.array()
        });
      }

      const { email } = req.body;

      // Rate limiting for password reset requests
      const resetKey = `password_reset:${req.ip}`;
      const resetCount = await redisManager.get(resetKey) || 0;

      if (resetCount >= 5) { // Max 5 reset requests per hour per IP
        return res.status(429).json({
          success: false,
          error: 'Too many password reset requests. Please try again later.',
          code: 'RESET_RATE_LIMIT'
        });
      }

      const user = await User.findByEmail(email);

      // Always return success to prevent email enumeration
      // but only send email if user exists
      if (user && user.isActive) {
        await user.generatePasswordResetToken();

        // In a real application, you would send an email here
        logger.info('Password reset token generated', {
          userId: user.id,
          email: user.email,
          ip: req.ip
        });
      }

      // Increment rate limiting counter
      await redisManager.set(resetKey, resetCount + 1, 3600);

      // Always return success response
      res.json({
        success: true,
        message: 'If an account with that email exists, a password reset link has been sent.'
      });

    } catch (error) {
      logger.error('Password reset request error:', {
        error: error.message,
        email: req.body?.email,
        ip: req.ip
      });

      res.status(500).json({
        success: false,
        error: 'Failed to process password reset request',
        code: 'RESET_REQUEST_ERROR'
      });
    }
  }

  // Reset password with token
  static async resetPassword(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: errors.array()
        });
      }

      const { token, newPassword } = req.body;

      const user = await User.findByPasswordResetToken(token);
      if (!user) {
        return res.status(400).json({
          success: false,
          error: 'Invalid or expired reset token',
          code: 'INVALID_RESET_TOKEN'
        });
      }

      // Update password
      await user.updatePassword(newPassword);

      // Invalidate all sessions for this user
      await redisManager.deletePattern(`session:${user.id}`);
      await redisManager.deletePattern(`user_session:${user.id}`);

      logger.info('Password reset completed', {
        userId: user.id,
        ip: req.ip
      });

      res.json({
        success: true,
        message: 'Password reset successfully'
      });

    } catch (error) {
      logger.error('Password reset error:', {
        error: error.message,
        ip: req.ip
      });

      res.status(500).json({
        success: false,
        error: 'Failed to reset password',
        code: 'RESET_PASSWORD_ERROR'
      });
    }
  }

  // Verify email
  static async verifyEmail(req, res) {
    try {
      const { token } = req.params;

      const user = await User.findByEmailVerificationToken(token);
      if (!user) {
        return res.status(400).json({
          success: false,
          error: 'Invalid verification token',
          code: 'INVALID_VERIFICATION_TOKEN'
        });
      }

      await user.verifyEmail();

      logger.info('Email verified', {
        userId: user.id,
        email: user.email
      });

      res.json({
        success: true,
        message: 'Email verified successfully'
      });

    } catch (error) {
      logger.error('Email verification error:', {
        error: error.message,
        token: req.params?.token
      });

      res.status(500).json({
        success: false,
        error: 'Failed to verify email',
        code: 'EMAIL_VERIFICATION_ERROR'
      });
    }
  }

  // Refresh token
  static async refreshToken(req, res) {
    try {
      const user = await User.findById(req.user.id);

      if (!user || !user.isActive) {
        return res.status(401).json({
          success: false,
          error: 'User not found or inactive',
          code: 'USER_INACTIVE'
        });
      }

      // Generate new token
      const token = user.generateJWT();

      // Update session
      await redisManager.set(`session:${user.id}`, token, 7 * 24 * 60 * 60);

      // Blacklist old token
      if (req.token) {
        const jwt = require('jsonwebtoken');
        const decoded = jwt.decode(req.token);
        const expiresIn = decoded.exp - Math.floor(Date.now() / 1000);

        if (expiresIn > 0) {
          await redisManager.set(`blacklist:${req.token}`, true, expiresIn);
        }
      }

      res.json({
        success: true,
        message: 'Token refreshed successfully',
        data: {
          token,
          expiresIn: '7d'
        }
      });

    } catch (error) {
      logger.error('Token refresh error:', {
        error: error.message,
        userId: req.user?.id
      });

      res.status(500).json({
        success: false,
        error: 'Failed to refresh token',
        code: 'TOKEN_REFRESH_ERROR'
      });
    }
  }

  // Get active sessions
  static async getActiveSessions(req, res) {
    try {
      const sessionData = await redisManager.get(`user_session:${req.user.id}`);

      res.json({
        success: true,
        data: {
          currentSession: sessionData || null,
          // In a more complex system, you might track multiple sessions
        }
      });

    } catch (error) {
      logger.error('Get active sessions error:', {
        error: error.message,
        userId: req.user?.id
      });

      res.status(500).json({
        success: false,
        error: 'Failed to get active sessions',
        code: 'GET_SESSIONS_ERROR'
      });
    }
  }
}

module.exports = AuthController;
