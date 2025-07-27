const express = require("express");
const { ApolloServer } = require("apollo-server-express");
const cors = require("cors");
const compression = require("compression");
const morgan = require("morgan");
const helmet = require("helmet");
require("dotenv").config();

// Import configurations
const logger = require("./config/logger");
const { db, testConnection, closeConnection } = require("./config/database");
const redisManager = require("./config/redis");

// Import middleware
const {
  helmetConfig,
  corsOptions,
  rateLimits,
  authenticateToken,
  optionalAuth,
  auditLogger,
  requestSizeLimiter,
} = require("./middleware/security");

// Import routes
const authRoutes = require("./routes/auth");
const todoRoutes = require("./routes/todos");

// Import GraphQL schema and resolvers
const typeDefs = require("./graphql/typeDefs");
const resolvers = require("./graphql/resolvers");

// Import utilities
const swaggerJsdoc = require("swagger-jsdoc");
const swaggerUi = require("swagger-ui-express");

class Server {
  constructor() {
    this.app = express();
    this.port = process.env.PORT || 3000;
    this.host = process.env.HOST || "localhost";
    this.apolloServer = null;
  }

  async initialize() {
    try {
      // Initialize database connection
      await testConnection();
      logger.info("Database connected successfully");

      // Initialize Redis connection
      await redisManager.connect();
      logger.info("Redis connected successfully");

      // Setup middleware
      this.setupMiddleware();

      // Setup routes (includes GraphQL setup)
      await this.setupRoutes();

      // Setup error handling
      this.setupErrorHandling();

      logger.info("Server initialized successfully");
    } catch (error) {
      logger.error("Server initialization failed:", error);
      throw error;
    }
  }

  setupMiddleware() {
    // Security headers
    this.app.use(helmetConfig);

    // Request size limiting
    this.app.use(requestSizeLimiter);

    // CORS
    this.app.use(cors(corsOptions));

    // Compression
    if (process.env.ENABLE_COMPRESSION === "true") {
      this.app.use(compression());
    }

    // Request logging
    this.app.use(
      morgan("combined", {
        stream: logger.stream,
        skip: (req, res) => {
          // Skip logging for health checks in production
          return process.env.NODE_ENV === "production" && req.url === "/health";
        },
      }),
    );

    // Add request ID for tracing
    this.app.use(logger.addRequestId);

    // Parse JSON bodies
    this.app.use(
      express.json({
        limit: "10mb",
        verify: (req, res, buf) => {
          req.rawBody = buf;
        },
      }),
    );

    // Parse URL-encoded bodies
    this.app.use(
      express.urlencoded({
        extended: true,
        limit: "10mb",
      }),
    );

    // Audit logging for sensitive operations
    this.app.use(auditLogger);

    // Global rate limiting
    this.app.use(rateLimits.general);
  }

