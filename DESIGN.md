# Voxandra Design System

## Visual thesis

Voxandra should feel like an exact, calm operator sitting beside a multilingual business call. The public site pairs editorial typography with precise product UI. The call-to-reviewed-record sequence is the one memorable visual moment; everything around it stays quiet.

## Type

- Geist is the body, navigation, control, and product-interface face.
- Newsreader is the editorial display face. Use it selectively for meaningful phrases in major headings, never for UI controls or long body copy.
- Body text starts at 16px with generous line height. Metadata may use 12–14px.
- Headlines use compact leading and natural sentence case. Give the hero’s sans-serif and editorial phrases an explicit 16–20px gap; their different font metrics must not collide. Keep 28–32px between the headline, body copy and primary action. Eyebrows are rare, short, and use the shared `landing-eyebrow` style.

## Color

- Page background: `#faf8f4`
- Warm opening surface: `#fffaf4`
- Primary ink: `#171511`
- Muted text: `#68635c`
- Structural line: `#ded8ce`
- Brand purple: `#3b1676`
- Brand violet: `#7c3aed`
- Soft violet: `#f3effb`
- Success green: `#16a34a`; reserve green for real availability, confirmation, and pricing status.

Use gradients only to create shallow depth around the primary product story. Do not make decorative gradients a section motif.

## Spacing and layout

- Main narrative width: `max-w-7xl`; the hero uses the same width for a balanced headline and compact dialer. Align both desktop columns at the top; use a 72–88px fluid desktop headline with deliberate phrase breaks rather than vertically centering it beside the taller product example.
- Standard horizontal padding: 20px mobile, 32px tablet and desktop.
- Standard section spacing uses `--landing-section-space`, approximately 72–120px.
- Keep body copy between 32rem and 44rem wide. Avoid long centered paragraphs.
- Mobile is one continuous reading order. Below 1024px, How it works uses one expanded step with a compact demo directly beneath its heading; visitors tap a heading or use Next to progress. Keep the CTA after the steps, respect reduced motion, and never duplicate a full product mockup for every explanation. Desktop retains its scroll-directed presentation.

## Components

- Primary button: compact rectangular shape, 8px radius, deep purple fill, white text. One primary CTA label: `Start a translated call`.
- Secondary action: text link or quiet outlined control. Do not give secondary actions primary-button weight.
- Cards represent a real grouped object such as a plan, a Call Record, or a workflow lane. Supporting facts use rules, columns, or plain rows. Pricing cards compare price, seats and usage; show shared features once below the cards. Keep included minutes and overage rates visible, align checkout controls, and use quiet rows for Enterprise and Calls only.
- Default surface radius: 16px. Reserve 24–28px radii and the focus shadow for the main product story and final CTA.
- Use Lucide icons only when they improve scanning or convey status. Do not put every icon in a colored rounded square.
- Keep photography tied to a business use: the goods, deals and cases lanes use a coordinated warm editorial set, with landscape crops on desktop and compact square thumbnails on mobile. Avoid standalone decorative photo sections. Its compact hero pairs number entry with a labeled translation, private Guidance, and pending-review Call Record example. On mobile these stack without a horizontal rail. Generated scenes are illustrative, not customer testimonials; prompts and asset provenance live in `docs/landing-imagery.md`.

## Motion

- One scroll-directed motion sequence per page: the four-stage call-to-record story. Never advance it on a timer.
- Hover and press feedback may respond to direct interaction.
- Do not animate every section on scroll.
- `prefers-reduced-motion` must show a complete, useful static state without autoplay.

## Never do

- No purple fog as the main idea, glassmorphism, neon accents, or generic dark SaaS treatment.
- No repeated grids of identical white cards when rules or plain rows communicate the hierarchy better.
- No numbered steps unless they describe a real sequence.
- No pill for ordinary prose, no badge without a state, and no shadow on every container.
- No isolated italic accent word chosen only for decoration; the editorial phrase must carry actual meaning.
- No autoplay reveal on every section, bouncing icons, or ornamental motion.
- No raw model names, provider diagnostics, invented proof, or unapproved product claims.
