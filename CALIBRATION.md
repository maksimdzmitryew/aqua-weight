### Calibration: "Correct overfill" button — how it works

Quick answer: When you click "Correct overfill", the UI finds the event with the most negative "Diff to max Weight (g)" since the last repotting and sends three values to the backend:
- from_ts = that event’s measured_at
- start_measurement_id = that event’s ID
- start_diff_to_max_g = that event’s (negative) diff value in grams

The backend then corrects all overfilled watering entries from that timestamp onward, using a cap of target = min_dry_weight_g + max_water_weight_g and also capping last_wet_weight_g (edit_last_wet=true).

This document explains exactly what the "Correct overfill (since repotting)" action on the Calibration page does, end‑to‑end.

---

#### Purpose
Some past watering events were recorded with a wet weight above the intended cap (either full capacity or the plant’s recommended retained ratio). These overfilled events inflate later calculations. The "Correct overfill" button rewrites those historical rows deterministically so your stored facts reflect the intended cap.

No schema changes are required. The correction updates only existing measurement rows.

---

#### Where you trigger it
- Frontend page: `Calibration.jsx`
- Per‑plant action button: "Correct overfill (since repotting)"
- The button is enabled only when the plant has both `min_dry_weight_g` and `max_water_weight_g` defined.

When clicked, the UI computes the correction window start and calls the backend with:

```
POST /measurements/corrections
Content-Type: application/json

{
  "plant_id": "<plant uuid hex>",
  "from_ts": "<measured_at of the entry with the biggest negative Diff to max Weight (g)>",
  "start_measurement_id": "<measurement id hex>",
  "start_diff_to_max_g": -120,
  "cap": "capacity",
  "edit_last_wet": true
}
```

Notes:
- The button chooses the correction starting point since last repotting by scanning the plant’s calibration entries and picking the entry with the most negative `Diff to max Weight (g)` (i.e., the minimum value of `last_wet_weight_g - target_weight_g`). It passes that entry’s identifiers: `from_ts`, `start_measurement_id`, and `start_diff_to_max_g`.
- If no entry has both `last_wet_weight_g` and `target_weight_g`, the button omits `from_ts`/`start_measurement_id`/`start_diff_to_max_g`, and the backend falls back to the default window "since last repotting" (exclusive of the repot timestamp).
- `cap` is set to `capacity` by this button (see Cap modes below).
- `edit_last_wet` is `true`, so measured wet weight is capped in addition to reducing water added.

After the request completes, the page refreshes the calibration list for all plants and shows any error via the standard error notice.

---

#### Backend endpoint
Route: `POST /measurements/corrections`

Request model fields:
- `plant_id` (required): 32‑char hex UUID of the plant.
- `from_ts` (optional, ISO local string): start of correction window.
- `to_ts` (optional, ISO local string): end of correction window.
- `cap` (optional): one of `capacity` (default) or `retained_ratio`.
- `edit_last_wet` (optional, default `true`): if true, also cap `last_wet_weight_g` to the computed target.
- `start_measurement_id` (optional): ID of the event selected by the UI as the starting point (informational; backend currently uses `from_ts`).
- `start_diff_to_max_g` (optional): numeric value of the selected event’s diff (informational).

Behavior (algorithm):
1. Validate `plant_id` and load plant parameters: `min_dry_weight_g`, `max_water_weight_g`, and `recommended_water_threshold_pct` (defaults to 100% when null).
2. Determine the time window:
   - If `from_ts`/`to_ts` are provided, use them.
   - Otherwise, default to "since last repotting" for the plant (strictly after the repot timestamp).
3. Compute the target cap weight `target_weight_g` per selected cap mode:
   - `capacity` (used by the button): `target = min_dry_weight_g + max_water_weight_g`.
   - `retained_ratio`: `target = min_dry_weight_g + (recommended_water_threshold_pct/100) * max_water_weight_g`.
4. Select candidate rows from `plants_measurements` that match all of the following:
   - The plant matches.
   - The row is a watering entry: `measured_weight_g IS NULL`.
   - The row’s `measured_at` falls inside the window.
   - `last_wet_weight_g` is not null and strictly greater than `target_weight_g`.
5. For each candidate row, compute `excess_g = last_wet_weight_g - target_weight_g`.
6. Apply updates in a transaction:
   - `water_added_g` becomes `max(0, water_added_g - excess_g)`.
   - If `edit_last_wet = true` (the default and what the button sends), also set `last_wet_weight_g = min(last_wet_weight_g, target_weight_g)`.
7. Commit the transaction and return a summary.

Safeguards:
- If plant `min_dry_weight_g` or `max_water_weight_g` is missing or invalid (<= 0), the endpoint returns early without changes.
- `water_added_g` is never reduced below zero.
- The whole set of updates is executed within a transaction; on error, the transaction is rolled back.

Response shape:
```json
{
  "updated": 3,
  "total_excess_g": 180,
  "details": [
    {
      "id": "<measurement uuid hex>",
      "measured_at": "2025-07-03 19:42:00",
      "excess_g": 75,
      "new_water_added_g": 120
    }
  ],
  "target_weight_g": 940
}
```

---

#### Cap modes (for context)
- `capacity` (used by the button): caps wet weight to the plant’s full capacity = `min_dry_weight_g + max_water_weight_g`.
- `retained_ratio`: caps to the plant’s recommended retained water ratio, if `recommended_water_threshold_pct` is set on the plant.

You can invoke the endpoint with `cap: "retained_ratio"` from custom tooling or future UI controls to use the ratio‑based cap; the current Calibration button uses `capacity`.

---

#### Example: cURL invocation (what the button sends)
```bash
curl -X POST \
  http://localhost:8000/measurements/corrections \
  -H 'Content-Type: application/json' \
  -d '{
        "plant_id": "0123456789abcdef0123456789abcdef",
        "cap": "capacity",
        "edit_last_wet": true
      }'
```

Because no `from_ts`/`to_ts` are provided, the backend automatically limits the correction window to events after the last repotting for that plant.

---

#### What you will see in the UI
- While the request runs, the button displays "Correcting…" for that plant.
- On success, the list refreshes and the per‑event numbers reflect the updated facts from the database.
- On error, a message is shown in the page’s error notice area.

---

#### Limitations and notes
- Only watering entries (`measured_weight_g IS NULL`) are considered.
- Historical raw wet weights are capped when `edit_last_wet=true`. If you prefer to preserve raw wet weights, you can call the endpoint with `edit_last_wet=false` (not used by the current button).
- If no candidate rows exceed the cap within the window, the endpoint returns `updated: 0`.

---

#### Implementation pointers
- Frontend caller: `frontend/src/api/calibration.js` → `calibrationApi.correct(payload)`.
- UI action: `frontend/src/pages/Calibration.jsx` → `handleCorrectOverfill`.
- Backend endpoint: `backend/app/routes/measurements.py` → `apply_measurements_corrections`.
