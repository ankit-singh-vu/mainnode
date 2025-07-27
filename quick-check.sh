#!/bin/bash

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}🔍 Quick Health Check for Todo Application${NC}\n"

# Check Docker services
echo -e "${YELLOW}Checking Docker services...${NC}"
if docker-compose ps | grep -q "Up"; then
    echo -e "${GREEN}✅ Docker services are running${NC}"
else
    echo -e "${RED}❌ Docker services are not running${NC}"
    exit 1
fi

# Check main health endpoint
echo -e "${YELLOW}Checking API health...${NC}"
if curl -s http://localhost:3000/health | grep -q '"status":"healthy"'; then
    echo -e "${GREEN}✅ API is healthy${NC}"
else
    echo -e "${RED}❌ API is not responding${NC}"
    exit 1
fi

# Check GraphQL
echo -e "${YELLOW}Checking GraphQL...${NC}"
if curl -s -X POST -H "Content-Type: application/json" -d '{"query":"{ health }"}' http://localhost:3000/graphql | grep -q '"health":"GraphQL service is healthy"'; then
    echo -e "${GREEN}✅ GraphQL is working${NC}"
else
    echo -e "${RED}❌ GraphQL is not working${NC}"
fi

# Check API documentation
echo -e "${YELLOW}Checking API documentation...${NC}"
if curl -s -I http://localhost:3000/api-docs/ | grep -q "200 OK"; then
    echo -e "${GREEN}✅ API documentation is accessible${NC}"
else
    echo -e "${RED}❌ API documentation is not accessible${NC}"
fi

echo -e "\n${BLUE}📊 Quick Check Complete!${NC}"
echo -e "\n${YELLOW}Available URLs:${NC}"
echo -e "• Health: http://localhost:3000/health"
echo -e "• API Docs: http://localhost:3000/api-docs"
echo -e "• GraphQL: http://localhost:3000/playground"
