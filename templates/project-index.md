# Project documentation

Start with [Concepts](concepts.md) for shared language and
[Architecture](architecture.md) for the system's boundaries and main flow.

Structured global terminology lives in `docs/concepts.json`; local definitions
and writing policies live in their own documentation directories. Use Concord's
concepts index or Web glossary for an automatically aggregated view with sources.

## Where facts belong

| Content | Owner |
| --- | --- |
| Adopted product goals and behavior | [Feature](feature/README.md) |
| Repository testing, maintenance, and build mechanisms | [Engineering](engineering/README.md) |
| Settled directions awaiting adoption | [Roadmap](roadmap/README.md) |
| Alternative comparison and a decision | [Design](design/README.md) |
| Freeform research, observations, and sources | [Research](research/README.md) |
| Feedback awaiting investigation | [Feedback](issues/README.md) |
| Problems, decisions, and reusable lessons | [Memory](../memory/README.md) |

## Writing rules

Write adopted target behavior, constraints, and acceptance in Feature and
Engineering. Product workflows belong in contracts; development logs,
investigation history, and implementation progress belong in Concord Memory.

Maintain Memory and Issues through Concord tools, including index, recall, and digest-protected edits.
Do not maintain a second index or edit their owner files directly.

Define each fact in one owner and link to it elsewhere. Research informs
decisions; Roadmap does not impose a current implementation obligation.

Feature README defines the problem, mental model, scope, and entry points.
Library, CLI, Architecture, Lifecycle, and Use Case pages are optional by feature
shape. Engineering README defines the goal, mechanism, usage, and acceptance;
split it into topic pages only when needed.

See the [template library](_template/README.md) for writing prompts and the
[Concord workflow](concord.md) for commands. Templates are not completed contracts
or test evidence. Add project-specific guides when there is content to explain.
