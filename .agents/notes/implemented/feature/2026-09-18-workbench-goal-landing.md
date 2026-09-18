# Agent Note: Goal-first workbench landing page

English | [中文](2026-09-18-workbench-goal-landing.zh.md)

Status: implemented

## Problem

The new-task screen presents setup controls before the user's goal, while the sidebar mixes project setup with navigation. The supplied layout reference emphasizes a single central composer and stable navigation.

## Decision

The authenticated landing page centers its title and goal composer over a subtle semantic-token grid. Data attachment, dataset selection and submission share the composer toolbar. Three localized suggestions fill and focus the goal without submitting. AI goal generation and advanced configuration remain available in disclosures. The sidebar provides icon-and-text navigation, a project disclosure, independently scrolling history and an account footer. History utility controls appear on hover or keyboard focus and stay visible on touch devices; pagination appears when another page can exist.

## Alternatives considered

**Reproduce every reference menu item.** Notebook and scenario-lab destinations have no implementation in this workbench; existing functional destinations remain the navigation inventory.

**Keep every setup field expanded.** This obscures the goal composer and uses unnecessary height. Disclosures retain the existing configuration and task creation semantics.

## Consequences

The workbench preserves its blue theme and existing data, authorization and approval requirements. Users discover optional configuration through disclosures. Component checks cover suggestion focus and the dataset requirement. Desktop and narrow-screen visual checks use the actual components with isolated fixture data; they do not exercise authenticated backend execution.
