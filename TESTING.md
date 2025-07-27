# 🧪 Testing Guide - Todo Application

This guide provides comprehensive instructions for testing your Todo application to verify everything is working correctly.

## 📋 Quick Health Check

### 1. **Check Docker Services**
```bash
# Check if all services are running
docker-compose ps

# Expected output: All services should show "Up" status
# - todo-app: Up
# - todo-postgres: Up (healthy)
# - todo-redis: Up (healthy)
# - todo-migrate: Exit 0 (completed)
```

### 2. **Basic Health Check**
```bash
# Test main health endpoint
curl http://localhost:3000/health

# Expected: JSON response with "status": "healthy"
```

## 🌐 Web Interface Testing

### 1. **API Documentation**
- Open: http://localhost:3000/api-docs
- ✅ Should load Swagger UI with all API endpoints
- ✅ Try the "Try it out" feature on any endpoint

### 2. **GraphQL Playground**
- Open: http://localhost:3000/playground
- ✅ Should load custom GraphQL interface
- ✅ Try running: `{ health }`

### 3. **GraphQL Endpoint**
- Open: http://localhost:3000/graphql
- ✅ Should show GraphQL playground (if browser supports it)

## 🔐 Authentication Flow Testing

### 1. **User Registration**
```bash
# Create a new user
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "username": "testuser",
    "password": "Password123!",
    "firstName": "Test",
    "lastName": "User"
  }'

# Expected: Success response with user data and JWT token
# Save the token for next steps!
```

### 2. **User Login**
```bash
# Login with created user
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "Password123!"
  }'

# Expected: Success response with JWT token
```

### 3. **Test Protected Endpoint**
```bash
# Get user profile (replace TOKEN with actual token)
curl -X GET http://localhost:3000/api/auth/profile \
  -H "Authorization: Bearer YOUR_TOKEN_HERE"

# Expected: User profile data
```

## 📝 Todo Operations Testing

### 1. **Create Todo**
```bash
# Create a new todo (replace TOKEN)
curl -X POST http://localhost:3000/api/todos \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN_HERE" \
  -d '{
    "title": "Test Todo",
    "description": "This is a test todo",
    "priority": 2,
    "category": "testing",
    "tags": ["test", "api"]
  }'

# Expected: Success response with todo data
# Save the todo ID for next steps!
```

### 2. **Get All Todos**
```bash
# Get all todos for user
curl -X GET http://localhost:3000/api/todos \
  -H "Authorization: Bearer YOUR_TOKEN_HERE"

# Expected: List of todos with pagination
```

### 3. **Update Todo**
```bash
# Update a todo (replace TODO_ID and TOKEN)
curl -X PUT http://localhost:3000/api/todos/TODO_ID \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN_HERE" \
  -d '{
    "title": "Updated Todo",
    "completed": true
  }'

# Expected: Updated todo data
```

### 4. **Delete Todo**
```bash
# Delete a todo (replace TODO_ID and TOKEN)
curl -X DELETE http://localhost:3000/api/todos/TODO_ID \
  -H "Authorization: Bearer YOUR_TOKEN_HERE"

# Expected: Success confirmation
```

## 🎯 GraphQL Testing

### 1. **Health Check**
```bash
# Test GraphQL health
curl -X POST http://localhost:3000/graphql \
  -H "Content-Type: application/json" \
  -d '{"query": "{ health }"}'

# Expected: {"data":{"health":"GraphQL service is healthy"}}
```

### 2. **User Registration via GraphQL**
```bash
# Register user via GraphQL
curl -X POST http://localhost:3000/graphql \
  -H "Content-Type: application/json" \
  -d '{
    "query": "mutation { register(input: { email: \"graphql@example.com\", username: \"gqluser\", password: \"Password123!\", firstName: \"GraphQL\", lastName: \"User\" }) { user { id email username } token } }"
  }'

# Expected: User data and token
```

### 3. **Authenticated GraphQL Query**
```bash
# Get todos via GraphQL (replace TOKEN)
curl -X POST http://localhost:3000/graphql \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN_HERE" \
  -d '{
    "query": "{ todos { todos { id title completed priority } } }"
  }'

# Expected: List of todos
```

## 🔧 Advanced Features Testing

### 1. **Todo Statistics**
```bash
# Get todo statistics
curl -X GET http://localhost:3000/api/todos/stats \
  -H "Authorization: Bearer YOUR_TOKEN_HERE"

# Expected: Statistics object with counts and completion rate
```

