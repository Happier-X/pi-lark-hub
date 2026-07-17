# Contributing

## Local development

```bash
npm install
pi install .
```

Edit sources under `src/`, then reload Pi:

```text
/reload
```

给他人安装（不发布 npm）：

```bash
pi install https://github.com/Happier-X/pi-lark-hub
```

## Checks

```bash
npm run typecheck
npm test
```

## Release checklist

以 **GitHub 标签 / 分支** 为分发来源（`pi install https://github.com/Happier-X/pi-lark-hub[@tag]`）：

1. Bump version in `package.json`（及代码里若有版本常量）
2. Update `CHANGELOG.md`
3. Commit
4. Push 到 GitHub，并打 tag（可选但推荐）  
   ```bash
   git tag v0.1.0
   git push origin main --tags
   ```
5. 他人更新：`pi update https://github.com/Happier-X/pi-lark-hub`  
   或钉死 tag：`pi install https://github.com/Happier-X/pi-lark-hub@v0.1.0`
