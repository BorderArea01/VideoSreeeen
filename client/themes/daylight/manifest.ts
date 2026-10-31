import type { ThemeDefinition } from '../core/types';
export default {
  id: 'glitch',
  name: '天光断层',
  order: 10,
  themeColor: '#1768ce',
  preview: {
    background:
      'linear-gradient(150deg,#1384df 0%,#a4e1ff 45%,#f7fbff 49%,#d9edff 62%,#318bd2 100%)',
    panel: '#f7fbffed',
    accent: '#0053e6',
    border: '#bbf5ff',
  },
  load: () => import('./index'),
} satisfies ThemeDefinition;
