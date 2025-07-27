const knex = require('knex');
const knexConfig = require('../../knexfile');
const logger = require('./logger');

const environment = process.env.NODE_ENV || 'development';
const config = knexConfig[environment];

// Create database connection
const db = knex(config);

// Database connection event handlers
db.on('query', (query) => {
  if (process.env.NODE_ENV === 'development') {
    logger.debug('Database Query:', query.sql, query.bindings);
  }
});

db.on('query-error', (error, query) => {
  logger.error('Database Query Error:', {
    error: error.message,
    sql: query.sql,
    bindings: query.bindings
  });
});

// Test database connection
const testConnection = async () => {
  try {
    await db.raw('SELECT 1');
    logger.info('Database connection established successfully');
    return true;
  } catch (error) {
    logger.error('Database connection failed:', error.message);
    throw error;
  }
};

// Graceful shutdown
const closeConnection = async () => {
  try {
    await db.destroy();
    logger.info('Database connection closed');
  } catch (error) {
    logger.error('Error closing database connection:', error.message);
  }
};

// Connection pool monitoring
const getConnectionPoolStatus = () => {
  const pool = db.client.pool;
  return {
    used: pool.numUsed(),
    free: pool.numFree(),
    pending: pool.numPendingAcquires(),
    pendingCreates: pool.numPendingCreates()
  };
};

// Database health check
const healthCheck = async () => {
  try {
    const startTime = Date.now();
    await db.raw('SELECT 1');
    const responseTime = Date.now() - startTime;

    return {
      status: 'healthy',
      responseTime: `${responseTime}ms`,
      pool: getConnectionPoolStatus(),
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      error: error.message,
      pool: getConnectionPoolStatus(),
      timestamp: new Date().toISOString()
    };
  }
};

// Query performance monitoring
const withPerformanceMonitoring = (query) => {
  return async (...args) => {
    const startTime = process.hrtime.bigint();
    try {
      const result = await query(...args);
      const endTime = process.hrtime.bigint();
      const duration = Number(endTime - startTime) / 1000000; // Convert to milliseconds

      if (duration > 1000) { // Log slow queries (>1s)
        logger.warn('Slow query detected:', {
          duration: `${duration.toFixed(2)}ms`,
          query: query.toString()
        });
      }

      return result;
    } catch (error) {
      const endTime = process.hrtime.bigint();
      const duration = Number(endTime - startTime) / 1000000;

      logger.error('Query failed:', {
        error: error.message,
        duration: `${duration.toFixed(2)}ms`,
        query: query.toString()
      });

      throw error;
    }
  };
};

// Transaction wrapper with retry logic
const withTransaction = async (callback, maxRetries = 3) => {
  let retries = 0;

  while (retries < maxRetries) {
    const trx = await db.transaction();

    try {
      const result = await callback(trx);
      await trx.commit();
      return result;
    } catch (error) {
      await trx.rollback();

      // Check if error is retryable (deadlock, connection issues, etc.)
      const isRetryable = error.code === 'ECONNRESET' ||
                         error.code === 'ETIMEDOUT' ||
                         error.message.includes('deadlock');

      if (isRetryable && retries < maxRetries - 1) {
        retries++;
        logger.warn(`Transaction failed, retrying (${retries}/${maxRetries}):`, error.message);

        // Exponential backoff
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, retries) * 100));
        continue;
      }

      throw error;
    }
  }
};

module.exports = {
  db,
  testConnection,
  closeConnection,
  healthCheck,
  getConnectionPoolStatus,
  withPerformanceMonitoring,
  withTransaction
};
