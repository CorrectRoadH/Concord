# 采用共享政策

## Decision

Selected: [shared-policy](plans/shared-policy/README.md)

## Rationale

共享政策将名称与布局判断收敛为单一事实，同时让现有资源 owner 保留发布职责。ID 的唯一查询与实际路径分开，归档也由来源和类型共同分类，满足跨入口一致目标。

## Rejected Options

逐入口放宽英文校验仍保留多份路径推导；新增入口或恢复路径可以再次出现相反规则，不能满足 G1。新增 archive Schema 不是识别 Memory 来源内历史材料的必要条件，因此不引入持久迁移。

## Residual Risks

物理移动仍会使原路径引用与证据失效，作者必须显式维护当前引用并重新取证。高级治理继续使用原有静态来源，配置驱动的跨来源写入不在此设计内；设计符合约束不代替运行验收。
