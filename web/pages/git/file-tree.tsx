import * as stylex from '@stylexjs/stylex';
import { ChevronRight, FileDiff, Folder } from 'lucide-react';
import { useState } from 'react';
import { SidebarItem } from '../../components/content-sidebar';
import type { GitEntry } from '../../../src/git-view';
import type { CaseLink, TreeNode } from './model';

const styles = stylex.create({
  list: { margin: 0, padding: 0, listStyleType: 'none' },
  nested: { marginLeft: 10, paddingLeft: 7, borderLeftWidth: 1, borderLeftStyle: 'solid', borderLeftColor: 'var(--border)' },
  icon: { width: 14, height: 14, flexShrink: 0 },
  expanded: { transform: 'rotate(90deg)' },
  name: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  metadata: { flexShrink: 0, fontSize: 10, color: 'var(--muted-foreground)' },
  cases: { color: 'var(--muted-foreground)' },
});

interface TreeProps {
  node: TreeNode; selected?: string; cases: readonly CaseLink[];
  select(entry: GitEntry, line?: number): void;
}

function Directory({ node, selected, cases, select }: TreeProps) {
  const [open, setOpen] = useState(true);
  return <>
    <button type="button" className="document-navigation__folder" aria-expanded={open} aria-label={node.path + ' 目录'} onClick={() => setOpen(value => !value)}>
      <ChevronRight {...stylex.props(styles.icon, open && styles.expanded)} /><Folder {...stylex.props(styles.icon)} /><span {...stylex.props(styles.name)}>{node.name}</span>
    </button>
    {open && <div {...stylex.props(styles.nested)}><FileTree node={node} selected={selected} cases={cases} select={select} /></div>}
  </>;
}

export function FileTree({ node, selected, cases, select }: TreeProps) {
  const nodes = [...node.children.values()].sort((a, b) => Number(!a.children.size) - Number(!b.children.size) || a.name.localeCompare(b.name));
  return <ul {...stylex.props(styles.list)}>{nodes.map(child => <li key={child.path}>
    {child.entry && <>
      <SidebarItem item={{ id: child.path, title: child.name, ariaLabel: child.path, active: selected === child.path,
        icon: <FileDiff {...stylex.props(styles.icon)} />,
        suffix: <code {...stylex.props(styles.metadata)}>{child.entry.conflicted ? '冲突' : child.entry.untracked ? 'A' : (child.entry.index + child.entry.worktree).trim()}</code>,
        onSelect: () => select(child.entry!),
      }} tooltip={child.entry.previousPath ? child.path + '（从 ' + child.entry.previousPath + '）' : child.path} onNavigate={() => undefined} />
      {cases.some(item => item.file === child.path) && <ul {...stylex.props(styles.list, styles.nested, styles.cases)} aria-label={child.path + ' 新增测试'}>
        {cases.filter(item => item.file === child.path).map(item => <li key={item.id}>
          <SidebarItem item={{ id: item.id, title: item.name, suffix: <small {...stylex.props(styles.metadata)}>+ L{item.line}</small>, onSelect: () => select(child.entry!, item.line) }} onNavigate={() => undefined} />
        </li>)}
      </ul>}
    </>}
    {child.children.size > 0 && <Directory node={child} selected={selected} cases={cases} select={select} />}
  </li>)}</ul>;
}
