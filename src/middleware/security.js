const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { body, param, query, validationResult } = require("express-validator");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const logger = require("../config/logger");
const redisManager = require("../config/redis");

// XSS Protection Middleware
const xssProtection = (req, res, next) => {
  // Sanitize input recursively
  const sanitizeInput = (obj) => {
    if (typeof obj === "string") {
      // Remove potentially dangerous HTML tags and JavaScript
      return obj
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
        .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, "")
        .replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi, "")
        .replace(/<embed\b[^<]*(?:(?!<\/embed>)<[^<]*)*<\/embed>/gi, "")
        .replace(/<link\b[^<]*(?:(?!<\/link>)<[^<]*)*<\/link>/gi, "")
        .replace(/<meta\b[^<]*(?:(?!<\/meta>)<[^<]*)*<\/meta>/gi, "")
        .replace(/javascript:/gi, "")
        .replace(/vbscript:/gi, "")
        .replace(/onload\s*=/gi, "")
        .replace(/onerror\s*=/gi, "")
        .replace(/onclick\s*=/gi, "")
        .replace(/onmouseover\s*=/gi, "");
    } else if (Array.isArray(obj)) {
      return obj.map(sanitizeInput);
    } else if (obj && typeof obj === "object") {
      const sanitized = {};
      for (const key in obj) {
        if (obj.hasOwnProperty(key)) {
          sanitized[key] = sanitizeInput(obj[key]);
        }
      }
      return sanitized;
    }
    return obj;
  };

  // Sanitize request body, query, and params
  if (req.body) {
    req.body = sanitizeInput(req.body);
  }
  if (req.query) {
    req.query = sanitizeInput(req.query);
  }
  if (req.params) {
    req.params = sanitizeInput(req.params);
  }

  next();
};

// SQL Injection Protection (input validation)
const sqlInjectionProtection = (req, res, next) => {
  const suspiciousPatterns = [
    /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|EXECUTE|UNION|SCRIPT)\b)/gi,
    /(\'|\"|;|--|\*|\|)/g,
    /(\bOR\b|\bAND\b).*(\=|\<|\>)/gi,
    /(\bunion\b.*\bselect\b)/gi,
    /(\bdrop\b.*\btable\b)/gi,
  ];

  const checkForSqlInjection = (value) => {
    if (typeof value === "string") {
      return suspiciousPatterns.some((pattern) => pattern.test(value));
    }
    if (Array.isArray(value)) {
      return value.some(checkForSqlInjection);
    }
    if (value && typeof value === "object") {
      return Object.values(value).some(checkForSqlInjection);
    }
    return false;
  };

  // Check all input sources
  const inputs = [req.body, req.query, req.params].filter(Boolean);
  const hasSqlInjection = inputs.some(checkForSqlInjection);

  if (hasSqlInjection) {
    logger.security.suspiciousActivity("SQL injection attempt detected", {
      ip: req.ip,
      userAgent: req.get("User-Agent"),
      url: req.originalUrl,
      body: req.body,
      query: req.query,
      params: req.params,
    });

    return res.status(400).json({
      error: "Invalid input detected",
      code: "INVALID_INPUT",
    });
  }

  next();
};

// Rate Limiting Configuration
const createRateLimit = (windowMs, max, message, keyGenerator) => {
  return rateLimit({
    windowMs,
    max,
    message: {
      error: message,
      code: "RATE_LIMIT_EXCEEDED",
    },
    keyGenerator: keyGenerator || ((req) => req.ip),
    handler: (req, res) => {
      logger.security.rateLimitExceeded(req.ip, req.originalUrl);
      res.status(429).json({
        error: message,
        code: "RATE_LIMIT_EXCEEDED",
      });
    },
    standardHeaders: true,
    legacyHeaders: false,
    // Use Redis store for distributed rate limiting
    store: redisManager.isConnected
      ? {
          incr: async (key) => {
            const current = await redisManager.increment(
              `rate_limit:${key}`,
              1,
            );
            if (current === 1) {
              await redisManager.expire(`rate_limit:${key}`, windowMs / 1000);
            }
            return current;
          },
          decrement: async (key) => {
            return await redisManager.increment(`rate_limit:${key}`, -1);
          },
          resetKey: async (key) => {
            return await redisManager.del(`rate_limit:${key}`);
          },
        }
      : undefined,
  });
};

// Different rate limits for different endpoints
const rateLimits = {
  general: createRateLimit(
    15 * 60 * 1000, // 15 minutes
    100, // 100 requests per window
    "Too many requests, please try again later",
  ),

  auth: createRateLimit(
    15 * 60 * 1000, // 15 minutes
    5, // 5 attempts per window
    "Too many authentication attempts, please try again later",
    (req) => `${req.ip}:auth`,
  ),

  api: createRateLimit(
    60 * 1000, // 1 minute
    60, // 60 requests per minute
    "API rate limit exceeded",
  ),

  graphql: createRateLimit(
    60 * 1000, // 1 minute
    30, // 30 requests per minute (GraphQL can be more expensive)
    "GraphQL rate limit exceeded",
  ),
};

