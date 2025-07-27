const express = require("express");
const AuthController = require("../controllers/authController");
const {
  rateLimits,
  authenticateToken,
  validationRules,
  handleValidationErrors,
  xssProtection,
  sqlInjectionProtection,
} = require("../middleware/security");

const router = express.Router();

// Apply security middleware to all auth routes
router.use(xssProtection);
router.use(sqlInjectionProtection);

// Public routes (no authentication required)

/**
 * @swagger
 * components:
 *   schemas:
 *     User:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *           description: Unique user identifier
 *         email:
 *           type: string
 *           format: email
 *           description: User's email address
 *         username:
 *           type: string
 *           description: User's username
 *         firstName:
 *           type: string
 *           description: User's first name
 *         lastName:
 *           type: string
 *           description: User's last name
 *         isActive:
 *           type: boolean
 *           description: Whether the user account is active
 *         emailVerified:
 *           type: boolean
 *           description: Whether the user's email is verified
 *         createdAt:
 *           type: string
 *           format: date-time
 *           description: Account creation timestamp
 *         updatedAt:
 *           type: string
 *           format: date-time
 *           description: Last update timestamp
 *     AuthResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           description: Request success status
 *         message:
 *           type: string
 *           description: Response message
 *         data:
 *           type: object
 *           properties:
 *             user:
 *               $ref: '#/components/schemas/User'
 *             token:
 *               type: string
 *               description: JWT authentication token
 *             expiresIn:
 *               type: string
 *               description: Token expiration time
 *     RegisterRequest:
 *       type: object
 *       required:
 *         - email
 *         - username
 *         - password
 *       properties:
 *         email:
 *           type: string
 *           format: email
 *           description: User's email address
 *         username:
 *           type: string
 *           minLength: 3
 *           maxLength: 30
 *           description: Desired username
 *         password:
 *           type: string
 *           minLength: 8
 *           description: User's password
 *         firstName:
 *           type: string
 *           description: User's first name
 *         lastName:
 *           type: string
 *           description: User's last name
 *     LoginRequest:
 *       type: object
 *       required:
 *         - email
 *         - password
 *       properties:
 *         email:
 *           type: string
 *           format: email
 *           description: User's email address
 *         password:
 *           type: string
 *           description: User's password
 *     Error:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: false
 *         error:
 *           type: string
 *           description: Error message
 *         code:
 *           type: string
 *           description: Error code
 *         timestamp:
 *           type: string
 *           format: date-time
 *   securitySchemes:
 *     bearerAuth:
 *       type: http
 *       scheme: bearer
 *       bearerFormat: JWT
 */

