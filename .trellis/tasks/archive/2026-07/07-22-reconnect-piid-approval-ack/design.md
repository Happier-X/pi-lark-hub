# 设计

- register 可选 piId 已有；Bridge 本地保留 piId，重连 open 时写入 register。
- 新增 Pi→Hub：`approval_result_ack { requestId, piId }`
- Hub deliverApprovalResult：send 后进入等待 ack，不立即 markDelivered；收到 ack 再 mark。
- 可选：简单内存 pending delivery 表（本任务最小：send 成功后仍先不 markDelivered，仅 ack 时 mark；失败 markFailedDelivery）。

最小方案：去掉 send 后立即 markDelivered；handlePiMessage 处理 approval_result_ack 时 markDelivered。重复 ack 幂等。