// JWT Authentication Middleware
const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers["authorization"];
    const token = authHeader && authHeader.split(" ")[1]; // Bearer TOKEN

    if (!token) {
      return res.status(401).json({
        error: "Access token required",
        code: "TOKEN_REQUIRED",
      });
    }

    // Check if token is blacklisted (logout/revoked tokens)
    const isBlacklisted = await redisManager.exists(`blacklist:${token}`);
    if (isBlacklisted) {
      return res.status(401).json({
        error: "Token has been revoked",
        code: "TOKEN_REVOKED",
      });
    }

    // Verify JWT token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Add user info to request
    req.user = decoded;
    req.token = token;

    // Log authentication event
    logger.security.loginAttempt(decoded.email, true, req.ip);

    next();
  } catch (error) {
    logger.security.loginAttempt("unknown", false, req.ip);

    if (error.name === "TokenExpiredError") {
      return res.status(401).json({
        error: "Token expired",
        code: "TOKEN_EXPIRED",
      });
    } else if (error.name === "JsonWebTokenError") {
      return res.status(401).json({
        error: "Invalid token",
        code: "TOKEN_INVALID",
      });
    } else {
      return res.status(500).json({
        error: "Authentication error",
        code: "AUTH_ERROR",
      });
    }
  }
};

// Optional authentication (for endpoints that work with or without auth)
const optionalAuth = async (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = decoded;
      req.token = token;
    } catch (error) {
      // Continue without authentication
      req.user = null;
    }
  }

  next();
};

// Input Validation Helpers
const validationRules = {
  // User validation
  registerUser: [
    body("email")
      .isEmail()
      .normalizeEmail()
      .withMessage("Valid email is required"),
    body("username")
      .isLength({ min: 3, max: 30 })
      .matches(/^[a-zA-Z0-9_]+$/)
      .withMessage(
        "Username must be 3-30 characters, alphanumeric and underscore only",
      ),
    body("password")
      .isLength({ min: 8 })
      .matches(
        /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/,
      )
      .withMessage(
        "Password must be at least 8 characters with uppercase, lowercase, number and special character",
      ),
    body("firstName")
      .optional()
      .isLength({ max: 50 })
      .matches(/^[a-zA-Z\s]+$/)
      .withMessage("First name must contain only letters and spaces"),
    body("lastName")
      .optional()
      .isLength({ max: 50 })
      .matches(/^[a-zA-Z\s]+$/)
      .withMessage("Last name must contain only letters and spaces"),
  ],

  loginUser: [
    body("email")
      .isEmail()
      .normalizeEmail()
      .withMessage("Valid email is required"),
    body("password").notEmpty().withMessage("Password is required"),
  ],

  // Todo validation
  createTodo: [
    body("title")
      .notEmpty()
      .isLength({ min: 1, max: 200 })
      .withMessage("Title is required and must be less than 200 characters"),
    body("description")
      .optional()
      .isLength({ max: 1000 })
      .withMessage("Description must be less than 1000 characters"),
    body("priority")
      .optional()
      .isInt({ min: 1, max: 3 })
      .withMessage("Priority must be 1 (low), 2 (medium), or 3 (high)"),
    body("category")
      .optional()
      .isLength({ max: 50 })
      .matches(/^[a-zA-Z0-9\s_-]+$/)
      .withMessage(
        "Category must be alphanumeric with spaces, underscores, or hyphens",
      ),
    body("dueDate")
      .optional()
      .isISO8601()
      .withMessage("Due date must be a valid ISO 8601 date"),
    body("tags").optional().isArray().withMessage("Tags must be an array"),
    body("tags.*")
      .optional()
      .isLength({ max: 30 })
      .matches(/^[a-zA-Z0-9_-]+$/)
      .withMessage("Each tag must be alphanumeric with underscores or hyphens"),
  ],

  updateTodo: [
    param("id").isUUID().withMessage("Valid todo ID is required"),
    body("title")
      .optional()
      .isLength({ min: 1, max: 200 })
      .withMessage("Title must be less than 200 characters"),
    body("description")
      .optional()
      .isLength({ max: 1000 })
      .withMessage("Description must be less than 1000 characters"),
    body("completed")
      .optional()
      .isBoolean()
      .withMessage("Completed must be a boolean"),
    body("priority")
      .optional()
      .isInt({ min: 1, max: 3 })
      .withMessage("Priority must be 1 (low), 2 (medium), or 3 (high)"),
    body("category")
      .optional()
      .isLength({ max: 50 })
      .matches(/^[a-zA-Z0-9\s_-]+$/)
      .withMessage(
        "Category must be alphanumeric with spaces, underscores, or hyphens",
      ),
    body("dueDate")
      .optional()
      .isISO8601()
      .withMessage("Due date must be a valid ISO 8601 date"),
    body("tags").optional().isArray().withMessage("Tags must be an array"),
    body("tags.*")
      .optional()
      .isLength({ max: 30 })
      .matches(/^[a-zA-Z0-9_-]+$/)
      .withMessage("Each tag must be alphanumeric with underscores or hyphens"),
  ],

  // Query validation
  getTodos: [
    query("page")
      .optional()
      .isInt({ min: 1 })
      .withMessage("Page must be a positive integer"),
    query("limit")
      .optional()
      .isInt({ min: 1, max: 100 })
      .withMessage("Limit must be between 1 and 100"),
    query("completed")
      .optional()
      .isBoolean()
      .withMessage("Completed must be a boolean"),
    query("priority")
      .optional()
      .isInt({ min: 1, max: 3 })
      .withMessage("Priority must be 1, 2, or 3"),
    query("category")
      .optional()
      .isLength({ max: 50 })
      .matches(/^[a-zA-Z0-9\s_-]+$/)
      .withMessage(
        "Category must be alphanumeric with spaces, underscores, or hyphens",
      ),
    query("sortBy")
      .optional()
      .isIn(["created_at", "updated_at", "title", "priority", "due_date"])
      .withMessage(
        "SortBy must be one of: created_at, updated_at, title, priority, due_date",
      ),
    query("sortOrder")
      .optional()
      .isIn(["asc", "desc"])
      .withMessage("SortOrder must be asc or desc"),
  ],

  // UUID parameter validation
  uuidParam: [param("id").isUUID().withMessage("Valid ID is required")],
};

