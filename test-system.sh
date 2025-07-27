#!/bin/bash

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
WHITE='\033[1;37m'
NC='\033[0m' # No Color

# Configuration
API_BASE_URL="http://localhost:3000"
TEST_EMAIL="test$(date +%s)@example.com"
TEST_USERNAME="testuser$(date +%s)"
TEST_PASSWORD="TestPassword123!"

# Global variables
AUTH_TOKEN=""
USER_ID=""
TODO_ID=""

# Helper functions
print_header() {
    echo -e "\n${BLUE}================================${NC}"
    echo -e "${WHITE}$1${NC}"
    echo -e "${BLUE}================================${NC}\n"
}

print_test() {
    echo -e "${CYAN}Testing: $1${NC}"
}

print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_info() {
    echo -e "${PURPLE}ℹ️  $1${NC}"
}

# Check if curl is available
check_dependencies() {
    if ! command -v curl &> /dev/null; then
        print_error "curl is required but not installed. Please install curl to run this test."
        exit 1
    fi

    if ! command -v jq &> /dev/null; then
        print_warning "jq is not installed. JSON responses will not be prettified."
    fi
}

# Test HTTP endpoint
test_endpoint() {
    local method=$1
    local endpoint=$2
    local data=$3
    local expected_status=$4
    local headers=$5

    local curl_cmd="curl -s -w 'HTTP_STATUS:%{http_code}' -X $method"

    if [ -n "$headers" ]; then
        curl_cmd="$curl_cmd $headers"
    fi

    if [ -n "$data" ]; then
        curl_cmd="$curl_cmd -H 'Content-Type: application/json' -d '$data'"
    fi

    curl_cmd="$curl_cmd $API_BASE_URL$endpoint"

    local response=$(eval $curl_cmd)
    local status=$(echo "$response" | grep -o 'HTTP_STATUS:[0-9]*' | cut -d: -f2)
    local body=$(echo "$response" | sed 's/HTTP_STATUS:[0-9]*$//')

    if [ "$status" = "$expected_status" ]; then
        return 0
    else
        echo "Expected: $expected_status, Got: $status"
        echo "Response: $body"
        return 1
    fi
}

# Parse JSON response
parse_json() {
    local json=$1
    local key=$2

    if command -v jq &> /dev/null; then
        echo "$json" | jq -r ".$key"
    else
        # Simple grep-based parsing for when jq is not available
        echo "$json" | grep -o "\"$key\":\"[^\"]*\"" | cut -d'"' -f4
    fi
}

# 1. Docker Services Health Check
test_docker_services() {
    print_header "1. DOCKER SERVICES HEALTH CHECK"

    print_test "Checking if Docker Compose services are running"
    if docker-compose ps | grep -q "Up"; then
        print_success "Docker services are running"
        docker-compose ps
    else
        print_error "Some Docker services are not running"
        docker-compose ps
        return 1
    fi

    print_test "Checking individual service health"

    # Check PostgreSQL
    if docker-compose exec -T postgres pg_isready -U postgres -d todo_app &>/dev/null; then
        print_success "PostgreSQL is healthy"
    else
        print_error "PostgreSQL is not responding"
    fi

    # Check Redis
    if docker-compose exec -T redis redis-cli ping | grep -q "PONG"; then
        print_success "Redis is healthy"
    else
        print_error "Redis is not responding"
    fi
}

# 2. Basic API Health Check
test_basic_health() {
    print_header "2. BASIC API HEALTH CHECK"

    print_test "Testing main health endpoint"
    if test_endpoint "GET" "/health" "" "200"; then
        print_success "Main health endpoint is working"
    else
        print_error "Main health endpoint failed"
        return 1
    fi

    print_test "Testing API root endpoint"
    if test_endpoint "GET" "/" "" "200"; then
        print_success "API root endpoint is working"
    else
        print_error "API root endpoint failed"
    fi
}

# 3. API Documentation Check
test_api_docs() {
    print_header "3. API DOCUMENTATION CHECK"

    print_test "Testing API documentation endpoint"
    if test_endpoint "GET" "/api-docs/" "" "200"; then
        print_success "API documentation is accessible"
    else
        print_error "API documentation is not accessible"
    fi
}

# 4. GraphQL Health Check
test_graphql() {
    print_header "4. GRAPHQL HEALTH CHECK"

    print_test "Testing GraphQL health query"
    local query='{"query": "{ health }"}'
    if test_endpoint "POST" "/graphql" "$query" "200"; then
        print_success "GraphQL endpoint is working"
    else
        print_error "GraphQL endpoint failed"
        return 1
    fi

    print_test "Testing GraphQL playground"
    if test_endpoint "GET" "/playground" "" "200"; then
        print_success "GraphQL playground is accessible"
    else
        print_error "GraphQL playground is not accessible"
    fi
}

