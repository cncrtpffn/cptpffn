import { ARCHIPELAGO } from './archipelago.js';
import { DEMO } from './demo.js';

// Карты по полю высот, выбираются параметром ?map=<id> (игра и стенд src/debug/map-viewer.html).
// Без параметра — демо.
export const MAPS = { demo: DEMO, archipelago: ARCHIPELAGO };
