#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const hooksDir = '.git/hooks';

// Pre-commit hook
const preCommitHook = `#!/bin/sh
# Pre-commit hook for RecopyFast

echo "Running pre-commit checks..."

# Run linting
echo "Running linter..."
npm run lint
if [ $? -ne 0 ]; then
  echo "❌ Linting failed. Please fix the issues before committing."
  exit 1
fi

# Run type checking
echo "Running type checker..."
npm run type-check
if [ $? -ne 0 ]; then
  echo "❌ Type checking failed. Please fix the issues before committing."
  exit 1
fi

# Run formatting check
echo "Checking code formatting..."
npm run format:check
if [ $? -ne 0 ]; then
  echo "❌ Code formatting check failed. Run 'npm run format' to fix."
  exit 1
fi

echo "✅ Pre-commit checks passed!"
`;

// Pre-push hook
const prePushHook = `#!/bin/sh
# Pre-push hook for RecopyFast

echo "Running pre-push checks..."

# Build the project
echo "Building project..."
npm run build
if [ $? -ne 0 ]; then
  echo "❌ Build failed. Please fix the issues before pushing."
  exit 1
fi

# Run tests
echo "Running tests..."
npm run test
if [ $? -ne 0 ]; then
  echo "❌ Tests failed. Please fix the issues before pushing."
  exit 1
fi

echo "✅ Pre-push checks passed!"
`;

// Create hooks directory if it doesn't exist
if (!fs.existsSync(hooksDir)) {
  console.log('❌ .git/hooks directory not found. Make sure you are in a git repository.');
  process.exit(1);
}

try {
  // Write pre-commit hook
  const preCommitPath = path.join(hooksDir, 'pre-commit');
  fs.writeFileSync(preCommitPath, preCommitHook);
  fs.chmodSync(preCommitPath, '755');
  console.log('✅ Pre-commit hook installed');

  // Write pre-push hook
  const prePushPath = path.join(hooksDir, 'pre-push');
  fs.writeFileSync(prePushPath, prePushHook);
  fs.chmodSync(prePushPath, '755');
  console.log('✅ Pre-push hook installed');

  console.log('\n🎉 Git hooks have been successfully installed!');
  console.log('\nThe following hooks are now active:');
  console.log('• Pre-commit: Runs linting, type checking, and format checking');
  console.log('• Pre-push: Runs build and tests');
  console.log('\nTo bypass hooks temporarily, use:');
  console.log('• git commit --no-verify');
  console.log('• git push --no-verify');

} catch (error) {
  console.error('❌ Error installing hooks:', error.message);
  process.exit(1);
}