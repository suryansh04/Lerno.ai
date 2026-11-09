import { useEffect, useState } from "react";

import { prefersReducedMotion } from "@/lib/utils";

export const STEPS = [
  ["Plan", "Planning the scenes"],
  ["Write", "Writing each scene"],
  ["Animate", "Animating the scenes"],
  ["Ready", "Opening your lesson"],
] as const;
export const READY = STEPS.length - 1;

const SWAP_MS = 450;

// The step's name and line. When the step changes, the old label blurs out first, then the new one comes in.
export function useStepLabel(step: number, failed: boolean) {
  const name = STEPS[step][0];
  const what = failed ? "Stopped at this step" : STEPS[step][1];
  const [label, setLabel] = useState([name, what]);
  const swapping = label[0] !== name || label[1] !== what;
  useEffect(() => {
    if (!swapping) return;
    const timer = setTimeout(() => setLabel([name, what]), prefersReducedMotion() ? 0 : SWAP_MS);
    return () => clearTimeout(timer);
  }, [swapping, name, what]);
  return { label, swapping };
}

export const SWAP = "transition-[opacity,filter] duration-[450ms]";