  async setupRoutes() {
    // Health check endpoint
    this.app.get("/health", async (req, res) => {
      try {
        const [dbHealth, redisHealth] = await Promise.all([
          db
            .raw("SELECT 1")
            .then(() => ({ status: "healthy" }))
            .catch((err) => ({ status: "unhealthy", error: err.message })),
          redisManager.healthCheck(),
        ]);

        const health = {
          status: "healthy",
          timestamp: new Date().toISOString(),
          uptime: process.uptime(),
          memory: process.memoryUsage(),
          version: process.env.npm_package_version || "1.0.0",
          environment: process.env.NODE_ENV || "development",
          services: {
            database: dbHealth,
            redis: redisHealth,
          },
        };

        // Overall health status
        const isHealthy =
          dbHealth.status === "healthy" && redisHealth.status === "healthy";
        if (!isHealthy) {
          health.status = "unhealthy";
        }

        res.status(isHealthy ? 200 : 503).json(health);
      } catch (error) {
        logger.error("Health check failed:", error);
        res.status(503).json({
          status: "unhealthy",
          error: "Health check failed",
          timestamp: new Date().toISOString(),
        });
      }
    });

    // API documentation with Swagger
    if (process.env.NODE_ENV !== "production") {
      const swaggerOptions = {
        definition: {
          openapi: "3.0.0",
          info: {
            title: process.env.SWAGGER_TITLE || "Todo App API",
            version: process.env.SWAGGER_VERSION || "1.0.0",
            description:
              process.env.SWAGGER_DESCRIPTION ||
              "A comprehensive Todo application API",
            contact: {
              name: "API Support",
              email: "support@todoapp.com",
            },
          },
          servers: [
            {
              url: `http://${this.host}:${this.port}`,
              description: "Development server",
            },
          ],
          components: {
            securitySchemes: {
              bearerAuth: {
                type: "http",
                scheme: "bearer",
                bearerFormat: "JWT",
              },
            },
          },
        },
        apis: ["./src/routes/*.js"], // Path to the API files
      };

      const swaggerSpec = swaggerJsdoc(swaggerOptions);
      this.app.use(
        "/api-docs",
        swaggerUi.serve,
        swaggerUi.setup(swaggerSpec, {
          explorer: true,
          customCss: ".swagger-ui .topbar { display: none }",
          customSiteTitle: "Todo App API Documentation",
        }),
      );

      logger.info(
        `API documentation available at http://${this.host}:${this.port}/api-docs`,
      );
    }

    // API routes
    this.app.use("/api/auth", authRoutes);
    this.app.use("/api/todos", todoRoutes);

    // Setup GraphQL before 404 handler
    await this.setupGraphQL();

    // Root endpoint
    this.app.get("/", (req, res) => {
      res.json({
        message: "Todo App API",
        version: process.env.npm_package_version || "1.0.0",
        endpoints: {
          health: "/health",
          auth: "/api/auth",
          todos: "/api/todos",
          graphql: "/graphql",
          ...(process.env.NODE_ENV !== "production" && { docs: "/api-docs" }),
        },
        timestamp: new Date().toISOString(),
      });
    });

    // 404 handler for undefined routes
    this.app.use("*", (req, res) => {
      logger.warn("Route not found:", {
        method: req.method,
        url: req.originalUrl,
        ip: req.ip,
        userAgent: req.get("User-Agent"),
      });

      res.status(404).json({
        success: false,
        error: "Route not found",
        code: "ROUTE_NOT_FOUND",
        path: req.originalUrl,
        method: req.method,
      });
    });
  }

  async setupGraphQL() {
    // GraphQL context function
    const getContext = async ({ req }) => {
      let user = null;
      let token = null;

      // Extract token from Authorization header
      const authHeader = req.headers.authorization;
      if (authHeader) {
        token = authHeader.split(" ")[1]; // Bearer <token>

        if (token) {
          try {
            // Check if token is blacklisted
            const isBlacklisted = await redisManager.exists(
              `blacklist:${token}`,
            );
            if (!isBlacklisted) {
              const jwt = require("jsonwebtoken");
              const decoded = jwt.verify(token, process.env.JWT_SECRET);
              user = decoded;
            }
          } catch (error) {
            // Invalid token - continue without user
            logger.debug("Invalid GraphQL token:", error.message);
          }
        }
      }

      return {
        req,
        user,
        token,
        logger,
        redis: redisManager,
      };
    };

    // Create Apollo Server
    this.apolloServer = new ApolloServer({
      typeDefs,
      resolvers,
      context: getContext,
      introspection: process.env.GRAPHQL_INTROSPECTION === "true",
      playground: process.env.GRAPHQL_PLAYGROUND === "true",
      formatError: (error) => {
        // Log GraphQL errors
        logger.error("GraphQL Error:", {
          message: error.message,
          path: error.path,
          source: error.source?.body,
          positions: error.positions,
          stack: error.stack,
        });

        // Don't expose internal errors in production
        if (
          process.env.NODE_ENV === "production" &&
          !error.message.startsWith("GraphQL error:")
        ) {
          return new Error("Internal server error");
        }

        return error;
      },
      formatResponse: (response, { request, context }) => {
        // Log GraphQL operations in development
        if (process.env.NODE_ENV === "development") {
          logger.debug("GraphQL Operation:", {
            operationName: request.operationName,
            variables: request.variables,
            userId: context.user?.id,
          });
        }

        return response;
      },
      plugins: [
        // Custom plugin for rate limiting GraphQL operations
        {
          requestDidStart() {
            return {
              async didResolveOperation({ request, context }) {
                // Apply rate limiting to GraphQL
                const rateLimitKey = `graphql:${context.req.ip}`;
                const requestCount =
                  (await redisManager.get(rateLimitKey)) || 0;

                if (requestCount >= 30) {
                  // 30 requests per minute
                  throw new Error("GraphQL rate limit exceeded");
                }

                await redisManager.set(rateLimitKey, requestCount + 1, 60);
              },
            };
          },
        },
      ],
    });

    // Start Apollo Server
    await this.apolloServer.start();

    // Apply Apollo GraphQL middleware
    this.apolloServer.applyMiddleware({
      app: this.app,
      path: "/graphql",
      cors: false, // We're handling CORS at the app level
    });

    logger.info(
      `GraphQL playground available at http://${this.host}:${this.port}${this.apolloServer.graphqlPath}`,
    );
  }

