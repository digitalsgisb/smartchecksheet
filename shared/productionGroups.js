export const productionGroups = [
  { id: 'conversion-port-klang', label: 'Conversion · Port Klang', division: 'Conversion', site: 'Port Klang' },
  { id: 'conversion-sendayan', label: 'Conversion · Sendayan', division: 'Conversion', site: 'Sendayan' },
  { id: 'roll-making-port-klang', label: 'Roll Making · Port Klang', division: 'Roll Making', site: 'Port Klang' }
];
export const productionGroup = id => productionGroups.find(group => group.id === id);
