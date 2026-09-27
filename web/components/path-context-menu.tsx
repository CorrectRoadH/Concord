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
  return <ContextMenu.Root><ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
    <ContextMenu.Portal><ContextMenu.Content aria-label="路径操作" className="z-50 min-w-44 rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
      <ContextMenu.Item className="cursor-default rounded-sm px-3 py-2 text-sm outline-none data-[highlighted]:bg-accent" onSelect={() => copy(path)}>复制相对路径</ContextMenu.Item>
      <ContextMenu.Item className="cursor-default rounded-sm px-3 py-2 text-sm outline-none data-[highlighted]:bg-accent" onSelect={() => copy(absolute)}>复制绝对路径</ContextMenu.Item>
    </ContextMenu.Content></ContextMenu.Portal>
  </ContextMenu.Root>;
}
