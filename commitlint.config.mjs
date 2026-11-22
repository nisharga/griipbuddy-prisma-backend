/** Conventional Commits: `type: subject`, e.g. `feat: add coupon module` (see .husky/commit-msg). */
const commitlintConfig = {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "type-enum": [
      2,
      "always",
      ["build", "chore", "ci", "docs", "feat", "fix", "perf", "refactor", "revert", "style", "test"],
    ],
  },
};

export default commitlintConfig;
