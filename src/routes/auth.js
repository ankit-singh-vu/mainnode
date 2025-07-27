const express = require('express');
const AuthController = require('../controllers/authController');
const {
  rateLimits,
  authenticateToken,
  validationRules,
  handleValidationErrors,
  xssProtection,
  sqlInjectionProtection
} = require('../middleware/security');

const router = express.Router();

// Apply security middleware to all auth routes
router.use(xssProtection);
router.use(sqlInjectionProtection);

// Public routes (no authentication required)

// Register new user
router.post('/register',
  rateLimits.auth, // Rate limiting for registration
  validationRules.registerUser,
  handleValidationErrors,
  AuthController.register
);

// Login user
router.post('/login',
  rateLimits.auth, // Rate limiting for login
  validationRules.loginUser,
  handleValidationErrors,
  AuthController.login
);

// Request password reset
router.post('/forgot-password',
  rateLimits.auth, // Rate limiting for password reset
  [
    require('express-validator').body('email')
      .isEmail()
      .normalizeEmail()
      .withMessage('Valid email is required')
  ],
  handleValidationErrors,
  AuthController.requestPasswordReset
);

// Reset password with token
router.post('/reset-password',
  rateLimits.auth,
  [
    require('express-validator').body('token')
      .notEmpty()
      .isLength({ min: 1 })
      .withMessage('Reset token is required'),
    require('express-validator').body('newPassword')
      .isLength({ min: 8 })
      .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
      .withMessage('Password must be at least 8 characters with uppercase, lowercase, number and special character')
  ],
  handleValidationErrors,
  AuthController.resetPassword
);

// Verify email
router.get('/verify-email/:token',
  rateLimits.general,
  [
    require('express-validator').param('token')
      .notEmpty()
      .isLength({ min: 1 })
      .withMessage('Verification token is required')
  ],
  handleValidationErrors,
  AuthController.verifyEmail
);

// Protected routes (authentication required)

// Logout user
router.post('/logout',
  rateLimits.general,
  authenticateToken,
  AuthController.logout
);

// Get current user profile
router.get('/profile',
  rateLimits.general,
  authenticateToken,
  AuthController.getProfile
);

// Update user profile
router.put('/profile',
  rateLimits.general,
  authenticateToken,
  [
    require('express-validator').body('firstName')
      .optional()
      .isLength({ max: 50 })
      .matches(/^[a-zA-Z\s]+$/)
      .withMessage('First name must contain only letters and spaces'),
    require('express-validator').body('lastName')
      .optional()
      .isLength({ max: 50 })
      .matches(/^[a-zA-Z\s]+$/)
      .withMessage('Last name must contain only letters and spaces'),
    require('express-validator').body('preferences')
      .optional()
      .isObject()
      .withMessage('Preferences must be an object')
  ],
  handleValidationErrors,
  AuthController.updateProfile
);

// Change password
router.put('/change-password',
  rateLimits.auth, // More restrictive rate limiting
  authenticateToken,
  [
    require('express-validator').body('currentPassword')
      .notEmpty()
      .withMessage('Current password is required'),
    require('express-validator').body('newPassword')
      .isLength({ min: 8 })
      .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
      .withMessage('New password must be at least 8 characters with uppercase, lowercase, number and special character')
  ],
  handleValidationErrors,
  AuthController.changePassword
);

// Refresh JWT token
router.post('/refresh-token',
  rateLimits.general,
  authenticateToken,
  AuthController.refreshToken
);

// Get active sessions
router.get('/sessions',
  rateLimits.general,
  authenticateToken,
  AuthController.getActiveSessions
);

// Health check endpoint for auth service
router.get('/health',
  rateLimits.general,
  (req, res) => {
    res.json({
      success: true,
      message: 'Auth service is healthy',
      timestamp: new Date().toISOString()
    });
  }
);

module.exports = router;
