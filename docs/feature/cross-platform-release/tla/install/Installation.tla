--------------------------- MODULE Installation ---------------------------
EXTENDS Naturals, Sequences, FiniteSets

CONSTANTS Concurrent, ObserveImplementation

Candidate == "candidate"
Current == "current"
Victim == "victim"
LiveOld == "live-old"
Versions == {Candidate, Current, "recent-1", "recent-2", Victim, LiveOld}
Installers == IF Concurrent THEN {"A", "B"} ELSE {"A"}
NoReceipt == "no-receipt"
Missing == "absent"
KnownReceipts == {"archive-a", "archive-b"}
ReceiptOptions == KnownReceipts \cup {NoReceipt, Missing}
Terminal == {"done", "rejected", "interrupted"}
LockingPhases == {"inspecting", "staged", "ready", "linked", "activated",
                  "scanned", "reclaiming", "quarantined"}

VARIABLES attempts, receipts, owner, link, activations, service, interrupted,
          nestedArchives, unsafeRemovals
vars == <<attempts, receipts, owner, link, activations, service, interrupted,
          nestedArchives, unsafeRemovals>>

InitialAttempt(target, digest) ==
    [phase |-> "downloading", target |-> target, digest |-> digest,
     canRollback |-> FALSE, reused |-> Missing, plan |-> <<>>, kept |-> 0,
     reclaim |-> Missing]

Init ==
    /\ \E initialCandidate \in IF Concurrent THEN {Missing} ELSE ReceiptOptions:
        receipts = [v \in Versions |-> IF v = Candidate THEN initialCandidate ELSE "archive-a"]
    /\ \E secondTarget \in IF Concurrent THEN {Candidate, Victim} ELSE {Candidate}:
        \E secondDigest \in IF Concurrent /\ secondTarget = Candidate
                            THEN KnownReceipts ELSE {"archive-a"}:
            attempts = [i \in Installers |->
                IF i = "A" THEN InitialAttempt(Candidate, "archive-a")
                ELSE InitialAttempt(secondTarget, secondDigest)]
    /\ owner = "pre-existing"
    /\ link = Current
    /\ activations = <<Current, "recent-1", "recent-2", Victim, LiveOld>>
    /\ service = "using-old"
    /\ interrupted = FALSE
    /\ nestedArchives = {}
    /\ unsafeRemovals = {}

LiveVersion == CASE service = "using-old" -> LiveOld
                 [] service = "using-victim" -> Victim
                 [] OTHER -> Missing

Exists(v) == receipts[v] # Missing
HeldLocks == {i \in Installers: attempts[i].phase \in LockingPhases}
IsQuarantined(v) ==
    \E i \in Installers: attempts[i].phase = "quarantined" /\ attempts[i].reclaim = v

Record(v) == <<v>> \o SelectSeq(activations, LAMBDA a: a # v)

VerifyArchive(i) ==
    /\ attempts[i].phase = "downloading"
    /\ attempts' = [attempts EXCEPT ![i].phase = IF ObserveImplementation THEN "inspecting" ELSE "verified"]
    /\ UNCHANGED <<receipts, owner, link, activations, service, interrupted,
                    nestedArchives, unsafeRemovals>>

AcquireInstallLock(i) ==
    /\ ~ObserveImplementation
    /\ attempts[i].phase = "verified"
    /\ HeldLocks = {}
    /\ attempts' = [attempts EXCEPT ![i].phase = "inspecting"]
    /\ UNCHANGED <<receipts, owner, link, activations, service, interrupted,
                    nestedArchives, unsafeRemovals>>

RejectBusyInstall(i) ==
    /\ ~ObserveImplementation
    /\ attempts[i].phase = "verified"
    /\ HeldLocks # {}
    /\ attempts' = [attempts EXCEPT ![i].phase = "rejected"]
    /\ UNCHANGED <<receipts, owner, link, activations, service, interrupted,
                    nestedArchives, unsafeRemovals>>

StageNewVersion(i) ==
    /\ attempts[i].phase = "inspecting"
    /\ ~Exists(attempts[i].target)
    /\ attempts' = [attempts EXCEPT ![i].phase = "staged", ![i].canRollback = TRUE]
    /\ UNCHANGED <<receipts, owner, link, activations, service, interrupted,
                    nestedArchives, unsafeRemovals>>

ReuseVersion(i) ==
    LET found == receipts[attempts[i].target]
    IN /\ attempts[i].phase = "inspecting"
       /\ found = attempts[i].digest
       /\ attempts' = [attempts EXCEPT ![i].phase = "ready",
                           ![i].reused = found, ![i].canRollback = FALSE]
       /\ UNCHANGED <<receipts, owner, link, activations, service, interrupted,
                       nestedArchives, unsafeRemovals>>

