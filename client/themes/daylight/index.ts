import styles from './styles.css?inline';
import controls from './controls.css?inline';
import panels from '../shared/panels.css?inline';
import { ThemeScope } from '../core/scope';
import { PanelLayout } from '../shared/panel-layout';
import { GlitchScene } from './scene';

export const stylesheets = [panels, styles, controls];
export { stylesheets as styles };
export function mount(scope: ThemeScope) {
  const layout = new PanelLayout(scope, { moveHeading: true });
  layout.setActive(true);
  const scene = new GlitchScene(scope);
  scope.defer(() => scene.setActive(false));
  scene.setActive(true);
}
