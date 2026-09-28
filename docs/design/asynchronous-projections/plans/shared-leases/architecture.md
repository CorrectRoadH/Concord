# 共享租约架构

读取持有共享 publication lease，普通写入持有独占 lease。HawDB 维持容量与所有权保护。多文件 journal、前像校验和 runner 清理决定写入与证据权限。
