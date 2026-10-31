import type { ThemeDefinition } from '../core/types';
export default {
  id: 'classic',
  name: '暖夜',
  hint: '原版',
  order: 0,
  themeColor: '#101014',
  preview: {
    background: 'linear-gradient(125deg,#16151b,#47343b)',
    panel: '#14151bd9',
    accent: '#f2ad86',
    border: '#f2ad8644',
  },
  load: async () => ({ styles: [], mount() {} }),
} satisfies ThemeDefinition;
