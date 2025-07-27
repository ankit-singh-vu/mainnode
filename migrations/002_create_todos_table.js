exports.up = function(knex) {
  return knex.schema.createTable('todos', function(table) {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    table.string('title').notNullable();
    table.text('description');
    table.boolean('completed').defaultTo(false);
    table.integer('priority').defaultTo(1); // 1=low, 2=medium, 3=high
    table.string('category');
    table.timestamp('due_date');
    table.timestamp('completed_at');
    table.json('tags').defaultTo('[]');
    table.json('metadata').defaultTo('{}');
    table.integer('position').defaultTo(0); // For ordering
    table.timestamps(true, true);

    // Indexes for performance
    table.index(['user_id']);
    table.index(['completed']);
    table.index(['priority']);
    table.index(['category']);
    table.index(['due_date']);
    table.index(['created_at']);
    table.index(['user_id', 'completed']);
    table.index(['user_id', 'priority']);
    table.index(['user_id', 'category']);
  });
};

exports.down = function(knex) {
  return knex.schema.dropTable('todos');
};
