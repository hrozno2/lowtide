'use strict';

/* Starter documents offered by the Home window. */

const NOVEL = `Title: Untitled Novel
Author:
Draft date: {{date}}

# One

`;

const CHAPTER = `# Chapter One

`;

const OUTLINE = `# Outline

## Act One

- the world as it stands
- the thing that breaks it
- the decision that cannot be taken back

## Act Two

-

## Act Three

-
`;

const SAMPLE = `Title: The Lighthouse Keeper
Author: A. Demo
Draft date: 29 August 2026

# One: The Long Light

The lamp had been burning for ninety-one years when Marta first climbed the stairs to meet it, and in all that time nobody had thought to give it a name.

She counted the steps because her father had counted them, and his mother before him. *One hundred and eighty-two.* The number was a kind of prayer in the family, muttered on the way up and never on the way down.

At the top, the light turned in its slow circle, indifferent as weather.

[[does she already know about the wreck here, or find out in ch.2?]]

***

By morning the fog had come in so thick that the sea was only a rumour. Marta made tea she did not drink and watched the window go from black to grey to a white that hurt to look at.

## The Boat

It appeared at four minutes past eleven — a shape where no shape should be, too low in the water, drifting rather than sailing.

She would remember, later, that her first thought was not _who_ but **how long**.

> There are three rules on the rock. <
> Watch. Wait. Write it down. <

/* I keep going back and forth on whether the rules should appear this early.
   Maybe hold them until the inquest scene. */

She wrote it down.

## What Happens Next

- the boat is empty, but the engine is still warm
- Marta reports it and is not believed
- the inquest turns on the one detail she left out

---

# Two: What the Water Kept

The inquest was held in a village hall that smelled of damp coats and floor polish, and the men who ran it had never in their lives been more than a mile from shore.

They asked her to describe the boat. She described the boat.
`;

function withDate(text) {
  const date = new Date().toLocaleDateString(undefined, {
    day: 'numeric', month: 'long', year: 'numeric'
  });
  return text.replace('{{date}}', date);
}

const TEMPLATES = [
  { id: 'novel', name: 'Novel', hint: 'Title page and a first chapter', body: NOVEL },
  { id: 'chapter', name: 'Chapter', hint: 'A single chapter heading', body: CHAPTER },
  { id: 'outline', name: 'Outline', hint: 'Three acts, ready to fill in', body: OUTLINE },
  { id: 'blank', name: 'Blank', hint: 'Nothing at all', body: '' }
];

const SAMPLES = [
  { id: 'lighthouse', name: 'The Lighthouse Keeper',
    hint: 'Shows every piece of markup', body: SAMPLE }
];

function templateBody(id) {
  const found = TEMPLATES.find((t) => t.id === id) || SAMPLES.find((s) => s.id === id);
  return found ? withDate(found.body) : '';
}

module.exports = { TEMPLATES, SAMPLES, templateBody };
