import { useId } from 'react';
import { Check } from 'lucide-react';
import { shiftWorkingHours } from './shiftOvertime.js';
import './overtime-choice.css';

export default function OvertimeChoice({ shift, value, onChange }) {
  const name = useId();
  return <fieldset className="overtime-choice"><legend>OVERTIME <span>Choose one</span></legend>
    <div className="overtime-options">{[false, true].map(ot => <label key={String(ot)} className={ot ? 'overtime-yes' : 'overtime-no'}>
      <input type="radio" name={name} required value={String(ot)} checked={value === ot} onChange={() => onChange(ot)} onInvalid={event => event.target.closest('fieldset').scrollIntoView({ block: 'center', behavior: 'smooth' })}/>
      <span className="overtime-card"><span className="overtime-card-title"><strong>{ot ? 'WITH OT' : 'NO OT'}</strong>{value === ot && <Check size={25} aria-hidden="true"/>}</span><span className="overtime-hours">{shiftWorkingHours(shift, ot)}</span></span>
    </label>)}</div>
    {typeof value !== 'boolean' && <p className="overtime-required">Select the working hours for this shift.</p>}
  </fieldset>;
}
