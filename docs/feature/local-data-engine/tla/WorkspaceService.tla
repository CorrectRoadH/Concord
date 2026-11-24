--------------------------- MODULE WorkspaceService ---------------------------
EXTENDS Naturals, FiniteSets

CONSTANT Commands

VARIABLES active, command, instance, phase, record, locks, caches, hung

vars == <<active, command, instance, phase, record, locks, caches, hung>>
runtime(token, state, cleanup) ==
    [token |-> token, state |-> state, cleanup |-> [phase |-> cleanup]]
emptyRecord == runtime("None", "absent", "none")
idleCommand == [stage |-> "idle", observed |-> "None", replacements |-> 0,
                servedBy |-> "None"]
cleanupPhases == {"draining", "closing-cache", "resources", "released"}
terminalStages == {"served", "CleanupFailed", "WorkspaceServerBusy"}

Init ==
    /\ active = 0
    /\ command = [id \in Commands |-> idleCommand]
    /\ instance = "Old"
    /\ phase = "running"
    /\ record = runtime("Old", "running", "none")
    /\ locks = {"Old"}
    /\ caches = {"Old"}
    /\ hung = FALSE

InStage(stages) == active \in Commands /\ command[active].stage \in stages

InvokeCommand ==
    /\ active + 1 \in Commands
    /\ active = 0 \/ InStage(terminalStages)
    /\ active' = active + 1
    /\ command' = [command EXCEPT ![active'].stage = "discovering"]
    /\ UNCHANGED <<instance, phase, record, locks, caches, hung>>

IncompatibleHello ==
    /\ InStage({"discovering", "can-start"})
    /\ phase = "running" /\ instance \in {"Old", "Rival"}
    /\ record.token = instance
    /\ command' = [command EXCEPT ![active].stage = "mismatch",
                                   ![active].observed = record.token]
    /\ UNCHANGED <<active, instance, phase, record, locks, caches, hung>>

ShutdownWithToken ==
    /\ InStage({"mismatch"}) /\ command[active].replacements = 0
    /\ phase = "running" /\ instance \in locks
    /\ command[active].observed = record.token /\ record.token = instance
    /\ command' = [command EXCEPT ![active].stage = "waiting",
                                   ![active].replacements = @ + 1]
    /\ phase' = "draining"
    /\ record' = runtime(instance, "stopping", "requests")
    /\ UNCHANGED <<active, instance, locks, caches, hung>>

WaitForStoppingInstance ==
    /\ InStage({"discovering"}) /\ phase \in cleanupPhases
    /\ command' = [command EXCEPT ![active].stage = "waiting"]
    /\ UNCHANGED <<active, instance, phase, record, locks, caches, hung>>

DrainRequests ==
    /\ phase = "draining" /\ ~hung
    /\ phase' = "closing-cache"
    /\ record' = runtime(instance, "stopping", "cache")
    /\ UNCHANGED <<active, command, instance, locks, caches, hung>>

CloseCache ==
    /\ phase = "closing-cache" /\ ~hung
    /\ phase' = "resources"
    /\ record' = runtime(instance, "stopping", "resources")
    /\ caches' = caches \ {instance}
    /\ UNCHANGED <<active, command, instance, locks, hung>>

ReleaseResources ==
    /\ phase = "resources" /\ ~hung
    /\ phase' = "released"
    /\ record' = emptyRecord
    /\ locks' = locks \ {instance}
    /\ UNCHANGED <<active, command, instance, caches, hung>>

ProcessExits ==
    /\ phase = "released" /\ ~hung
    /\ phase' = "exited"
    /\ UNCHANGED <<active, command, instance, record, locks, caches, hung>>

PauseOldCleanup ==
    /\ instance = "Old" /\ phase \in cleanupPhases /\ ~hung
    /\ hung' = TRUE
    /\ UNCHANGED <<active, command, instance, phase, record, locks, caches>>

ExternalSigkill ==
    /\ instance = "Old" /\ phase \in cleanupPhases \cup {"running"}
    /\ \E id \in Commands : command[id].stage \notin terminalStages
    /\ phase' = "exited"
    /\ locks' = locks \ {instance}
    /\ caches' = caches \ {instance}
    /\ hung' = FALSE
    /\ UNCHANGED <<active, command, instance, record>>

ExitWaitTimesOut ==
    \* Collapse the 10-second wait once the modeled cleanup cannot advance.
    /\ InStage({"waiting"}) /\ hung
    /\ command' = [command EXCEPT ![active].stage = "CleanupFailed"]
    /\ UNCHANGED <<active, instance, phase, record, locks, caches, hung>>

ProbeReleasedLock ==
    \* Probe acquisition and release are atomic here. The child acquires separately.
    /\ InStage({"discovering", "waiting", "mismatch"})
    /\ phase = "exited" /\ locks = {}
    /\ command' = [command EXCEPT ![active].stage = "can-start"]
    /\ UNCHANGED <<active, instance, phase, record, locks, caches, hung>>

