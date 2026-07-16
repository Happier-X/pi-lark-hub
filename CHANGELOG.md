# Changelog

## Unreleased

- Fix: busy-path WeChat tasks use an extension-owned queue instead of Pi `followUp`, so Escape/abort no longer dumps them into the TUI editor
- Fix: pairing code uses `ctx.ui.input` in TUI mode (no stdin readline fallback)
- Fix: QR login chrome uses Pi `setWidget` / status instead of multi-line stderr in TUI mode

## 0.1.0

- Initial release
- Official WeChat iLink login via QR code
- Inject WeChat text into the current Pi session
- Reply final Pi answer to WeChat on `agent_settled`
- Proactive completion notice for local Pi tasks
- Dangerous bash remote approval from WeChat
- Commands: `/wechat`, `/weixin`, `/wechat-status`, `/wechat-stop`, `/wechat-test`
