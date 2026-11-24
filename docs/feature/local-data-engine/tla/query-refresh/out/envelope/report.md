# QueryRefresh

TLC reached 111 states and 198 steps. The chart draws 11 states and 15 arrows.
The chart does not draw 3 steps that stay in one chart state.
The view hides 36 steps, so the chart does not draw them.

## Rules that hold
CoalescedAttemptStartsAfterRequest, IdentityChangeDiscardsCandidate, DriftKeepsLastConsistentRecord, FailedRefreshKeepsPreviousResult, NoDeadlock
