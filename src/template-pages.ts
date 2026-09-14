/** Shared by CLI creation and the browser; no filesystem or runtime dependencies. */
export const TEMPLATE_PAGES = ['library', 'cli', 'architecture', 'lifecycle', 'use-case'] as const;
export type TemplatePage = typeof TEMPLATE_PAGES[number];

export const PAGE_DESCRIPTIONS: Record<TemplatePage, { label: string; purpose: string }> = {
  library: { label: 'Library', purpose: '公开编程接口、输入输出类型和调用示例' },
  cli: { label: 'CLI', purpose: '公开命令、参数、输出和错误反馈' },
  architecture: { label: 'Architecture', purpose: '实体关系、模块职责、数据流和不变量' },
  lifecycle: { label: 'Lifecycle', purpose: '资源创建、运行、复用、取消和清理' },
  'use-case': { label: 'Use Cases', purpose: '用户目标索引；具体路径通过 Use Case 创建' },
};
