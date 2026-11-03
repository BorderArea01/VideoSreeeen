import css from './styles.css?inline';
import { ThemeScope } from '../core/scope';
import { SignalScene } from './scene';

export const styles = [css];
export function mount(scope: ThemeScope) {
  const scene = new SignalScene(scope);
  scope.defer(() => scene.setActive(false));
  scene.setActive(true);
}
