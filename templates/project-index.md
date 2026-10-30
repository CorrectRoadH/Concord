# Project documentation

Start with [Concepts](concepts.md) for shared language and
[Architecture](architecture.md) for the system's boundaries and main flow.

Structured global terminology lives in `docs/concepts.md`; local definitions
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
| Defects, requests, and observations | [Issues](issues/README.md) |
| Decisions without a Design and reusable lessons | [Memory](../memory/README.md) |

## Writing rules

Write adopted target behavior, constraints, and acceptance in Feature and
Engineering. Product workflows belong in contracts; development logs,
investigation history, and implementation progress belong in Concord Memory.

Every file under `docs/` and `memory/` can be edited directly; Concord commands
run the steps a change needs, such as fix verification. `concord check --since <base>`
validates each change. Derive indexes and reverse relations instead of maintaining them.

Define each fact in one owner and link to it elsewhere. Research informs
decisions; Roadmap does not impose a current implementation obligation.

Feature README defines the problem, mental model, scope, and entry points.
Library, CLI, Architecture, and Use Case pages are optional by feature shape.
Engineering uses the same layout. A document's path is its identity and its
single top-level heading is its name; Spec pages carry no frontmatter.

See the [template library](_template/README.md) for writing prompts and the
[Concord workflow](concord.md) for commands. Templates are not completed contracts
or test evidence. Add project-specific guides when there is content to explain.
