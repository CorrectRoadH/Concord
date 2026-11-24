------------------------------- MODULE CacheClear ------------------------------
EXTENDS Naturals, Sequences

CONSTANTS Scenarios, CheckRootPins

VARIABLES attempt, drift, pinChanged, externalLocks, files, deletions
vars == <<attempt, drift, pinChanged, externalLocks, files, deletions>>

EngineLocks == {"root", "child"}
CacheData == {"cache-data"}
ProtectedPaths == {"service-lock", "admission-lock", "root-lock", "child-lock",
                   "lock-directories", "sources", "evidence", "journal"}
AllPaths == CacheData \union ProtectedPaths

SchemaOf(scenario) ==
    CASE scenario = "auto-old" -> "obsolete"
      [] scenario = "auto-unknown" -> "unknown"
      [] OTHER -> "current"

InventoryIdentity ==
    [lockInode |-> drift = "lock-replaced",
     pinDirectoryInode |-> drift = "pin-parent-replaced"]

SchemaIdentity ==
    [inventory |-> InventoryIdentity,
     dataChangeTime |-> drift = "same-size-write",
     (* This bundles only the fields the exact inactive pin and its parent may change. *)
     inactivePinFields |-> pinChanged]

SafeTree == drift # "unsafe-entry"

Init ==
    /\ \E scenario \in Scenarios:
        attempt = [mode |-> IF scenario = "explicit" THEN "explicit" ELSE "automatic",
                   phase |-> IF scenario = "explicit" THEN "serving" ELSE "opening",
                   request |-> IF scenario = "explicit" THEN "running" ELSE "none",
                   oldHandle |-> TRUE,
                   serviceLock |-> TRUE,
                   admission |-> TRUE,
                   clearLocks |-> {},
                   inventory |-> [lockInode |-> FALSE, pinDirectoryInode |-> FALSE],
                   verified |-> FALSE,
                   schema |-> SchemaOf(scenario),
                   observed |-> FALSE,
                   observation |-> [inventory |-> [lockInode |-> FALSE, pinDirectoryInode |-> FALSE],
                                    dataChangeTime |-> FALSE, inactivePinFields |-> FALSE],
                   outcome |-> "pending", reopenBusy |-> FALSE]
    /\ drift = "none"
    /\ pinChanged = FALSE
    /\ externalLocks = {}
    /\ files = AllPaths
    /\ deletions = <<>>

StartExplicitClear ==
    /\ attempt.phase = "serving"
    /\ attempt' = [attempt EXCEPT !.phase = "draining"]
    /\ UNCHANGED <<drift, pinChanged, externalLocks, files, deletions>>

RequestCancel ==
    /\ attempt.phase \in {"serving", "draining"}
    /\ attempt.request = "running"
    /\ attempt' = [attempt EXCEPT !.request = "cancel-requested"]
    /\ UNCHANGED <<drift, pinChanged, externalLocks, files, deletions>>

NativeReturned ==
    /\ attempt.phase \in {"serving", "draining"}
    /\ attempt.request \in {"running", "cancel-requested"}
    /\ attempt' = [attempt EXCEPT !.request = "returned"]
    /\ UNCHANGED <<drift, pinChanged, externalLocks, files, deletions>>

DrainComplete ==
    /\ attempt.phase = "draining"
    /\ attempt.request = "returned"
    /\ attempt' = [attempt EXCEPT !.phase = "closing"]
    /\ UNCHANGED <<drift, pinChanged, externalLocks, files, deletions>>

ConfirmObsoleteSchema ==
    /\ attempt.phase = "opening"
    /\ attempt.oldHandle
    /\ attempt.schema = "obsolete"
    /\ SafeTree
    /\ attempt' = [attempt EXCEPT !.phase = "closing", !.observed = TRUE,
                                  !.observation = SchemaIdentity]
    /\ UNCHANGED <<drift, pinChanged, externalLocks, files, deletions>>

OpenCurrentSchema ==
    /\ attempt.phase = "opening"
    /\ attempt.schema = "current"
    /\ attempt' = [attempt EXCEPT !.phase = "ready", !.outcome = "ok"]
    /\ UNCHANGED <<drift, pinChanged, externalLocks, files, deletions>>

ReportUnknownSchema ==
    /\ attempt.phase = "opening"
    /\ attempt.schema = "unknown"
    /\ attempt' = [attempt EXCEPT !.phase = "failed", !.oldHandle = FALSE,
                                  !.outcome = "HawdbIncompatible"]
    /\ UNCHANGED <<drift, pinChanged, externalLocks, files, deletions>>

