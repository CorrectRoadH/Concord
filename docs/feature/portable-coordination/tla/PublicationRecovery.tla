---- MODULE PublicationRecovery ----
EXTENDS Naturals, TLC

CONSTANT Writers

VARIABLES files, replies, staleAtAdmission, journalWriters, journal, server,
          recoveryStep, recoveryCrashed, externalTarget, recovery, firstReply

vars == <<files, replies, staleAtAdmission, journalWriters, journal, server,
          recoveryStep, recoveryCrashed, externalTarget, recovery, firstReply>>

Targets == 1..2
OldImage == [target \in Targets |-> "old"]
PlannedImage(writer) == [target \in Targets |-> writer]
NoJournal == [phase |-> "absent", writer |-> "none", nextTarget |-> 1]
NoRecovery == [status |-> "none", image |-> OldImage, writer |-> "none", warnings |-> {}]
NoReply == [journal |-> "unknown", recovery |-> "none"]
HasJournal == journal.phase # "absent"
CanPublish == server \in {"running", "replied"}
ExternallyChanged == {target \in Targets : files[target] \notin {"old", journal.writer}}

Init ==
    /\ files = OldImage
    /\ replies = [writer \in Writers |-> "queued"]
    /\ staleAtAdmission = {}
    /\ journalWriters = {}
    /\ journal = NoJournal
    /\ server = "running"
    /\ recoveryStep = "idle"
    /\ recoveryCrashed = FALSE
    /\ externalTarget = 0
    /\ recovery = NoRecovery
    /\ firstReply = NoReply

AdmitPlan ==
    /\ CanPublish /\ ~HasJournal
    /\ \E writer \in Writers :
        /\ replies[writer] = "queued"
        /\ IF files # OldImage
           THEN /\ staleAtAdmission' = staleAtAdmission \cup {writer}
                /\ replies' = [replies EXCEPT ![writer] = "SourceChanged"]
                /\ UNCHANGED <<journal, journalWriters>>
           ELSE /\ journal' = [phase |-> "prepared", writer |-> writer, nextTarget |-> 1]
                /\ journalWriters' = journalWriters \cup {writer}
                /\ replies' = [replies EXCEPT ![writer] = "publishing"]
                /\ UNCHANGED staleAtAdmission
    /\ UNCHANGED <<files, server, recoveryStep, recoveryCrashed, externalTarget, recovery, firstReply>>

ReplaceTarget ==
    /\ CanPublish /\ journal.phase = "prepared" /\ journal.nextTarget \in Targets
    /\ files[journal.nextTarget] = "old"
    /\ files' = [files EXCEPT ![journal.nextTarget] = journal.writer]
    /\ journal' = [journal EXCEPT !.nextTarget = @ + 1]
    /\ UNCHANGED <<replies, staleAtAdmission, journalWriters, server, recoveryStep,
                   recoveryCrashed, externalTarget, recovery, firstReply>>

RecordCommit ==
    /\ CanPublish /\ journal.phase = "prepared" /\ journal.nextTarget = 3
    /\ journal' = [journal EXCEPT !.phase = "committed"]
    /\ UNCHANGED <<files, replies, staleAtAdmission, journalWriters, server,
                   recoveryStep, recoveryCrashed, externalTarget, recovery, firstReply>>

FinishPublication ==
    /\ CanPublish /\ journal.phase = "committed"
    /\ journal' = NoJournal
    /\ replies' = [replies EXCEPT ![journal.writer] = "applied"]
    /\ UNCHANGED <<files, staleAtAdmission, journalWriters, server, recoveryStep,
                   recoveryCrashed, externalTarget, recovery, firstReply>>

ExternalEdit ==
    /\ externalTarget = 0 /\ recovery.status = "none"
    /\ (HasJournal \/ "queued" \in {replies[writer] : writer \in Writers})
    /\ externalTarget' \in Targets
    /\ files' = [files EXCEPT ![externalTarget'] = "external"]
    /\ UNCHANGED <<replies, staleAtAdmission, journalWriters, journal, server,
                   recoveryStep, recoveryCrashed, recovery, firstReply>>

InterruptPublication(nextServer) ==
    /\ server = "running" /\ HasJournal
    /\ server' = nextServer
    /\ replies' = [replies EXCEPT ![journal.writer] = "interrupted"]
    /\ UNCHANGED <<files, staleAtAdmission, journalWriters, journal, recoveryStep,
                   recoveryCrashed, externalTarget, recovery, firstReply>>

TargetChanged ==
    /\ journal.phase = "prepared" /\ journal.nextTarget \in Targets
    /\ files[journal.nextTarget] # "old"
    /\ InterruptPublication("needs-recovery")

