# Landing business imagery

The three business-lane photos were created October 5, 2026 with the built-in image_gen tool through the imagegen skill. The closing CTA variant below uses the Higgsfield CLI. These are generated illustrative workplace scenes, not customer portraits or testimonials.

## Placement

A coordinated three-photo set replaces the plain business-use rows below the walkthrough. Landscape images accompany the goods/deals/cases headings on desktop; compact square thumbnails keep mobile readable. The product-led hero stays unchanged. Warm natural light, tactile workplaces and restrained purple accents match the cream/purple page.

## Final project assets

- `public/landing/business/moving-goods-v1.webp`
- `public/landing/business/moving-deals-v1.webp`
- `public/landing/business/moving-cases-v1.webp`

All three generated originals are 1536×1024. Project derivatives are 1200×800 WebP, quality 82, served through Next Image with explicit dimensions, responsive sizes and default lazy loading. No generated text or interface is used.

## Exact generation prompts

### moving-goods-v1

```text
Use case: photorealistic-natural
Asset type: editorial business photography for the Voxandra multilingual business-call website, one of a cohesive set of three.
Style/medium: photorealistic candid documentary magazine photography, warm daylight, cream and stone neutrals with one understated deep-purple accent. Real skin texture, natural expression, tactile materials and believable ordinary workplace details. Premium but human, not a posed stock-photo advertisement.
Composition: landscape 3:2 photograph, medium environmental portrait; the subject and essential action in the central 70% so it crops gracefully to a 16:10 card and a square thumbnail. Clear focal point at small website sizes.
Constraints: one person only; anatomically natural hands and face; no typography, captions, logos, watermarks, readable private documents, flags, floating UI, holograms or visible app interface. Laptop screen faces the person, not the viewer. No looking at camera, exaggerated smile, handshake, smartphone held to the ear, or sci-fi effects.
Scene/backdrop: a small bright shipping office beside a working warehouse, neatly stacked unbranded cartons and shelving softly visible through an interior window.
Subject: a woman in her late thirties coordinating an overseas supplier call from an open laptop, wearing a discreet lightweight headset with boom mic. She studies a plain delivery sheet on the desk with a pen resting naturally in one hand. Practical cream cotton shirt, dark trousers; a deep aubergine notebook supplies the subtle brand accent. Intent, composed expression, a real moment of getting a shipment unstuck.
Lighting: soft side window daylight, gentle warm highlights, restrained contrast, fine photographic grain.
```

### moving-deals-v1

```text
Use case: photorealistic-natural
Asset type: editorial business photography for the Voxandra multilingual business-call website, one of a cohesive set of three.
Style/medium: photorealistic candid documentary magazine photography, warm daylight, cream and stone neutrals with one understated deep-purple accent. Real skin texture, natural expression, tactile materials and believable ordinary workplace details. Premium but human, not a posed stock-photo advertisement.
Composition: landscape 3:2 photograph, medium environmental portrait; the subject and essential action in the central 70% so it crops gracefully to a 16:10 card and a square thumbnail. Clear focal point at small website sizes.
Constraints: one person only; anatomically natural hands and face; no typography, captions, logos, watermarks, readable private documents, flags, floating UI, holograms or visible app interface. Laptop screen faces the person, not the viewer. No looking at camera, exaggerated smile, handshake, smartphone held to the ear, or sci-fi effects.
Scene/backdrop: a modest contemporary materials showroom / independent export business studio, oak worktable, linen samples and simple ceramic product samples, warm plaster wall and softly blurred shelving.
Subject: a man in his early forties with medium brown skin and short dark hair, wearing an understated plum knit polo and a discreet lightweight headset with boom mic, engaged in a business call through his open laptop. One hand rests comfortably on the table beside a material sample; his expression is engaged and quietly optimistic while listening to an overseas customer. A convincing working environment, not a luxury lifestyle scene.
Lighting: soft bright afternoon daylight, warm natural shadows, restrained contrast, fine photographic grain.
```

### moving-cases-v1

