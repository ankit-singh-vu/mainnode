exports.up = function(knex) {
  return knex.schema.createTable('users', function(table) {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.string('email').unique().notNullable();
    table.string('username').unique().notNullable();
    table.string('password_hash').notNullable();
    table.string('first_name');
    table.string('last_name');
    table.boolean('is_active').defaultTo(true);
    table.boolean('email_verified').defaultTo(false);
    table.string('email_verification_token');
    table.timestamp('email_verified_at');
    table.string('password_reset_token');
    table.timestamp('password_reset_expires');
    table.timestamp('last_login_at');
    table.string('last_login_ip');
    table.integer('failed_login_attempts').defaultTo(0);
    table.timestamp('locked_until');
    table.json('preferences').defaultTo('{}');
    table.timestamps(true, true);

    // Indexes for performance
    table.index(['email']);
    table.index(['username']);
    table.index(['is_active']);
    table.index(['email_verified']);
    table.index(['created_at']);
  });
};

exports.down = function(knex) {
  return knex.schema.dropTable('users');
};
