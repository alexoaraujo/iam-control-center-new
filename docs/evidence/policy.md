# Evidence Policy

Every release claim must refer to:
- repository and branch,
- exact commit SHA,
- workflow/run URL and conclusion,
- test suite and environment,
- timestamp in UTC,
- known exclusions and blockers.

A check is not PASS if it is missing, skipped, stale, or attached to another SHA. A deployment success does not prove authorization or tenant isolation. Production remains blocked until Preview evidence and approval are recorded.
