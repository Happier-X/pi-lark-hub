# 实施

1. protocol 增加 ApprovalResultAckMessage + 解码
2. Bridge register 带 piId；收到 approval_result 后发 ack
3. Hub deliverApprovalResult 不 markDelivered；处理 ack
4. 测试 + 规格
