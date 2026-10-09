# Icon prompts for Calico and Ginger

Prompts for ChatGPT image generation, plus what to do with the results. Paste one prompt per generation. Image models drift when asked for several assets at once.

## The idea

One cat, drawn once, used everywhere:

- **Pose:** lying down in profile. The head is on the left, low, with the chin resting down. The body runs to the right. The tail curls around the feet and its tip comes back toward the head, so the whole shape reads as one calm closed loop.
- **Style:** a clean outline and flat color. No inner details at all: no eyes, nose, mouth, whiskers, ear interiors, paw lines, or fur strokes. Color is the only variation inside the shape.
- **Calico:** three color regions from left to right, meeting along organic, wavy, feathered edges like fur growing across a boundary, not a smooth gradient. Pale warm sand (`#e3c898`) at the head, amber orange (`#e2a23a`) through the middle, near-black (`#2a2d24`) at the rump and tail. The amber, near-black, and outline cream (`#efe7d6`) are the app's own palette. The sand is a little darker than the outline on purpose, so the outline still reads against the head.
- **Ginger:** the same pose and outline, with an orange tabby coat instead, using the same fur-edged transitions at gentler contrast. Same cat family, different coat, so the two read as a pair.

The shape is deliberately simple. A silhouette that survives at 22 pixels is worth more than a detailed one.

## What the first result taught us

The first Calico attempt (a smooth cream, amber, and near-black gradient) got the pose, the outline, and the empty interior right. Two things to carry forward:

- **Keep the head fill darker than the outline.** With cream fill and a cream outline, the head's edge dissolves. Use a warmer sand for the head, as above.
- **Watch the tail band.** A tail that runs as a thick strip along the bottom can merge with the body at 24 pixels. Ask for a visible gap, or a slightly thinner tail.

## Refining a result you already have

Upload the image you want to keep to the same conversation and send this. It changes only the color transitions and leaves the shape alone.

```text
Keep the cat's silhouette, outline weight, pose, tile, and margins exactly as they
are. Change only the coat.

Replace the smooth gradient with three color regions in the same left-to-right
order: pale warm sand #e3c898 over the head and front, amber orange #e2a23a across
the middle, and near-black #2a2d24 over the rump and tail. Where one color meets
the next, use an organic wavy edge with 3 to 5 soft undulations, feathered over a
narrow soft blend (about 3 to 4 percent of the width), with a few small tapering
tongues of the darker color reaching back into the lighter one in the direction the
fur grows, from the head toward the tail, like fur growing across the boundary. The
two boundaries are not parallel. The edges are soft, not hairy: no individual hair
strokes and no texture lines.

The head fill must be visibly darker than the cream outline so the outline stays
clear against it. Give me 3 variations that differ only in how the two wavy
boundaries are shaped.
```

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

Fill: a calico coat of three color regions in this order from left to right: pale
warm sand #e3c898 over the head and front, amber orange #e2a23a across the middle of
the body, and near-black #2a2d24 over the rump and the tail. Where one color meets
the next, do NOT use a smooth linear gradient and do NOT use a straight line. Each
boundary is an organic wavy edge with 3 to 5 soft undulations, feathered over a
narrow soft blend (about 3 to 4 percent of the width), with a few small tapering
tongues of the darker color reaching back into the lighter one in the direction the
fur grows, from the head toward the tail, like fur growing across the boundary. The
two boundaries are not parallel to each other. The edges are soft, not hairy: no
individual hair strokes and no texture lines.

Give me 3 variations that differ only in how the tail loops around the feet.
```

## 2. Calico art with a removable background

Use this when you want the cat without the tile, for the README banner or a window icon.

```text
[paste the shared style block]

Square image, 1024 by 1024 pixels. Background: one flat solid magenta #ff00ff with
nothing else on it, so it can be removed. The cat is centered with 12 percent margin.

Outline: cream #efe7d6, uniform width about 3 percent of the canvas.

Fill: a calico coat of three color regions in this order from left to right: pale
warm sand #e3c898 over the head and front, amber orange #e2a23a across the middle of
the body, and near-black #2a2d24 over the rump and the tail. Where one color meets
the next, do NOT use a smooth linear gradient and do NOT use a straight line. Each
boundary is an organic wavy edge with 3 to 5 soft undulations, feathered over a
narrow soft blend (about 3 to 4 percent of the width), with a few small tapering
tongues of the darker color reaching back into the lighter one in the direction the
fur grows, from the head toward the tail, like fur growing across the boundary. The
two boundaries are not parallel to each other. The edges are soft, not hairy: no
individual hair strokes and no texture lines.
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

