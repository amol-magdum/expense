# TODO - Expense Tracker Improvements

- [x] Update `script.js` to remove XSS risk by avoiding `innerHTML` for user-controlled fields (use DOM creation or escaping).

- [ ] Fix date sorting robustness for `YYYY-MM-DD` values.
- [x] Reduce unnecessary Drive reads on add/delete (avoid `await readJsonFile()` in add unless needed).

- [x] Harden parsing/shape validation for `localData` after Drive reads.

- [ ] (If applicable) Improve UI feedback + prevent double-submit during Drive writes.
- [ ] Run a quick local smoke test: login flow (if keys exist), month dropdown population, add/delete, and both tabs render correctly.

