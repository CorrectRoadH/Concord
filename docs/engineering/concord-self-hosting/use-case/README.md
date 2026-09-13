# 维护场景

## 增加功能契约

先创建或更新 Feature/Use Case owner，再在已有真实测试中选择最接近的验收声明添加关系；不要为了数字注册空测试。

## 调整 runner

runner argv 或 sourceFiles 变化会使旧 command evidence 不再代表当前定义。调整后先用 doctor/check 验证配置，再按需重新采集证据。

## 修复中断写入

读取遇到 recovery required 时停止其它 mutation，检查 journal 与文件内容，使用 `recover`；若出现 unknown edit，保留现场并由维护者裁决。

## 审阅交接

reviewer 使用 trace 与 review 输出定位 owner、测试和 Memory，再直接审阅正文与源码。命令收据是可复核输入，不替代测试设计判断。
