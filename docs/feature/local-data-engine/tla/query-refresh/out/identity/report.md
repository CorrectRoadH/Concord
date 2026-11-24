# QueryRefresh

TLC reached 135 states and 256 steps. The chart draws 12 states and 19 arrows.
The chart does not draw 3 steps that stay in one chart state.
The view hides 64 steps, so the chart does not draw them.

## Rules that hold
CoalescedAttemptStartsAfterRequest, IdentityChangeDiscardsCandidate, DriftKeepsLastConsistentRecord, FailedRefreshKeepsPreviousResult, NoDeadlock