/**
 * @swagger
 * /api/auth/register:
 *   post:
 *     summary: Register a new user
 *     description: Create a new user account with email, username, and password
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/RegisterRequest'
 *           example:
 *             email: "user@example.com"
 *             username: "johndoe"
 *             password: "securePassword123"
 *             firstName: "John"
 *             lastName: "Doe"
 *     responses:
 *       201:
 *         description: User registered successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AuthResponse'
 *             example:
 *               success: true
 *               message: "User registered successfully"
 *               data:
 *                 user:
 *                   id: 1
 *                   email: "user@example.com"
 *                   username: "johndoe"
 *                   firstName: "John"
 *                   lastName: "Doe"
 *                   isActive: true
 *                   emailVerified: false
 *                 token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
 *                 expiresIn: "7d"
 *       400:
 *         description: Validation error or user already exists
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               success: false
 *               error: "Email already exists"
 *               code: "VALIDATION_ERROR"
 *       429:
 *         description: Too many requests
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
  "/register",
  rateLimits.auth, // Rate limiting for registration
  validationRules.registerUser,
  handleValidationErrors,
  AuthController.register,
);

/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     summary: Login user
 *     description: Authenticate user with email and password
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/LoginRequest'
 *           example:
 *             email: "user@example.com"
 *             password: "securePassword123"
 *     responses:
 *       200:
 *         description: Login successful
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AuthResponse'
 *             example:
 *               success: true
 *               message: "Login successful"
 *               data:
 *                 user:
 *                   id: 1
 *                   email: "user@example.com"
 *                   username: "johndoe"
 *                   firstName: "John"
 *                   lastName: "Doe"
 *                 token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
 *                 expiresIn: "7d"
 *       401:
 *         description: Invalid credentials
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               success: false
 *               error: "Invalid email or password"
 *               code: "INVALID_CREDENTIALS"
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       429:
 *         description: Too many requests
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
  "/login",
  rateLimits.auth, // Rate limiting for login
  validationRules.loginUser,
  handleValidationErrors,
  AuthController.login,
);

/**
 * @swagger
 * /api/auth/forgot-password:
 *   post:
 *     summary: Request password reset
 *     description: Send password reset email to user
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 description: User's email address
 *           example:
 *             email: "user@example.com"
 *     responses:
 *       200:
 *         description: Password reset email sent
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
 *                   example: "Password reset email sent"
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       429:
 *         description: Too many requests
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
  "/forgot-password",
  rateLimits.auth, // Rate limiting for password reset
  [
    require("express-validator")
      .body("email")
      .isEmail()
      .normalizeEmail()
      .withMessage("Valid email is required"),
  ],
  handleValidationErrors,
  AuthController.requestPasswordReset,
);

/**
 * @swagger
 * /api/auth/reset-password:
 *   post:
 *     summary: Reset password with token
 *     description: Reset user password using reset token
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - token
 *               - newPassword
 *             properties:
 *               token:
 *                 type: string
 *                 description: Password reset token
 *               newPassword:
 *                 type: string
 *                 minLength: 8
 *                 description: New password
 *           example:
 *             token: "reset_token_here"
 *             newPassword: "newSecurePassword123"
 *     responses:
 *       200:
 *         description: Password reset successful
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
 *                   example: "Password reset successful"
 *       400:
 *         description: Invalid or expired token
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               success: false
 *               error: "Invalid or expired reset token"
 *               code: "INVALID_TOKEN"
 *       429:
 *         description: Too many requests
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
  "/reset-password",
  rateLimits.auth,
  [
    require("express-validator")
      .body("token")
      .notEmpty()
      .isLength({ min: 1 })
      .withMessage("Reset token is required"),
    require("express-validator")
      .body("newPassword")
      .isLength({ min: 8 })
      .matches(
        /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/,
      )
      .withMessage(
        "Password must be at least 8 characters with uppercase, lowercase, number and special character",
      ),
  ],
  handleValidationErrors,
  AuthController.resetPassword,
);

// Verify email
router.get(
  "/verify-email/:token",
  rateLimits.general,
  [
    require("express-validator")
      .param("token")
      .notEmpty()
      .isLength({ min: 1 })
      .withMessage("Verification token is required"),
  ],
  handleValidationErrors,
  AuthController.verifyEmail,
);

// Protected routes (authentication required)

// Logout user
router.post(
  "/logout",
  rateLimits.general,
  authenticateToken,
  AuthController.logout,
);

// Get current user profile
router.get(
  "/profile",
  rateLimits.general,
  authenticateToken,
  AuthController.getProfile,
);

// Update user profile
router.put(
  "/profile",
  rateLimits.general,
  authenticateToken,
  [
    require("express-validator")
      .body("firstName")
      .optional()
      .isLength({ max: 50 })
      .matches(/^[a-zA-Z\s]+$/)
      .withMessage("First name must contain only letters and spaces"),
    require("express-validator")
      .body("lastName")
      .optional()
      .isLength({ max: 50 })
      .matches(/^[a-zA-Z\s]+$/)
      .withMessage("Last name must contain only letters and spaces"),
    require("express-validator")
      .body("preferences")
      .optional()
      .isObject()
      .withMessage("Preferences must be an object"),
  ],
  handleValidationErrors,
  AuthController.updateProfile,
);

// Change password
router.put(
  "/change-password",
  rateLimits.auth, // More restrictive rate limiting
  authenticateToken,
  [
    require("express-validator")
      .body("currentPassword")
      .notEmpty()
      .withMessage("Current password is required"),
    require("express-validator")
      .body("newPassword")
      .isLength({ min: 8 })
      .matches(
        /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/,
      )
      .withMessage(
        "New password must be at least 8 characters with uppercase, lowercase, number and special character",
      ),
  ],
  handleValidationErrors,
  AuthController.changePassword,
);

// Refresh JWT token
router.post(
  "/refresh-token",
  rateLimits.general,
  authenticateToken,
  AuthController.refreshToken,
);

// Get active sessions
router.get(
  "/sessions",
  rateLimits.general,
  authenticateToken,
  AuthController.getActiveSessions,
);

// Health check endpoint for auth service
router.get("/health", rateLimits.general, (req, res) => {
  res.json({
    success: true,
    message: "Auth service is healthy",
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;
