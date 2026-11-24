------------------------------ MODULE HttpLeases ------------------------------
EXTENDS Naturals, FiniteSets

CONSTANTS MaxGeneration, GuardCleanupGeneration

Generations == 1..MaxGeneration
ViewA == "view-a"
ViewB == "view-b"
Panel == "panel"
Views == {ViewA, ViewB}

VARIABLES generation, registered, listening, refs, browser, cleanup, expired, scoped

vars == <<generation, registered, listening, refs, browser, cleanup, expired, scoped>>

Init ==
    /\ generation = 0 /\ registered = 0 /\ listening = {}
    /\ refs = [g \in Generations |-> {}]
    /\ browser = 0 /\ cleanup = {} /\ expired = FALSE /\ scoped = TRUE

Open(owner) ==
    LET g == IF registered = 0 THEN generation + 1 ELSE registered IN
    /\ g \in Generations /\ owner \notin refs[g]
    /\ generation' = IF registered = 0 THEN g ELSE generation
    /\ registered' = g /\ listening' = listening \cup {g}
    /\ refs' = [refs EXCEPT ![g] = @ \cup {owner}]
    /\ expired' = IF registered = 0 \/ owner = Panel THEN FALSE ELSE expired
    /\ UNCHANGED <<browser, cleanup, scoped>>

OpenView == \E owner \in Views : Open(owner)
OpenPanel == Open(Panel)

Remove(expected, removed) ==
    /\ registered # 0
    /\ refs' = [refs EXCEPT ![registered] = @ \ removed]
    /\ scoped' = (refs[registered] \ refs'[registered] = expected)
    /\ IF refs'[registered] = {} /\ browser # registered
          THEN /\ registered' = 0 /\ listening' = listening \ {registered}
               /\ expired' = FALSE
          ELSE UNCHANGED <<registered, listening, expired>>
    /\ UNCHANGED <<generation, browser, cleanup>>

DisconnectView ==
    /\ registered # 0
    /\ \E owner \in Views \cap refs[registered] : Remove({owner}, {owner})

ReleaseReference ==
    /\ registered # 0
    /\ \E g \in Generations : \E owner \in refs[g] :
        /\ g = registered
        /\ Remove({owner}, {owner})

RejectForeignToken ==
    /\ registered # 0 /\ refs[registered] # {}
    /\ Remove({}, {})

IgnoreReleasedReference ==
    /\ \E g \in Generations : g <= generation /\ g # registered /\ g \notin listening
    /\ UNCHANGED vars

ConnectSse ==
    /\ registered # 0 /\ browser = 0
    /\ browser' = registered /\ expired' = FALSE
    /\ UNCHANGED <<generation, registered, listening, refs, cleanup, scoped>>

EndSse ==
    /\ browser # 0
    /\ browser' = 0 /\ cleanup' = cleanup \cup {browser} /\ expired' = FALSE
    /\ UNCHANGED <<generation, registered, listening, refs, scoped>>

ElapseIdle ==
    /\ registered # 0 /\ browser # registered /\ Panel \in refs[registered] /\ ~expired
    /\ expired' = TRUE
    /\ UNCHANGED <<generation, registered, listening, refs, browser, cleanup, scoped>>

Tick ==
    /\ registered # 0 /\ browser # registered
    /\ refs[registered] = {} \/ (expired /\ Panel \in refs[registered])
    /\ Remove(refs[registered] \cap {Panel}, refs[registered] \cap {Panel})

FinishSseCleanup ==
    \E g \in cleanup :
        /\ cleanup' = cleanup \ {g}
        /\ IF refs[g] = {} /\ browser # g /\ (g = registered \/ ~GuardCleanupGeneration)
              THEN /\ registered' = 0 /\ listening' = listening \ {g}
                   /\ expired' = FALSE
              ELSE UNCHANGED <<registered, listening, expired>>
        /\ UNCHANGED <<generation, refs, browser, scoped>>

Quiescent ==
    /\ registered = 0 /\ cleanup = {} /\ generation = MaxGeneration
    /\ UNCHANGED vars

Next ==
    \/ OpenView \/ OpenPanel \/ DisconnectView \/ ReleaseReference
    \/ RejectForeignToken \/ IgnoreReleasedReference
    \/ ConnectSse \/ EndSse \/ ElapseIdle \/ Tick \/ FinishSseCleanup \/ Quiescent

OneListenerPerAddress == Cardinality(listening) <= 1

ActiveReferenceKeepsListener ==
    \A g \in Generations : (refs[g] # {} \/ browser = g) => (g = registered /\ g \in listening)

ReleaseIsScopedToOwnerAndToken == scoped

Unused(g) == g \in listening /\ refs[g] \subseteq {Panel} /\ browser # g

UnusedListenerEventuallyCloses ==
    \A g \in Generations : Unused(g) ~> (~Unused(g))

Spec == Init /\ [][Next]_vars
        /\ WF_vars(ElapseIdle) /\ WF_vars(Tick) /\ WF_vars(FinishSseCleanup)

=============================================================================
