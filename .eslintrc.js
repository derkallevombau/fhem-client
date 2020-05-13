module.exports = {
	"root": true,
	"env": {
		// Using 2017 since 2019 isn't accepted. I suppose that's
		// because no globals have been added to 2019 w.r.t 2017.
		"es2017": true,
		"node": true
	},
	"parser": "@typescript-eslint/parser",
	"parserOptions": {
		/// Core parser options
		"ecmaVersion": 2019,
		// For a module, place a .eslintrc.js in src with contents
		// 'module.exports = { "parserOptions": { "sourceType": "module" } };'
		// to override this option.
		"sourceType": "script",
		/// Options for @typescript-eslint/parser
		"tsconfigRootDir": __dirname,
		"project": "./tsconfig.json"
	},
	"plugins": [
		"@typescript-eslint/eslint-plugin",
		"eslint-plugin-tsdoc"
	],
	"extends": [
		"eslint:recommended",
		"plugin:@typescript-eslint/eslint-recommended",
		"plugin:@typescript-eslint/recommended",
		"plugin:@typescript-eslint/recommended-requiring-type-checking"
	],
	"rules": {
		/// Additionally enabled (N.B.: The corresponding base rules must be disabled)
		"no-extra-parens": "off",
		"@typescript-eslint/no-extra-parens": "warn",

		"semi": "off",
		"@typescript-eslint/semi": "warn",

		"brace-style": "off",
    	"@typescript-eslint/brace-style": ["warn", "allman", { "allowSingleLine": true }],

		"quotes": "off",
		"@typescript-eslint/quotes": ["warn", "single", { "avoidEscape": true }],
		/// Adjustments
		"@typescript-eslint/no-use-before-define": ["error", "nofunc"], // Functions are hoisted

		"camelcase": "off",
    	"@typescript-eslint/camelcase": ["warn", { "properties": "always", "genericType": "always" }],
		/// Disabled
		// Annoying to get this warning even if the return type is inferred.
		"@typescript-eslint/explicit-function-return-type": "off",

		// Dispensable and doesn't take into account that you might want
		// to align consecutive lines.
		"@typescript-eslint/type-annotation-spacing": "off",

		"@typescript-eslint/no-explicit-any": "off",

		/// eslint-plugin-tsdoc
		"tsdoc/syntax": "warn"
	}
};
