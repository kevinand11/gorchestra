# Server Consumer Design System

The Server Consumer UI is a dense, flat operations interface for managing selected-Portfolio work. It should feel like one continuous application surface, not a set of boxed marketing cards.

## Principles

- **Flat first**: prefer direct layout, full-width separators, and restrained status marks over boxed panels.
- **Full-width structure**: borders and row dividers must run edge-to-edge within their owning rail, page, form, or section. Never put borders on elements whose parent padding shortens the separator line; put the border on the full-width section/row and padding on the content inside it.
- **Content over decoration**: avoid decorative metric/count cards unless a count is the primary domain object being inspected or acted on.
- Do not show routine list item counts in section headers or helper copy; the visible list rows are enough unless the count itself drives an action or decision.
- **Actions belong where they act**: put lifecycle actions on detail pages, section toolbars, or near the form they submit. Do not clutter index rows with secondary actions.
- **Shared controls**: use `Ui*` components for buttons, forms, labels, inputs, textareas, selects, cards, and text before adding page-local native controls.

## Layout

- Use the existing app shell rails and page headers as the main structure.
- The app shell owns viewport scrolling: the topbar stays fixed, while left, middle, and right rails are individually scrollable.
- Primary navigation items live together in the left rail; active route backgrounds should span the full rail width rather than appearing inside padded nav groups.
- Portfolio Config is the final left-rail item and is pushed to the rail bottom to separate global selected-Portfolio configuration from day-to-day surfaces.
- Page headers may have horizontal padding; section dividers below them must span the full content width.
- Prefer stacked full-width sections separated by `border-b` or `border-t` over nested bordered cards.
- Forms with internal sections should use full-width bordered sections or rows, then apply horizontal padding to the fields/content inside those sections.
- Use side rails for guidance, impact summaries, and secondary context. Keep primary work in the main column.
- Do not make the whole page/body the primary scroll container for selected-Portfolio app surfaces; put `overflow-y-auto` on the rail that owns the content.
- Right-rail guidance should use flat sections with headings, muted copy, and full-width separators; avoid `UiCallout` for routine right-rail guidance.
- Avoid adding padded wrapper elements whose only purpose is to contain a border. Put the border on the section or row itself.

## Sections and separators

- Section boundaries should be visible as full-width borders.
- If section content needs padding, apply padding to the content area inside the section, not to a parent that shortens the border.
- Treat inset borders caused by parent padding as a design bug unless the border is an intentional inline emphasis marker such as a callout's left rule.
- Use boxed surfaces only for exceptional states that need distinct emphasis, such as destructive warnings, setup blockers, or important notices. Even then, prefer a left accent rule over a full box when possible.
- Use a shared `UiCallout` component for setup blockers, warnings, notices, or errors that need emphasis near the affected work; do not use it for routine right-rail guidance.
- Avoid decorative tags or badges in section headers when helper copy communicates the same requirement.
- Avoid stacking multiple bordered containers inside each other.

## Lists and indexes

- Index pages should read as flat lists or tables with full-width row separators.
- Rows that primarily navigate should be full-row links.
- Do not put routine `Open` buttons on rows that are already links.
- Do not put archive, preflight, or other secondary lifecycle actions on provider/model index rows. Put those actions on the relevant detail page.
- Status badges are appropriate for active/archived state and important readiness state, but keep them terse.

## Forms

- Forms should use shared form controls and clear labels.
- Dense forms may use two-column layouts on wide screens, collapsing to one column on narrow screens.
- Required setup blockers should be shown before submit, close to the form they affect.
- Submit controls should live in the page or section toolbar when the whole page saves, and near the form when only that form submits.
- Creation forms that mix domain content and configuration should use clear full-width section headers rather than side-by-side boxed cards.

## Selects

- `UiSelect` is the shared searchable select. It accepts a single `options` prop that may contain flat options or option groups:

```ts
type UiSelectOption<TValue extends string = string> = {
	value: TValue
	label: string
	disabled?: boolean
}

type UiSelectOptionGroup<TValue extends string = string> = {
	label: string
	options: readonly UiSelectOption<TValue>[]
}

type UiSelectOptions<TValue extends string = string> = readonly (UiSelectOption<TValue> | UiSelectOptionGroup<TValue>)[]
```

- Group headings are not selectable.
- Keyboard navigation skips group headings.
- Search matches option labels and group labels.
- If a group label matches the search, show that group's child options.
- `UiSelect` may expose an always-open prop for embedded selection panels where the option list is part of the page design rather than a transient dropdown.
- Model selectors should group Models under their Model Providers.
- Forms that select a Model and Model Thinking Level together must derive the Thinking Level options from the selected Model's available Thinking Levels; do not show unavailable Thinking Levels for that Model.

## Models and Portfolio Config surfaces

- The top-level `Models` surface lists Model Providers only.
- Model Provider rows link directly to provider detail pages.
- Model Provider rows do not show `Open`, `Archive`, or `Preflight` actions.
- Model Provider detail pages own Provider metadata/actions, Provider lifecycle, Model creation, and a flat linked list of Models under that Provider.
- Model detail pages own Model metadata, capability/pricing editing, Model References, Model Preflight, and Model lifecycle actions.
- The top-level `Portfolio Config` surface lives at `/portfolio-config` and edits Portfolio Config directly.
- Portfolio Config should be the last item in the left rail and visually separated at the bottom of the rail.
- Portfolio Config should not be presented as generic Workspace or account settings.
- Portfolio Config pages should separate model-related configuration from delivery/work-related configuration with clear full-width section hierarchy.
- Portfolio Config model fields need a full-width separator below them before the delivery/work configuration header.
- Use the right rail for Portfolio Config guidance copy rather than adding summary blocks below the form.

## Copy and visual tone

- Use concise operational copy.
- Use Core and Server Consumer domain terms from the context docs.
- Prefer helper text that explains immediate consequences over generic descriptions.
- Keep labels stable and explicit: `Portfolio Config`, `Model Provider`, `Model`, `Secret`, `Preflight`, `Archived`, `Active`.
