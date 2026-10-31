import css from './styles.css?inline';
import panels from '../shared/panels.css?inline';
import { ThemeScope } from '../core/scope';
import { PanelLayout } from '../shared/panel-layout';
import { SignalScene } from './scene';

export const styles = [panels, css];
export function mount(scope: ThemeScope) {
  const layout = new PanelLayout(scope, { moveHeading: false });
  layout.setActive(true);
  const scene = new SignalScene(scope);
  scope.defer(() => scene.setActive(false));
  scene.setActive(true);
}
