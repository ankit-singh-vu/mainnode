exports.up = function(knex) {
  return knex.schema.createTable('audit_logs', function(table) {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('user_id').references('id').inTable('users').onDelete('SET NULL');
    table.string('action').notNullable(); // CREATE, UPDATE, DELETE, LOGIN, LOGOUT, etc.
    table.string('resource_type').notNullable(); // USER, TODO, etc.
    table.uuid('resource_id');
    table.json('old_values'); // Previous state of the resource
    table.json('new_values'); // New state of the resource
    table.string('ip_address');
    table.string('user_agent');
    table.string('request_id');
    table.string('session_id');
    table.json('metadata').defaultTo('{}'); // Additional context
    table.string('status').defaultTo('SUCCESS'); // SUCCESS, FAILURE, PARTIAL
    table.string('error_message');
    table.timestamp('timestamp').defaultTo(knex.fn.now());

    // Indexes for performance and querying
    table.index(['user_id']);
    table.index(['action']);
    table.index(['resource_type']);
    table.index(['resource_id']);
    table.index(['timestamp']);
    table.index(['status']);
    table.index(['user_id', 'timestamp']);
    table.index(['resource_type', 'resource_id']);
    table.index(['action', 'resource_type']);
  });
};

exports.down = function(knex) {
  return knex.schema.dropTable('audit_logs');
};
