# Changelog

## 2026-09-08 18:28:50 +08:00 — React SKU database layout and responsive table sizing

- Moved Central Search above the SKU date-range and tag-bind filters.
- Reduced SKU/product image thumbnails to compact 28px table cells.
- Matched the legacy compact table row sizing and made the SKU table consume the remaining vertical viewport space with internal scrolling.
- Kept the table responsive while allowing the database panel to expand instead of using an arbitrary fixed maximum height.

## 2026-09-08 18:27:14 +08:00 — React inventory and SKU database parity

- Added React SKU database Excel template export and Excel import.
- Added SKU database lock/unlock state, select-all, batch delete, date-range filtering, tag-bind filtering, and column filters.
- Added SKU and Tag Bind scanner actions, text-based Tag Bind entry, clear-field actions, and Clear Entry.
- Added product image selection, preview, removal, and image display in SKU/inventory tables.
- Added View More SKU detail modal with product image and extended item information.
- Added React batch-adjust API client support and included SheetJS in the React entry page.

## 2026-09-08 18:14:02 +08:00 — Warehouse picker and drag preview correction

- Matched the legacy attachment picker by allowing all tags of the requested type to be selected, including tags currently assigned elsewhere.
- Preserved reassignment by updating the selected tag's `parentTag`.
- Strengthened ItemTag image bounds and cropping selectors so bound SKU images cannot expand card height.
- Kept all insertion indicators mounted throughout dragging to avoid hover flicker.

## 2026-09-08 18:11:58 +08:00 — Warehouse stable drag preview and image sizing

- Rendered all left/right ItemTag insertion points for the complete drag session instead of mounting only the hovered point.
- Added active highlighting and spacing only to the currently selected insertion point to prevent flicker.
- Constrained bound SKU images to a fixed 72px card area with cropping and overflow protection.

## 2026-09-08 18:08:57 +08:00 — Warehouse horizontal drop targets and card sizing

- Changed ItemTag drop indicators from above-card markers to explicit left/right insertion markers based on pointer position.
- Added a rightmost drop zone and spacing expansion around the active insertion point.
- Normalized ItemTag card heights so image content cannot create uneven card sizes.

## 2026-09-08 18:05:45 +08:00 — Warehouse drop-point feedback

- Added visible drop indicators between ItemTag cards and at the rightmost end of each shelf.
- Added expanded drop spacing, cyan arrows/markers, and a labeled end-of-shelf drop zone during dragging.
- Added ItemTag move animation for cross-shelf drops and limited target-card displacement animation to true card replacements.

## 2026-09-08 18:00:31 +08:00 — Reverting to warehouse drag/drop rearrangement

- Removed the unpredictable ItemTag arrow rearrangement mode.
- Restored direct ItemTag drag/drop reordering and cross-shelf movement.
- Added distinct, larger slide animations for both the moved card and displaced target card.

## 2026-09-08 17:55:52 +08:00 — Warehouse explicit item rearrangement controls

- Added a configuration-only `REARRANGE ITEMS` toggle for unlocked warehouse layouts.
- Added left/right arrow controls to ItemTag cards.
- Arrow moves reorder items within a shelf or across adjacent shelves while updating `parentTag`.
- Added a sliding highlight animation after each persisted move.

## 2026-09-08 17:52:48 +08:00 — Warehouse intra-shelf item ordering

- Added explicit ItemTag-to-ItemTag drop handling within the same shelf.
- Persisted item order by moving the dragged tag before the target tag in the shared tag array.
- Preserved existing inter-shelf reassignment behavior.

## 2026-09-08 17:50:07 +08:00 — Warehouse drag/drop and orphan tag recovery

- Fixed warehouse drag/drop with explicit browser drag payloads and ShelfTag drop targets.
- Corrected Add Item Tag availability to include orphaned ItemTags whose parent is missing or not a ShelfTag.
- Preserved valid hierarchy filtering so already-assigned ItemTags and ShelfTags remain excluded.

## 2026-09-08 17:46:54 +08:00 — Warehouse attachment filtering and detach behavior

- Restricted Add Shelf/Item Tag pickers to tags with no current hierarchy parent, preventing already-configured tags from appearing.
- Changed warehouse Delete/Detach behavior to clear `parentTag` while preserving the tag in the shared Light Control registry.
- Child tags are also detached when their shelf/area parent is removed, allowing them to be attached again later.

## 2026-09-08 16:59:26 +08:00 — Warehouse tag picker parity

- Replaced the minimal Add Shelf/Item Tag creation form with the legacy attachment picker workflow.
- Added Tag Reference/Tag ID search, sort field, ascending/descending control, scanner support, clear action, and responsive tag grid.
- Selecting a tag now attaches an existing unassigned tag instead of creating a potentially duplicate tag record.

## 2026-09-08 16:56:39 +08:00 — Warehouse tag persistence and add controls

- Fixed drag/drop bubbling that could save an ItemTag with an AreaTag parent and make it disappear from both React and legacy views.
- Added type-safe parent validation before persisting warehouse hierarchy changes.
- Restored `+ Add Shelf Tag` and `+ Add Item Tag` controls with React creation modal and persistence.

## 2026-09-08 16:52:12 +08:00 — Picklist layout and collapse sizing parity

