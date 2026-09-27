// Recording-only Apple-PIM substitute. This file never loads accounts or network clients.
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
const root = process.env.APPLE_PIM_CONFIG_DIR;
const args = process.argv.slice(2);
const flag = name => args[args.indexOf(name) + 1];
const statePath = join(root, 'state.json');
const state = JSON.parse(readFileSync(statePath, 'utf8'));
appendFileSync(join(root, 'calls.jsonl'), JSON.stringify(args) + '\n');
const allowed = ['--id', '--list', '--limit', '--filter', '--calendar', '--from', '--to', '--title', '--start', '--end', '--notes', '--location', '--profile', '--format'];
if (flag('--profile') !== 'fixture' || flag('--format') !== 'json' || args.slice(1).filter((_, i) => i % 2 === 0).some(v => !allowed.includes(v))) throw new Error('Unscripted flags');
const reminder = () => { const item = state.items.find(i => i.id === flag('--id')); if (!item) throw new Error('Unknown fixture item'); return item; };
let result;
switch (args[0]) {
  case 'items':
    if (flag('--list') !== 'fixture-list') throw new Error('Foreign list');
    result = { reminders: state.items.filter(i => i.isCompleted === args.includes('--filter')).slice(0, Number(flag('--limit'))) }; break;
  case 'get':
    result = flag('--id') === 'fixture-event' ? { event: state.events[0] } : { reminder: reminder() }; break;
  case 'complete':
    if (flag('--id') === 'dinner' && state.failCompletion) { state.failCompletion = false; result = { success: false }; }
    else { reminder().isCompleted = true; result = { reminder: reminder() }; }
    break;
  case 'events':
    if (flag('--calendar') !== 'fixture-calendar') throw new Error('Foreign calendar');
    result = { events: state.events }; break;
  case 'create':
    if (flag('--calendar') !== 'fixture-calendar' || state.events.length) throw new Error('Duplicate or foreign create');
    state.events.push({ id: 'fixture-event', calendarId: 'fixture-calendar', title: flag('--title'), notes: flag('--notes'), startDate: flag('--start'), endDate: flag('--end') });
    result = { event: state.events[0] }; break;
  default: throw new Error('Unscripted operation');
}
writeFileSync(statePath, JSON.stringify(state));
console.log(JSON.stringify({ success: true, ...result }));