CloseOldHandle ==
    /\ attempt.phase = "closing"
    /\ attempt.request \in {"none", "returned"}
    /\ attempt' = [attempt EXCEPT !.phase = "root", !.oldHandle = FALSE]
    /\ pinChanged' \in (IF CheckRootPins THEN BOOLEAN ELSE {FALSE})
    /\ UNCHANGED <<drift, externalLocks, files, deletions>>

ExternalTakesEngineLock ==
    /\ attempt.phase \in {"root", "reopen"}
    /\ externalLocks = {}
    /\ externalLocks' \in {{"root"}, {"child"}}
    /\ UNCHANGED <<attempt, drift, pinChanged, files, deletions>>

ExternalCloses ==
    /\ attempt.phase \in {"root", "child", "reopen"}
    /\ externalLocks # {}
    /\ externalLocks' = {}
    /\ UNCHANGED <<attempt, drift, pinChanged, files, deletions>>

ExternalWritesSameSizeAndCloses ==
    /\ attempt.phase \in {"root", "child"}
    /\ attempt.observed
    /\ externalLocks # {}
    /\ drift = "none"
    /\ drift' = "same-size-write"
    /\ externalLocks' = {}
    /\ UNCHANGED <<attempt, pinChanged, files, deletions>>

ReplacePinParent ==
    /\ CheckRootPins
    /\ attempt.phase = "root"
    /\ drift = "none"
    /\ drift' = "pin-parent-replaced"
    /\ UNCHANGED <<attempt, pinChanged, externalLocks, files, deletions>>

ChangeLockedInventory ==
    /\ attempt.phase \in {"child", "verify", "delete"}
    /\ drift = "none"
    /\ drift' \in {"lock-replaced", "unsafe-entry"}
    /\ UNCHANGED <<attempt, pinChanged, externalLocks, files, deletions>>

TakeRootLock ==
    /\ attempt.phase = "root"
    /\ "root" \notin externalLocks
    /\ attempt' = [attempt EXCEPT !.phase = "child", !.clearLocks = {"root"},
                                  !.inventory = InventoryIdentity]
    /\ UNCHANGED <<drift, pinChanged, externalLocks, files, deletions>>

FailClearBusy ==
    /\ \/ attempt.phase = "root" /\ "root" \in externalLocks
       \/ attempt.phase = "child" /\ "child" \in externalLocks
    /\ attempt' = [attempt EXCEPT !.phase = "failed", !.clearLocks = {},
                                  !.outcome = "HawdbBusy"]
    /\ UNCHANGED <<drift, pinChanged, externalLocks, files, deletions>>

SameInventory == SafeTree /\ attempt.inventory = InventoryIdentity
ExclusiveInventory ==
    /\ attempt.serviceLock /\ attempt.admission
    /\ attempt.clearLocks = EngineLocks
    /\ externalLocks = {}
    /\ SameInventory

TakeChildLock ==
    /\ attempt.phase = "child"
    /\ "child" \notin externalLocks
    /\ SameInventory
    /\ attempt' = [attempt EXCEPT !.phase = "verify", !.clearLocks = EngineLocks]
    /\ UNCHANGED <<drift, pinChanged, externalLocks, files, deletions>>

RefuseChangedInventory ==
    /\ attempt.phase \in {"child", "verify", "delete"}
    /\ ~SameInventory
    /\ attempt' = [attempt EXCEPT !.phase = "failed", !.clearLocks = {},
                                  !.outcome = IF attempt.mode = "explicit"
                                              THEN "CleanupFailed" ELSE "UnsafePath"]
    /\ UNCHANGED <<drift, pinChanged, externalLocks, files, deletions>>

CurrentSchemaEvidence ==
    /\ attempt.observed
    /\ attempt.schema = "obsolete"
    /\ SafeTree
    /\ LET current == SchemaIdentity IN
       [attempt.observation EXCEPT !.inactivePinFields = current.inactivePinFields] = current

RefuseStaleSchema ==
    /\ attempt.phase = "verify"
    /\ ExclusiveInventory
    /\ attempt.mode = "automatic"
    /\ ~CurrentSchemaEvidence
    /\ attempt' = [attempt EXCEPT !.phase = "failed", !.clearLocks = {},
                                  !.outcome = "UnsafePath"]
    /\ UNCHANGED <<drift, pinChanged, externalLocks, files, deletions>>