For the kit and the panel's identity. Same cat, same outline, ginger coat. Two of its colors, apricot `#f2c98f` and burnt orange `#b8741a`, are for the Ginger coat only and are not in DESIGN.md's UI palette.

```text
[paste the shared style block]

Create a square icon, 1024 by 1024 pixels.

Background: a solid rounded-square tile in very dark olive #14160f, corners rounded
about 22 percent. The cat is centered with 14 percent empty margin on every side.

Outline: cream #efe7d6, uniform width about 3 percent of the canvas.

Fill: a ginger tabby coat of three color regions in this order from left to right:
light apricot #f2c98f over the head and front, amber orange #e2a23a across the middle
of the body, and deeper burnt orange #b8741a over the rump and the tail. Where one
color meets the next, do NOT use a smooth linear gradient and do NOT use a straight
line. Each boundary is an organic wavy edge with 3 to 5 soft undulations, feathered
over a narrow soft blend (about 3 to 4 percent of the width), with a few small
tapering tongues of the darker color reaching back into the lighter one in the
direction the fur grows, from the head toward the tail. The two boundaries are not
parallel. The contrast between regions is gentler than on the calico. The edges are
soft, not hairy: no individual hair strokes, no stripes, and no texture lines.

The pose, outline, and proportions must match the calico icon exactly, so the two
read as a pair.

Give me 3 variations that differ only in how the tail loops around the feet.
```

To keep Ginger consistent with the Calico icon, finish the Calico one first and upload it with this prompt: "Match the pose, outline weight, proportions, and margins of this image exactly. Only change the coat to ginger."

## 5. Ginger splash for the panel (480 by 480)

The panel is a 480 by 480 AMOLED. Its outer edge is a 24 pixel case line (a 16 pixel bezel plus an 8 pixel lip), and the UI background is `#0c0e09`. Pure near-black saves power and burn-in on AMOLED.

```text
[paste the shared style block]

Square image, 480 by 480 pixels. Background: flat solid #0c0e09 with nothing else.
The cat is centered and fits inside a 360 pixel wide area, leaving at least 60
pixels of empty space on every side.

Outline: cream #efe7d6, uniform width about 3 percent of the canvas.

Fill: a ginger tabby coat of three color regions in this order from left to right:
light apricot #f2c98f over the head and front, amber orange #e2a23a across the middle
of the body, and deeper burnt orange #b8741a over the rump and the tail. Where one
color meets the next, do NOT use a smooth linear gradient and do NOT use a straight
line. Each boundary is an organic wavy edge with 3 to 5 soft undulations, feathered
over a narrow soft blend (about 3 to 4 percent of the width), with a few small
tapering tongues of the darker color reaching back into the lighter one in the
direction the fur grows, from the head toward the tail. The two boundaries are not
parallel. The contrast between regions is gentler than on the calico. The edges are
soft, not hairy: no individual hair strokes, no stripes, and no texture lines.
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

Remove the magenta background, trim, shrink to 75 percent so the cat keeps a 12 percent margin, and square it up:

```bash
magick generated.png -fuzz 12% -transparent '#ff00ff' -trim +repage \
  -resize 768x768 -background none -gravity center -extent 1024x1024 cat.png
```

If a pink fringe is left on the edge, raise `-fuzz` a little (try 18%) and run it again. Avoid a green key, since the Ginger and Calico palettes both sit near warm olive.

Make the sizes and preview how they actually look small:

```bash
magick cat.png -resize 512x512 resources/icon.png        # app icon (at least 512 by 512 for Linux; 1024 also works)
python3 -I docs/branding/ginger-idle-anim/build_tray.py   # tray icon, 64 px, from the idle cat line art
for s in 16 22 24 32 48; do magick cat.png -resize ${s}x${s} -filter point -scale 800% preview-$s.png; done
```

Check the palette landed close to the tokens by sampling known points: the head, the middle of the body, and the tail. They should be near cream `#efe7d6`, amber `#e2a23a`, and near-black `#2a2d24` for Calico:

```bash
magick resources/icon.png -format '%[hex:p{150,300}] %[hex:p{256,300}] %[hex:p{360,300}]\n' info:
```

Then check how the real thing looks:

- Rebuild, and look at the tray on both a light and a dark panel. A cream cat with a dark outline works on both.
- Look at the window and the installer icon after `pnpm dist`.
- If the icon works in dark mode but vanishes on a light launcher, add a thin dark outer edge, or switch to the tile version.

## Names and marks

- The cat has no Grok, xAI, Anthropic, or other company marks in it, on purpose. "Ginger" is the Grok kit's name inside this project, not a brand claim.
- Keep any generated art you commit free of a visible signature or watermark.
