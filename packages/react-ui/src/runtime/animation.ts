import { gsap } from "gsap";
import type {
  GameKitsUiAnimationOptions,
  GameKitsUiAnimator,
  GameKitsUiExitAnimationOptions
} from "./types";

const DEFAULT_DURATION = 0.18;

export function createGameKitsUiAnimator(
  defaults: GameKitsUiAnimationOptions = {}
): GameKitsUiAnimator {
  const resolveReducedMotion = (options?: GameKitsUiAnimationOptions) =>
    options?.reducedMotion ?? defaults.reducedMotion ?? prefersReducedMotion();

  const resolveDuration = (options?: GameKitsUiAnimationOptions) =>
    options?.duration ?? defaults.duration ?? DEFAULT_DURATION;

  return {
    enter(element, options) {
      if (resolveReducedMotion(options)) {
        gsap.set(element, { autoAlpha: 1, clearProps: "transform" });
        return;
      }

      gsap.fromTo(
        element,
        { autoAlpha: 0, y: 6 },
        {
          autoAlpha: 1,
          clearProps: "transform",
          duration: resolveDuration(options),
          ease: "power2.out",
          y: 0
        }
      );
    },
    exit(element, options?: GameKitsUiExitAnimationOptions) {
      if (resolveReducedMotion(options)) {
        gsap.set(element, { autoAlpha: 0 });
        options?.onComplete?.();
        return;
      }

      const vars = {
        autoAlpha: 0,
        duration: resolveDuration(options),
        ease: "power2.in",
        y: -4
      };

      gsap.to(
        element,
        options?.onComplete === undefined ? vars : { ...vars, onComplete: options.onComplete }
      );
    },
    emphasize(element, options) {
      if (resolveReducedMotion(options)) {
        return;
      }

      gsap.fromTo(
        element,
        { scale: 0.985 },
        {
          clearProps: "transform",
          duration: resolveDuration(options),
          ease: "back.out(2)",
          scale: 1
        }
      );
    }
  };
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }

  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
