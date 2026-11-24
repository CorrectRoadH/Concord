----------------------------- MODULE QueryRefresh -----------------------------
EXTENDS Naturals

CONSTANT Scenario
VARIABLES identity, requests, scan, cache, decision
vars == <<identity, requests, scan, cache, decision>>

Clients == {1, 2}
Keys == {"A", "B"}
EmptyEnvelope == [record |-> "none", recordAt |-> 0, lastAttempt |-> 0, error |-> 0]
WarmEnvelope(kind) == [record |-> kind, recordAt |-> 1, lastAttempt |-> 1, error |-> 1]
EmptyRequest == [due |-> 0, served |-> 0, expired |-> FALSE, disconnected |-> FALSE]
EmptyScan == [phase |-> "idle", key |-> "A", generation |-> 1, batch |-> {},
              candidate |-> "none", drift |-> FALSE]
EmptyDecision == [kind |-> "none", beforeKey |-> "A", afterKey |-> "A",
                  before |-> EmptyEnvelope, after |-> EmptyEnvelope, at |-> 0,
                  otherKeyUnchanged |-> TRUE]

Init ==
    /\ identity = "A"
    /\ requests = [client \in Clients |-> EmptyRequest]
    /\ scan = EmptyScan
    /\ cache \in CASE Scenario = "envelope" ->
                        {[A |-> previous, B |-> EmptyEnvelope] :
                            previous \in {EmptyEnvelope, WarmEnvelope("consistent"), WarmEnvelope("inconsistent")}}
                   [] Scenario = "identity" -> {[A |-> WarmEnvelope("consistent"), B |-> EmptyEnvelope]}
                   [] OTHER -> {[key \in Keys |-> EmptyEnvelope]}
    /\ decision = EmptyDecision

NeedsRefresh(request) == request.due > 0 /\ request.served = 0 /\ ~request.expired
Pending == {client \in Clients : NeedsRefresh(requests[client])}
Idle == scan.phase \in {"idle", "finished"}
Ready == scan.phase \in {"candidate", "retry"}
Queue(s) == [EmptyScan EXCEPT !.phase = "queued", !.key = identity, !.generation = s.generation]
OpenWork == scan.phase \in {"queued", "scanning", "candidate", "retry"}

RequestRefresh ==
    \E client \in Clients:
        /\ requests[client].due = 0
        /\ client = 1 \/ requests[1].due > 0
        /\ \/ Scenario \in {"requests", "all"}
           \/ scan.generation = 1
        (* A request received after the scan starts needs the next generation. *)
        /\ requests' = [requests EXCEPT ![client].due = scan.generation + 1]
        /\ scan' = IF Idle THEN Queue(scan) ELSE scan
        /\ UNCHANGED <<identity, cache, decision>>

DisconnectClient ==
    /\ Scenario \in {"requests", "all"}
    /\ 1 \in Pending /\ ~requests[1].disconnected
    /\ requests' = [requests EXCEPT ![1].disconnected = TRUE]
    /\ UNCHANGED <<identity, scan, cache, decision>>

ChangeIdentity ==
    /\ Scenario \in {"identity", "all"}
    /\ OpenWork
    /\ identity = "A"
    /\ identity' = "B"
    /\ UNCHANGED <<requests, scan, cache, decision>>

StartScan ==
    /\ scan.phase = "queued"
    /\ scan.key = identity
    /\ scan' = [scan EXCEPT !.phase = "scanning", !.generation = @ + 1, !.batch = Pending]
    /\ UNCHANGED <<identity, requests, cache, decision>>

EditSource ==
    /\ Scenario \in {"envelope", "identity", "all"}
    /\ scan.phase = "scanning" /\ ~scan.drift
    /\ scan' = [scan EXCEPT !.drift = TRUE]
    /\ UNCHANGED <<identity, requests, cache, decision>>

FinishScan ==
    /\ scan.phase = "scanning"
    /\ scan' \in { [scan EXCEPT !.phase = "candidate", !.candidate = kind] :
        kind \in IF scan.drift
                 THEN {"inconsistent", "unstructured", "failure"}
                 ELSE IF Scenario = "requests" THEN {"consistent"} ELSE {"consistent", "failure"} }
    /\ UNCHANGED <<identity, requests, cache, decision>>

