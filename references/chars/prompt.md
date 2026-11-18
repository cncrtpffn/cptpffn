# Prompts for character generation (NickliesCat style)

Prompts are in English: image generators handle it better.
Structure: **STYLE** (always the same) + **CHARACTER** (swappable) + **VIEW** (how to frame it) + **NEGATIVE**.
For exact proportions add the block from [style-geometry.md](style-geometry.md) §8 after STYLE.
Attach 2–3 images from this folder as style references (`soldier_front.png`, `fedora_front.png`, `dog_sunglasses.png`) when the tool supports it.

## STYLE (base block)

```
Cute minimalist 3D cartoon character in the style of a stylized indie game, rendered like a soft toon-shaded 3D model.
The character is built from exactly 4 separate simple objects, each with its own outline:
1) HEAD: a separate round ball (slightly flattened sphere), skin-colored, carrying the face, any beard and the headwear. It sits on top of the body, slightly sunk into the collar, with no neck.
2) BODY: a separate rounded capsule / jelly-bean shape, wider at the bottom, made entirely of clothing. No skin, no legs, no arms.
3-4) HANDS: two small skin-colored spheres floating beside the body, not connected to anything.
There is a clear visible seam/outline between head and body: they are two distinct shapes, never merged into one.
Face is extremely simple: two small solid black dot eyes, no nose, usually no mouth.
Skin is warm light tan/beige. Clothing details are painted onto the body capsule: collar, buttons, seams, pockets.
Thick, uniform black outline around every object (inverted-hull toon outline), soft cel shading with a gentle gradient, slight ambient occlusion, matte materials.
Head is about 0.6-0.7 of the body width; total height is about 2 head heights.
```

## CHARACTER (variants)

Main one, for the boat cockpit:
```
A sailor: bright red chunky knit beanie with a folded ribbed cuff, sitting snugly on top of the round head ball. Navy-blue double-breasted pea coat (naval peacoat) forming the body capsule, with wide notched lapels and two vertical rows of brass buttons. The coat is open at the chest in a deep V, showing a Russian naval striped undershirt (telnyashka) underneath with bold, wide horizontal stripes: navy-blue and white, stripes thick and few (about 4-5 visible), clearly readable from a distance.
```

Optional beard (add to the sailor if wanted):
```
A short, thick, rounded dark-brown beard covering the lower half of the head ball, as a simple smooth shape with its own outline, part of the head object.
```

From the video (for reference/checking the style):
```
A soldier: dark charcoal rounded steel helmet with a small brim, brown field jacket with collar and buttons.
```
```
An explorer: brown fedora with a dark band, beige trench jacket with collar and buttons.
```
```
A dog: tan round head ball with floppy ears, red short-sleeve button shirt, optional pixel-art black "deal with it" sunglasses.
```

## VIEW

Single hero image:
```
Full body, three-quarter front view, slightly elevated camera, neutral plain light-grey background, soft studio lighting from top-left, centered, no props.
```

Turnaround sheet for 3D modeling:
```
Character turnaround model sheet: front, 3/4 front, side, back views, head ball and body capsule clearly separate in every view, same scale, aligned on one horizontal baseline, orthographic-like camera, flat neutral grey background, even lighting, no perspective distortion.
```

Poses for the cockpit (seated, hand on tiller):
```
Character sitting on a low bench, body leaning slightly, one floating hand resting on an invisible tiller to the side, the other hand near the knee level. Side and 3/4 views.
```

Expression sheet:
```
Expression sheet of the same character: neutral dot eyes, closed eyes (two short curved lines), squint / wink (one eye as a line), surprised (bigger dots), smug half-closed eyes. Head and upper body only, grid of 5.
```

## NEGATIVE

```
realistic, anime, human anatomy, head merged with body, single-piece body, legs, feet, arms, elbows, fingers, neck, nose, detailed mouth, teeth, eyebrows, hair strands, 2D flat vector, pixel art (except sunglasses), thin lines, sketch, text, watermark, logo, busy background, multiple characters
```

## Ready-made prompt for Gemini / ChatGPT (sailor)

These tools work best with plain descriptive prose, not tag lists, and with "do not" sentences instead of a negative prompt.
Attach 2-3 reference crops (`soldier_front.png`, `fedora_front.png`, `soldier_three_quarter.png`) and start with "Match the art style of the attached images".
Ask for one image at a time; for the turnaround, generate the hero shot first, then ask "now make a turnaround sheet of this exact character".

Hero shot:
```
Match the art style of the attached reference images exactly.

Create a single cute minimalist 3D cartoon character, rendered like a soft toon-shaded game model. The character is built from exactly four separate simple objects, like a toy:
1. The head: a separate round, skin-colored ball. It holds the face and the hat. It rests on top of the body, slightly sunk into the collar, with no neck.
2. The body: a separate rounded capsule, like a jelly bean, wider at the bottom, made only of clothing. No arms, no legs.
3 and 4. The hands: two small skin-colored balls floating on either side of the body, not attached to anything.
The head and the body must be two clearly distinct shapes with a visible outline between them, exactly like in the reference images. They must never merge into one continuous shape.
The face is extremely simple: just two small solid black dot eyes, no nose, no mouth, no eyebrows. Skin is warm light tan. Every object has a thick, even black outline, with soft cel shading, a gentle gradient and matte materials. The head is about two thirds as wide as the body.

The character is a sailor. On his head ball he wears a bright red chunky knit beanie with a folded ribbed cuff. The body capsule is his navy-blue double-breasted pea coat, with wide notched lapels and two vertical rows of brass buttons. The coat is open at the chest in a deep V, showing a striped naval undershirt (Russian telnyashka) with bold, wide horizontal navy-blue and white stripes: only 4-5 thick stripes are visible, so they read clearly from far away.

Full body, three-quarter front view, camera slightly above, centered, on a plain light-grey background with soft studio light from the top left.

Do not merge the head and body into one shape. Do not add arms, legs, fingers, a neck, a nose, a mouth or hair. Do not make it realistic, anime or flat 2D vector. No text, no watermark, no props, only one character.
```

Turnaround (follow-up message in the same chat):
```
Now make a character turnaround model sheet of this exact same sailor: front, three-quarter front, side and back views, same scale, standing on one horizontal baseline, flat neutral grey background, even lighting, same style, outlines and colors. Keep the four separate parts (head ball, body capsule, two hand balls) clearly visible in every view, and keep the red knit beanie, the open navy pea coat with brass buttons and the wide-striped telnyashka identical in every view.
```

Cockpit pose (follow-up):
```
Now show the same sailor sitting on a low bench, leaning slightly back, one floating hand resting on an invisible tiller at his side, the other hand near his lap. Side view and three-quarter view, same style.
```
