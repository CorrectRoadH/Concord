---------------------------- MODULE TaggedRelease ----------------------------
EXTENDS Naturals

CONSTANT WatchDispatchedRun

NoAsset == [commit |-> "none", version |-> "none", digest |-> "none"]
TagCommit == "tag commit"
Candidate == [commit |-> TagCommit, version |-> "tag version", digest |-> "candidate SHA-256"]
OtherAssets == {
  [Candidate EXCEPT !.commit = "another commit"],
  [Candidate EXCEPT !.version = "another version"],
  [Candidate EXCEPT !.digest = "another SHA-256"]
}

VARIABLES trigger, attempt, retries, phase, checks, packaged, originalAsset,
          asset, reusedAsset, uploadCommit, receipt, firstFailed
vars == <<trigger, attempt, retries, phase, checks, packaged, originalAsset,
          asset, reusedAsset, uploadCommit, receipt, firstFailed>>

Init ==
  /\ trigger = "none"
  /\ attempt = 0
  /\ retries = 0
  /\ phase = "idle"
  /\ checks = FALSE
  /\ packaged = FALSE
  /\ originalAsset \in {NoAsset, Candidate} \cup OtherAssets
  /\ asset = originalAsset
  /\ reusedAsset = NoAsset
  /\ uploadCommit = "none"
  /\ receipt = "none"
  /\ firstFailed = FALSE

DispatchRelease ==
  /\ phase = "idle"
  /\ trigger' \in {"tag", "manual"}
  /\ attempt' = 1
  /\ phase' = "running"
  /\ UNCHANGED <<retries, checks, packaged, originalAsset, asset, reusedAsset,
                 uploadCommit, receipt, firstFailed>>

FailAttempt ==
  /\ phase' = IF attempt = 1 THEN "failed" ELSE "exhausted"
  /\ firstFailed' = (firstFailed \/ attempt = 1)

FinishChecksAndPackaging ==
  /\ phase = "running"
  /\ checks' \in IF checks THEN {TRUE} ELSE BOOLEAN
  /\ packaged' \in IF packaged THEN {TRUE} ELSE BOOLEAN
  /\ IF checks' /\ packaged'
       THEN /\ phase' = "verified"
            /\ UNCHANGED firstFailed
       ELSE FailAttempt
  /\ UNCHANGED <<trigger, attempt, retries, originalAsset, asset, reusedAsset,
                 uploadCommit, receipt>>

PublishNewAsset ==
  /\ phase = "verified"
  /\ asset = NoAsset
  /\ uploadCommit' = TagCommit
  /\ asset' = Candidate
  /\ phase' = "notify"
  /\ UNCHANGED <<trigger, attempt, retries, checks, packaged, originalAsset,
                 reusedAsset, receipt, firstFailed>>

ReuseExistingAsset ==
  /\ phase = "verified"
  /\ asset = Candidate
  /\ reusedAsset' = asset
  /\ phase' = "notify"
  /\ UNCHANGED <<trigger, attempt, retries, checks, packaged, originalAsset,
                 asset, uploadCommit, receipt, firstFailed>>

RejectExistingAsset ==
  /\ phase = "verified"
  /\ asset \in OtherAssets
  /\ FailAttempt
  /\ UNCHANGED <<trigger, attempt, retries, checks, packaged, originalAsset,
                 asset, reusedAsset, uploadCommit, receipt>>

RequestChannelSync ==
  /\ phase = "notify"
  /\ receipt # "received"
  /\ receipt' = "requested"
  /\ phase' = "finished"
  /\ UNCHANGED <<trigger, attempt, retries, checks, packaged, originalAsset,
                 asset, reusedAsset, uploadCommit, firstFailed>>

FailChannelNotification ==
  /\ phase = "notify"
  /\ receipt # "received"
  /\ FailAttempt
  /\ UNCHANGED <<trigger, attempt, retries, checks, packaged, originalAsset,
                 asset, reusedAsset, uploadCommit, receipt>>

ReceiveChannelReceipt ==
  /\ asset = Candidate
  /\ receipt # "received"
  /\ receipt' = "received"
  /\ UNCHANGED <<trigger, attempt, retries, phase, checks, packaged, originalAsset,
                 asset, reusedAsset, uploadCommit, firstFailed>>

RecognizeChannelReceipt ==
  /\ phase = "notify"
  /\ receipt = "received"
  /\ phase' = "finished"
  /\ UNCHANGED <<trigger, attempt, retries, checks, packaged, originalAsset,
                 asset, reusedAsset, uploadCommit, receipt, firstFailed>>

ResolveCompletion ==
  /\ phase = "failed"
  /\ phase' = IF trigger = "manual" THEN "delivered" ELSE "suppressed"
  /\ UNCHANGED <<trigger, attempt, retries, checks, packaged, originalAsset,
                 asset, reusedAsset, uploadCommit, receipt, firstFailed>>

ScheduleRetry ==
  /\ attempt = 1
  /\ \/ phase = "delivered"
     \/ phase = "suppressed" /\ WatchDispatchedRun
  /\ retries' = retries + 1
  /\ phase' = "scheduled"
  /\ UNCHANGED <<trigger, attempt, checks, packaged, originalAsset, asset,
                 reusedAsset, uploadCommit, receipt, firstFailed>>

StartRetry ==
  /\ phase = "scheduled"
  /\ attempt' = 2
  /\ phase' = "running"
  /\ UNCHANGED <<trigger, retries, checks, packaged, originalAsset, asset,
                 reusedAsset, uploadCommit, receipt, firstFailed>>

Done ==
  /\ \/ phase \in {"finished", "exhausted"}
     \/ phase = "suppressed" /\ ~WatchDispatchedRun
  /\ UNCHANGED vars

Next ==
  \/ DispatchRelease
  \/ FinishChecksAndPackaging
  \/ PublishNewAsset
  \/ ReuseExistingAsset
  \/ RejectExistingAsset
  \/ RequestChannelSync
  \/ FailChannelNotification
  \/ ReceiveChannelReceipt
  \/ RecognizeChannelReceipt
  \/ ResolveCompletion
  \/ ScheduleRetry
  \/ StartRetry
  \/ Done

Spec == Init /\ [][Next]_vars /\ WF_vars(ResolveCompletion) /\ WF_vars(ScheduleRetry)

PublishRequiresPassingChecksForTagCommit ==
  uploadCommit # "none" => /\ uploadCommit = TagCommit
                           /\ checks
                           /\ packaged
                           /\ asset = Candidate

RetryPreservesImmutableAssetIdentity ==
  /\ originalAsset # NoAsset => asset = originalAsset
  /\ uploadCommit # "none" => asset = Candidate
  /\ reusedAsset # NoAsset => (reusedAsset = Candidate /\ asset = reusedAsset)

AtMostOneAutomaticRetry == retries <= 1

FirstFailedRunEventuallyRetries == firstFailed ~> (retries = 1)
=============================================================================
