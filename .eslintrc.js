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
		"project": "./tsconfig.json",
		"sourceType": "module"
	},
	"plugins": [
		"@typescript-eslint",
	],
	"extends": [
		"eslint:recommended",
		"plugin:@typescript-eslint/eslint-recommended",
		"plugin:@typescript-eslint/recommended",
		"plugin:@typescript-eslint/recommended-requiring-type-checking"
	],
	"rules": {
		//// Additionally enabled (N.B.: The corresponding base rules must be disabled)
		"no-extra-parens": "off",
		"@typescript-eslint/no-extra-parens": "warn",
		"semi": "off",
		"@typescript-eslint/semi": "warn",
    	"brace-style": "off",
    	"@typescript-eslint/brace-style": ["warn", "allman", { "allowSingleLine": true }],
		"quotes": "off",
		"@typescript-eslint/quotes": ["warn", "single", { "avoidEscape": true }],
		//// Adjustments
		"@typescript-eslint/no-use-before-define": ["error", "nofunc"], // Functions are hoisted
		"camelcase": "off",
    	"@typescript-eslint/camelcase": ["warn", { "properties": "always", "genericType": "always" }],
		//// Disabled
		// Annoying to get this warning even if the return type is inferred.
		"@typescript-eslint/explicit-function-return-type": "off"
		// 	"@typescript-eslint/class-name-casing": "error",
		// 	"@typescript-eslint/member-delimiter-style": [
		// 		"off",
		// 		{
		// 			"multiline": {
		// 				"delimiter": "none",
		// 				"requireLast": true
		// 			},
		// 			"singleline": {
		// 				"delimiter": "semi",
		// 				"requireLast": false
		// 			}
		// 		}
		// 	],
		// 	"no-redeclare": "error",
		// 	"no-unused-expressions": "error",
	}
};
