/** Shared by CLI creation and the browser; no filesystem or runtime dependencies. */
export const TEMPLATE_PAGES = ['library', 'cli', 'api', 'format', 'ui', 'performance', 'architecture', 'data-model', 'use-case'] as const;
export type TemplatePage = typeof TEMPLATE_PAGES[number];

export const PAGE_DESCRIPTIONS: Record<TemplatePage, { label: string; purpose: string }> = {
  library: { label: 'Library', purpose: '公开编程接口、输入输出类型和调用示例' },
  cli: { label: 'CLI', purpose: '公开命令、参数、输出和错误反馈' },
  api: { label: 'API', purpose: '公开网络协议的请求、响应、错误与兼容规则' },
  format: { label: 'Format', purpose: '使用者编辑或读取的文件路径、语法、字段与校验' },
  ui: { label: 'UI', purpose: '布局、交互状态、键盘操作与可访问性要求' },
  performance: { label: 'Performance', purpose: '场景、测量内容、性能预算与负载前提' },
  architecture: { label: 'Architecture', purpose: '实体关系、模块职责、数据流和不变量' },
  'data-model': { label: 'Data Model', purpose: '内部实体、存储结构、约束、事务与数据生命周期' },
  'use-case': { label: 'Use Cases', purpose: '用户目标索引；具体路径通过 Use Case 创建' },
};
