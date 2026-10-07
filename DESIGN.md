# Calico design brief

Calico is a small desktop tool for one person at a desk. It sits next to a physical panel and should feel like that panel's other half, not like a web dashboard template.

## Who and when

A developer glancing over between tasks, or setting up a board with a cable in one hand. They want state at a glance, and setup steps that cannot go wrong quietly.

## Tokens

The palette comes from the panel firmware. Do not add colors.

| Token    | Hex       | Use                                |
| -------- | --------- | ---------------------------------- |
| glass    | `#0c0e09` | window background, strips          |
| surface  | `#14160f` | sidebar, raised areas              |
| field    | `#2a2d24` | inputs, buttons, off states        |
| stroke   | `#6d6756` | borders, dividers                  |
| selected | `#3d4f32` | selected rows, primary button fill |
| sage     | `#9bb57a` | ok, running, online, focus ring    |
| cream    | `#efe7d6` | primary text                       |
| muted    | `#a39b88` | secondary text, idle               |
| amber    | `#e2a23a` | needs you, warnings, connecting    |
| red      | `#c4544a` | errors, offline                    |

Type: the platform UI font (`system-ui`), tabular numerals everywhere. Monospace only in the Console and for commands the user copies.

## Do

- Dense rows separated by hairlines, like the panel's agent list.
- A sidebar with four views: Dashboard, Device, Console, Settings.
- Say what happened and what to do next, in plain words. Show the exact command before running anything privileged.
- Motion only for state changes, 150 to 200 ms, and none under `prefers-reduced-motion`.
- Lucide icons, because the panel draws Lucide glyphs.
- Keyboard reachable everything, visible focus ring in sage.

## Do not

- Card grids, hero headers, gradients, glassmorphism, drop shadows for depth.
- Inter, or any web font download.
- shadcn default theme, purple, blue links.
- Modals for anything except device pickers and destructive confirmation.
- Toasts that vanish before they can be read.
- Spinners without a label saying what is being waited on.

## Audit

Renderer pull requests run Impeccable `/audit` (product mode) with this file as context, plus the ui-skills `baseline-ui` and `fixing-accessibility` passes. The pull request template carries the checklist.
