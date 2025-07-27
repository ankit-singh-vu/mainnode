const winston = require('winston');
const path = require('path');

// Define log levels
const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
};

// Define colors for each level
const colors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  debug: 'white',
};

// Add colors to winston
winston.addColors(colors);

// Custom format for console output
const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss:ms' }),
  winston.format.colorize({ all: true }),
  winston.format.printf(
    (info) => `${info.timestamp} ${info.level}: ${info.message}`
  )
);

// Custom format for file output
const fileFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss:ms' }),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

// Define which transports the logger must use
const transports = [
  // Console transport
  new winston.transports.Console({
    format: consoleFormat,
    level: process.env.LOG_LEVEL || 'info',
    handleExceptions: true,
    handleRejections: true
  }),
];

// Add file transports only in non-test environments
if (process.env.NODE_ENV !== 'test') {
  // Ensure logs directory exists
  const fs = require('fs');
  const logsDir = path.join(process.cwd(), 'logs');
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }

  transports.push(
    // Info and above to combined.log
    new winston.transports.File({
      filename: path.join(logsDir, 'combined.log'),
      format: fileFormat,
      level: 'info',
      maxsize: 5242880, // 5MB
      maxFiles: 5,
      handleExceptions: true,
      handleRejections: true
    }),

    // Error logs only
    new winston.transports.File({
      filename: path.join(logsDir, 'error.log'),
      format: fileFormat,
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5,
      handleExceptions: true,
      handleRejections: true
    }),

    // HTTP requests log
    new winston.transports.File({
      filename: path.join(logsDir, 'http.log'),
      format: fileFormat,
      level: 'http',
      maxsize: 5242880, // 5MB
      maxFiles: 3
    })
  );
}

// Create the logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  levels,
  format: fileFormat,
  transports,
  exitOnError: false,
});

// Create a stream object for morgan HTTP logging
logger.stream = {
  write: (message) => {
    logger.http(message.trim());
  },
};

// Add request ID correlation
logger.addRequestId = (req, res, next) => {
  const requestId = req.headers['x-request-id'] ||
                   req.headers['x-correlation-id'] ||
                   require('uuid').v4();

  req.requestId = requestId;
  res.setHeader('X-Request-ID', requestId);

  // Add request ID to all subsequent logs in this request
  const originalLog = logger.log;
  logger.log = function(level, message, meta = {}) {
    return originalLog.call(this, level, message, {
      ...meta,
      requestId: req.requestId
    });
  };

  next();
};

// Performance monitoring helper
logger.performance = {
  start: (label) => {
    const startTime = process.hrtime.bigint();
    return {
      end: () => {
        const endTime = process.hrtime.bigint();
        const duration = Number(endTime - startTime) / 1000000; // Convert to milliseconds
        logger.info(`Performance: ${label} completed in ${duration.toFixed(2)}ms`);
        return duration;
      }
    };
  }
};

// Database query logging
logger.logQuery = (query, bindings, duration) => {
  if (process.env.NODE_ENV === 'development') {
    logger.debug('Database Query', {
      sql: query,
      bindings,
      duration: duration ? `${duration}ms` : undefined
    });
  }
};

// Error logging with context
logger.logError = (error, context = {}) => {
  logger.error('Application Error', {
    message: error.message,
    stack: error.stack,
    ...context
  });
};

// Security event logging
logger.security = {
  loginAttempt: (username, success, ip) => {
    logger.info('Login Attempt', {
      username,
      success,
      ip,
      type: 'security',
      event: 'login_attempt'
    });
  },

  rateLimitExceeded: (ip, endpoint) => {
    logger.warn('Rate Limit Exceeded', {
      ip,
      endpoint,
      type: 'security',
      event: 'rate_limit_exceeded'
    });
  },

  suspiciousActivity: (description, context) => {
    logger.warn('Suspicious Activity', {
      description,
      ...context,
      type: 'security',
      event: 'suspicious_activity'
    });
  }
};

// Business logic logging
logger.business = {
  todoCreated: (userId, todoId) => {
    logger.info('Todo Created', {
      userId,
      todoId,
      type: 'business',
      event: 'todo_created'
    });
  },

  todoCompleted: (userId, todoId) => {
    logger.info('Todo Completed', {
      userId,
      todoId,
      type: 'business',
      event: 'todo_completed'
    });
  },

  userRegistered: (userId, email) => {
    logger.info('User Registered', {
      userId,
      email,
      type: 'business',
      event: 'user_registered'
    });
  }
};

// Health check logging
logger.health = {
  databaseConnection: (status, responseTime) => {
    const level = status === 'healthy' ? 'info' : 'error';
    logger.log(level, 'Database Health Check', {
      status,
      responseTime,
      type: 'health',
      component: 'database'
    });
  },

  redisConnection: (status, responseTime) => {
    const level = status === 'healthy' ? 'info' : 'error';
    logger.log(level, 'Redis Health Check', {
      status,
      responseTime,
      type: 'health',
      component: 'redis'
    });
  }
};

module.exports = logger;
