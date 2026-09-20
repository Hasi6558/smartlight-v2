# Codebase Map

## AI navigation rules

1. Read this file first. 
2. Whenever an update or code has been changed, update `changelog.md` with the date, time, change, and affected file/line references; create it if missing.
3. Identify the feature affected by the request.
4. Start with the minimum relevant files listed below.
5. Do not inspect unrelated files unless an actual dependency requires it.
6. For appearance-only changes, prioritize the HTML partial and `css/styles.css`; avoid API, database, and backend files.
7. Expand context only when the loaded files show that more layers are required.
8. Update this map when features or architecture change.
9. Very important: Update `changelog.md` with the date, time, change, and affected file/line references; create it if missing.

## Architecture at a glance

- The repository currently contains a legacy vanilla browser application and a new React/TypeScript migration frontend.
- The legacy vanilla application is served directly by Express with no build step.
- The migration frontend lives in [frontend/](frontend/) and is built with Vite. It currently runs alongside the legacy application and does not replace it. It imports the legacy [css/styles.css](css/styles.css) design system so the React UI can preserve visual parity while features are migrated.
- [index.html](index.html) is the entry document. It loads [css/styles.css](css/styles.css), the SheetJS CDN script, five HTML partials, and then [js/app.js](js/app.js).
- HTML is split into [partials/home.html](partials/home.html), [partials/light.html](partials/light.html), [partials/warehouse.html](partials/warehouse.html), [partials/settings.html](partials/settings.html), and [partials/modals.html](partials/modals.html).
- [js/app.js](js/app.js) is the frontend bootstrapper. It initializes tabs, modals, API listeners, light control, picklists, inventory, and warehouse listeners, then loads persisted data.
- [js/state.js](js/state.js) contains shared DOM/helpers, API URL constants, icon rendering, and the mutable application `state` object.
- [js/api.js](js/api.js) is the shared browser API/storage layer. Feature modules call it rather than talking to SQLite directly.
- [server.js](server.js) serves static files, owns MQTT connectivity, initializes SQLite schema, and exposes all `/api/*` routes.
- [start-reactserver.bat](start-reactserver.bat) starts the existing Express/MQTT backend on port `9117` and the React/Vite development server on `http://localhost:9118`. Vite proxies React `/api` requests to the backend.
- [frontend/src/main.tsx](frontend/src/main.tsx) is the React migration entry point. [frontend/src/app/App.tsx](frontend/src/app/App.tsx) currently provides the migration shell and consumes the existing MQTT status API.
- [frontend/src/api/client.ts](frontend/src/api/client.ts) is the typed API boundary for the React frontend. It currently covers MQTT status, settings, MQTT connect/disconnect, tags, SKUs, and inventory reads.
- [frontend/src/features/settings/SettingsPage.tsx](frontend/src/features/settings/SettingsPage.tsx) is the first migrated feature. It manages broker settings, connection controls, AP status, task timeout, and optional sidebar visibility using the existing `/api/settings` and `/api/mqtt/*` routes.
- [frontend/src/features/light-control/LightControlPage.tsx](frontend/src/features/light-control/LightControlPage.tsx) is the second migrated feature. It manages tag CRUD, filtering, group commands, per-tag activation/test/stop commands, and cascade activation using the existing `/api/tags` and `/api/mqtt/publish` routes.
- [frontend/src/features/warehouse/WarehousePage.tsx](frontend/src/features/warehouse/WarehousePage.tsx) is the third migrated feature. It loads tags, SKUs, and inventory, renders the Area/Shelf/Item hierarchy, supports search and collapse, shows SKU and stock bindings, and exposes warehouse light test/stop commands.
- [frontend/src/features/inventory/InventoryPage.tsx](frontend/src/features/inventory/InventoryPage.tsx) is the fourth migrated feature. It provides SKU CRUD, tag binding, inventory adjustments, stock search, and transaction history using the existing inventory APIs.
- [frontend/src/features/picklists/PicklistsPage.tsx](frontend/src/features/picklists/PicklistsPage.tsx) is the fifth migrated feature. It supports picklist/putaway creation, SKU item selection, templates, list activation, completion/cancellation, MQTT light commands, and inventory commits.

## Entry points and runtime

