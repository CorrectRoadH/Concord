------------------------------- MODULE WebDrafts -------------------------------
EXTENDS Naturals

CONSTANTS Scenario, Behavior

Original == 0
External == 3
NoRequest == 0
Full == Scenario = "full"
NoConflict == [text |-> 0, disk |-> 0, url |-> 0]

VARIABLES draft, disk, save, route, owner, registered, oldCleanup, conflict

vars == <<draft, disk, save, route, owner, registered, oldCleanup, conflict>>
OnEditor == route.url = 0
Dirty == draft.text # draft.baseline
Saving == save.phase \in {"sending", "readback"}
NeedsSave == Dirty \/ Saving \/ save.phase = "conflict"
IdleSave == [phase |-> "idle", sent |-> NoRequest]
Blocked == save.phase \in {"failed", "conflict"}

Init ==
    /\ draft = [generation |-> 0, text |-> Original, baseline |-> Original]
    /\ disk = Original /\ save = IdleSave
    /\ route = [latest |-> 0, waiting |-> FALSE, firstSaveWaiting |-> FALSE,
                failure |-> FALSE, discarding |-> 0,
                url |-> 0, discarded |-> FALSE]
    /\ owner = 1 /\ registered = 1 /\ oldCleanup = FALSE
    /\ conflict = NoConflict

EditDraft ==
    /\ OnEditor /\ route.discarding = 0 /\ ~route.failure /\ draft.generation < 2
    /\ \E text \in
        (IF draft.generation = 0 THEN {1}
         ELSE IF Full THEN {Original, 2}
         ELSE IF Scenario = "undo" THEN {Original} ELSE {2}) :
        draft' = [draft EXCEPT !.generation = @ + 1, !.text = text]
    /\ save' = IF save.phase = "failed" THEN IdleSave ELSE save
    /\ route' = [route EXCEPT !.discarded = FALSE]
    /\ conflict' = NoConflict
    /\ UNCHANGED <<disk, owner, registered, oldCleanup>>

StartSave ==
    /\ OnEditor /\ route.discarding = 0 /\ Dirty /\ registered = owner
    /\ save.phase \in {"idle", "failed"}
    /\ ~route.failure \/ save.phase = "idle" \/ save.sent # draft.text
    /\ save' = [phase |-> "sending", sent |-> draft.text]
    /\ route' = [route EXCEPT !.firstSaveWaiting = @ \/ (route.waiting /\ route.latest = 1)]
    /\ UNCHANGED <<draft, disk, owner, registered, oldCleanup, conflict>>

SaveAfterPause ==
    /\ ~route.waiting \/ route.failure
    /\ StartSave

SaveBeforeLeaving ==
    /\ route.waiting /\ ~route.failure
    /\ StartSave

AcceptWrite ==
    /\ save.phase = "sending" /\ disk = draft.baseline
    /\ disk' = save.sent
    /\ save' = [save EXCEPT !.phase = "readback"]
    /\ UNCHANGED <<draft, route, owner, registered, oldCleanup, conflict>>

ConfirmReadback ==
    /\ save.phase = "readback" /\ disk = save.sent
    /\ draft' = [draft EXCEPT !.baseline = disk]
    /\ save' = IdleSave
    /\ UNCHANGED <<disk, route, owner, registered, oldCleanup, conflict>>

RejectSave ==
    /\ save.phase = "sending" /\ disk = draft.baseline
    /\ save' = [save EXCEPT !.phase = "failed"]
    /\ route' = [route EXCEPT !.failure = route.waiting, !.firstSaveWaiting = FALSE]
    /\ UNCHANGED <<draft, disk, owner, registered, oldCleanup, conflict>>

RememberConflict ==
    /\ conflict' = [text |-> draft.text, disk |-> disk, url |-> route.url]
    /\ save' = [phase |-> "conflict", sent |-> NoRequest]
    /\ route' = [route EXCEPT !.failure = route.waiting, !.firstSaveWaiting = FALSE]
    /\ UNCHANGED <<draft, disk, owner, registered, oldCleanup>>

RejectConflictingWrite ==
    /\ save.phase = "sending" /\ disk # draft.baseline
    /\ RememberConflict

ReadbackFindsExternalEdit ==
    /\ save.phase = "readback" /\ disk # save.sent
    /\ RememberConflict

MakeExternalEdit ==
    /\ Scenario \in {"full", "conflict"} /\ OnEditor /\ disk # External
    /\ disk' = External
    /\ UNCHANGED <<draft, save, route, owner, registered, oldCleanup, conflict>>

ReadExternalVersion ==
    /\ OnEditor /\ ~Saving /\ disk # draft.baseline /\ save.phase # "conflict"
    /\ IF Dirty
       THEN RememberConflict
       ELSE /\ draft' = [draft EXCEPT !.baseline = disk, !.text = disk]
            /\ save' = IdleSave
            /\ UNCHANGED <<disk, route, owner, registered, oldCleanup, conflict>>

NavigationAvailable ==
    OnEditor /\ route.latest < 2 /\ (Scenario \in {"full", "navigation"} \/ route.latest = 0)

