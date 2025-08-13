# Full Reset Command

Reset development environment completely:

```bash
rm -rf node_modules package-lock.json
rm -rf server/node_modules server/package-lock.json
npm run setup
```

Use this when encountering dependency issues or when starting fresh.