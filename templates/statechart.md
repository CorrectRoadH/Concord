# {{title}}

## Rules

### The callback runs at most once {#AtMostOnce}

Describe the rule in terms a reader can verify. Use the exact model invariant or property name as the heading anchor. A test that replays a counterexample uses an `@spec` reference to this anchor.

## Model Scope and Code Mapping

State the bounds, explored interleavings, and assumptions for each configuration.

| Model action | Code entry or operation | Atomic step or effect |
| --- | --- | --- |
| `Complete` | Point to the actual completion code. | Identify the state written together. |

## Statechart

Generate `out` with the model checker and update the digest from the current model inputs. Replace this example with the actual block after the output exists.

````markdown
```statechart spec="./tla/Model.tla" config="./tla/model.cfg" out="./tla/out/default" digest="sha256:0000000000000000000000000000000000000000000000000000000000000000"
```
````

## Outside the Model

Name the behavior and failure paths outside the model's bounds. Link to the tests that replay any counterexample against the code.
