# PublicationRecovery

TLC reached 127 states and 205 steps. The chart draws 14 states and 23 arrows.
The chart does not draw 78 steps that stay in one chart state.
With SYMMETRY, TLC keeps one representative for each group of states that it counts as the same. An arrow can lead to the representative rather than to the state that the step reaches.

## Rules that hold
StalePlanWritesNothing, RecoveryPreservesExternalEdit, RecoveredFilesMatchOneImage, RecoveryBeforeFirstReply, NoDeadlock
