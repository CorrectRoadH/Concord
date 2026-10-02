import { ContextMenu } from 'radix-ui';
import type { ReactElement } from 'react';
import { useWorkspace } from '../workspace';
import { copyText } from '../lib/clipboard';

/** Paths come from the server inventory, never from the browser's current URL. */
export function PathContextMenu({ path, children }: { path: string; children: ReactElement }) {
  const { snapshot, notify } = useWorkspace();
  const absolute = `${snapshot.root.replace(/[\\/]$/u, '')}/${path}`;
  const copy = (value: string) => {
    void copyText(value).then(() => notify('路径已复制。', 'success'), () => notify('无法复制路径，请检查浏览器剪贴板权限。', 'error'));
  };
  return <ContextMenu.Root><ContextMenu.Trigger asChild onKeyDown={event => {
    if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
    // 部分浏览器不为键盘菜单键派发 contextmenu；复用同一触发入口，避免改变文件选择。
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    event.currentTarget.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: bounds.left, clientY: bounds.bottom }));
  }}>{children}</ContextMenu.Trigger>
    <ContextMenu.Portal><ContextMenu.Content aria-label="路径操作" className="z-50 min-w-44 rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
      <ContextMenu.Item className="cursor-default rounded-sm px-3 py-2 text-sm outline-none data-[highlighted]:bg-accent" onSelect={() => copy(path)}>复制相对路径</ContextMenu.Item>
      <ContextMenu.Item className="cursor-default rounded-sm px-3 py-2 text-sm outline-none data-[highlighted]:bg-accent" onSelect={() => copy(absolute)}>复制绝对路径</ContextMenu.Item>
    </ContextMenu.Content></ContextMenu.Portal>
  </ContextMenu.Root>;
}
