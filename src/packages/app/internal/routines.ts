import type { Routine } from '../../domain';
import { PLACEMENT } from './placement';

const BODY_ROUTINES: Routine[] = ['sit-drop', 'bridge-drop'];

const option = (routine: Routine) => `<option value="${routine}">${PLACEMENT[routine].label}</option>`;

/** The routine picker: the rig, with the frozen body routines behind a "legacy" toggle. */
export const routinePickerHtml = (): string => `
  <label>Routine <select name="routine">${option('rig-drop')}</select></label>
  <label class="check-row"><input type="checkbox" name="legacy"> Show legacy body routines</label>`;

/**
 * Fills the picker from the toggle. Turning the toggle off while a body routine is selected goes back to the rig.
 * `onChange` runs after the picker changes for any reason except the user picking an option, which has its own event.
 */
export function wireRoutinePicker(select: HTMLSelectElement, legacy: HTMLInputElement, onChange: () => void): void {
  legacy.addEventListener('change', () => {
    const keep = legacy.checked ? select.value : 'rig-drop';
    const routines: Routine[] = legacy.checked ? ['rig-drop', ...BODY_ROUTINES] : ['rig-drop'];
    select.innerHTML = routines.map(option).join('');
    select.value = keep;
    onChange();
  });
}
