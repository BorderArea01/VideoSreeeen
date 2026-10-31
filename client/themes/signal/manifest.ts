import type { ThemeDefinition } from '../core/types';
export default {
  id: 'signal',
  name: '紫电噪讯',
  order: 20,
  themeColor: '#18111f',
  preview: {
    background: 'linear-gradient(125deg,#18111f,#30203b)',
    panel: '#211729',
    accent: '#c9ff4b',
    border: '#9164ad',
  },
  load: () => import('./index'),
} satisfies ThemeDefinition;
