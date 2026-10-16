import { memo, useCallback, useEffect, useId, useRef } from 'react';

const ROW_HEIGHT = 44;
const HOURS = Array.from({ length: 25 }, (_, index) => index);
const MINUTES = Array.from({ length: 60 }, (_, index) => index);
const ZERO_MINUTES = [0];

const WheelColumn = memo(function WheelColumn({ label, values, value, onChange }) {
  const wheel = useRef(null);
  const lastValue = useRef(null);
  const scrollTarget = useRef(null);
  const settleTimeout = useRef(null);
  const change = useRef(onChange);
  const id = useId();
  const selected = Math.max(0, values.indexOf(value));
  change.current = onChange;
  useEffect(() => {
    if (lastValue.current === value) return;
    lastValue.current = value;
    scrollTarget.current = null;
    wheel.current.scrollTo({ top: selected * ROW_HEIGHT, behavior: 'instant' });
  }, [value, selected, values.length]);
  useEffect(() => () => clearTimeout(settleTimeout.current), []);
  function choose(index) {
    clearTimeout(settleTimeout.current);
    const next = Math.min(values.length - 1, Math.max(0, index));
    scrollTarget.current = next * ROW_HEIGHT;
    lastValue.current = values[next];
    change.current(values[next]);
    wheel.current.scrollTo({ top: next * ROW_HEIGHT, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  }
  function settle() {
    const top = wheel.current.scrollTop;
    if (scrollTarget.current !== null && Math.abs(top - scrollTarget.current) > 1) return;
    scrollTarget.current = null;
    const index = Math.min(values.length - 1, Math.max(0, Math.round(top / ROW_HEIGHT)));
    if (lastValue.current !== values[index]) {
      lastValue.current = values[index];
      change.current(values[index]);
    }
  }
  function keyDown(event) {
    const movement = { ArrowUp: -1, ArrowDown: 1, PageUp: -5, PageDown: 5 };
    if (event.key in movement || event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      choose(event.key === 'Home' ? 0 : event.key === 'End' ? values.length - 1 : selected + movement[event.key]);
    }
  }
  return <div className="duration-wheel-column"><span className="duration-wheel-unit">{label}</span><div ref={wheel} className="duration-wheel-scroll" role="listbox" aria-label={label} tabIndex={0} aria-activedescendant={id + '-' + selected} onKeyDown={keyDown} onPointerDown={() => { scrollTarget.current = null; }} onWheel={() => { scrollTarget.current = null; }} onScroll={() => {
    clearTimeout(settleTimeout.current);
    settleTimeout.current = setTimeout(settle, 140);
  }}>{values.map((item, index) => <button type="button" role="option" aria-selected={index === selected} tabIndex={-1} id={id + '-' + index} key={item} className="duration-wheel-option" onClick={() => choose(index)}>{String(item).padStart(2, '0')}</button>)}</div></div>;
});

export default memo(function DurationWheel({ minutes, onChange }) {
  const total = Math.min(1440, Math.max(1, Math.round(Number(minutes) || 1)));
  const hours = Math.floor(total / 60);
  const remaining = total % 60;
  const setHours = useCallback(next => onChange(Math.min(1440, Math.max(1, next * 60 + remaining))), [onChange, remaining]);
  const setMinutes = useCallback(next => onChange(Math.max(1, hours * 60 + next)), [onChange, hours]);
  return <section className="duration-picker" aria-label="Set downtime duration"><h3>SET DOWNTIME</h3><p>Scroll to set hours and minutes.</p><div className="duration-wheel-frame"><div className="duration-wheel-selection" aria-hidden="true"/><WheelColumn label="Hours" values={HOURS} value={hours} onChange={setHours}/><span className="duration-wheel-colon" aria-hidden="true">:</span><WheelColumn label="Minutes" values={hours === 24 ? ZERO_MINUTES : MINUTES} value={remaining} onChange={setMinutes}/></div><div className="duration-picked-value">{hours} hr {String(remaining).padStart(2, '0')} min <span>· {total} minutes total</span></div></section>;
});