CrashPublication ==
    /\ journal.phase = "prepared"
    /\ InterruptPublication("down")

BeginRecovery ==
    /\ server \in {"down", "needs-recovery"} /\ HasJournal
    /\ server' = "recovering"
    /\ recoveryStep' = "inspect"
    /\ UNCHANGED <<files, replies, staleAtAdmission, journalWriters, journal,
                   recoveryCrashed, externalTarget, recovery, firstReply>>

StartRollback ==
    /\ server = "recovering" /\ recoveryStep = "inspect"
    /\ ExternallyChanged = {} /\ files # PlannedImage(journal.writer)
    /\ recoveryStep' = "rollback"
    /\ UNCHANGED <<files, replies, staleAtAdmission, journalWriters, journal,
                   server, recoveryCrashed, externalTarget, recovery, firstReply>>

\* The Spec gives external changes priority. Recheck at the modeled replacement boundary.
RestoreTarget ==
    /\ server = "recovering" /\ recoveryStep = "rollback" /\ ExternallyChanged = {}
    /\ \E target \in Targets :
        /\ files[target] = journal.writer
        /\ files' = [files EXCEPT ![target] = "old"]
    /\ UNCHANGED <<replies, staleAtAdmission, journalWriters, journal, server,
                   recoveryStep, recoveryCrashed, externalTarget, recovery, firstReply>>

CrashRecovery ==
    /\ server = "recovering" /\ ~recoveryCrashed
    /\ server' = "down"
    /\ recoveryCrashed' = TRUE
    /\ recoveryStep' = "idle"
    /\ UNCHANGED <<files, replies, staleAtAdmission, journalWriters, journal,
                   externalTarget, recovery, firstReply>>

FinishRecovery ==
    /\ server = "recovering"
    /\ \/ ExternallyChanged # {}
       \/ files = PlannedImage(journal.writer)
       \/ (recoveryStep = "rollback" /\ files = OldImage)
    /\ UNCHANGED files
    /\ recovery' =
        [status |-> IF ExternallyChanged # {} THEN "discarded"
                    ELSE IF files = PlannedImage(journal.writer) THEN "completed"
                    ELSE "rolledBack",
         image |-> files', writer |-> journal.writer, warnings |-> ExternallyChanged]
    /\ journal' = NoJournal
    /\ server' = "ready"
    /\ recoveryStep' = "idle"
    /\ UNCHANGED <<replies, staleAtAdmission, journalWriters, recoveryCrashed,
                   externalTarget, firstReply>>

ReplyToBusiness ==
    /\ server = "ready"
    /\ server' = "replied"
    /\ firstReply' = [journal |-> journal.phase, recovery |-> recovery.status]
    /\ UNCHANGED <<files, replies, staleAtAdmission, journalWriters, journal,
                   recoveryStep, recoveryCrashed, externalTarget, recovery>>

Done ==
    /\ CanPublish /\ ~HasJournal
    /\ \A writer \in Writers : replies[writer] # "queued"
    /\ UNCHANGED vars

Next ==
    \/ AdmitPlan
    \/ ReplaceTarget
    \/ RecordCommit
    \/ FinishPublication
    \/ ExternalEdit
    \/ TargetChanged
    \/ CrashPublication
    \/ BeginRecovery
    \/ StartRollback
    \/ RestoreTarget
    \/ CrashRecovery
    \/ FinishRecovery
    \/ ReplyToBusiness
    \/ Done

Spec == Init /\ [][Next]_vars

WriterSymmetry == Permutations(Writers)

StalePlanWritesNothing ==
    /\ staleAtAdmission \cap journalWriters = {}
    /\ \A writer \in staleAtAdmission :
        /\ replies[writer] = "SourceChanged"
        /\ \A target \in Targets : files[target] # writer

RecoveryPreservesExternalEdit ==
    /\ (externalTarget # 0 /\ server \in {"needs-recovery", "down", "recovering"})
       => files[externalTarget] = "external"
    /\ (externalTarget # 0 /\ recovery.status # "none")
       => /\ recovery.image[externalTarget] = "external"
          /\ recovery.status = "discarded"
          /\ recovery.warnings = {externalTarget}
          /\ (server = "ready" => ~HasJournal)

RecoveredFilesMatchOneImage ==
    (recovery.status # "none" /\ externalTarget = 0)
    => /\ recovery.image \in {OldImage, PlannedImage(recovery.writer)}
       /\ (server = "ready" => ~HasJournal)

RecoveryBeforeFirstReply ==
    firstReply # NoReply
    => /\ firstReply.journal = "absent"
       /\ firstReply.recovery \in {"completed", "rolledBack", "discarded"}

====
