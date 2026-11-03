import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import postcss from 'postcss';

test('optional themes decorate the base layout without moving controls or owning application grids', async () => {
  for (const theme of ['daylight', 'signal']) {
    const entry = await readFile(`client/themes/${theme}/index.ts`, 'utf8');
    assert.doesNotMatch(entry, /PanelLayout|panels\.css/);
    const css = postcss.parse(await readFile(`client/themes/${theme}/styles.css`, 'utf8'));
    css.walkRules((rule) => {
      assert.doesNotMatch(rule.selector, /theme-(voice|members|utilities|mic)/);
      if (
        /#theme-(photo|scene|fragments)|#signal-field|signal-(copy|counter|panel-fragments|panel-inverse|panel-counter)|::(before|after)/.test(
          rule.selector,
        )
      )
        return;
      rule.walkDecls((declaration) => {
        assert.doesNotMatch(
          declaration.prop,
          /^(grid.*|order|flex.*|width|height|min-width|min-height|max-width|max-height|margin.*|padding.*|gap|row-gap|column-gap|aspect-ratio)$/,
          `${theme} ${rule.selector} must inherit application layout`,
        );
        assert.notEqual(
          declaration.prop,
          'display',
          `${theme} must not hide or reorder real controls`,
        );
      });
    });
  }
});
