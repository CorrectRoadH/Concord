---- MODULE FeedbackSync ----
EXTENDS Integers, FiniteSets

CONSTANTS SecondVersionTime, SecondVersionPayload

Requests == {"A", "B"}
NoVersion == [time |-> 0, payload |-> ""]
FirstVersion == [time |-> 1, payload |-> "original"]
Version(r) == IF r = "A" THEN FirstVersion ELSE [time |-> SecondVersionTime, payload |-> SecondVersionPayload]
NoReceipt == [paths |-> {}, expected |-> {}, checkedAt |-> -1]
Terminal == {"rejected", "merged", "conflict", "cache-failed"}

VARIABLES requests, edited, initialBindings, bindings, issues, cache, lastMerge
vars == <<requests, edited, initialBindings, bindings, issues, cache, lastMerge>>

(* A manual edit and each first binding change the whole config digest. *)
Revision == Cardinality(bindings) + (IF edited THEN 1 ELSE 0)

Init ==
    /\ requests = [r \in Requests |-> [
           phase |-> "idle", observed |-> -1, attempts |-> 0,
           receipt |-> NoReceipt, failureReceipt |-> NoReceipt,
           operationCompleted |-> FALSE]]
    /\ edited = FALSE
    /\ initialBindings \in {{}, Requests}
    /\ bindings = initialBindings
    /\ issues = {}
    /\ cache = NoVersion
    /\ lastMerge = [request |-> "", prior |-> NoVersion]

StartRead ==
    \E r \in Requests:
        /\ requests[r].phase = "idle"
        /\ requests' = [requests EXCEPT ![r].phase = "reading", ![r].observed = Revision]
        /\ UNCHANGED <<edited, initialBindings, bindings, issues, cache, lastMerge>>

ReadComplete ==
    \E r \in Requests:
        /\ requests[r].phase = "reading"
        /\ requests' = [requests EXCEPT ![r].phase = "ready"]
        /\ UNCHANGED <<edited, initialBindings, bindings, issues, cache, lastMerge>>

EditConfig ==
    /\ ~edited
    /\ \E r \in Requests: requests[r].phase \in {"reading", "ready"}
    /\ edited' = TRUE
    /\ UNCHANGED <<requests, initialBindings, bindings, issues, cache, lastMerge>>

RejectChangedConfig ==
    \E r \in Requests:
        /\ requests[r].phase = "ready"
        /\ requests[r].observed # Revision
        /\ requests' = [requests EXCEPT ![r].phase = "rejected"]
        /\ UNCHANGED <<edited, initialBindings, bindings, issues, cache, lastMerge>>

Publish ==
    \E r \in Requests:
        /\ requests[r].phase = "ready"
        /\ requests[r].observed = Revision
        /\ LET expected == {p \in {"config", "issue"}:
                                IF p = "config" THEN r \notin bindings ELSE issues = {}}
               paths == (IF bindings' # bindings THEN {"config"} ELSE {})
                        \cup (IF issues' # issues THEN {"issue"} ELSE {})
           IN /\ bindings' = bindings \cup {r}
              /\ issues' = IF issues = {} THEN {r} ELSE issues
              /\ requests' = [requests EXCEPT
                    ![r].phase = "published", ![r].attempts = @ + 1,
                    ![r].receipt = [paths |-> paths, expected |-> expected, checkedAt |-> Revision]]
        /\ UNCHANGED <<edited, initialBindings, cache, lastMerge>>

MergeObservation ==
    \E r \in Requests:
        /\ requests[r].phase = "published"
        /\ LET candidate == Version(r)
               conflict == candidate.time = cache.time /\ candidate.payload # cache.payload
           IN /\ cache' = IF candidate.time > cache.time THEN candidate ELSE cache
              /\ requests' = [requests EXCEPT ![r].phase = IF conflict THEN "conflict" ELSE "merged"]
        /\ lastMerge' = [request |-> r, prior |-> cache]
        /\ UNCHANGED <<edited, initialBindings, bindings, issues>>

CacheUpdateFails ==
    \E r \in Requests:
        /\ requests[r].phase = "published"
        /\ requests' = [requests EXCEPT ![r].phase = "cache-failed",
                 ![r].failureReceipt = requests[r].receipt, ![r].operationCompleted = TRUE]
        /\ UNCHANGED <<edited, initialBindings, bindings, issues, cache, lastMerge>>

Done ==
    /\ \A r \in Requests: requests[r].phase \in Terminal
    /\ UNCHANGED vars

Next == StartRead \/ ReadComplete \/ EditConfig \/ RejectChangedConfig
        \/ Publish \/ MergeObservation \/ CacheUpdateFails \/ Done

OneLocalIssuePerRemoteIdentity == Cardinality(issues) <= 1

BindingAndNewIssuesPublishTogether ==
    /\ bindings = initialBindings \cup {r \in Requests: "config" \in requests[r].receipt.paths}
    /\ issues = {r \in Requests: "issue" \in requests[r].receipt.paths}
    /\ \A r \in Requests:
           LET request == requests[r]
           IN IF request.phase \in {"published", "merged", "conflict", "cache-failed"}
              THEN /\ request.receipt.checkedAt = request.observed
                   /\ request.receipt.paths = request.receipt.expected
                   /\ r \in bindings
                   /\ issues # {}
              ELSE request.receipt = NoReceipt

CacheFailureDoesNotUndoSourceCommit ==
    \A r \in Requests:
        LET request == requests[r]
        IN /\ request.attempts <= 1
           /\ request.phase = "cache-failed" =>
                 /\ request.operationCompleted
                 /\ request.attempts = 1
                 /\ request.failureReceipt = request.receipt
                 /\ r \in bindings
                 /\ issues # {}
                 /\ "issue" \in request.failureReceipt.paths => r \in issues

ObservationVersionNeverRegresses ==
    IF lastMerge.request = "" THEN cache = NoVersion
    ELSE LET prior == lastMerge.prior
             candidate == Version(lastMerge.request)
             response == requests[lastMerge.request].phase
         IN /\ cache.time >= prior.time
            /\ IF candidate.time > prior.time
               THEN /\ cache = candidate
                    /\ response = "merged"
               ELSE /\ cache = prior
                    /\ IF candidate.time = prior.time /\ candidate.payload # prior.payload
                       THEN response = "conflict"
                       ELSE response = "merged"
====
