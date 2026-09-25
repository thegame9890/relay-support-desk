import { readFile } from 'node:fs/promises';
import { routeMessage } from '../lib/router.mjs';

const cases = JSON.parse(await readFile(new URL('../eval/cases.json', import.meta.url), 'utf8'));
const rows = cases.map(item => {
  const actual = routeMessage(item.question);
  return { question: item.question, expectedRoute: item.route, actualRoute: actual.route, expectedSource: item.source, actualSource: actual.sources[0]?.id || null, confidence: actual.confidence, pass: item.route === actual.route && (!item.source || item.source === actual.sources[0]?.id) };
});
const passed = rows.filter(row => row.pass).length;
console.log(JSON.stringify({ total: rows.length, passed, accuracy: Number((passed / rows.length).toFixed(3)), failures: rows.filter(row => !row.pass) }, null, 2));
if (passed !== rows.length) process.exitCode = 1;
