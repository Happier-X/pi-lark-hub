# Error Handling

> Error handling for the Pi × WeChat iLink extension.

---

## Overview

Errors are surface either as:

1. **WeChat replies** to the inbound user (task submit/reply failures)
2. **Pi UI** `notify` / `setStatus` (connection, send failures)
3. **Thrown errors** that abort login when UI cannot collect required input

Prefer best-effort replies; never leave the TUI blocked on SDK stdin.

---

## Error Types

No custom error classes. Use `Error` with clear Chinese or bilingual messages for user-visible paths.

---

## Error Handling Patterns

| Situation | Behavior |
|-----------|----------|
| `sendUserMessage` throws (idle or drain) | Clear current WeChat flags; reply WeChat “指令提交失败：…”. On drain, continue next queue item if still idle. |
| WeChat `reply` / `stopTyping` throws | `status` / `notify` error; still clear current flags in `finally` so queue can drain. |
| Login needs pairing code, `!hasUI` | **Fail closed**: throw — do not call SDK stdin readline. |
| Login pairing cancelled / empty input | Throw “未输入配对码”; login catch clears QR chrome and notifies. |
| Login / connect failure | `clearQrChrome`, null bot, clear status, `notify` error. |
| Dangerous-command approval timeout | Treat as reject; block tool with timeout reason. |

---

## Validation & Error Matrix (login / queue)

| Input / state | Result |
|---------------|--------|
| TUI + pairing required | `ctx.ui.input` → trimmed code |
| TUI + empty/cancel pairing | throw → login failed notify |
| no UI + pairing required | throw “当前模式无 UI” |
| Busy / slot busy + WeChat text | enqueue + WeChat queued ack (not an error) |
| Drain submit failure | WeChat error reply; try next queued item |

---

## Common Mistakes

1. **Using Pi `followUp` for WeChat while busy** — abort dumps text into the editor. Use extension queue.
2. **Assuming `isIdle()` alone means safe to start a WeChat run** — between drain submit and `agent_start`, or between `agent_end` and `agent_settled`, flags may still own the reply slot. Check `currentRunFromWechat` / `currentWechatRequest` / `drainingQueue`.
3. **Relying on `@wechatbot` default verify-code prompt** — uses `process.stdin` and breaks TUI.
4. **Writing QR to stderr in TUI** — corrupts alternate screen; use `setWidget`.
