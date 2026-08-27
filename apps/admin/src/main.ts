// The Daily Roast — Admin boot script. Persistent chrome (src/core/shell.ts), the
// top-bar/command-palette (src/core/header.ts → src/core/cmdK.ts), and the
// router (src/router.ts, which lazy-loads one feature module per tab from
// src/features/) do the rest.
import { initShell } from './core/shell';
import { initOrdersCore } from './features/orders-core';
import { initHeader } from './core/header';
import { initRouter } from './router';

initShell();
initOrdersCore();
initHeader();
initRouter();