RejectVersion(i) ==
    LET found == receipts[attempts[i].target]
    IN /\ attempts[i].phase = "inspecting"
       /\ found # Missing
       /\ found # attempts[i].digest
       /\ attempts' = [attempts EXCEPT ![i].phase = "rejected", ![i].canRollback = FALSE]
       /\ UNCHANGED <<receipts, owner, link, activations, service, interrupted,
                       nestedArchives, unsafeRemovals>>

PublishDirectory(i) ==
    LET v == attempts[i].target
    IN /\ attempts[i].phase = "staged"
       /\ ~Exists(v)
       /\ attempts' = [attempts EXCEPT ![i].phase = "ready"]
       /\ receipts' = [receipts EXCEPT ![v] = attempts[i].digest]
       /\ owner' = i
       /\ UNCHANGED <<link, activations, service, interrupted, nestedArchives, unsafeRemovals>>

NestStagingDirectory(i) ==
    LET v == attempts[i].target
    IN /\ ObserveImplementation
       /\ attempts[i].phase = "staged"
       /\ Exists(v)
       /\ attempts' = [attempts EXCEPT ![i].phase = "ready"]
       /\ nestedArchives' = nestedArchives \cup {v}
       /\ UNCHANGED <<receipts, owner, link, activations, service, interrupted, unsafeRemovals>>

SwitchLink(i) ==
    LET v == attempts[i].target
    IN /\ attempts[i].phase = "ready"
       /\ ObserveImplementation \/ receipts[v] = attempts[i].digest
       /\ attempts' = [attempts EXCEPT ![i].phase = "linked"]
       /\ link' = v
       /\ activations' = IF ObserveImplementation THEN activations ELSE Record(v)
       /\ UNCHANGED <<receipts, owner, service, interrupted, nestedArchives, unsafeRemovals>>

RecordActivation(i) ==
    LET v == attempts[i].target
    IN /\ attempts[i].phase = "linked"
       /\ attempts' = [attempts EXCEPT ![i].phase = IF Exists(v) THEN "activated" ELSE "rejected",
                           ![i].canRollback = FALSE]
       /\ activations' = IF ObserveImplementation /\ Exists(v) THEN Record(v) ELSE activations
       /\ UNCHANGED <<receipts, owner, link, service, interrupted, nestedArchives, unsafeRemovals>>

