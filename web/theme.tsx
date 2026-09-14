import { Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from './components/ui/button';

type Theme = 'light' | 'dark';
const storageKey = 'concord-theme';
const systemTheme = (): Theme => window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';

function savedTheme(): Theme | null {
  const value = window.localStorage.getItem(storageKey);
  return value === 'light' || value === 'dark' ? value : null;
}

function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  document.documentElement.dataset.theme = theme;
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#11191b' : '#f7f5ef');
}

export function initializeTheme(): Theme {
  const theme = savedTheme() ?? systemTheme();
  applyTheme(theme);
  return theme;
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() => initializeTheme());
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const followSystem = () => {
      if (savedTheme() === null) {
        const next = systemTheme();
        setTheme(next);
        applyTheme(next);
      }
    };
    media.addEventListener('change', followSystem);
    return () => media.removeEventListener('change', followSystem);
  }, []);

  const next = theme === 'light' ? 'dark' : 'light';
  const label = `切换至${next === 'dark' ? '深色' : '浅色'}主题`;
  return <Button type="button" variant="outline" size="icon" className="theme-toggle" aria-label={label} title={label} onClick={() => {
    window.localStorage.setItem(storageKey, next);
    applyTheme(next);
    setTheme(next);
  }}>{theme === 'light' ? <Moon /> : <Sun />}</Button>;
}