- Browser entry: [index.html](index.html)
- JavaScript entry: [js/app.js](js/app.js)
- React migration entry: [frontend/index.html](frontend/index.html), developed with `npm run frontend:dev` and built with `npm run frontend:build`
- React development URL: `http://localhost:9118`
- Shared React modal and confirmation primitives are in [frontend/src/components/Modal.tsx](frontend/src/components/Modal.tsx); migrated dialogs should not use `window.confirm`.
- Shared warehouse/tag SVG icons are in [frontend/src/components/TagIcon.tsx](frontend/src/components/TagIcon.tsx).
- [frontend/src/features/warehouse/WarehousePage.tsx](frontend/src/features/warehouse/WarehousePage.tsx) follows the legacy warehouse card hierarchy with independent area/shelf expansion, configuration lock state, stock badges, SKU binding, tag removal, and MQTT area/tag actions.
- [frontend/src/features/light-control/LightControlPage.tsx](frontend/src/features/light-control/LightControlPage.tsx) follows the legacy Light Control layout with group controls, an animated expandable add/edit panel, filter/sort/batch toolbar, responsive multi-column strip cards, and Area/Shelf/Item icons.
- The Light Control add/edit panel preserves the legacy three two-column field rows, input action affordances, color chips, switch controls, spacing, and full-width submit action.
- [frontend/src/components/ScannerModal.tsx](frontend/src/components/ScannerModal.tsx) provides camera barcode/QR scanning with manual fallback for React fields.
- Settings includes legacy quick access, persisted sidebar visibility, and database-backed Area/Shelf/Item custom icon upload and clearing.
- [frontend/src/features/debug/DebugPage.tsx](frontend/src/features/debug/DebugPage.tsx) provides the legacy two-log Debug Console layout and server publish composer.
- Inventory and Home now use the legacy `sku-wrap`, `strip-toolbar`, table, launcher, list-card, and template-drawer structures; shared filter inputs use the legacy dark field treatment.
- Home create actions now open the legacy-style create-list modal, launcher buttons use distinct picklist/putaway icons, and saved templates expand with add-to-today, view, edit, and delete actions.
- Light Control batch actions include activate, test, stop, and delete, aligned to the right side of the legacy filter toolbar.
- Warehouse configuration persists drag/drop reassignment of item tags to shelves and shelf tags to areas while unlocked.
- Server entry: [server.js](server.js), normally started with `npm start` or [start-server.bat](start-server.bat)
- Server listens on port `9117` and serves the repository root.
- [\.vscode/launch.json](.vscode/launch.json) launches Chrome at `http://localhost:8080`; this does not match the server's default port and may need adjustment when debugging.

## Frontend areas

### Home, picklists, and putaway lists

#### Legacy vanilla JS

- UI: [partials/home.html](partials/home.html)
- Behaviour: [js/modules/picklists.js](js/modules/picklists.js)
- Shared dialogs: [partials/modals.html](partials/modals.html), [js/UI/modals.js](js/UI/modals.js)
- Tab/render integration: [js/UI/tabs.js](js/UI/tabs.js)
- Persistence/API calls: [js/api.js](js/api.js)
- Server routes: `/api/picklists`, `/api/picklist-templates`, `/api/running-numbers/next`, `/api/inventory/commit-list`
- Home creates PICKLIST (outbound/subtract) and PUTAWAY (inbound/add) lists, shows today's/history views, templates, activation/completion/timeout state, and Excel export.

#### React version

- UI and behaviour: [frontend/src/features/picklists/PicklistsPage.tsx](frontend/src/features/picklists/PicklistsPage.tsx)
- Shared modal primitives: [frontend/src/components/Modal.tsx](frontend/src/components/Modal.tsx)
- Uses the existing picklist, template, inventory, and MQTT APIs through [frontend/src/api/client.ts](frontend/src/api/client.ts).
- Provides modal-based Picklist/Putaway creation, distinct launcher icons, expandable template actions, list activation, completion/cancellation, MQTT light commands, and inventory commits.

### Light control and tag management

#### Legacy vanilla JS

- UI: [partials/light.html](partials/light.html)
- Behaviour, tag CRUD, MQTT command payloads, import/export: [js/modules/LightControl.js](js/modules/LightControl.js)
- Shared state/icons/escaping: [js/state.js](js/state.js)
- MQTT and tag persistence: [js/api.js](js/api.js)
- Server routes: `/api/mqtt/status`, `/api/mqtt/connect`, `/api/mqtt/disconnect`, `/api/mqtt/publish`, `/api/tags`
- Animation bridge: [js/UI/animation.js](js/UI/animation.js)
- Tag hierarchy is consumed by warehouse configuration and picklist activation.

#### React version

