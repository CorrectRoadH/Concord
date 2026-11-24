# QueryRefresh

TLC reached 101 states and 196 steps. The chart draws 9 states and 15 arrows.
The chart does not draw 12 steps that stay in one chart state.
The view hides 47 steps, so the chart does not draw them.

## Rules that hold
CoalescedAttemptStartsAfterRequest, IdentityChangeDiscardsCandidate, DriftKeepsLastConsistentRecord, FailedRefreshKeepsPreviousResult, NoDeadlock
