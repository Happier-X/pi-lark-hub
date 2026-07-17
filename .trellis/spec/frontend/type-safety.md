# 类型安全

> TypeScript `strict` + NodeNext；UI 侧类型来自 Pi peer 与共享 `protocol`。

---

## Overview

- `tsconfig.json`：`strict: true`，`module`/`moduleResolution`: `NodeNext`，`noEmit: true`
- 包类型：`"type": "module"`，源码 `import` 带 `.js` 扩展名（TS 发 ESM 约定）
- Pi API：`import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent"`（peerDependency）
- 协议：`src/protocol.ts` 导出消息联合类型与 `parseProtocolMessage` / `serializeMessage`

---

## 约定

| 规则 | 说明 |
|------|------|
| 协议消息 | 用 `ProtocolMessage` / `PiToHubMessage` / `HubToPiMessage` 判别，不手写松散 `any` JSON |
| 解析失败 | `parseProtocolMessage` 返回 `null`，调用方忽略或记 warning，不抛崩 TUI |
| UI level | `notify` 的 level 收窄为 `"info" \| "warning" \| "error"` |
| 决策类型 | 审批 `ApprovalDecision`：`"approve" \| "reject"` |
| 可选 peer | `@earendil-works/pi-coding-agent` optional peer；类型在 devDependency 中供 typecheck |

---

## 组织方式

- **共享契约** → `protocol.ts`（Hub 与 Bridge 共用）
- **Bridge 局部类型** → `lark-bridge/index.ts` 文件内 `type`（如 `QueuedTask`、`PendingApproval`）
- **Hub 领域类型** → 各 hub 模块导出（如 `HubConfig`、`ApprovalRecord`）

不要为 UI 单独建 `src/types/frontend.ts`，除非出现多文件 bridge 拆分。

---

## 验证

```bash
npm run typecheck
```

发布前：`prepublishOnly` 会跑 typecheck。

---

## 反模式

- `as any` 绕过 WS 消息字段
- 在 bridge 复制一份与 `protocol.ts` 不一致的手写接口
- 去掉 `.js` 后缀的相对导入（破坏 NodeNext）
