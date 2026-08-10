# API Latency SLOs

Target latency percentiles (under 10 concurrent users):

| Endpoint                                            | p50 (median) | p95     | p99      |
| --------------------------------------------------- | ------------ | ------- | -------- |
| GET /api/plants                                     | < 100ms      | < 300ms | < 500ms  |
| GET /api/plants/measurements/approximation/watering | < 150ms      | < 500ms | < 1000ms |
| POST /api/plants/{id}/measurements/weight           | < 200ms      | < 500ms | < 1000ms |

These are initial baselines. Run `make load-test` to measure current performance.