RivalWinsLock ==
    \* One other-installation contender can win after this command's probe.
    /\ InStage({"can-start"})
    /\ instance = "Old" /\ phase = "exited" /\ locks = {}
    /\ instance' = "Rival" /\ phase' = "running"
    /\ locks' = locks \cup {"Rival"} /\ caches' = caches \cup {"Rival"}
    /\ record' = runtime("Rival", "running", "none")
    /\ UNCHANGED <<active, command, hung>>

ReplacementBudgetSpent ==
    /\ InStage({"mismatch"}) /\ command[active].replacements = 1
    /\ command[active].observed = "Rival" /\ record.token = "Rival"
    /\ command' = [command EXCEPT ![active].stage = "WorkspaceServerBusy"]
    /\ UNCHANGED <<active, instance, phase, record, locks, caches, hung>>

StartCurrent ==
    /\ InStage({"can-start"}) /\ locks = {} /\ phase = "exited"
    /\ instance' = "New" /\ phase' = "launching"
    /\ command' = [command EXCEPT ![active].stage = "starting"]
    /\ UNCHANGED <<active, record, locks, caches, hung>>

AcquireCurrentLock ==
    /\ phase = "launching" /\ locks = {}
    /\ phase' = "locked" /\ locks' = locks \cup {instance}
    /\ UNCHANGED <<active, command, instance, record, caches, hung>>

PublishCurrentRecord ==
    /\ phase = "locked" /\ instance \in locks
    /\ phase' = "opening" /\ record' = runtime(instance, "opening", "none")
    /\ UNCHANGED <<active, command, instance, locks, caches, hung>>

OpenCurrentCache ==
    /\ phase = "opening" /\ instance \in locks
    /\ phase' = "running" /\ record' = runtime(instance, "running", "none")
    /\ caches' = caches \cup {instance}
    /\ UNCHANGED <<active, command, instance, locks, hung>>

CurrentHello ==
    /\ InStage({"starting", "discovering"}) /\ instance = "New"
    /\ record.token = instance /\ phase \in {"opening", "running"}
    /\ command' = [command EXCEPT ![active].stage = "ready",
                                   ![active].observed = record.token]
    /\ UNCHANGED <<active, instance, phase, record, locks, caches, hung>>

ServeRequest ==
    /\ InStage({"ready"}) /\ phase = "running"
    /\ command[active].observed = instance /\ record.token = instance
    /\ command' = [command EXCEPT ![active].stage = "served",
                                   ![active].servedBy = instance]
    /\ UNCHANGED <<active, instance, phase, record, locks, caches, hung>>

Done ==
    /\ \A id \in Commands : command[id].stage \in terminalStages
    /\ UNCHANGED vars

Next ==
    \/ InvokeCommand
    \/ IncompatibleHello
    \/ ShutdownWithToken
    \/ WaitForStoppingInstance
    \/ DrainRequests
    \/ CloseCache
    \/ ReleaseResources
    \/ ProcessExits
    \/ PauseOldCleanup
    \/ ExternalSigkill
    \/ ExitWaitTimesOut
    \/ ProbeReleasedLock
    \/ RivalWinsLock
    \/ ReplacementBudgetSpent
    \/ StartCurrent
    \/ AcquireCurrentLock
    \/ PublishCurrentRecord
    \/ OpenCurrentCache
    \/ CurrentHello
    \/ ServeRequest
    \/ Done

\* The commands, healthy cleanup and healthy startup make progress when enabled.
\* The environment may freeze the old process and may leave it frozen forever.
Progress ==
    \/ InvokeCommand \/ IncompatibleHello \/ ShutdownWithToken \/ WaitForStoppingInstance
    \/ DrainRequests \/ CloseCache \/ ReleaseResources \/ ProcessExits \/ ExitWaitTimesOut
    \/ ProbeReleasedLock \/ ReplacementBudgetSpent \/ StartCurrent \/ AcquireCurrentLock
    \/ PublishCurrentRecord \/ OpenCurrentCache \/ CurrentHello \/ ServeRequest

Spec == Init /\ [][Next]_vars /\ WF_vars(Progress)

SingleOwner == Cardinality(locks) <= 1 /\ Cardinality(caches) <= 1 /\ caches \subseteq locks
ServedByCurrent == \A id \in Commands : command[id].servedBy \in {"None", "New"}
OneReplacementPerCommand == \A id \in Commands : command[id].replacements <= 1

StartRespectsLock ==
    (instance' = "New" /\ phase' = "launching" /\ phase # "launching")
    => (locks = {} /\ phase = "exited")
NoStartWhileHeld == [][StartRespectsLock]_vars

FindsStaleRecord(id) ==
    /\ active = id /\ command[id].stage \in {"discovering", "mismatch"}
    /\ instance = "Old" /\ phase = "exited" /\ record.token = "Old"

StaleRecordRecovers ==
    \A id \in Commands : FindsStaleRecord(id) ~> (command[id].servedBy = "New")

UpgradeEventuallyServes ==
    \* A demand can be served by its command or by a later invocation after recovery.
    \A id \in Commands : (command[id].stage # "idle")
        ~> (\E attempt \in Commands : attempt >= id /\ command[attempt].servedBy = "New")

=============================================================================
