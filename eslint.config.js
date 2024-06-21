const js = require("@eslint/js")
const globals = require("globals")
const prettierPlugin = require("eslint-plugin-prettier/recommended")

const nodeBuiltinSet = new Set(Object.keys(globals.nodeBuiltin))
// Compute the intersection of browser and nodeBuiltin globals
const primaryGlobals = {}
for (const g in globals.browser) {
	if (nodeBuiltinSet.has(g)) {
		primaryGlobals[g] = globals.browser[g]
	}
}

module.exports = [
	js.configs.recommended,
	prettierPlugin,
	{
		languageOptions: {
			ecmaVersion: 2018,
			sourceType: "commonjs",
			globals: primaryGlobals,
		},
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
		files: ["example-app/client.js"],
		languageOptions: {
			globals: {
				...globals.browser,
				$: false,
			},
		},
	},
	{
		files: ["example-app/server.js"],
		languageOptions: {
			globals: {
				...globals.node,
			},
		},
	},
]
