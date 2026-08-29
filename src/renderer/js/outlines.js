/* Starter outlines.
 *
 * Each is the bare skeleton of a widely taught story structure: the step names
 * plus a one-line prompt of our own. They are meant to be overwritten.
 */

export const OUTLINE_TEMPLATES = [
  {
    id: 'blank',
    name: 'Blank',
    hint: 'Start from nothing',
    body: '# Outline\n\n'
  },
  {
    id: 'three-act',
    name: 'Three-Act Structure',
    hint: 'Setup, confrontation, resolution',
    body: `# Outline

## Act One — Setup

- Opening image:
- Ordinary world:
- Inciting incident:
- The decision that ends Act One:

## Act Two — Confrontation

- First trials:
- Midpoint reversal:
- Things fall apart:
- The lowest point:

## Act Three — Resolution

- The last idea:
- Climax:
- Closing image:
`
  },
  {
    id: 'story-circle',
    name: "Story Circle",
    hint: "Dan Harmon's eight steps",
    body: `# Outline

## 1. You — a character in a zone of comfort

## 2. Need — but they want something

## 3. Go — they enter an unfamiliar situation

## 4. Search — and adapt to it

## 5. Find — getting what they wanted

## 6. Take — and paying a heavy price for it

## 7. Return — then returning to their familiar situation

## 8. Change — having changed
`
  },
  {
    id: 'heros-journey',
    name: "Hero's Journey",
    hint: 'Departure, initiation, return',
    body: `# Outline

## Departure

- The ordinary world:
- The call to adventure:
- Refusal of the call:
- Meeting the mentor:
- Crossing the threshold:

## Initiation

- Tests, allies, enemies:
- Approach to the inmost cave:
- The ordeal:
- The reward:

## Return

- The road back:
- The resurrection:
- Return with the elixir:
`
  },
  {
    id: 'seven-point',
    name: 'Seven-Point Structure',
    hint: 'Hook to resolution, plotted backwards',
    body: `# Outline

## 1. Hook — the opposite of the ending

## 2. Plot turn one — the call to change

## 3. Pinch one — pressure applied

## 4. Midpoint — from reacting to acting

## 5. Pinch two — the worst of it

## 6. Plot turn two — the missing piece

## 7. Resolution — what the hook became
`
  },
  {
    id: 'freytag',
    name: "Freytag's Pyramid",
    hint: 'The classical five-part shape',
    body: `# Outline

## Exposition

## Rising action

## Climax

## Falling action

## Dénouement
`
  },
  {
    id: 'chapters',
    name: 'Chapter Grid',
    hint: 'One line per chapter',
    body: `# Outline

- Ch 1 —
- Ch 2 —
- Ch 3 —
- Ch 4 —
- Ch 5 —
- Ch 6 —
`
  }
];

export const templateById = (id) =>
  OUTLINE_TEMPLATES.find((t) => t.id === id) || OUTLINE_TEMPLATES[0];
