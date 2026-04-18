import type { Transition } from "framer-motion";

/**
 * Aurora motion vocabulary — keep all framer-motion `transition` objects
 * sourced from this file so spring feel is consistent across v2 surfaces.
 */
export const spring = {
  /** snappy press / hover */
  press: { type: "spring", stiffness: 400, damping: 28, mass: 0.8 },
  /** layout shifts (sheets, drawers) */
  layout: { type: "spring", stiffness: 220, damping: 26, mass: 0.9 },
  /** subtle ambient drift on hero / waveform */
  drift: { type: "spring", stiffness: 60, damping: 20, mass: 1.2 },
  /** entry/exit fades */
  fade: { type: "tween", duration: 0.24, ease: [0.32, 0.72, 0, 1] },
  /** page transitions */
  page: { type: "tween", duration: 0.52, ease: [0.22, 1, 0.36, 1] },
} satisfies Record<string, Transition>;

export const fadeIn = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -4 },
  transition: spring.fade,
};

export const sheetUp = {
  initial: { opacity: 0, y: 32 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: 32 },
  transition: spring.layout,
};

export const scaleIn = {
  initial: { opacity: 0, scale: 0.96 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.98 },
  transition: spring.press,
};
