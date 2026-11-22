/** Checks run on `git commit` for the staged files only (see .husky/pre-commit). */
const lintStagedConfig = {
  // Type-check the whole project when any TS file is staged: a change in one
  // file can break another. (A function, so file names aren't passed to tsc.)
  "*.ts": [() => "tsc --noEmit", "prettier --write", "eslint --fix"],

  // Formatting only.
  "*.{js,mjs,cjs,json,md,yml,yaml}": ["prettier --write"],

  // Prisma schema formatter (aligns columns, sorts attributes).
  "prisma/schema.prisma": [() => "prisma format"],
};

export default lintStagedConfig;
