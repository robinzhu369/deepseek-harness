# Agent Note: Workbench control colors and icons

English | [中文](2026-09-18-workbench-control-colors.zh.md)

Status: implemented

## Problem

A descendant-wide blue foreground override makes primary-button text indistinguishable from its blue fill. Text-only utility controls also consume space in the narrow monitor and history columns.

## Decision

Button variants own their foreground colors. Monitor selection uses the semantic workbench selected background with blue text and an explicit pressed state. Navigation keeps labels alongside shared icons. Compact utility actions retain localized accessible names, hover titles and disabled states.

## Alternatives considered

**Add more selector exceptions.** This would preserve the competing color rules and require each future control to opt out. Removing the broad override keeps variant ownership explicit.

**Remove all button labels.** Ambiguous and consequential actions still benefit from visible text; only familiar utilities use icon-only controls.

## Consequences

The blue theme remains scoped to the workbench. Compact actions free horizontal space but rely on tooltips for sighted users unfamiliar with their symbols. Component snapshots cover monitor selection and icon action accessibility; full authenticated visual review still requires a logged-in browser.