# 5. Authentication Flow Test
test_authentication() {
    print_header "5. AUTHENTICATION FLOW TEST"

    print_test "Testing user registration"
    local register_data="{\"email\":\"$TEST_EMAIL\",\"username\":\"$TEST_USERNAME\",\"password\":\"$TEST_PASSWORD\",\"firstName\":\"Test\",\"lastName\":\"User\"}"

    local response=$(curl -s -X POST -H "Content-Type: application/json" -d "$register_data" "$API_BASE_URL/api/auth/register")

    if echo "$response" | grep -q '"success":true'; then
        print_success "User registration successful"
        AUTH_TOKEN=$(parse_json "$response" "data.token")
        USER_ID=$(parse_json "$response" "data.user.id")
        print_info "Auth token obtained: ${AUTH_TOKEN:0:20}..."
    else
        print_error "User registration failed"
        echo "Response: $response"
        return 1
    fi

    print_test "Testing user login"
    local login_data="{\"email\":\"$TEST_EMAIL\",\"password\":\"$TEST_PASSWORD\"}"

    if test_endpoint "POST" "/api/auth/login" "$login_data" "200"; then
        print_success "User login successful"
    else
        print_error "User login failed"
    fi

    print_test "Testing protected endpoint (profile)"
    if test_endpoint "GET" "/api/auth/profile" "" "200" "-H 'Authorization: Bearer $AUTH_TOKEN'"; then
        print_success "Protected endpoint access successful"
    else
        print_error "Protected endpoint access failed"
    fi
}

# 6. Todo CRUD Operations Test
test_todo_operations() {
    print_header "6. TODO CRUD OPERATIONS TEST"

    if [ -z "$AUTH_TOKEN" ]; then
        print_error "No auth token available. Skipping todo tests."
        return 1
    fi

    print_test "Testing todo creation"
    local todo_data='{"title":"Test Todo","description":"This is a test todo","priority":2,"category":"test","tags":["testing","api"]}'

    local response=$(curl -s -X POST -H "Content-Type: application/json" -H "Authorization: Bearer $AUTH_TOKEN" -d "$todo_data" "$API_BASE_URL/api/todos")

    if echo "$response" | grep -q '"success":true'; then
        print_success "Todo creation successful"
        TODO_ID=$(parse_json "$response" "data.id")
        print_info "Todo ID: $TODO_ID"
    else
        print_error "Todo creation failed"
        echo "Response: $response"
        return 1
    fi

    print_test "Testing get all todos"
    if test_endpoint "GET" "/api/todos" "" "200" "-H 'Authorization: Bearer $AUTH_TOKEN'"; then
        print_success "Get all todos successful"
    else
        print_error "Get all todos failed"
    fi

    if [ -n "$TODO_ID" ]; then
        print_test "Testing get specific todo"
        if test_endpoint "GET" "/api/todos/$TODO_ID" "" "200" "-H 'Authorization: Bearer $AUTH_TOKEN'"; then
            print_success "Get specific todo successful"
        else
            print_error "Get specific todo failed"
        fi

        print_test "Testing todo update"
        local update_data='{"title":"Updated Test Todo","completed":true}'
        if test_endpoint "PUT" "/api/todos/$TODO_ID" "$update_data" "200" "-H 'Authorization: Bearer $AUTH_TOKEN'"; then
            print_success "Todo update successful"
        else
            print_error "Todo update failed"
        fi

        print_test "Testing todo toggle"
        if test_endpoint "PATCH" "/api/todos/$TODO_ID/toggle" "" "200" "-H 'Authorization: Bearer $AUTH_TOKEN'"; then
            print_success "Todo toggle successful"
        else
            print_error "Todo toggle failed"
        fi
    fi
}

# 7. Advanced Features Test
test_advanced_features() {
    print_header "7. ADVANCED FEATURES TEST"

    if [ -z "$AUTH_TOKEN" ]; then
        print_error "No auth token available. Skipping advanced tests."
        return 1
    fi

    print_test "Testing todo statistics"
    if test_endpoint "GET" "/api/todos/stats" "" "200" "-H 'Authorization: Bearer $AUTH_TOKEN'"; then
        print_success "Todo statistics working"
    else
        print_error "Todo statistics failed"
    fi

    print_test "Testing categories endpoint"
    if test_endpoint "GET" "/api/todos/categories" "" "200" "-H 'Authorization: Bearer $AUTH_TOKEN'"; then
        print_success "Categories endpoint working"
    else
        print_error "Categories endpoint failed"
    fi

    print_test "Testing tags endpoint"
    if test_endpoint "GET" "/api/todos/tags" "" "200" "-H 'Authorization: Bearer $AUTH_TOKEN'"; then
        print_success "Tags endpoint working"
    else
        print_error "Tags endpoint failed"
    fi

    if [ -n "$TODO_ID" ]; then
        print_test "Testing add tag to todo"
        local tag_data='{"tag":"important"}'
        if test_endpoint "POST" "/api/todos/$TODO_ID/tags" "$tag_data" "200" "-H 'Authorization: Bearer $AUTH_TOKEN'"; then
            print_success "Add tag to todo working"
        else
            print_error "Add tag to todo failed"
        fi
    fi
}

