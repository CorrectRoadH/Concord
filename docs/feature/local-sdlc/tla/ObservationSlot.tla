-------------------------- MODULE ObservationSlot --------------------------
EXTENDS FiniteSets, Naturals

CollectionToken == "collection"
AnalysisToken == "analysis"
Tokens == {CollectionToken, AnalysisToken}
NoInputs == 2
Ending == {"leader-closed", "cancelled", "timed-out", "service-stopping"}
Finished == {"published", "stale", "aborted"}
EmptyRun == [stage |-> "idle", ownerAlive |-> FALSE, group |-> "gone", inputs |-> NoInputs]

VARIABLES owners, issued, uncertain, run, inputs, currentInputs, manualReleaseAuthorized

vars == <<owners, issued, uncertain, run, inputs, currentInputs, manualReleaseAuthorized>>

Init ==
    /\ owners = {} /\ issued = {} /\ uncertain = {}
    /\ run = EmptyRun
    /\ inputs = 0 /\ currentInputs = NoInputs
    /\ manualReleaseAuthorized = TRUE

StartObservation(token) ==
    /\ owners = {} /\ token \notin issued
    /\ owners' = owners \cup {token}
    /\ issued' = issued \cup {token}
    /\ run' = [stage |-> "running", ownerAlive |-> TRUE, group |-> "alive", inputs |-> inputs]
    /\ UNCHANGED <<uncertain, inputs, currentInputs, manualReleaseAuthorized>>

StartCollection == StartObservation(CollectionToken)
StartAnalysis == StartObservation(AnalysisToken)

RefuseOccupiedSlot ==
    /\ owners # {} /\ Tokens \ issued # {}
    /\ UNCHANGED vars

BeginCleanup(reason) ==
    /\ run.stage = "running"
    /\ run' = [run EXCEPT !.stage = reason]
    /\ UNCHANGED <<owners, issued, uncertain, inputs, currentInputs, manualReleaseAuthorized>>

LeaderCloses == BeginCleanup("leader-closed")
CancelObservation == BeginCleanup("cancelled")
ObservationTimesOut == BeginCleanup("timed-out")
StopService == BeginCleanup("service-stopping")

ConfirmGroupGone ==
    /\ run.stage \in Ending
    /\ run' = [run EXCEPT !.group = "gone",
                          !.stage = IF run.stage = "leader-closed" THEN "ready" ELSE "aborted"]
    /\ UNCHANGED <<owners, issued, uncertain, inputs, currentInputs, manualReleaseAuthorized>>

CleanupUnconfirmed ==
    /\ run.stage \in Ending
    /\ run' = [run EXCEPT !.stage = "blocked", !.group = "unknown"]
    /\ uncertain' = uncertain \cup owners
    /\ UNCHANGED <<owners, issued, inputs, currentInputs, manualReleaseAuthorized>>

OwnerDies ==
    /\ run.ownerAlive
    /\ run' = [run EXCEPT !.ownerAlive = FALSE, !.stage = "blocked"]
    /\ uncertain' = uncertain \cup owners
    /\ UNCHANGED <<owners, issued, inputs, currentInputs, manualReleaseAuthorized>>

ConfirmGroupGoneAfterOwnerDeath ==
    /\ run.stage = "blocked" /\ ~run.ownerAlive /\ run.group # "gone"
    /\ run' = [run EXCEPT !.group = "gone"]
    /\ UNCHANGED <<owners, issued, uncertain, inputs, currentInputs, manualReleaseAuthorized>>

VerifyAndPublishCurrent(token) ==
    /\ owners = {token} /\ run.stage = "ready"
    /\ inputs = run.inputs
    /\ currentInputs' = run.inputs
    /\ run' = [run EXCEPT !.stage = "published"]
    /\ UNCHANGED <<owners, issued, uncertain, inputs, manualReleaseAuthorized>>

RejectChangedInputs(token) ==
    /\ owners = {token} /\ run.stage = "ready"
    /\ inputs # run.inputs
    /\ run' = [run EXCEPT !.stage = "stale"]
    /\ UNCHANGED <<owners, issued, uncertain, inputs, currentInputs, manualReleaseAuthorized>>

ClearSlot(token) ==
    /\ owners' = owners \ {token}
    /\ run' = EmptyRun
    /\ UNCHANGED <<issued, inputs, currentInputs>>

ReleaseCleanSlot(token) ==
    /\ owners = {token} /\ run.stage \in Finished /\ run.group = "gone"
    /\ ClearSlot(token)
    /\ UNCHANGED <<uncertain, manualReleaseAuthorized>>

ManualRelease(token, sameHost, confirmed) ==
    /\ owners = {token} /\ run.stage = "blocked"
    /\ ~run.ownerAlive /\ sameHost /\ confirmed
    /\ ClearSlot(token)
    /\ uncertain' = uncertain \ {token}
    \* Record the pre-release facts even though the slot is now empty.
    /\ manualReleaseAuthorized' = (token \in owners /\ ~run.ownerAlive /\ sameHost /\ confirmed)

RefuseManualRelease(token, sameHost, confirmed) ==
    /\ token \notin owners \/ run.ownerAlive \/ ~sameHost \/ ~confirmed
    /\ UNCHANGED vars

DiscardLateCompletion ==
    /\ issued \ owners # {}
    /\ UNCHANGED vars

ChangeInputs ==
    /\ inputs = 0
    /\ inputs' = 1 /\ currentInputs' = NoInputs

EditSourceOutsideConcord ==
    /\ ChangeInputs
    /\ UNCHANGED <<owners, issued, uncertain, run, manualReleaseAuthorized>>

\* Other publication prerequisites are satisfied. Writes need not touch observed inputs.
CommitDocumentWrite ==
    /\ ChangeInputs \/ UNCHANGED <<inputs, currentInputs>>
    /\ UNCHANGED <<owners, issued, uncertain, run, manualReleaseAuthorized>>

QueryRelations == UNCHANGED vars
CloseIssue == UNCHANGED vars

Next ==
    \/ StartCollection \/ StartAnalysis \/ RefuseOccupiedSlot
    \/ LeaderCloses \/ CancelObservation \/ ObservationTimesOut \/ StopService
    \/ ConfirmGroupGone \/ CleanupUnconfirmed \/ OwnerDies \/ ConfirmGroupGoneAfterOwnerDeath
    \/ \E token \in Tokens :
        \/ VerifyAndPublishCurrent(token) \/ RejectChangedInputs(token) \/ ReleaseCleanSlot(token)
        \/ \E sameHost, confirmed \in BOOLEAN :
            ManualRelease(token, sameHost, confirmed) \/ RefuseManualRelease(token, sameHost, confirmed)
    \/ DiscardLateCompletion
    \/ EditSourceOutsideConcord \/ CommitDocumentWrite \/ QueryRelations \/ CloseIssue

AtMostOneObservationOwner == Cardinality(owners) <= 1

UnknownCleanupKeepsSlotBlocked ==
    uncertain # {} => (owners = uncertain /\ run.stage = "blocked")

ManualReleaseRequiresCurrentDeadLocalOwner == manualReleaseAuthorized

BlockedObservationDoesNotRefuseWrites ==
    run.stage = "blocked" => (ENABLED CommitDocumentWrite /\ ENABLED QueryRelations /\ ENABLED CloseIssue)

CurrentObservationRequiresCurrentInputs ==
    currentInputs # NoInputs => currentInputs = inputs

=============================================================================