### 2. **Categories and Tags**
```bash
# Get categories
curl -X GET http://localhost:3000/api/todos/categories \
  -H "Authorization: Bearer YOUR_TOKEN_HERE"

# Get tags
curl -X GET http://localhost:3000/api/todos/tags \
  -H "Authorization: Bearer YOUR_TOKEN_HERE"

# Expected: Arrays of categories and tags
```

### 3. **Bulk Operations**
```bash
# Bulk update todos (replace TODO_IDS and TOKEN)
curl -X PUT http://localhost:3000/api/todos/bulk \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN_HERE" \
  -d '{
    "todoIds": ["todo-id-1", "todo-id-2"],
    "updateData": {
      "completed": true,
      "priority": 3
    }
  }'

# Expected: Updated todos data
```

## 🚀 Automated Testing

### Run Complete Test Suite
```bash
# Make the test script executable
chmod +x test-system.sh

# Run comprehensive tests
./test-system.sh

# Expected: Detailed test results with pass/fail for each component
```

## 🐛 Troubleshooting

### Common Issues and Solutions

#### 1. **Service Not Running**
```bash
# Check Docker services
docker-compose ps

# Restart services if needed
docker-compose restart

# View logs
docker-compose logs app
```

#### 2. **Database Connection Issues**
```bash
# Check PostgreSQL
docker-compose exec postgres pg_isready -U postgres -d todo_app

# Restart PostgreSQL if needed
docker-compose restart postgres
```

#### 3. **Redis Connection Issues**
```bash
# Check Redis
docker-compose exec redis redis-cli ping

# Restart Redis if needed
docker-compose restart redis
```

#### 4. **Authentication Errors**
- Make sure to include `Bearer ` prefix in Authorization header
- Check that token hasn't expired (7 days default)
- Verify token format is correct

#### 5. **CORS Issues**
- The app is configured for `localhost:3000` and `localhost:3001`
- Check if you're accessing from correct origin

## 📊 Success Indicators

### ✅ Everything Working Correctly When:

1. **Docker Services**: ✅ All services show "Up" status
2. **Health Endpoints**: ✅ Return 200 status with healthy responses
3. **API Documentation**: ✅ Loads and shows all endpoints
4. **GraphQL**: ✅ Playground loads and queries work
5. **Authentication**: ✅ Registration and login return JWT tokens
6. **Todo Operations**: ✅ CRUD operations work with proper authentication
7. **Advanced Features**: ✅ Statistics, bulk operations, filtering work
8. **Error Handling**: ✅ Proper error responses for invalid requests
9. **Rate Limiting**: ✅ Limits excessive requests appropriately
10. **Security**: ✅ Protected endpoints require authentication

## 🎯 Quick Browser Tests

### 1. Open these URLs in your browser:
- **Health Check**: http://localhost:3000/health
- **API Docs**: http://localhost:3000/api-docs
- **GraphQL Playground**: http://localhost:3000/playground
- **Root API**: http://localhost:3000/

### 2. In GraphQL Playground, try:
```graphql
# Health check
{ health }

# Register user
mutation {
  register(input: {
    email: "browser@example.com"
    username: "browseruser"
    password: "Password123!"
    firstName: "Browser"
    lastName: "User"
  }) {
    user { id email username }
    token
  }
}
```

### 3. In API Documentation:
- Click "Authorize" button
- Add your JWT token: `Bearer YOUR_TOKEN_HERE`
- Try any endpoint with "Try it out"

## 📈 Performance Testing

### Load Test Health Endpoint
```bash
# Simple load test (requires Apache Bench)
ab -n 100 -c 10 http://localhost:3000/health

# Expected: All requests should succeed with reasonable response times
```

## 🏁 Final Verification

If all the above tests pass, your Todo application is:
- ✅ **Fully Functional**: All core features working
- ✅ **Secure**: Authentication and authorization working
- ✅ **Documented**: API documentation accessible
- ✅ **Scalable**: Docker containerized and ready for deployment
- ✅ **Maintainable**: GraphQL and REST APIs both available
- ✅ **Production Ready**: Error handling and logging in place

## 🆘 Getting Help

If tests fail:
1. Check the logs: `docker-compose logs app`
2. Verify environment variables in `docker-compose.yml`
3. Ensure ports 3000, 5433, and 6380 are available
4. Run the automated test script for detailed diagnostics
5. Check database migrations: `docker-compose logs migrate`

---

**Happy Testing! 🎉**