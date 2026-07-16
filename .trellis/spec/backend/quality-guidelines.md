# Quality Guidelines

> Code quality standards for this Pi extension project.

---

## Overview

This package is a **Pi coding-agent extension** bridging WeChat iLink. Quality rules focus on not corrupting the Pi TUI, not leaking remote control into the local editor, and keeping typecheck green.

---

## Forbidden Patterns

| Pattern | Why |
|---------|-----|
| `pi.sendUserMessage(text, { deliverAs: "followUp" })` (or `"steer"`) for **WeChat / remote** tasks | Pi interactive mode restores steering/follow-up queues into the **TUI editor** on Escape/abort (`restoreQueuedMessagesToEditor`). Remote text must not enter those queues. |
| `process.stdin` / Node `readline` prompts while Pi TUI is active | TUI uses raw mode; stdin prompts inject prompt text into the editor or corrupt the frame. Use `ctx.ui.input` / `select` / `confirm` when `ctx.hasUI`. |
| Multi-line `process.stderr.write` / `console.log` for QR art or banners in TUI mode | Alternate-screen TUI gets dirty; text can appear to “sit in” the input area. Use `ctx.ui.setWidget` / `notify` / `setStatus`. |
| Overwriting `currentWechatRequest` while a WeChat reply slot is already owned | Races between `agent_end`→`agent_settled` and new inbound messages lose or cross replies. Treat slot-busy as busy and enqueue. |

---

## Required Patterns

| Pattern | Rule |
|---------|------|
| Busy-path remote tasks | Extension-owned FIFO (`wechatQueue`); drain **one** item on `agent_settled` **after** clearing current WeChat flags; submit with `pi.sendUserMessage(text)` **without** `deliverAs`. |
| Login pairing code | Implement `@wechatbot` `onVerifyCode` via `ctx.ui.input` when `hasUI`; **fail closed** (throw) when no UI — never rely on SDK stdin default. |
| QR / login chrome | TUI: `setWidget` + status; clear widget on success, failure, `/wechat-stop`, `session_shutdown`. Headless: single-line URL on stderr only. |
| Slot occupancy | Ingress treats `currentRunFromWechat \|\| currentWechatRequest \|\| drainingQueue \|\| !isIdle()` as busy → enqueue. |
| Typecheck | `npm run typecheck` must pass before claiming done. |

---

## Testing Requirements

- Minimum: `npm run typecheck`.
- Prefer manual TUI smoke for queue/abort/QR/pairing paths until automated tests exist.
- Future unit tests should cover: enqueue when slot busy; drain order; no `deliverAs` on WeChat paths.

---

## Code Review Checklist

- [ ] No remote path uses Pi followUp/steer queues
- [ ] No raw stdin/readline under TUI
- [ ] No multi-line stderr UI chrome under TUI
- [ ] Queue cleared on stop/shutdown; QR widget cleared
- [ ] `agent_settled` reply-then-drain ordering preserved
- [ ] Typecheck clean
