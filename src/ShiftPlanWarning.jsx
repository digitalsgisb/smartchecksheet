import { useEffect, useState } from 'react';
import { TriangleAlert } from 'lucide-react';
import { api } from './api.js';

// Small, non-blocking note when the operator's shift choice differs from the executive's rotation plan.
// The operator's choice always wins; the plan may not apply on some days.
export default function ShiftPlanWarning({ line, shift, overtime, employeeIds = [] }) {
  const [plan, setPlan] = useState(null);
  useEffect(() => {
    let disposed = false;
    api(`/shift-plan?line=${encodeURIComponent(line || '')}`).then(result => { if (!disposed) setPlan(result); }).catch(() => { if (!disposed) setPlan(null); });
    return () => { disposed = true; };
  }, [line]);
  const rotation = plan?.rotation;
  if (!rotation || !['Day', 'Night'].includes(shift)) return null;
  const team = shift === 'Day' ? rotation.dayTeam : rotation.nightTeam, plannedOt = shift === 'Day' ? rotation.dayOt : rotation.nightOt;
  const notes = [];
  if (typeof plannedOt === 'boolean' && typeof overtime === 'boolean' && plannedOt !== overtime) notes.push(`${shift} shift is planned ${plannedOt ? 'WITH OT' : 'NO OT'}.`);
  const otherTeam = employeeIds.filter(id => ['A', 'B'].includes(plan.teams?.[id]) && plan.teams[id] !== team).length;
  if (otherTeam) notes.push(`${otherTeam} selected ${otherTeam === 1 ? 'person is' : 'people are'} not Team ${team}.`);
  if (!notes.length) return null;
  return <p className="shift-plan-warning" role="status"><TriangleAlert size={16} aria-hidden="true"/><span>Plan: {shift} = Team {team}. {notes.join(' ')} You can still continue.</span></p>;
}