# 8. GraphQL Operations Test
test_graphql_operations() {
    print_header "8. GRAPHQL OPERATIONS TEST"

    if [ -z "$AUTH_TOKEN" ]; then
        print_warning "No auth token available. Testing public GraphQL queries only."
    fi

    print_test "Testing GraphQL user registration"
    local register_mutation='{"query":"mutation { register(input: { email: \"graphql'$(date +%s)'@example.com\", username: \"gqluser'$(date +%s)'\", password: \"TestPassword123!\", firstName: \"GraphQL\", lastName: \"User\" }) { user { id email username } token } }"}'

    local response=$(curl -s -X POST -H "Content-Type: application/json" -d "$register_mutation" "$API_BASE_URL/graphql")

    if echo "$response" | grep -q '"data"'; then
        print_success "GraphQL user registration working"
        # Extract token for GraphQL tests
        local gql_token=$(echo "$response" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)

        if [ -n "$gql_token" ]; then
            print_test "Testing authenticated GraphQL query"
            local todos_query='{"query":"{ todos { todos { id title completed } } }"}'

            local auth_response=$(curl -s -X POST -H "Content-Type: application/json" -H "Authorization: Bearer $gql_token" -d "$todos_query" "$API_BASE_URL/graphql")

            if echo "$auth_response" | grep -q '"data"'; then
                print_success "Authenticated GraphQL query working"
            else
                print_error "Authenticated GraphQL query failed"
            fi
        fi
    else
        print_error "GraphQL user registration failed"
        echo "Response: $response"
    fi
}

# 9. Rate Limiting Test
test_rate_limiting() {
    print_header "9. RATE LIMITING TEST"

    print_test "Testing rate limiting (making multiple requests)"
    local success_count=0
    local total_requests=10

    for i in $(seq 1 $total_requests); do
        if test_endpoint "GET" "/health" "" "200" >/dev/null 2>&1; then
            ((success_count++))
        fi
    done

    if [ $success_count -eq $total_requests ]; then
        print_success "Rate limiting allows normal requests ($success_count/$total_requests succeeded)"
    else
        print_warning "Some requests were rate limited ($success_count/$total_requests succeeded)"
    fi
}

# 10. Cleanup Test Data
cleanup_test_data() {
    print_header "10. CLEANUP TEST DATA"

    if [ -n "$TODO_ID" ] && [ -n "$AUTH_TOKEN" ]; then
        print_test "Cleaning up test todo"
        if test_endpoint "DELETE" "/api/todos/$TODO_ID" "" "200" "-H 'Authorization: Bearer $AUTH_TOKEN'" >/dev/null 2>&1; then
            print_success "Test todo cleaned up"
        else
            print_warning "Failed to clean up test todo (ID: $TODO_ID)"
        fi
    fi

    print_info "Test user and data may remain in the system for manual cleanup if needed"
    print_info "Test email: $TEST_EMAIL"
    print_info "Test username: $TEST_USERNAME"
}

# Main execution
main() {
    print_header "🧪 COMPREHENSIVE SYSTEM HEALTH CHECK"
    print_info "Starting comprehensive test of Todo Application"
    print_info "Base URL: $API_BASE_URL"
    print_info "Test Email: $TEST_EMAIL"
    print_info "Test Username: $TEST_USERNAME"

    check_dependencies

    # Run all tests
    local tests=(
        "test_docker_services"
        "test_basic_health"
        "test_api_docs"
        "test_graphql"
        "test_authentication"
        "test_todo_operations"
        "test_advanced_features"
        "test_graphql_operations"
        "test_rate_limiting"
        "cleanup_test_data"
    )

    local passed=0
    local total=${#tests[@]}

    for test in "${tests[@]}"; do
        if $test; then
            ((passed++))
        fi
        sleep 1  # Brief pause between tests
    done

    # Final summary
    print_header "📊 TEST SUMMARY"

    if [ $passed -eq $total ]; then
        print_success "ALL TESTS PASSED! ($passed/$total) 🎉"
        print_success "Your Todo application is fully functional!"
    elif [ $passed -gt $((total * 3 / 4)) ]; then
        print_warning "MOST TESTS PASSED ($passed/$total) ⚠️"
        print_warning "Your application is mostly working with minor issues"
    else
        print_error "SEVERAL TESTS FAILED ($passed/$total) ❌"
        print_error "Your application has significant issues that need attention"
    fi

    print_info "Check the detailed output above for specific issues"

    echo -e "\n${BLUE}Available Endpoints:${NC}"
    echo -e "${WHITE}• Health Check:${NC} $API_BASE_URL/health"
    echo -e "${WHITE}• API Documentation:${NC} $API_BASE_URL/api-docs"
    echo -e "${WHITE}• GraphQL Playground:${NC} $API_BASE_URL/playground"
    echo -e "${WHITE}• GraphQL Endpoint:${NC} $API_BASE_URL/graphql"
    echo -e "${WHITE}• Auth API:${NC} $API_BASE_URL/api/auth"
    echo -e "${WHITE}• Todos API:${NC} $API_BASE_URL/api/todos"
}

# Run the main function
main "$@"