- UI and behaviour: [frontend/src/features/light-control/LightControlPage.tsx](frontend/src/features/light-control/LightControlPage.tsx)
- Uses typed tags, settings, MQTT, and persistence calls from [frontend/src/api/client.ts](frontend/src/api/client.ts).
- Mirrors the legacy expandable form, filters, responsive strip cards, tag icons, scanner actions, per-tag controls, and batch actions.

### Warehouse configuration and stock view

#### Legacy vanilla JS

- UI: the `tab-warehouse` and `tab-wh-stock` sections in [partials/warehouse.html](partials/warehouse.html)
- Behaviour and hierarchy/drag-and-drop: [js/modules/warehouse.js](js/modules/warehouse.js)
- Related tag/SKU picker dialogs: [partials/modals.html](partials/modals.html), [js/UI/modals.js](js/UI/modals.js)
- Shared rendering animation: [js/UI/animation.js](js/UI/animation.js)
- Persistence: [js/api.js](js/api.js), with tag/SKU data from `/api/tags` and `/api/skus`
- Warehouse stock is a read-only view combining tag hierarchy, SKU bindings, and inventory counts; it is distinct from inventory editing.

#### React version

- UI and behaviour: [frontend/src/features/warehouse/WarehousePage.tsx](frontend/src/features/warehouse/WarehousePage.tsx)
- Uses the existing tags, SKUs, inventory, MQTT, and persistence APIs through [frontend/src/api/client.ts](frontend/src/api/client.ts).
- Renders the legacy area/shelf/item card hierarchy with search, collapse, lock state, SKU binding, stock badges, light actions, and unlocked drag/drop tag reassignment.

### Warehouse database (SKU administration)

#### Legacy vanilla JS

- UI: the `tab-wh-db` section in [partials/warehouse.html](partials/warehouse.html)
- Behaviour/table filters, SKU CRUD, stock detail opening, and Excel import/export: [js/modules/inventory.js](js/modules/inventory.js)
- SKU form/detail/attach dialogs: [partials/modals.html](partials/modals.html), [js/UI/modals.js](js/UI/modals.js)
- Server routes: `/api/skus`, `/api/inventory`
- Product images are stored as data in SQLite, not in `assets`.

#### React version

- UI and behaviour: [frontend/src/features/inventory/InventoryPage.tsx](frontend/src/features/inventory/InventoryPage.tsx)
- Provides React SKU CRUD, tag binding, product image handling, stock detail views, and inventory API integration.
- SKU administration includes Excel template export/import, database lock state, date-range and tag-bind filters, column filters, select-all/batch deletion, compact product thumbnails, and a responsive table that fills the available vertical viewport.
- The SKU form supports text Tag Bind entry with datalist suggestions, SKU/Tag Bind scanning, clear-field actions, Clear Entry, product image choose/remove/preview, and View More detail modal actions.
- React-specific styling is in [frontend/src/app/app.css](frontend/src/app/app.css); API boundaries are in [frontend/src/api/client.ts](frontend/src/api/client.ts), including batch inventory adjustment support.

### Inventory and stock transactions

#### Legacy vanilla JS

- UI: `tab-wh-inventory` and `tab-wh-transactions` in [partials/warehouse.html](partials/warehouse.html)
- Behaviour, sorting, search, single/batch adjustment, and Excel export: [js/modules/inventory.js](js/modules/inventory.js)
- Stock adjustment dialog: [partials/modals.html](partials/modals.html), [js/UI/modals.js](js/UI/modals.js)
- Browser API calls: [js/api.js](js/api.js)
- Server routes: `/api/inventory`, `/api/inventory/adjust`, `/api/inventory/batch-adjust`, `/api/transactions`
- Adjustments update inventory and append audit rows with generated order/picklist numbers.

#### React version

- UI and behaviour: [frontend/src/features/inventory/InventoryPage.tsx](frontend/src/features/inventory/InventoryPage.tsx)
- Provides the React inventory and transaction tables, dark legacy-style search/filter toolbar, product images, quantity adjustments, and transaction history using the existing APIs.
- Central Search is rendered above the database filters, inventory/SKU images use compact thumbnails, and the SKU table expands to use the remaining vertical screen space with scrolling inside the table region.

### Settings, MQTT gateway, and debug console

#### Legacy vanilla JS

