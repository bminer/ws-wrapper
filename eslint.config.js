const js = require("@eslint/js")
const globals = require("globals")
const prettierPlugin = require("eslint-plugin-prettier/recommended")

module.exports = [
	js.configs.recommended,
	prettierPlugin,
	{
		rules: {
			eqeqeq: ["error", "always", { null: "never" }],
			"no-unused-expressions": "error",
			"new-cap": "error",
			"no-nested-ternary": "error",
			"no-unused-vars": ["error", { args: "none" }],
			"no-var": "error",
			"no-template-curly-in-string": "error",
			"no-alert": "error",
			"spaced-comment": ["warn", "always"],
			"prefer-destructuring": [
				"warn",
				{
					AssignmentExpression: { object: false, array: true },
					VariableDeclarator: { object: true, array: true },
				},
			],
			"prefer-const": [
				"error",
				{
					destructuring: "all",
					ignoreReadBeforeAssign: false,
				},
			],
			"object-shorthand": ["warn", "always"],
		},
	},
	{
		files: ["lib/**/*.js", "eslint.config.js"],
		languageOptions: {
			ecmaVersion: 2018,
			sourceType: "commonjs",
			globals: {
				console: false,
				setTimeout: false,
				clearTimeout: false,
			},
		},
	},
	{
		files: ["example-app/client.js"],
		languageOptions: {
			ecmaVersion: 2018,
			sourceType: "commonjs",
			globals: {
				...globals.browser,
				$: false,
			},
		},
	},
	{
		files: ["example-app/server.js"],
		languageOptions: {
			ecmaVersion: 2018,
			sourceType: "commonjs",
			globals: {
				...globals.node,
			},
		},
	},
]
