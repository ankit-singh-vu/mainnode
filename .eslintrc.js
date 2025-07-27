module.exports = {
  env: {
    browser: false,
    es2021: true,
    node: true,
    jest: true
  },
  extends: [
    'eslint:recommended',
    'airbnb-base'
  ],
  parserOptions: {
    ecmaVersion: 12,
    sourceType: 'module'
  },
  rules: {
    // Allow console.log in development
    'no-console': process.env.NODE_ENV === 'production' ? 'error' : 'warn',

    // Allow debugger in development
    'no-debugger': process.env.NODE_ENV === 'production' ? 'error' : 'warn',

    // Disable some overly strict rules
    'no-underscore-dangle': 'off',
    'no-param-reassign': ['error', { props: false }],
    'consistent-return': 'off',
    'no-plusplus': 'off',
    'class-methods-use-this': 'off',

    // Allow async functions without await
    'require-await': 'off',

    // Enforce consistent line endings
    'linebreak-style': ['error', 'unix'],

    // Enforce semicolons
    'semi': ['error', 'always'],

    // Enforce consistent quotes
    'quotes': ['error', 'single', { allowTemplateLiterals: true }],

    // Enforce consistent indentation
    'indent': ['error', 2, { SwitchCase: 1 }],

    // Enforce max line length
    'max-len': ['warn', {
      code: 120,
      ignoreUrls: true,
      ignoreStrings: true,
      ignoreTemplateLiterals: true,
      ignoreComments: true
    }],

    // Allow multiple empty lines in certain contexts
    'no-multiple-empty-lines': ['error', { max: 2, maxEOF: 1 }],

    // Allow dangling commas
    'comma-dangle': ['error', 'never'],

    // Enforce consistent object property spacing
    'key-spacing': ['error', { beforeColon: false, afterColon: true }],

    // Enforce consistent spacing in objects
    'object-curly-spacing': ['error', 'always'],

    // Enforce consistent spacing in arrays
    'array-bracket-spacing': ['error', 'never'],

    // Allow unused vars that start with underscore
    'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],

    // Security rules
    'no-eval': 'error',
    'no-implied-eval': 'error',
    'no-new-func': 'error',
    'no-script-url': 'error',

    // Node.js specific rules
    'global-require': 'off',
    'import/no-dynamic-require': 'off',
    'import/prefer-default-export': 'off',
    'import/no-extraneous-dependencies': ['error', {
      devDependencies: [
        '**/*.test.js',
        '**/*.spec.js',
        '**/tests/**',
        '**/test/**',
        'knexfile.js',
        'jest.config.js'
      ]
    }],

    // Allow async/await
    'no-async-promise-executor': 'warn',
    'no-await-in-loop': 'warn',

    // Enforce camelCase
    'camelcase': ['error', { properties: 'never', ignoreDestructuring: true }],

    // Enforce consistent function declarations
    'func-style': ['error', 'expression', { allowArrowFunctions: true }],

    // Enforce consistent arrow function style
    'arrow-parens': ['error', 'always'],
    'arrow-spacing': 'error',

    // Enforce consistent object shorthand
    'object-shorthand': ['error', 'always'],

    // Enforce consistent template literal usage
    'prefer-template': 'error',

    // Enforce consistent destructuring
    'prefer-destructuring': ['error', {
      array: false,
      object: true
    }, {
      enforceForRenamedProperties: false
    }],

    // Enforce consistent spread operator usage
    'prefer-spread': 'error',

    // Enforce consistent rest parameters
    'prefer-rest-params': 'error',

    // Enforce consistent default parameters
    'default-param-last': 'error'
  },
  overrides: [
    {
      // Specific rules for test files
      files: ['**/*.test.js', '**/*.spec.js', '**/tests/**'],
      rules: {
        'no-unused-expressions': 'off',
        'import/no-extraneous-dependencies': 'off',
        'max-len': 'off',
        'no-console': 'off'
      }
    },
    {
      // Specific rules for configuration files
      files: ['knexfile.js', 'jest.config.js', '.eslintrc.js'],
      rules: {
        'no-console': 'off',
        'global-require': 'off'
      }
    }
  ]
};