- Settings UI: [partials/settings.html](partials/settings.html)
- Debug console UI: the `tab-debug` section in [partials/warehouse.html](partials/warehouse.html)
- Frontend connection/settings/listener logic: [js/api.js](js/api.js), [js/UI/tabs.js](js/UI/tabs.js)
- Backend MQTT client, AP information, bounded publish/receive logs: [server.js](server.js)
- Server routes: `/api/settings` and all `/api/mqtt/*` routes
- Settings controls sidebar visibility, task timeout, broker host/port/WebSocket path/credentials/topic, and custom tag icons.

#### React version

- Settings UI: [frontend/src/features/settings/SettingsPage.tsx](frontend/src/features/settings/SettingsPage.tsx)
- Debug console UI: [frontend/src/features/debug/DebugPage.tsx](frontend/src/features/debug/DebugPage.tsx)
- Uses the typed settings and MQTT boundary in [frontend/src/api/client.ts](frontend/src/api/client.ts).
- Provides quick access, persisted sidebar visibility, broker controls, AP status, custom tag icons, and the legacy-style debug console layout.

## Shared UI and styling

#### Legacy vanilla JS

- Global layout, responsive sidebar/bottom navigation, forms, tables, panels, modals, state colors, and feature-specific selectors: [css/styles.css](css/styles.css).
- Tab switching and optional-page visibility: [js/UI/tabs.js](js/UI/tabs.js).
- Generic confirmation, scanner, SKU/tag picker, and list modals: [js/UI/modals.js](js/UI/modals.js).
- Small render transitions for tags and warehouse configuration: [js/UI/animation.js](js/UI/animation.js).
- Shared HTML modal markup is loaded once from [partials/modals.html](partials/modals.html).

#### React version

- React reuses [css/styles.css](css/styles.css) as the primary visual system and adds migration-specific rules in [frontend/src/app/app.css](frontend/src/app/app.css).
- Shared React modal and confirmation primitives: [frontend/src/components/Modal.tsx](frontend/src/components/Modal.tsx).
- Shared React scanner: [frontend/src/components/ScannerModal.tsx](frontend/src/components/ScannerModal.tsx).
- Shared React tag icons and custom icon rendering: [frontend/src/components/TagIcon.tsx](frontend/src/components/TagIcon.tsx).
- [assets/](assets/) contains example/tag imagery (`areatag*`, `itemtag*`, `shelftag*`); it is static media and not the database.

## Backend and storage

- [server.js](server.js) creates/opens [warehouse.db](warehouse.db) and creates these tables: `tags`, `skus`, `settings`, `inventory`, `stock_transactions`, `running_numbers`, `picklists`, and `picklist_templates`.
- `tags` stores tag definitions and parent hierarchy; `skus` stores SKU metadata, tag binding, and product image data.
- `inventory` stores current quantities; `stock_transactions` is the audit history.
- `running_numbers` supplies order/picklist/GRN sequences. Picklist records store item arrays as JSON in `picklists.itemsJson`; templates do the same in `picklist_templates.itemsJson`.
- `settings` stores broker configuration, UI visibility, timeout, and icon data as key/value strings.
- [warehouse.db](warehouse.db) is live application data. Do not modify schema or data manually unless the task explicitly concerns migration/storage.

## Important cross-file dependencies

- `state.js` is imported by nearly every frontend module; changing state keys or API constants can affect all features.
- `api.js` imports state and dynamically imports renderers after data loads. Changes to response shapes must be coordinated with the corresponding renderer.
- LightControl publishes MQTT commands used by warehouse/picklist flows; picklists imports its cascade activation helper and API MQTT publisher.
- Warehouse imports LightControl publish helpers and inventory SKU detail UI; circular UI relationships are intentional.
- `animation.js` imports feature renderers, so avoid introducing initialization work that assumes partials are absent.
- Partial element IDs are the frontend contract. Renaming an ID requires updating its module listener and renderer.
- [partials/warehouse.html](partials/warehouse.html) contains multiple tabs (warehouse config, stock, inventory, transactions, SKU database, debug), not only warehouse configuration.
- On Windows, [js/app.js](js/app.js) imports `./modules/Lightcontrol.js`, while the actual file is [js/modules/LightControl.js](js/modules/LightControl.js). Preserve or normalize this casing if making the project portable to a case-sensitive filesystem.

## When modifying X, read these files

### Appearance-only changes

- Read: the affected partial and [css/styles.css](css/styles.css).
- Usually do not read: [js/api.js](js/api.js), [server.js](server.js), or [warehouse.db](warehouse.db).
- Also read [index.html](index.html) only if the change affects global shell/navigation or external styles/scripts.