```text
Use case: photorealistic-natural
Asset type: editorial business photography for the Voxandra multilingual business-call website, one of a cohesive set of three.
Style/medium: photorealistic candid documentary magazine photography, warm daylight, cream and stone neutrals with one understated deep-purple accent. Real skin texture, natural expression, tactile materials and believable ordinary workplace details. Premium but human, not a posed stock-photo advertisement.
Composition: landscape 3:2 photograph, medium environmental portrait; the subject and essential action in the central 70% so it crops gracefully to a 16:10 card and a square thumbnail. Clear focal point at small website sizes.
Constraints: one person only; anatomically natural hands and face; no typography, captions, logos, watermarks, readable private documents, flags, floating UI, holograms or visible app interface. Laptop screen faces the person, not the viewer. No looking at camera, exaggerated smile, handshake, smartphone held to the ear, or sci-fi effects.
Scene/backdrop: a calm independent professional-services office with a pale wooden desk, a few closed paper folders and a warm textured wall, no legal emblems or identifiable documents.
Subject: a woman in her early fifties with short dark curly hair and thin-framed glasses, wearing a cream blouse and a discreet lightweight headset with boom mic while coordinating a case over a laptop call. She checks a plain paper checklist beside the laptop, gently holding a pen; a closed muted-purple folder sits nearby. Attentive, reassuring, capable expression, not smiling at camera. Show the everyday work of clarifying details and following through.
Lighting: soft side daylight, warm but realistic skin tones, restrained contrast, fine photographic grain.
```


## Closing CTA photo

The closing CTA restores the existing `public/final-cta-live-call-v1.png` illustration: a business owner using a laptop and headset at her desk. No new image generation was used for this restoration. The original asset's generation prompt is not recorded here.

The initial restoration used `public/landing/business/final-cta-live-call-v1.webp`, a 1200px-wide WebP derivative at quality 82. Next Image supplied responsive sizes and lazy loading, with a 5:4 desktop crop and a compact 16:9 phone crop. The flag-framed variant below supersedes this presentation; both originals remain available. The scene is illustrative, not a customer portrait or testimonial.

## International flag frame for the closing CTA

The closing CTA now shows a variant of `public/final-cta-live-call-v1.png` framed on all four edges by a ribbon of small national flags, generated as an image edit through the Higgsfield CLI (v1.1.23, model `gpt_image_2`, 4:3, 2k, high quality; job `d81cb24a-73ff-4830-b3ab-adbbb44ffe0f`, 6.5 credits). The 2336×1744 result is preserved at `tmp/higgsfield/final-cta-flags-v2-original.png`. One malformed bottom-row tile (a US/UK hybrid) was mechanically replaced with an intact Japan flag tile copied from the same generated image; the corrected full-res file is `tmp/higgsfield/final-cta-flags-v2-corrected.png`. The shipped asset is `public/landing/business/final-cta-international-flags-v2.webp`, resized without cropping to 1600×1195 at WebP quality 88.

The page preserves the image's intrinsic aspect ratio (`h-auto w-full`) so all four sides of the flag frame remain visible. At Carlos's request, it now matches the closing section's original rounded styling: `rounded-2xl` on smaller screens and `lg:rounded-3xl` on desktop. CSS rounds only the outer corners. The flags provide illustrative international context; they are not a language-coverage legend. Generation prompt:

```text
Edit the supplied reference photograph for the closing section of the Voxandra multilingual business-call website. Create a 4:3 landscape image with a complete international flag border around ALL FOUR EDGES.

Preserve the reference photograph's woman, her identity and natural face, cream shirt, black telephone headset with boom microphone, open laptop, hands, wooden desk, notebook, warm daylight and real office surroundings. Keep the same candid business-call moment and warm photographic color. Fit this recognizable photo neatly inside the new frame; do not cover her face, headset, hands or laptop with flags. Do not add people or change her pose.

The outer frame is a single orderly ribbon of small, crisp rectangular national flags, running continuously along the top, bottom, left AND right edges. All four sides must clearly show actual complete flags, not abstract multicolored stripes. The tiles sit upright, edge to edge with only fine warm-white dividers. Repeat a few flags if needed to complete the frame. Use recognizable accurate national flag designs representing international business across regions: United States, Canada, Mexico, Brazil, United Kingdom, Portugal, Spain, France, Germany, Italy, Netherlands, Sweden, Poland, Ukraine, India, China, Japan, South Korea, Indonesia and South Africa. Preserve each flag's correct colors, symbol placement and orientation; no invented flags.

Keep the border restrained, approximately 6 percent of the total image width on each side, so the human photograph is still the main subject. Add a narrow warm-ivory inner keyline between the flag ribbon and the photograph. Make this look like a carefully art-directed photographic print with a flat flag-tile frame, not a travel advertisement. Rectangular 4:3 canvas with square corners, all corners and the entire flag frame visible, with no cropping of the outside edges. No text, country names, logos, watermark, floating interface, flagpoles, loose flags over the photo, bunting, 3D bevels, heavy shadows or extra decorative objects. Deliver a finished raster image, not a mockup placed inside another scene.
```
