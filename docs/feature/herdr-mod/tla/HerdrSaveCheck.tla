---------------------------- MODULE HerdrSaveCheck ----------------------------
EXTENDS Naturals, FiniteSets

CONSTANTS SaveLimit, AllowStaleProjection
VARIABLES sessions, foreground, projectionReading

vars == <<sessions, foreground, projectionReading>>
Repositories == {"A", "B"}
Generations == 1..SaveLimit
CheckOutcomes == {"findings", "check failed"}
NoReport == [repository |-> "none", generation |-> 0, status |-> "none"]

Init ==
    /\ sessions = [r \in Repositories |->
        [open |-> TRUE, saved |-> 0, receipt |-> 0, pending |-> 0,
         running |-> {}, late |-> {}, report |-> NoReport]]
    /\ foreground = "A"
    /\ projectionReading = FALSE

SaveConfirmed ==
    /\ foreground \in Repositories
    /\ sessions["A"].saved + sessions["B"].saved < SaveLimit
    /\ LET r == foreground
           generation == sessions[r].saved + 1
       IN sessions' = [sessions EXCEPT
            ![r].saved = generation,
            ![r].receipt = generation,
            ![r].pending = generation,
            ![r].report = NoReport]
    /\ UNCHANGED <<foreground, projectionReading>>

StartCheck(r) ==
    LET session == sessions[r]
    IN /\ session.open
       /\ session.pending # 0
       /\ session.running = {}
       /\ sessions' = [sessions EXCEPT ![r].running = {session.pending}, ![r].pending = 0]
       /\ UNCHANGED <<foreground, projectionReading>>

FinishCheck(r) ==
    LET session == sessions[r]
    IN /\ session.open
       /\ \E generation \in session.running, outcome \in CheckOutcomes:
           sessions' = [sessions EXCEPT
               ![r].running = @ \ {generation},
               ![r].report = IF generation = session.saved
                             THEN [repository |-> r, generation |-> generation, status |-> outcome]
                             ELSE @]
       /\ UNCHANGED <<foreground, projectionReading>>

\* One representative read captures repository A's projection before its first save.
ReadProjection ==
    /\ foreground = "A"
    /\ sessions["A"].saved = 0
    /\ ~projectionReading
    /\ projectionReading' = TRUE
    /\ UNCHANGED <<sessions, foreground>>

ReceiveProjection ==
    /\ projectionReading
    /\ projectionReading' = FALSE
    /\ LET session == sessions["A"]
       IN IF AllowStaleProjection /\ session.report.status = "findings"
          THEN sessions' = [sessions EXCEPT !["A"].report =
                    [repository |-> "A", generation |-> 0, status |-> "passed"]]
          ELSE UNCHANGED sessions
    /\ UNCHANGED foreground

SwitchPage ==
    /\ foreground \in Repositories
    /\ UNCHANGED vars

SwitchRepository ==
    /\ foreground \in Repositories
    /\ \E r \in Repositories: r # foreground /\ sessions[r].open /\ foreground' = r
    /\ projectionReading' = FALSE
    /\ UNCHANGED sessions

CloseSession(session) ==
    [session EXCEPT !.open = FALSE, !.pending = 0, !.late = @ \cup session.running,
                    !.running = {}, !.report = NoReport]

EvictSession ==
    /\ foreground \in Repositories
    /\ \E r \in Repositories:
         /\ r # foreground
         /\ sessions[r].open
         /\ sessions' = [sessions EXCEPT ![r] = CloseSession(@)]
    /\ UNCHANGED <<foreground, projectionReading>>

CloseMod ==
    /\ foreground \in Repositories
    /\ sessions' = [r \in Repositories |-> CloseSession(sessions[r])]
    /\ foreground' = "none"
    /\ projectionReading' = FALSE

LateCheckReply ==
    /\ \E r \in Repositories, generation \in Generations:
         /\ generation \in sessions[r].late
         /\ sessions' = [sessions EXCEPT ![r].late = @ \ {generation}]
    /\ UNCHANGED <<foreground, projectionReading>>

Done == foreground = "none" /\ UNCHANGED vars

Next ==
    \/ SaveConfirmed
    \/ \E r \in Repositories: StartCheck(r)
    \/ \E r \in Repositories: FinishCheck(r)
    \/ ReadProjection
    \/ ReceiveProjection
    \/ SwitchPage
    \/ SwitchRepository
    \/ EvictSession
    \/ CloseMod
    \/ LateCheckReply
    \/ Done

Fairness ==
    \A r \in Repositories: WF_vars(StartCheck(r)) /\ WF_vars(FinishCheck(r))

Spec == Init /\ [][Next]_vars /\ Fairness

AtMostOneCheckPerRepositorySession ==
    \A r \in Repositories: Cardinality(sessions[r].running) <= 1

VisibleReport == IF foreground \in Repositories THEN sessions[foreground].report ELSE NoReport

OnlyCurrentCheckMayPublish ==
    /\ \A r \in Repositories:
        LET session == sessions[r]
        IN session.report # NoReport =>
            /\ session.open
            /\ session.report.repository = r
            /\ session.report.generation = session.saved
            /\ session.pending = 0
            /\ session.running = {}
    /\ (VisibleReport # NoReport => VisibleReport.repository = foreground)

CheckFailureDoesNotUndoSave ==
    \A r \in Repositories: sessions[r].receipt = sessions[r].saved

LatestPendingCheckEventuallyStarts ==
    \A r \in Repositories, generation \in Generations:
        LET session == sessions[r]
        IN (session.open /\ session.pending = generation) ~>
           ( \/ ~session.open
             \/ session.saved > generation
             \/ generation \in session.running
             \/ session.report.generation = generation /\ session.report.status \in CheckOutcomes )

=============================================================================