CancelBackground ==
    /\ Scenario \in {"requests", "all"}
    /\ scan.phase = "scanning"
    /\ scan' = [scan EXCEPT !.phase = "candidate", !.candidate = "failure"]
    /\ UNCHANGED <<identity, requests, cache, decision>>

RecordDecision(kind) ==
    [kind |-> kind, beforeKey |-> scan.key, afterKey |-> identity, at |-> scan.generation,
     before |-> cache[scan.key], after |-> cache'[scan.key],
     otherKeyUnchanged |-> \A key \in Keys \ {scan.key} : cache[key] = cache'[key]]

DiscardChangedIdentity ==
    /\ scan.phase = "queued" \/ Ready
    /\ scan.key # identity
    /\ scan' = Queue(scan)
    /\ UNCHANGED <<identity, requests, cache>>
    /\ decision' = RecordDecision("discarded")

WaitForCache ==
    /\ scan.phase = "candidate"
    /\ scan.key = identity
    /\ scan' = [scan EXCEPT !.phase = "retry"]
    /\ UNCHANGED <<identity, requests, cache, decision>>

QueueRemainder ==
    scan' = IF \E client \in Clients : NeedsRefresh(requests'[client])
            THEN Queue(scan)
            ELSE [EmptyScan EXCEPT !.phase = "finished", !.key = identity, !.generation = scan.generation]

ExpireCacheRetry ==
    /\ scan.phase = "retry" /\ scan.key = identity
    /\ requests' = [client \in Clients |->
        IF client \in scan.batch THEN [requests[client] EXCEPT !.expired = TRUE] ELSE requests[client]]
    /\ QueueRemainder
    /\ UNCHANGED <<identity, cache>>
    /\ decision' = RecordDecision("expired")

UpdatedEnvelope(previous, kind, at) ==
    CASE kind = "failure" -> [previous EXCEPT !.error = at]
      [] kind = "unstructured" \/ (kind = "inconsistent" /\ previous.record = "consistent") ->
          [previous EXCEPT !.lastAttempt = at, !.error = 0]
      [] OTHER -> [record |-> kind, recordAt |-> at, lastAttempt |-> at, error |-> 0]

Publish ==
    /\ Ready
    /\ scan.key = identity
    /\ cache' = [cache EXCEPT ![scan.key] = UpdatedEnvelope(@, scan.candidate, scan.generation)]
    /\ requests' = [client \in Clients |->
        IF client \in scan.batch THEN [requests[client] EXCEPT !.served = scan.generation] ELSE requests[client]]
    /\ decision' = RecordDecision(scan.candidate)
    /\ QueueRemainder
    /\ UNCHANGED identity

Done ==
    /\ scan.phase = "finished"
    /\ UNCHANGED vars

Next ==
    \/ RequestRefresh \/ DisconnectClient \/ ChangeIdentity \/ StartScan
    \/ EditSource \/ FinishScan \/ CancelBackground \/ DiscardChangedIdentity
    \/ WaitForCache \/ ExpireCacheRetry \/ Publish \/ Done

Spec == Init /\ [][Next]_vars

CoalescedAttemptStartsAfterRequest ==
    \A client \in Clients :
        requests[client].served # 0 => requests[client].served >= requests[client].due

IdentityChangeDiscardsCandidate ==
    decision.beforeKey # decision.afterKey =>
        /\ decision.kind = "discarded"
        /\ decision.before = decision.after
        /\ decision.otherKeyUnchanged

DriftKeepsLastConsistentRecord ==
    decision.kind \in {"inconsistent", "unstructured"} /\ decision.before.record = "consistent" =>
        /\ decision.after.record = decision.before.record
        /\ decision.after.recordAt = decision.before.recordAt

FailedRefreshKeepsPreviousResult ==
    decision.kind = "failure" =>
        /\ decision.after.record = decision.before.record
        /\ decision.after.recordAt = decision.before.recordAt
        /\ decision.after.lastAttempt = decision.before.lastAttempt
        /\ decision.after.error = decision.at
==============================================================================
