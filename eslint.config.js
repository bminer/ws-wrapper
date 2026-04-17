import js from "@eslint/js"
import prettierPlugin from "eslint-plugin-prettier/recommended"
import globals from "globals"

const nodeBuiltinSet = new Set(Object.keys(globals.nodeBuiltin))
// Compute the intersection of browser and nodeBuiltin globals
const primaryGlobals = {}
for (const g in globals.browser) {
	if (nodeBuiltinSet.has(g)) {
		primaryGlobals[g] = globals.browser[g]
	}
}

export default [
	{ ignores: ["**/dist"] },
	js.configs.recommended,
	prettierPlugin,
	{
		languageOptions: {
			ecmaVersion: 2020,
			sourceType: "module",
			globals: {
				...primaryGlobals,
				// AbortController is available in Node 14.17+ and all modern browsers
				AbortController: "readonly",
				AbortSignal: "readonly",
			},
		},
		rules: {
			eqeqeq: ["error", "always", { null: "never" }],
			"no-unused-expressions": "error",
			"new-cap": "error",
			"no-nested-ternary": "error",
			"no-unused-vars": [
				"error",
				{ args: "none", caughtErrorsIgnorePattern: "^ignore" },
			],
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
	{
		// Test files run on Node 18+ and may use any Node global
		files: ["test/**/*.mjs"],
		languageOptions: {
			ecmaVersion: 2022,
			globals: {
				...globals.node,
			},
		},
	},
]