RequestNavigation ==
    /\ NavigationAvailable /\ NeedsSave
    /\ route.discarding = 0 \/ Saving
    /\ route' = [route EXCEPT !.latest = @ + 1, !.waiting = TRUE,
                              !.failure = save.phase = "conflict",
                              !.firstSaveWaiting = @ \/ (route.latest = 0 /\ Saving)]
    /\ UNCHANGED <<draft, disk, save, owner, registered, oldCleanup, conflict>>

OpenCleanTarget ==
    /\ NavigationAvailable /\ route.discarding = 0
    /\ ~NeedsSave \/ (Behavior = "old-undo" /\ ~Dirty /\ Saving)
    /\ route' = [route EXCEPT !.latest = @ + 1, !.url = route.latest + 1, !.waiting = FALSE]
    /\ UNCHANGED <<draft, disk, save, owner, registered, oldCleanup, conflict>>

CurrentNavigationMayProceed ==
    /\ OnEditor /\ route.waiting /\ route.discarding = 0
    /\ ~NeedsSave
    /\ route' = [route EXCEPT !.url = route.latest, !.waiting = FALSE]
    /\ UNCHANGED <<draft, disk, save, owner, registered, oldCleanup, conflict>>

FinishStaleSaveCallback ==
    /\ OnEditor /\ route.waiting /\ route.latest = 2
    /\ ~NeedsSave /\ ~Blocked /\ route.discarding = 0
    /\ route.firstSaveWaiting /\ ~route.discarded
    /\ route' = IF Behavior = "old-save"
                THEN [route EXCEPT !.url = 1, !.waiting = FALSE]
                ELSE route
    /\ UNCHANGED <<draft, disk, save, owner, registered, oldCleanup, conflict>>

BeginDiscard ==
    /\ OnEditor /\ route.waiting /\ route.discarding = 0 /\ route.failure
    /\ registered = owner
    /\ route' = [route EXCEPT !.discarding = route.latest]
    /\ UNCHANGED <<draft, disk, save, owner, registered, oldCleanup, conflict>>

FinishDiscard ==
    /\ OnEditor /\ route.discarding # 0 /\ ~Saving
    /\ LET proceed == route.discarding = route.latest \/ Behavior = "old-discard"
       IN route' = [route EXCEPT !.discarding = 0, !.discarded = TRUE,
                                 !.failure = FALSE,
                                 !.url = IF proceed THEN route.discarding ELSE 0,
                                 !.waiting = ~proceed]
    /\ draft' = [draft EXCEPT !.text = draft.baseline]
    /\ save' = IdleSave /\ conflict' = NoConflict
    /\ UNCHANGED <<disk, owner, registered, oldCleanup>>

CancelNavigation ==
    /\ OnEditor /\ route.waiting /\ route.failure /\ route.discarding = 0
    /\ route' = [route EXCEPT !.waiting = FALSE, !.failure = FALSE, !.firstSaveWaiting = FALSE]
    /\ UNCHANGED <<draft, disk, save, owner, registered, oldCleanup, conflict>>

ActivateNewOwner ==
    /\ Scenario \in {"full", "owner"} /\ OnEditor /\ owner = 1 /\ ~NeedsSave
    /\ route.latest = 0
    /\ owner' = 2 /\ registered' = 2 /\ oldCleanup' = TRUE
    /\ UNCHANGED <<draft, disk, save, route, conflict>>

CleanupOldOwner ==
    /\ oldCleanup
    /\ registered' = IF registered = 1 THEN 0 ELSE registered
    /\ oldCleanup' = FALSE
    /\ UNCHANGED <<draft, disk, save, route, owner, conflict>>

WaitOnPage ==
    /\ OnEditor /\ ~Saving
    /\ UNCHANGED vars

Arrived ==
    /\ ~OnEditor
    /\ UNCHANGED vars

Next ==
    \/ EditDraft \/ SaveAfterPause \/ SaveBeforeLeaving
    \/ AcceptWrite \/ ConfirmReadback \/ RejectSave
    \/ RejectConflictingWrite \/ ReadbackFindsExternalEdit
    \/ MakeExternalEdit \/ ReadExternalVersion
    \/ RequestNavigation \/ OpenCleanTarget \/ CurrentNavigationMayProceed \/ FinishStaleSaveCallback
    \/ BeginDiscard \/ FinishDiscard \/ CancelNavigation
    \/ ActivateNewOwner \/ CleanupOldOwner \/ WaitOnPage \/ Arrived

NavigationWaitsForLatestDraft ==
    ~OnEditor => (route.discarded \/ (~Dirty /\ ~Saving))

StaleNavigationCannotProceed ==
    ~OnEditor => route.url = route.latest

\* A single registration exposes all three operations for that owner.
ReportedDirty == IF registered = owner THEN Dirty ELSE FALSE
FlushOwner == IF registered = owner THEN owner ELSE 0
DiscardOwner == IF registered = owner THEN owner ELSE 0

OldOwnerCleanupPreservesNewOwner ==
    owner = 2 => (ReportedDirty = Dirty /\ FlushOwner = 2 /\ DiscardOwner = 2)

ConflictPreservesDraftAndDisk ==
    conflict # NoConflict =>
        (draft.text = conflict.text /\ disk = conflict.disk /\ route.url = conflict.url)

=============================================================================
