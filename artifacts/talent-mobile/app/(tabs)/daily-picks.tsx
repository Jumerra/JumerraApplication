// The Daily Picks tab is the employer-facing entry point into the
// canonical deck experience. The screen itself (swipe + undo + snackbar)
// lives at `/employer-deck` so it can also be deep-linked or pushed from
// other surfaces; re-exporting it here keeps a single source of truth.
export { default } from "../employer-deck";
