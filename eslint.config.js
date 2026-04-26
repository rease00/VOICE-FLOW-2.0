export default [
    {
        ignores: ["_next/**", "output/**", "audio/**", ".playwright-mcp/**"]
    },
    {
        files: ["**/*.js", "**/*.mjs"],
        rules: {
            "no-unused-vars": "warn"
        }
    }
];
