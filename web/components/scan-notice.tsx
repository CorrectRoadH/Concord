import { Link } from 'react-router-dom';
import type { WorkspaceProjectionSnapshot } from '../../src/model/index.ts';

export function scanFindings(snapshot: WorkspaceProjectionSnapshot, kind: 'tests' | 'sources') {
  const roots = (kind === 'tests' ? snapshot.project?.testRoots : snapshot.project?.sourceRoots) ?? [];
  return snapshot.findings.filter(finding => roots.some(root => finding.path === root || finding.path.startsWith(`${root}/`)));
}

export function ScanNotice({ snapshot, kind }: { snapshot: WorkspaceProjectionSnapshot; kind: 'tests' | 'sources' }) {
  const roots = (kind === 'tests' ? snapshot.project?.testRoots : snapshot.project?.sourceRoots) ?? [];
  const label = kind === 'tests' ? '通用测试' : '源码声明';
  if (roots.length === 0) return <p role="status">尚未配置{label}扫描目录。<Link to="/settings">前往项目设置</Link></p>;
  const findings = scanFindings(snapshot, kind);
  if (findings.length === 0) return null;
  return <div role="alert">{label}扫描存在问题，列表可能不完整。{findings.map((finding, index) => <p key={index}>{finding.code}：{finding.path} — {finding.message}</p>)}</div>;
}
