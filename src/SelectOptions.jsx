import { memo } from 'react';

const valueOf = item => typeof item === 'object' ? item.value : item;
const labelOf = item => typeof item === 'object' ? item.label : item;

// Telemetry must not rebuild unchanged native dropdown option lists.
export default memo(function SelectOptions({ items }) {
  return items.map(item => <option key={valueOf(item)} value={valueOf(item)}>{labelOf(item)}</option>);
}, (previous, next) => previous.items.length === next.items.length
  && previous.items.every((item, index) => valueOf(item) === valueOf(next.items[index])
    && labelOf(item) === labelOf(next.items[index])));
