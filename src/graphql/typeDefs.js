const { gql } = require("apollo-server-express");

const typeDefs = gql`
  scalar DateTime

  # User Types
  type User {
    id: ID!
    email: String!
    username: String!
    firstName: String
    lastName: String
    isActive: Boolean!
    emailVerified: Boolean!
    emailVerifiedAt: DateTime
    lastLoginAt: DateTime
    preferences: JSON
    createdAt: DateTime!
    updatedAt: DateTime!
    stats: UserStats
  }

  type UserStats {
    totalTodos: Int!
    completedTodos: Int!
    pendingTodos: Int!
    highPriorityTodos: Int!
    overdueTodos: Int!
    completionRate: Int!
  }

  # Todo Types
  type Todo {
    id: ID!
    userId: ID!
    user: User
    title: String!
    description: String
    completed: Boolean!
    priority: Priority!
    priorityText: String!
    category: String
    dueDate: DateTime
    completedAt: DateTime
    tags: [String!]!
    metadata: JSON
    position: Int!
    isOverdue: Boolean!
    isDueSoon: Boolean!
    timeUntilDue: String
    createdAt: DateTime!
    updatedAt: DateTime!
  }

  enum Priority {
    LOW
    MEDIUM
    HIGH
  }

  enum SortBy {
    CREATED_AT
    UPDATED_AT
    TITLE
    PRIORITY
    DUE_DATE
    POSITION
  }

  enum SortOrder {
    ASC
    DESC
  }

  # Pagination
  type PaginationInfo {
    page: Int!
    limit: Int!
    total: Int!
    pages: Int!
    hasNext: Boolean!
    hasPrev: Boolean!
  }

  type TodoConnection {
    todos: [Todo!]!
    pagination: PaginationInfo!
  }

  # Bulk Operation Results
  type BulkUpdateResult {
    updatedCount: Int!
    todos: [Todo!]!
  }

  type BulkDeleteResult {
    deletedCount: Int!
    deletedIds: [ID!]!
  }

  # Auth Types
  type AuthPayload {
    user: User!
    token: String!
    expiresIn: String!
  }

  type SessionInfo {
    ip: String
    userAgent: String
    loginAt: DateTime
  }

  # Input Types
  input RegisterInput {
    email: String!
    username: String!
    password: String!
    firstName: String
    lastName: String
  }

  input LoginInput {
    email: String!
    password: String!
  }

  input UpdateProfileInput {
    firstName: String
    lastName: String
    preferences: JSON
  }

  input ChangePasswordInput {
    currentPassword: String!
    newPassword: String!
  }

  input CreateTodoInput {
    title: String!
    description: String
    priority: Priority = LOW
    category: String
    dueDate: DateTime
    tags: [String!] = []
    metadata: JSON
    position: Int
  }

  input UpdateTodoInput {
    title: String
    description: String
    completed: Boolean
    priority: Priority
    category: String
    dueDate: DateTime
    tags: [String!]
    metadata: JSON
    position: Int
  }

  input TodoFilterInput {
    completed: Boolean
    priority: Priority
    category: String
    search: String
    dueBefore: DateTime
    dueAfter: DateTime
    tags: [String!]
  }

  input TodoSortInput {
    sortBy: SortBy = CREATED_AT
    sortOrder: SortOrder = DESC
  }

  input BulkUpdateTodoInput {
    todoIds: [ID!]!
    updateData: UpdateTodoInput!
  }

  input BulkDeleteTodoInput {
    todoIds: [ID!]!
  }

  input ReorderTodosInput {
    todoIds: [ID!]!
  }

  # Queries
  type Query {
    # User Queries
    me: User!
    profile: User!
    sessions: SessionInfo

    # Todo Queries
    todos(
      page: Int = 1
      limit: Int = 20
      filter: TodoFilterInput
      sort: TodoSortInput
    ): TodoConnection!

    todo(id: ID!): Todo

    categories: [String!]!
    tags: [String!]!

    overdueTodos: [Todo!]!
    upcomingTodos(days: Int = 7): [Todo!]!

    todoStats: UserStats!

    # Health Check
    health: String!
  }

  # Mutations
  type Mutation {
    # Authentication Mutations
    register(input: RegisterInput!): AuthPayload!
    login(input: LoginInput!): AuthPayload!
    logout: Boolean!
    refreshToken: AuthPayload!

    updateProfile(input: UpdateProfileInput!): User!
    changePassword(input: ChangePasswordInput!): AuthPayload!

    requestPasswordReset(email: String!): Boolean!
    resetPassword(token: String!, newPassword: String!): Boolean!
    verifyEmail(token: String!): Boolean!

    # Todo Mutations
    createTodo(input: CreateTodoInput!): Todo!
    updateTodo(id: ID!, input: UpdateTodoInput!): Todo!
    deleteTodo(id: ID!): Boolean!

    toggleTodo(id: ID!): Todo!
    duplicateTodo(id: ID!): Todo!

    bulkUpdateTodos(input: BulkUpdateTodoInput!): BulkUpdateResult!
    bulkDeleteTodos(input: BulkDeleteTodoInput!): BulkDeleteResult!
    reorderTodos(input: ReorderTodosInput!): Boolean!

    addTagToTodo(id: ID!, tag: String!): Todo!
    removeTagFromTodo(id: ID!, tag: String!): Todo!
  }

  # Subscriptions (for real-time updates)
  type Subscription {
    todoCreated(userId: ID!): Todo!
    todoUpdated(userId: ID!): Todo!
    todoDeleted(userId: ID!): ID!
    todosReordered(userId: ID!): [Todo!]!
  }

  # Custom JSON scalar for flexible metadata
  scalar JSON
`;

module.exports = typeDefs;
