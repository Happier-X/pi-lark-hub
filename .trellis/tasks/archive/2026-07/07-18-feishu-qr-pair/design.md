# 设计：配对二维码辅助展示

## 流程

```text
pair_challenge { code, expiresAt, ttlMs }
  → bridge 组装 payload = `配对 ${code}`
  → writeQrPng(payload, ~/.pi/lark-hub/pair-qr.png)
  → notify：短码文案 + 图片路径（+ 自动引导标题若适用）
  → tryOpenPath(png)  // win: start, mac: open, linux: xdg-open
  → 任意失败：仅短码文案
```

Hub / 协议 / 绑定逻辑**不改**。

## 模块

| 文件 | 职责 |
|------|------|
| `src/lark-bridge/pair-qr.ts`（新） | `defaultPairQrPath`、`writePairQrPng`、`openPathBestEffort` |
| `src/lark-bridge/pair-qr.test.ts` | mock 写文件/打开；载荷与路径 |
| `src/lark-bridge/index.ts` | `pair_challenge` 分支调用上述 API |
| `package.json` | `dependencies.qrcode`（+ 必要时 `@types` 或内置 types） |

## 依赖

- `qrcode`：`toFile(path, text, options)` 写 PNG。
- 放 **dependencies**（与 tsx 一样，GitHub install 生产依赖可用）。

## 打开图片

```ts
// Windows: cmd /c start "" path
// Darwin: open path
// 其它: xdg-open path
// detached + ignore 错误
```

## 安全

- 载荷仅短口令字符串，不含 openId / token。
- 路径固定在用户 home 下 lark-hub 目录，覆盖写。

## 测试

- 单元：mock `qrcode.toFile` / `spawn`；断言 payload 与默认路径。
- 失败路径：toFile throw → 返回 error，bridge 仍 notify 短码。
