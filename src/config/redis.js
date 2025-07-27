const redis = require("redis");
const logger = require("./logger");

class RedisManager {
  constructor() {
    this.client = null;
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.reconnectDelay = 1000; // Start with 1 second
  }

  async connect() {
    try {
      const redisConfig = {
        socket: {
          host: process.env.REDIS_HOST || "localhost",
          port: process.env.REDIS_PORT || 6379,
          connectTimeout: 10000,
          commandTimeout: 5000,
          keepAlive: 30000,
        },
        password: process.env.REDIS_PASSWORD || undefined,
        retryDelayOnFailover: 100,
        disableOfflineQueue: true,
      };

      // Create Redis client
      this.client = redis.createClient(redisConfig);

      // Error handling
      this.client.on("error", (error) => {
        logger.error("Redis connection error:", error.message);
        this.isConnected = false;
        this.handleReconnection();
      });

      // Connection events
      this.client.on("connect", () => {
        logger.info("Redis client connected");
        this.reconnectAttempts = 0;
      });

      this.client.on("ready", () => {
        logger.info("Redis connection ready");
        this.isConnected = true;
      });

      this.client.on("end", () => {
        logger.warn("Redis connection ended");
        this.isConnected = false;
      });

      this.client.on("reconnecting", () => {
        logger.info("Redis reconnecting...");
      });

      // Connect to Redis
      await this.client.connect();

      // Test connection
      await this.client.ping();
      logger.info("Redis connection established successfully");

      return this.client;
    } catch (error) {
      logger.error("Failed to connect to Redis:", error.message);
      throw error;
    }
  }

  async handleReconnection() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      logger.error("Max Redis reconnection attempts reached");
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(
      this.reconnectDelay * Math.pow(2, this.reconnectAttempts),
      30000,
    );

    logger.info(
      `Attempting Redis reconnection ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${delay}ms`,
    );

    setTimeout(async () => {
      try {
        await this.connect();
      } catch (error) {
        logger.error("Redis reconnection failed:", error.message);
      }
    }, delay);
  }

  async disconnect() {
    try {
      if (this.client && this.isConnected) {
        await this.client.quit();
        logger.info("Redis connection closed gracefully");
      }
    } catch (error) {
      logger.error("Error closing Redis connection:", error.message);
    }
  }

  // Cache operations with error handling
  async get(key) {
    try {
      if (!this.isConnected) {
        logger.warn("Redis not connected, cache miss for key:", key);
        return null;
      }

      const value = await this.client.get(key);
      if (value) {
        logger.debug("Cache hit for key:", key);
        return JSON.parse(value);
      } else {
        logger.debug("Cache miss for key:", key);
        return null;
      }
    } catch (error) {
      logger.error("Redis GET error:", { key, error: error.message });
      return null; // Fail gracefully
    }
  }

  async set(key, value, ttl = 3600) {
    try {
      if (!this.isConnected) {
        logger.warn("Redis not connected, unable to cache key:", key);
        return false;
      }

      const serializedValue = JSON.stringify(value);
      await this.client.setEx(key, ttl, serializedValue);
      logger.debug("Cache set for key:", key, "TTL:", ttl);
      return true;
    } catch (error) {
      logger.error("Redis SET error:", { key, error: error.message });
      return false;
    }
  }

  async del(key) {
    try {
      if (!this.isConnected) {
        logger.warn("Redis not connected, unable to delete key:", key);
        return false;
      }

      const result = await this.client.del(key);
      logger.debug("Cache delete for key:", key, "Result:", result);
      return result > 0;
    } catch (error) {
      logger.error("Redis DEL error:", { key, error: error.message });
      return false;
    }
  }

  async exists(key) {
    try {
      if (!this.isConnected) {
        return false;
      }

      const result = await this.client.exists(key);
      return result === 1;
    } catch (error) {
      logger.error("Redis EXISTS error:", { key, error: error.message });
      return false;
    }
  }

  async increment(key, increment = 1) {
    try {
      if (!this.isConnected) {
        logger.warn("Redis not connected, unable to increment key:", key);
        return null;
      }

      const result = await this.client.incrBy(key, increment);
      logger.debug("Cache increment for key:", key, "Value:", result);
      return result;
    } catch (error) {
      logger.error("Redis INCRBY error:", { key, error: error.message });
      return null;
    }
  }

  async expire(key, ttl) {
    try {
      if (!this.isConnected) {
        return false;
      }

      const result = await this.client.expire(key, ttl);
      return result === 1;
    } catch (error) {
      logger.error("Redis EXPIRE error:", { key, ttl, error: error.message });
      return false;
    }
  }

  // Pattern-based operations
  async deletePattern(pattern) {
    try {
      if (!this.isConnected) {
        return 0;
      }

      const keys = await this.client.keys(pattern);
      if (keys.length === 0) {
        return 0;
      }

      const result = await this.client.del(keys);
      logger.debug("Cache delete pattern:", pattern, "Deleted:", result);
      return result;
    } catch (error) {
      logger.error("Redis delete pattern error:", {
        pattern,
        error: error.message,
      });
      return 0;
    }
  }

  // Health check
  async healthCheck() {
    try {
      const startTime = Date.now();
      await this.client.ping();
      const responseTime = Date.now() - startTime;

      return {
        status: "healthy",
        responseTime: `${responseTime}ms`,
        connected: this.isConnected,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return {
        status: "unhealthy",
        error: error.message,
        connected: this.isConnected,
        timestamp: new Date().toISOString(),
      };
    }
  }

  // Get Redis info
  async getInfo() {
    try {
      if (!this.isConnected) {
        return null;
      }

      const info = await this.client.info();
      return info;
    } catch (error) {
      logger.error("Redis INFO error:", error.message);
      return null;
    }
  }

  // Session store methods (for express-session)
  getSessionStore() {
    const session = require("express-session");
    const RedisStore = require("connect-redis")(session);

    return new RedisStore({
      client: this.client,
      prefix: "sess:",
      ttl: 86400, // 24 hours
      disableTouch: false,
      logErrors: (error) => {
        logger.error("Redis session store error:", error.message);
      },
    });
  }

  // Cache middleware for Express routes
  cacheMiddleware(ttl = 3600) {
    return async (req, res, next) => {
      // Skip caching for non-GET requests
      if (req.method !== "GET") {
        return next();
      }

      // Create cache key based on URL and query parameters
      const cacheKey = `cache:${req.originalUrl || req.url}`;

      try {
        const cachedData = await this.get(cacheKey);

        if (cachedData) {
          logger.debug("Serving cached response for:", cacheKey);
          return res.json(cachedData);
        }

        // Store original res.json function
        const originalJson = res.json;

        // Override res.json to cache the response
        res.json = function (data) {
          // Cache the response
          redisManager.set(cacheKey, data, ttl).catch((error) => {
            logger.error("Failed to cache response:", error.message);
          });

          // Call original function
          return originalJson.call(this, data);
        };

        next();
      } catch (error) {
        logger.error("Cache middleware error:", error.message);
        next();
      }
    };
  }
}

// Create singleton instance
const redisManager = new RedisManager();

module.exports = redisManager;