  setupErrorHandling() {
    // Global error handler
    this.app.use((error, req, res, next) => {
      logger.error("Unhandled application error:", {
        error: error.message,
        stack: error.stack,
        url: req.originalUrl,
        method: req.method,
        ip: req.ip,
        userAgent: req.get("User-Agent"),
        body: req.body,
        params: req.params,
        query: req.query,
        userId: req.user?.id,
      });

      // Don't expose internal errors in production
      const isDevelopment = process.env.NODE_ENV === "development";

      res.status(error.status || 500).json({
        success: false,
        error: isDevelopment ? error.message : "Internal server error",
        code: error.code || "INTERNAL_ERROR",
        ...(isDevelopment && { stack: error.stack }),
        timestamp: new Date().toISOString(),
        requestId: req.requestId,
      });
    });

    // Handle uncaught exceptions
    process.on("uncaughtException", (error) => {
      logger.error("Uncaught Exception:", error);
      this.gracefulShutdown("uncaughtException");
    });

    // Handle unhandled promise rejections
    process.on("unhandledRejection", (reason, promise) => {
      logger.error("Unhandled Rejection at:", promise, "reason:", reason);
      this.gracefulShutdown("unhandledRejection");
    });

    // Handle SIGTERM (production)
    process.on("SIGTERM", () => {
      logger.info("SIGTERM received");
      this.gracefulShutdown("SIGTERM");
    });

    // Handle SIGINT (Ctrl+C)
    process.on("SIGINT", () => {
      logger.info("SIGINT received");
      this.gracefulShutdown("SIGINT");
    });
  }

  async gracefulShutdown(signal) {
    logger.info(`Received ${signal}. Starting graceful shutdown...`);

    try {
      // Stop accepting new connections
      if (this.server) {
        this.server.close(() => {
          logger.info("HTTP server closed");
        });
      }

      // Stop Apollo Server
      if (this.apolloServer) {
        await this.apolloServer.stop();
        logger.info("Apollo Server stopped");
      }

      // Close database connections
      await closeConnection();
      logger.info("Database connections closed");

      // Close Redis connections
      await redisManager.disconnect();
      logger.info("Redis connections closed");

      logger.info("Graceful shutdown completed");
      process.exit(0);
    } catch (error) {
      logger.error("Error during graceful shutdown:", error);
      process.exit(1);
    }
  }

  async start() {
    try {
      await this.initialize();

      this.server = this.app.listen(this.port, this.host, () => {
        logger.info(`🚀 Server running at http://${this.host}:${this.port}`);
        logger.info(`📊 Health check: http://${this.host}:${this.port}/health`);
        logger.info(`🔐 Auth API: http://${this.host}:${this.port}/api/auth`);
        logger.info(`📝 Todos API: http://${this.host}:${this.port}/api/todos`);
        logger.info(`🎯 GraphQL: http://${this.host}:${this.port}/graphql`);

        if (process.env.NODE_ENV !== "production") {
          logger.info(`📚 API Docs: http://${this.host}:${this.port}/api-docs`);
        }

        logger.info(`🌍 Environment: ${process.env.NODE_ENV || "development"}`);
        logger.info("Server is ready to accept connections");
      });

      // Handle server errors
      this.server.on("error", (error) => {
        if (error.code === "EADDRINUSE") {
          logger.error(`Port ${this.port} is already in use`);
          process.exit(1);
        } else {
          logger.error("Server error:", error);
          this.gracefulShutdown("serverError");
        }
      });
    } catch (error) {
      logger.error("Failed to start server:", error);
      process.exit(1);
    }
  }
}

// Create and start the server
if (require.main === module) {
  const server = new Server();
  server.start().catch((error) => {
    logger.error("Failed to start application:", error);
    process.exit(1);
  });
}

module.exports = Server;
