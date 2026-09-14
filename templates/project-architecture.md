# Project architecture

## Purpose and boundaries

Describe the system's purpose, its external actors, and what lies outside it.

## Components and responsibilities

Identify the main components, the state each owns, and how they communicate.
Link detailed feature contracts instead of repeating them.

## Main flow

Follow one representative input through the system to its observable result.

## Invariants and failure boundaries

State the system-wide constraints implementations must preserve and which
component owns each failure. Keep detailed resource lifecycles in their feature.
