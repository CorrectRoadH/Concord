# Cases

- Feature B metadata 损坏：Memory list/index/recall/add/edit 可用；为 Feature A 生成注释可用；全局 check 报 B 的错误。
- 目标 owner、其归属链或显式 regression 损坏：局部命令失败，不退回祖先 owner 掩盖错误。
- Memory 来源中有无法解析的记录：该来源的集合查询和短 ID 查询失败；另一 canonical path 的精确读取仍按必要依赖验证。
- 两个真实进程同时只读；第三个发布必须等待释放或明确 Busy，不能观察混合事务。
- 持锁进程 SIGKILL，无 journal：recover 回收准确 token，后续 list/annotate 成功；返回回收事实。
- 有活 reader 或未知 owner：recover 不夺锁；有 prepared journal：普通读取仍返回 RecoveryRequired。
- runner quarantined：Memory 可读，写入失败；recover 明确说明 runner 阻塞而不返回笼统 clean，不删除 runner 现场。
- shared owner 加入期间最后一个 reader 退出、writer 到达：不得把新 reader 加入 writer 的有效临界区。