InterruptInstall(i) ==
    LET v == attempts[i].target
        remove == attempts[i].canRollback /\
                  (ObserveImplementation \/ (owner = i /\ (\A n \in 1..Len(activations): activations[n] # v)))
    IN /\ ~interrupted
       /\ attempts[i].phase \in {"staged", "ready", "linked", "quarantined"}
       /\ attempts' = [attempts EXCEPT ![i].phase = "interrupted",
                           ![i].canRollback = FALSE, ![i].reclaim = Missing]
       /\ interrupted' = TRUE
       /\ receipts' = IF remove THEN [receipts EXCEPT ![v] = Missing] ELSE receipts
       /\ UNCHANGED <<owner, link, activations, service, nestedArchives, unsafeRemovals>>

ScanRetention(i) ==
    /\ attempts[i].phase = "activated"
    /\ attempts' = [attempts EXCEPT ![i].phase = "scanned",
                      ![i].plan = SelectSeq(activations, LAMBDA v: Exists(v) /\ v # attempts[i].target)]
    /\ UNCHANGED <<receipts, owner, link, activations, service, interrupted,
                    nestedArchives, unsafeRemovals>>

CheckReclaim(i) ==
    LET a == attempts[i]
        v == Head(a.plan)
        keep == v # LiveVersion /\ a.kept < 2
        select == v # LiveVersion /\ ~keep
    IN /\ a.phase = "scanned"
       /\ a.plan # <<>>
       /\ attempts' = [attempts EXCEPT ![i].plan = Tail(@),
                           ![i].kept = IF keep THEN @ + 1 ELSE @,
                           ![i].phase = IF select THEN "reclaiming" ELSE "scanned",
                           ![i].reclaim = IF select THEN v ELSE Missing]
       /\ UNCHANGED <<receipts, owner, link, activations, service, interrupted,
                       nestedArchives, unsafeRemovals>>

QuarantineVersion(i) ==
    /\ ~ObserveImplementation
    /\ attempts[i].phase = "reclaiming"
    /\ attempts' = [attempts EXCEPT ![i].phase = "quarantined"]
    /\ UNCHANGED <<receipts, owner, link, activations, service, interrupted,
                    nestedArchives, unsafeRemovals>>

RestoreLiveVersion(i) ==
    /\ attempts[i].phase = "quarantined"
    /\ attempts[i].reclaim = LiveVersion
    /\ attempts' = [attempts EXCEPT ![i].phase = "scanned", ![i].reclaim = Missing]
    /\ UNCHANGED <<receipts, owner, link, activations, service, interrupted,
                    nestedArchives, unsafeRemovals>>

ReclaimVersion(i) ==
    LET v == attempts[i].reclaim
    IN /\ IF ObserveImplementation THEN attempts[i].phase = "reclaiming"
          ELSE attempts[i].phase = "quarantined" /\ v # LiveVersion
       /\ receipts' = [receipts EXCEPT ![v] = Missing]
       /\ attempts' = [attempts EXCEPT ![i].phase = "scanned", ![i].reclaim = Missing]
       /\ unsafeRemovals' = IF Exists(v) /\ (v = link \/ v = LiveVersion \/ attempts[i].kept # 2)
                            THEN unsafeRemovals \cup {v} ELSE unsafeRemovals
    /\ UNCHANGED <<owner, link, activations, service, interrupted, nestedArchives>>

FinishRetention(i) ==
    /\ attempts[i].phase = "scanned"
    /\ attempts[i].plan = <<>>
    /\ attempts' = [attempts EXCEPT ![i].phase = "done"]
    /\ UNCHANGED <<receipts, owner, link, activations, service, interrupted,
                    nestedArchives, unsafeRemovals>>

ReleaseMarker ==
    /\ service \in {"using-old", "using-victim"}
    /\ service' = IF service = "using-old" THEN "between-services" ELSE "stopped"
    /\ UNCHANGED <<attempts, receipts, owner, link, activations, interrupted,
                    nestedArchives, unsafeRemovals>>

RegisterMarker ==
    /\ service = "between-services"
    /\ Exists(Victim)
    /\ ~IsQuarantined(Victim)
    /\ service' = "using-victim"
    /\ UNCHANGED <<attempts, receipts, owner, link, activations, interrupted,
                    nestedArchives, unsafeRemovals>>

RefuseMarker ==
    /\ ~ObserveImplementation
    /\ service = "between-services"
    /\ ~Exists(Victim) \/ IsQuarantined(Victim)
    /\ service' = "refused"
    /\ UNCHANGED <<attempts, receipts, owner, link, activations, interrupted,
                    nestedArchives, unsafeRemovals>>

Done ==
    /\ \A i \in Installers: attempts[i].phase \in Terminal
    /\ UNCHANGED vars

Next ==
    \/ \E i \in Installers: VerifyArchive(i)
    \/ \E i \in Installers: AcquireInstallLock(i)
    \/ \E i \in Installers: RejectBusyInstall(i)
    \/ \E i \in Installers: StageNewVersion(i)
    \/ \E i \in Installers: ReuseVersion(i)
    \/ \E i \in Installers: RejectVersion(i)
    \/ \E i \in Installers: PublishDirectory(i)
    \/ \E i \in Installers: NestStagingDirectory(i)
    \/ \E i \in Installers: SwitchLink(i)
    \/ \E i \in Installers: RecordActivation(i)
    \/ \E i \in Installers: InterruptInstall(i)
    \/ \E i \in Installers: ScanRetention(i)
    \/ \E i \in Installers: CheckReclaim(i)
    \/ \E i \in Installers: QuarantineVersion(i)
    \/ \E i \in Installers: RestoreLiveVersion(i)
    \/ \E i \in Installers: ReclaimVersion(i)
    \/ \E i \in Installers: FinishRetention(i)
    \/ ReleaseMarker
    \/ RegisterMarker
    \/ RefuseMarker
    \/ Done

Spec == Init /\ [][Next]_vars

ActiveLinkTargetsVerifiedInstallation == receipts[link] \in KnownReceipts /\ ~IsQuarantined(link)
ExistingVersionBytesAreImmutable ==
    /\ nestedArchives = {}
    /\ \A i \in Installers: attempts[i].reused \in {Missing, attempts[i].digest}
RetentionPreservesCurrentAndLiveVersions == unsafeRemovals = {}
=============================================================================
