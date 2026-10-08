# Icon prompts for Calico and Ginger

Prompts for ChatGPT image generation, plus what to do with the results. Paste one prompt per generation. Image models drift when asked for several assets at once.

## The idea

One cat, drawn once, used everywhere:

- **Pose:** lying down in profile. The head is on the left, low, with the chin resting down. The body runs to the right. The tail curls around the feet and its tip comes back toward the head, so the whole shape reads as one calm closed loop.
- **Style:** a clean outline and flat color. No inner details at all: no eyes, nose, mouth, whiskers, ear interiors, paw lines, or fur strokes. Color is the only variation inside the shape.
- **Calico:** a smooth left-to-right color blend, built from the app's own palette so it matches the UI. Warm white (cream `#efe7d6`) at the head, amber orange (`#e2a23a`) through the middle, near-black (`#2a2d24`) at the rump and tail.
- **Ginger:** the same pose and outline, with a solid orange tabby coat instead. Same cat family, different coat, so the two read as a pair.

The shape is deliberately simple. A silhouette that survives at 22 pixels is worth more than a detailed one.

## How to get good results

- **One asset per prompt.** Start from the master prompt, not from a blank chat.
- **Colors drift.** The model treats hex codes as hints. Generate, then sample the result with an eyedropper and correct it in post.
- **Transparent backgrounds are unreliable in the ChatGPT app.** It often draws a fake checkerboard. Ask for a flat magenta `#ff00ff` background instead and remove it afterwards (commands below).
- **Ask for variations.** End with "Give me 3 variations that differ only in how the tail loops." Pick the strongest, then refine that one.
- **Refine by naming what stays.** "Keep the pose, outline, and colors exactly. Change only X."
- **Silhouette test.** Fill the cat solid black in your head. If it no longer reads as a lying cat with a looped tail, the shape is too fussy. Ask for fewer curves.

## Shared style block

Paste this at the start of every prompt.

```text
Flat vector-style icon illustration of a single cat, drawn as one clean silhouette
with a uniform-width outline and flat color fill. No inner details of any kind: no
eyes, nose, mouth, whiskers, ear interiors, paw lines, or fur strokes. Color is the
only variation inside the shape. No text, letters, logos, or watermark. No drop
shadow, no 3D shading, no texture, no background scene, no props. Smooth simple
curves with as few as possible, as if cut from one piece of paper. It must stay
readable when shrunk to 32 pixels.

The cat lies down in profile, seen from the side. Its head is on the LEFT, held low
with the chin resting near the ground. The body stretches to the right in a relaxed
rounded line. The tail curls around the feet and its tip comes back toward the head
on the left, so the whole shape reads as one calm closed loop.
```

## 1. Calico app icon (1024 by 1024)

Becomes `resources/icon.png`.

```text
[paste the shared style block]

Create a square app icon, 1024 by 1024 pixels.

Background: a solid rounded-square tile in very dark olive #14160f, corners rounded
about 22 percent. The cat is centered with 14 percent empty margin on every side.

Outline: cream #efe7d6, uniform width about 3 percent of the canvas.

Fill: a calico coat as ONE smooth horizontal gradient from left to right. Warm white
#efe7d6 at the head, blending through amber orange #e2a23a across the middle of the
body, and ending in near-black #2a2d24 at the rump and the tail. The blend is soft
and gradual with no hard patch edges.

Give me 3 variations that differ only in how the tail loops around the feet.
```

If you want a variation with real calico patches instead of a pure gradient, add: "Instead of one gradient, use 3 large soft-edged patches in the same order and colors, with generous blending where they meet."

## 2. Calico art with a removable background

Use this when you want the cat without the tile, for the README banner or a window icon.

```text
[paste the shared style block]

Square image, 1024 by 1024 pixels. Background: one flat solid magenta #ff00ff with
nothing else on it, so it can be removed. The cat is centered with 12 percent margin.

Outline: cream #efe7d6, uniform width about 3 percent of the canvas.

Fill: calico coat as one smooth horizontal gradient from left to right: warm white
#efe7d6 at the head, amber orange #e2a23a in the middle, near-black #2a2d24 at the
rump and tail. Soft gradual blend, no hard patch edges.
```

## 3. Tray icon (becomes `resources/tray.png`, shown at about 22 to 24 pixels)

