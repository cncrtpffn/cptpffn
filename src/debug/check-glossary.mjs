// Запуск: jsc -m src/debug/check-glossary.mjs  (из корня проекта)
// Проверяет glossary.js и ссылки href="#g-…" в manual.html.
import { GLOSSARY } from '../ui/glossary.js';
const out = (s) => (typeof print === 'function' ? print(s) : console.log(s));
const html = readFile('manual.html');
const ids = new Set();
let bad = 0;
for (const g of GLOSSARY) {
  if (ids.has(g.id)) { out(`дубль id: ${g.id}`); bad++; }
  ids.add(g.id);
  if (!g.ru?.term || !g.ru?.def) { out(`нет ru.term/def: ${g.id}`); bad++; }
}
for (const g of GLOSSARY) for (const s of g.see || []) if (!ids.has(s)) { out(`${g.id}: see → нет «${s}»`); bad++; }
const refs = [...html.matchAll(/href="#g-([a-z0-9-]+)"/g)].map((m) => m[1]);
for (const r of new Set(refs)) if (!ids.has(r)) { out(`manual.html → нет термина «${r}»`); bad++; }
const used = new Set(refs);
const unused = GLOSSARY.filter((g) => !used.has(g.id)).map((g) => g.id);
out(`терминов ${GLOSSARY.length}, ссылок ${refs.length} (${used.size} разных), без ссылок из текста: ${unused.length ? unused.join(', ') : '—'}`);
out(bad ? `ОШИБОК: ${bad}` : 'OK');