// Validation error handler
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);

  if (!errors.isEmpty()) {
    logger.warn("Validation errors:", {
      errors: errors.array(),
      ip: req.ip,
      url: req.originalUrl,
      body: req.body,
    });

    return res.status(400).json({
      error: "Validation failed",
      code: "VALIDATION_ERROR",
      details: errors.array(),
    });
  }

  next();
};

// Helmet security headers configuration
const helmetConfig = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https:"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      scriptSrcAttr: ["'unsafe-inline'"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: [],
    },
  },
  crossOriginEmbedderPolicy: false, // Disable for GraphQL playground
  hsts: {
    maxAge: 31536000, // 1 year
    includeSubDomains: true,
    preload: true,
  },
});

// CORS configuration with security considerations
const corsOptions = {
  origin: function (origin, callback) {
    const allowedOrigins = process.env.CORS_ORIGIN
      ? process.env.CORS_ORIGIN.split(",")
      : ["http://localhost:3000", "http://localhost:3001"];

    // Allow requests with no origin (mobile apps, etc.)
    if (!origin) return callback(null, true);

    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      logger.security.suspiciousActivity("CORS policy violation", {
        origin,
        allowedOrigins,
      });
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "X-Requested-With",
    "X-Request-ID",
  ],
  exposedHeaders: [
    "X-Request-ID",
    "X-RateLimit-Limit",
    "X-RateLimit-Remaining",
  ],
  maxAge: 86400, // 24 hours
};

// Security audit logging middleware
const auditLogger = (req, res, next) => {
  // Log sensitive operations
  const sensitiveEndpoints = ["/auth/", "/admin/", "/api/users/"];
  const isSensitive = sensitiveEndpoints.some((endpoint) =>
    req.originalUrl.includes(endpoint),
  );

  if (isSensitive) {
    logger.info("Sensitive endpoint access", {
      method: req.method,
      url: req.originalUrl,
      ip: req.ip,
      userAgent: req.get("User-Agent"),
      userId: req.user?.id,
      timestamp: new Date().toISOString(),
    });
  }

  next();
};

// Request size limiter
const requestSizeLimiter = (req, res, next) => {
  const contentLength = parseInt(req.get("content-length") || "0", 10);
  const maxSize = 10 * 1024 * 1024; // 10MB

  if (contentLength > maxSize) {
    logger.security.suspiciousActivity("Large request detected", {
      contentLength,
      maxSize,
      ip: req.ip,
      url: req.originalUrl,
    });

    return res.status(413).json({
      error: "Request too large",
      code: "REQUEST_TOO_LARGE",
    });
  }

  next();
};

module.exports = {
  helmetConfig,
  corsOptions,
  xssProtection,
  sqlInjectionProtection,
  rateLimits,
  authenticateToken,
  optionalAuth,
  validationRules,
  handleValidationErrors,
  auditLogger,
  requestSizeLimiter,
};