Do not expect a gradient to survive at 22 pixels. Make a one-color pictogram.

```text
[paste the shared style block]

Square image, 256 by 256 pixels. Background: flat solid magenta #ff00ff.

This is a tray pictogram, so keep it bold. The cat is a single flat solid cream
#efe7d6 shape with a thin dark outline #0c0e09. NO gradient and no second color
inside. Thicken the tail and the legs slightly, and leave a clearly visible gap
between the tail loop and the body so the loop still reads at 22 pixels. The cat
fills about 90 percent of the width.
```

You can also derive the tray icon from the main art instead of generating it. Make the master cat solid cream with a dark outline in an image editor, then shrink it. Generated art is more consistent with the main icon, and derived art is usually crisper.

## 4. Ginger icon (1024 by 1024)

For the kit and the panel's identity. Same cat, same outline, ginger coat.

```text
[paste the shared style block]

Create a square icon, 1024 by 1024 pixels.

Background: a solid rounded-square tile in very dark olive #14160f, corners rounded
about 22 percent. The cat is centered with 14 percent empty margin on every side.

Outline: cream #efe7d6, uniform width about 3 percent of the canvas.

Fill: a solid ginger tabby coat as ONE smooth horizontal gradient from left to right.
Light apricot #f2c98f at the head, amber orange #e2a23a through the middle, and a
deeper burnt orange #b8741a at the rump and the tail. No stripes, no patches, no
inner details. Soft gradual blend.

The pose, outline, and proportions must match the calico icon exactly, so the two
read as a pair.

Give me 3 variations that differ only in how the tail loops around the feet.
```

To keep Ginger consistent with the Calico icon, finish the Calico one first and upload it with this prompt: "Match the pose, outline weight, proportions, and margins of this image exactly. Only change the coat to ginger."

## 5. Ginger splash for the panel (480 by 480)

The panel is a 480 by 480 AMOLED with a 24 pixel case line, and the UI background is `#0c0e09`. Pure near-black saves power and burn-in on AMOLED.

```text
[paste the shared style block]

Square image, 480 by 480 pixels. Background: flat solid #0c0e09 with nothing else.
The cat is centered and fits inside a 360 pixel wide area, leaving at least 60
pixels of empty space on every side.

Outline: cream #efe7d6, uniform width about 3 percent of the canvas.

Fill: ginger tabby coat as one smooth horizontal gradient from left to right: light
apricot #f2c98f at the head, amber orange #e2a23a in the middle, burnt orange
#b8741a at the rump and tail. Soft gradual blend, no inner details.
```

## Checks before you accept a result

- The head is on the left and low, and the tail tip returns toward the head.
- No eyes, nose, whiskers, or inner lines anywhere.
- The color runs left to right in the right order, with no hard edges.
- Shrink it to 32 and then 24 pixels. It still reads as a lying cat.
- No text, signature, or watermark in any corner.
- The outline weight matches the other icons.

## Post-processing

These commands use ImageMagick (`magick`). Work from a copy, not the original.

Remove the magenta background, trim, and square it up:

```bash
magick generated.png -fuzz 12% -transparent '#ff00ff' -trim +repage \
  -background none -gravity center -extent 1024x1024 cat.png
```

If a pink fringe is left on the edge, raise `-fuzz` a little, or run `-channel A -morphology Erode Disk:1`.

Make the sizes and preview how they actually look small:

```bash
magick cat.png -resize 512x512 resources/icon.png        # app icon (electron-builder wants 512 or more)
magick tray.png -resize 32x32 resources/tray.png         # tray icon
for s in 16 22 24 32 48; do magick cat.png -resize ${s}x${s} -filter point -scale 800% preview-$s.png; done
```

Check the palette landed close to the tokens:

```bash
magick icon.png -colors 6 -unique-colors -scale 80x80 palette.png
```

Then check how the real thing looks:

- Rebuild, and look at the tray on both a light and a dark panel. A cream cat with a dark outline works on both.
- Look at the window and the installer icon after `pnpm dist`.
- If the icon works in dark mode but vanishes on a light launcher, add a thin dark outer edge, or switch to the tile version.

## Names and marks

- The cat has no Grok, xAI, Anthropic, or other company marks in it, on purpose. "Ginger" is the Grok kit's name inside this project, not a brand claim.
- Keep any generated art you commit free of a visible signature or watermark.
