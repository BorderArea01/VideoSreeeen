import styles from './styles.css?inline';
import controls from './controls.css?inline';
import { ThemeScope } from '../core/scope';
import { GlitchScene } from './scene';

export const stylesheets = [styles, controls];
export { stylesheets as styles };
export function mount(scope: ThemeScope) {
  const scene = new GlitchScene(scope);
  scope.defer(() => scene.setActive(false));
  scene.setActive(true);
}