- Expanded Picklist/Putaway modal fields to fill the available modal width with legacy spacing, sizing, and field proportions.
- Added a constrained inner wrapper to list-card bodies so collapsed cards reduce to header height regardless of item count.

## 2026-09-08 16:47:24 +08:00 — Home list card parity

- Added an explicit React modal entrance animation for the SKU confirmation submodal and other shared modals.
- Added collapsible Picklist/Putaway cards with legacy chevron behavior.
- Added View More list details modal and Delete actions with confirmation for saved lists.

## 2026-09-08 16:45:04 +08:00 — Picklist modal animation and styling parity

- Added enter and exit animations to shared React modals, including the item confirmation submodal.
- Applied rounded dark legacy styling and focus treatment to Picklist/Putaway modal fields.
- Increased the SKU number and item label typography in the item confirmation submodal.

## 2026-09-08 16:39:30 +08:00 — React Picklist modal parity

- Matched the React Picklist/Putaway creation modal to the legacy two-stage workflow.
- Added dark legacy-style Order Number and SKU fields with scanner and clear actions.
- Added SKU filtering and matching-item selection.
- Added the item confirmation submodal with product image, SKU details, quantity stepper, and `+ Add Item`.

## 2026-09-08 16:34:29 +08:00 — Documentation structure update

- Updated [CODEBASE_MAP.md](CODEBASE_MAP.md) while preserving its main section structure.
- Separated legacy vanilla JavaScript and React implementation details within feature subsections where both versions exist.
- Added explicit React and legacy ownership for Home, Light Control, Warehouse, SKU administration, Inventory, Settings, Debug Console, and shared UI layers.
- Added a timestamp convention to this changelog entry.

## React Home, batch actions, and warehouse drag/drop parity

- Added the legacy-style create Picklist/Putaway modal and distinct launcher icons.
- Added expandable saved template cards with add-to-today, view, edit, and delete actions.
- Added Light Control Batch Stop and Batch Delete, with batch actions aligned to the right.
- Added unlocked Warehouse drag/drop reassignment with persisted tag hierarchy updates.

## React Debug, Inventory, Home, and search parity

- Added a Debug Console page with publish/receive log panels and a JSON publish composer.
- Restored Home launcher buttons, list cards, status actions, and template drawer structure.
- Replaced generic Inventory data rows with legacy toolbar, filter, inventory table, and transaction table structures.
- Applied the legacy dark search-field styling to Light Control, Warehouse, Inventory, and Home filters.

## React scanner and Settings parity

- Added a React camera scanner modal with `BarcodeDetector` support and manual fallback.
- Wired Light Control tag fields to the scanner and restored dark legacy input styling.
- Added Settings quick access buttons, working persisted sidebar visibility controls, and custom tag icon upload/clear actions backed by `/api/settings`.
- Custom icons now render in React Light Control cards.

## Light Control form visual parity

- Matched the add/edit form to the legacy three-row two-column field layout.
- Restored legacy input action affordances, placeholders, color preview spacing, switch controls, and submit-button spacing.

## React Light Control parity

- Replaced the simplified Light Control screen with the legacy group-control, expandable add/edit form, filtering, sorting, selection, batch-action, and card layout.
- Restored the responsive `strip-list` multi-column grid and legacy `strip-card` metadata/action structure.
- Added AreaTag, ShelfTag, and ItemTag icons to each strip card and tag badge.

## React warehouse parity

- Replaced the generic React warehouse tree with the legacy area, shelf, and item card hierarchy.
- Added separate configuration and stock views, independent area/shelf expansion, configuration lock behavior, stock quantity badges, SKU bind/unbind dialogs, tag removal confirmation, and area/tag light actions.
- Reused the legacy warehouse layout classes and added only the React-specific interaction styles.

## React parity: modal and icon primitives

- Added reusable React modal and confirmation dialog components using the legacy overlay and panel classes.
- Moved SKU create/edit into a modal and replaced the browser delete confirmation with the React confirmation dialog.
- Added typed SVG tag icons for warehouse hierarchy records.

## 2026-09-08 15:25

- Added an isolated React 19 + TypeScript + Vite frontend under `frontend/`.
- Added a typed API client for existing MQTT status, tag, SKU, and inventory endpoints.
- Added a responsive React migration shell that runs without changing the legacy frontend or backend.
- Added root scripts for installing, developing, and building the React frontend.
- Migrated the Settings/MQTT configuration screen into React with typed settings, broker controls, connection status, and AP information.
- Migrated Light Control/tag management into React with tag CRUD, filtering, group commands, per-tag controls, and cascade activation.
- Migrated Warehouse Configuration and Stock View into React with hierarchy rendering, search, collapse controls, SKU bindings, stock quantities, and light test/stop actions.
- Migrated SKU Database and Inventory Management into React with SKU CRUD, tag binding, stock adjustments, search, and transaction history.
- Migrated Picklists and Putaway Lists into React with list creation, item selection, templates, activation, completion/cancellation, MQTT commands, and inventory commits.
- Configured the React development server for `http://localhost:9118` and added `start-reactserver.bat` to launch it with the existing backend.
- Reworked the React shell to use the legacy visual system and typography instead of the temporary dark-green migration styling.
