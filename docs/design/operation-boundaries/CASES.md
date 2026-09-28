# Cases

- Feature B metadata 损坏：Memory list/index/recall/add/edit 可用；为 Feature A 生成注释可用；全局 check 报 B 的错误。
- 目标 owner、其归属链或显式 regression 损坏：局部命令失败，不退回祖先 owner 掩盖错误。
- Memory 来源中有无法解析的记录：该来源的集合查询和短 ID 查询失败；另一 canonical path 的精确读取仍按必要依赖验证。
- 两个真实进程同时只读；第三个发布不等待读者，发生来源漂移的当前读取必须失败，不能成功返回混合事务。
- 持锁进程 SIGKILL，无 journal：recover 回收准确 token，后续 list/annotate 成功；返回回收事实。
- 有活独占 owner 或未知 owner：recover 不夺锁；有 prepared journal：普通读取仍返回 RecoveryRequired。
- runner quarantined：Memory 可读，写入失败；recover 明确说明 runner 阻塞而不返回笼统 clean，不删除 runner 现场。
- 写者完成 A→B→A 后尚未释放独占 owner：读者必须通过发布代次发现变化。
