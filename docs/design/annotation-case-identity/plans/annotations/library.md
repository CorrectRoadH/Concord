# Library

两个解析入口共用 `deriveTestReference`。`RepositoryHost.caseIdentity` 为 `concord.case-contracts/v1`；host 在执行副本中验证 native case 与声明的唯一对应。

源码身份使用 `concord.repository-source-identity/v3`，仅有 direct-contract binding。代码投影为 `concord.repository-source-projection/v2`，契约路径及内容另行签入 identity。