VerifyInventory ==
    /\ attempt.phase = "verify"
    /\ ExclusiveInventory
    /\ attempt.mode = "explicit" \/ CurrentSchemaEvidence
    /\ attempt' = [attempt EXCEPT !.phase = "delete", !.verified = TRUE]
    /\ UNCHANGED <<drift, pinChanged, externalLocks, files, deletions>>

DeleteCacheData ==
    /\ attempt.phase = "delete"
    /\ attempt.verified /\ ExclusiveInventory
    /\ attempt.mode = "explicit" \/ CurrentSchemaEvidence
    /\ UNCHANGED <<drift, pinChanged, externalLocks>>
    /\ files' = files \ CacheData
    /\ deletions' = Append(deletions,
        [request |-> attempt.request, oldHandle |-> attempt.oldHandle,
         serviceLock |-> attempt.serviceLock, admission |-> attempt.admission,
         locks |-> attempt.clearLocks, competingLocks |-> externalLocks,
         verified |-> attempt.verified, sameInventory |-> SameInventory,
         mode |-> attempt.mode, evidence |-> CurrentSchemaEvidence,
         lockInodesKept |-> InventoryIdentity'.lockInode = InventoryIdentity.lockInode,
         removed |-> files \ files'])
    /\ attempt' = [attempt EXCEPT !.phase = "deleted"]

ReleaseClearLocks ==
    /\ attempt.phase = "deleted"
    /\ attempt' = [attempt EXCEPT !.phase = "reopen", !.clearLocks = {}]
    /\ UNCHANGED <<drift, pinChanged, externalLocks, files, deletions>>

ReopenCache ==
    /\ attempt.phase = "reopen"
    /\ externalLocks = {}
    /\ attempt' = [attempt EXCEPT !.phase = "ready", !.outcome = "ok"]
    /\ files' = files \union CacheData
    /\ UNCHANGED <<drift, pinChanged, externalLocks, deletions>>

ReportBusyReopen ==
    /\ attempt.phase = "reopen"
    /\ externalLocks # {}
    /\ attempt' = [attempt EXCEPT !.phase = "failed", !.outcome = "HawdbBusy",
                                  !.reopenBusy = TRUE]
    /\ UNCHANGED <<drift, pinChanged, externalLocks, files, deletions>>

Done ==
    /\ attempt.phase \in {"failed", "ready"}
    /\ UNCHANGED vars

Next ==
    \/ StartExplicitClear \/ RequestCancel \/ NativeReturned \/ DrainComplete
    \/ ConfirmObsoleteSchema \/ OpenCurrentSchema \/ ReportUnknownSchema \/ CloseOldHandle
    \/ ExternalTakesEngineLock \/ ExternalCloses \/ ExternalWritesSameSizeAndCloses
    \/ ReplacePinParent \/ ChangeLockedInventory
    \/ TakeRootLock \/ FailClearBusy \/ TakeChildLock \/ RefuseChangedInventory
    \/ RefuseStaleSchema \/ VerifyInventory \/ DeleteCacheData \/ ReleaseClearLocks
    \/ ReopenCache \/ ReportBusyReopen \/ Done

Spec == Init /\ [][Next]_vars

DeletionEvents == {deletions[index] : index \in DOMAIN deletions}

ClearWaitsForNativeDrain ==
    \A entry \in DeletionEvents:
        entry.request \in {"none", "returned"} /\ ~entry.oldHandle

DeleteRequiresVerifiedExclusiveInventory ==
    \A entry \in DeletionEvents:
        /\ entry.serviceLock /\ entry.admission
        /\ entry.locks = EngineLocks /\ entry.competingLocks = {}
        /\ entry.verified /\ entry.sameInventory

ClearPreservesLockFilesAndSources ==
    /\ ProtectedPaths \subseteq files
    /\ \A entry \in DeletionEvents:
        entry.lockInodesKept /\ entry.removed \subseteq CacheData

AutomaticClearRequiresCurrentSchemaEvidence ==
    \A entry \in DeletionEvents: entry.mode = "automatic" => entry.evidence

BusyReopenNeverDeletesAgain ==
    attempt.reopenBusy =>
        /\ attempt.phase = "failed" /\ attempt.outcome = "HawdbBusy"
        /\ attempt.clearLocks = {} /\ Len(deletions) = 1

=============================================================================
