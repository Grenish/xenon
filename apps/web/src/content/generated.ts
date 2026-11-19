export type Generated = {
  file: string;
  mobile?: string;
  alt: string;
  title: string;
  width: number;
  height: number;
  model: string;
  prompt: string;
  notes: string;
};

// The source PNGs identify ChatGPT and gpt-image in their content credentials.
const model = "OpenAI ChatGPT (gpt-image)";
const sharedPrompt =
  "Create an original, generic scientific illustration with the realism of a quiet macro laboratory photograph, no source image or identifiable event. True near-black backdrop (#000000 to #0c0d0f), transparent real glass, realistic electrode construction, shallow depth of field, light emitted by the gas itself. Main glow blue-white with a restrained teal #5fb4c8 falloff, violet at most a faint fringe unless a gas color below specifically calls for it. No CGI sheen, lens flare streaks, smoke, particles, people, UI, branding, watermarks or writing.";

const mobilePrompt =
  `${sharedPrompt} Portrait mobile treatment of one horizontal xenon spectral discharge tube. Straight symmetrical glass tube with two wider end chambers, a thinner center capillary, and one credible metal electrode enclosed at each end. Restrained blue-white and teal glow emerges along its length, with soft localized halos near electrodes. Portrait 4:5, intended for a 1200 by 1500 export. The top 45 percent stays completely empty, uniform pure black. Place the tube horizontally across about 82 percent of the width, in the lower half at 67 percent of frame height. Keep both ends fully visible. Leave dark breathing room below the tube. No text. Frame the sealed glass tips and all metal ends entirely inside a central box from x=12% to x=88%. Use only capped glass outer tips, with no cords or protruding rods. This is a wide object in a portrait canvas with clear black margins on all sides. Use no floor or vignette.`;

export const generated: readonly Generated[] = [
  {
    file: "/generated/xenon-tube.webp",
    mobile: "/generated/xenon-tube-mobile.webp",
    alt: "A long blue-white discharge glows through a horizontal glass tube with a narrow middle and an electrode at each end.",
    title: "Xenon discharge tube",
    width: 2400,
    height: 1600,
    model,
    prompt:
      `${sharedPrompt} One long straight horizontal glass xenon gas-discharge tube with symmetrical wider end chambers, an elegantly narrow glass capillary in the middle, and exactly one credible metal electrode housed at each end. A luminous blue-white filament continues along the central capillary, with soft localized halos near the electrodes. Wide landscape 3:2, intended for a 2400 by 1600 full-bleed image. The top 40 percent must be completely empty pure black, especially the top-left, for an external heading. Center the tube horizontally with tips inset by 10 percent on either side, and center it vertically at 60 percent of the frame. Keep all glow inside the 45–75 percent vertical band. A single complete object. No text.\n\nMobile render:\n${mobilePrompt}`,
    notes:
      "Desktop tube centered near 62% of the frame height, with a dark field above it for copy. The separate 1200 × 1500 mobile rendering places both end caps in the lower half.",
  },
  {
    file: "/generated/noble-gas-tubes.webp",
    alt: "Five upright glass tubes glow peach-pink, orange-red, violet-blue, cool white and blue-white from left to right.",
    title: "Five noble gas discharge tubes",
    width: 2400,
    height: 1600,
    model,
    prompt:
      `${sharedPrompt} An orderly, precise lineup of exactly five separate slim vertical glass discharge tubes at equal height and five equal horizontal spacings, completely visible. From left to right, first helium pale peach-pink, second neon orange-red, third argon slightly muted violet-blue, fourth krypton cool white, fifth xenon blue-white with faint teal. Each tube has one clear slender illuminated capillary and a subtle pair of metal end electrodes, all alike in proportions. Perfectly orthographic front view, well-defined separation, no additional apparatus, no reflections on the background. 3:2 landscape for a 2400 by 1600 export. The five colors are the only visual identifiers: absolutely no letters, labels, numbers or text.`,
    notes:
      "The five tubes illustrate helium, neon, argon, krypton and xenon, in that order.",
  },
  {
    file: "/generated/xenon-arc-lamp.webp",
    alt: "A pinpoint of blue-white light glows between two metal electrodes inside a clear quartz bulb.",
    title: "Xenon short-arc lamp",
    width: 2400,
    height: 1600,
    model,
    prompt:
      `${sharedPrompt} Show one unbranded generic cinema-projector xenon short-arc lamp in operation. A single clear ovoid quartz bulb, with sealed diametrically opposite stems, contains exactly two heavy machined tungsten electrodes opposing each other on the same axis, visually separate and almost touching. The larger blunt anode and the pointed cathode face across a tiny clean gap where one intense pinpoint of blue-white arc light forms, delicately lighting the interior glass. No long electric beam or lightning. Show the full bulb in three-quarter view, axis running from lower left to upper right, with restrained, realistic highlights against a black field. 3:2 landscape for a 2400 by 1600 export. No text.`,
    notes:
      "Three-quarter macro view of a generic projector bulb. The glass envelope is fully visible, with the outer stems extending beyond the image edges.",
  },
  {
    file: "/generated/xe-tube.webp",
    alt: "Blue-white glass tubes form a capital X and lowercase e on black.",
    title: "Xe in glass tubes",
    width: 1600,
    height: 2000,
    model,
    prompt:
      `${sharedPrompt} A physical glass discharge sign made of hand-bent transparent glass, showing exactly the two characters "Xe": a capital Latin X followed by a clearly lowercase Latin e, nothing before or after. Use two simple crossing diagonal lengths of tubing for the X and one rounded, single-storey lowercase e with a horizontal crossbar and unmistakable open right side. Two letters side by side, recognizable at a glance, slightly hand-made with realistic subtle electrode fittings. View straight on. The glowing form fills about 80 percent of the frame and is centered with both letters entirely visible. True black surround and cool blue-white light toward brand teal #5fb4c8, no purple cast. Portrait 4:5 for a 1600 by 2000 export. The sign itself is the only permitted lettering, and there are no additional marks. The diagonals of the capital X are two separate sealed tubes at slightly different depths, with one passing in front of the other at the crossing without touching, fusing or branching. Keep the wiring inconspicuous and behind the glass. Give the lowercase e a smoothly rounded bend and realistic sealed terminals.`,
    notes:
      "The two sealed diagonals cross at different depths. The lowercase e has a single rounded open terminal.",
  },
];