### Light/tag behaviour

- Read: [partials/light.html](partials/light.html), [js/modules/LightControl.js](js/modules/LightControl.js), [js/state.js](js/state.js).
- Read [js/api.js](js/api.js) for persistence or MQTT calls.
- Read [server.js](server.js) only for `/api/tags` or `/api/mqtt/*` changes.

### Warehouse hierarchy or stock view

- Read: [partials/warehouse.html](partials/warehouse.html), [js/modules/warehouse.js](js/modules/warehouse.js).
- Read [js/UI/modals.js](js/UI/modals.js) for attach/picker behaviour and [js/state.js](js/state.js) for shared data.
- Read [js/api.js](js/api.js) and [server.js](server.js) only when persistence or inventory API behaviour changes.

### SKU database

- Read: [partials/warehouse.html](partials/warehouse.html) (SKU database section), [partials/modals.html](partials/modals.html), [js/modules/inventory.js](js/modules/inventory.js).
- Read [js/api.js](js/api.js) and [server.js](server.js) for SKU persistence or inventory joins.

### Inventory adjustments or transaction history

- Read: [partials/warehouse.html](partials/warehouse.html) (inventory/transactions sections), [partials/modals.html](partials/modals.html), [js/modules/inventory.js](js/modules/inventory.js).
- Read [js/api.js](js/api.js) and the inventory/transaction routes in [server.js](server.js).
- Include [js/modules/picklists.js](js/modules/picklists.js) when list commits or shared running numbers are involved.

### Picklists, putaway lists, or templates

- Read: [partials/home.html](partials/home.html), [partials/modals.html](partials/modals.html), [js/modules/picklists.js](js/modules/picklists.js).
- Read [js/api.js](js/api.js) for persistence and [js/modules/inventory.js](js/modules/inventory.js) for stock effects.
- Read [js/modules/LightControl.js](js/modules/LightControl.js) when activation changes lights.
- Read the matching routes in [server.js](server.js) for numbering, persistence, or commit changes.

### Settings, connection, or debug console

- Read: [partials/settings.html](partials/settings.html), the debug section of [partials/warehouse.html](partials/warehouse.html), [js/api.js](js/api.js), and [js/UI/tabs.js](js/UI/tabs.js).
- Read [server.js](server.js) for MQTT lifecycle, settings persistence, AP messages, or debug log changes.
- Read [css/styles.css](css/styles.css) for layout/appearance only.

### Modal, scanner, or shared navigation behaviour

- Read: [partials/modals.html](partials/modals.html) and [js/UI/modals.js](js/UI/modals.js) for dialogs/scanner/pickers.
- Read [js/UI/tabs.js](js/UI/tabs.js) for tab/subpage routing.
- Read [js/app.js](js/app.js) only when initialization order or listener registration changes.

## Installed dependencies

Do not inspect `node_modules` for application logic. The declared installed runtime dependencies in [package.json](package.json) are:

- `express` `^5.2.1` — static server and REST API
- `mqtt` `^5.15.2` — server-side MQTT broker client
- `sqlite3` `^6.0.1` — SQLite database access

The browser also loads SheetJS `xlsx@0.18.5` from jsDelivr in [index.html](index.html), plus Google Fonts (`Inter` and `JetBrains Mono`). Check `package.json` and [index.html](index.html) before adding a dependency.

## Files usually not needed for feature work

- [js/scripts.js](js/scripts.js) contains older/duplicate frontend logic and is not imported by [index.html](index.html) or [js/app.js](js/app.js). Do not modify it for current behaviour unless the task explicitly targets that legacy implementation.
- [js/modules/readmes/lightcontrol-readmes.js](js/modules/readmes/lightcontrol-readmes.js) is auxiliary light-control reference content and is not part of the current bootstrap import graph.
- [package-lock.json](package-lock.json) is dependency resolution metadata; change it through npm when dependencies change.
- [assets/](assets/) and [warehouse.db](warehouse.db) are data/media, not source modules.
- [start-server.bat](start-server.bat) checks for Node.js, installs dependencies if `node_modules` is absent, optionally starts Tailscale Serve, then runs `server.js`. This is only run by the user to start the service and is generally not needed for feature work
- [changelog.md](changelog.md) is only for keeping record of features added, modified or removed.
- [frontend/node_modules/](frontend/node_modules/) and [frontend/dist/](frontend/dist/) are generated frontend artifacts and should not be edited manually.
